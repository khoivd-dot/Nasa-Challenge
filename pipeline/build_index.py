#!/usr/bin/env python3
"""Build the SPHEREx pointing index from NASA's public IRSA S3 archive.

Reads only the first ~20 KB (the FITS header) of one detector-1 file per
SPHEREx pointing, so the whole survey is indexed without downloading images.
Standard library only, so it runs unchanged in GitHub Actions.

    python3 pipeline/build_index.py            # incremental update
    python3 pipeline/build_index.py --full     # rebuild from scratch

Output (web/public/data/):
    pointings.json  metadata: folders, column layout, detector geometry
    pointings.bin   columnar little-endian arrays, one row per pointing
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import json
import math
import os
import re
import struct
import sys
import time
import urllib.parse
import urllib.request

BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/"
RELEASES = ["qr2", "qr3"]
OUT = os.path.join(os.path.dirname(__file__), "..", "web", "public", "data")
MJD0 = 60700.0  # stored times are float32 days since this MJD (2025-01-26)
PC_SCALE = 0.002 / 32767  # PC matrix entries quantized to int16
NAME_RE = re.compile(r"level2_(\d{4}W\d{2}_\w{2})_(\d{4})_(\d)D(\d)_spx_(.+)\.fits$")


def http(url, headers=None, tries=5):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=headers or {})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:  # network hiccup or S3 throttling
            if i == tries - 1:
                raise
            time.sleep(2 ** i)


def s3_list(prefix, delimiter=None):
    keys, prefixes, token = [], [], None
    while True:
        q = {"list-type": "2", "prefix": prefix, "max-keys": "1000"}
        if delimiter:
            q["delimiter"] = delimiter
        if token:
            q["continuation-token"] = token
        d = http(BUCKET + "?" + urllib.parse.urlencode(q)).decode()
        keys += re.findall(r"<Key>(.*?)</Key>", d)
        prefixes += re.findall(r"<CommonPrefixes><Prefix>(.*?)</Prefix>", d)
        m = re.search(r"<NextContinuationToken>(.*?)</NextContinuationToken>", d)
        if not m:
            return keys, prefixes
        token = m.group(1)


def parse_cards(raw):
    hdr = {}
    for i in range(0, len(raw) - 79, 80):
        card = raw[i:i + 80].decode("ascii", "replace")
        key = card[:8].strip()
        if key == "END":
            break
        if card[8:10] == "= ":
            hdr[key] = card[10:].split("/")[0].strip().strip("'").strip()
    return hdr


def read_wcs(key):
    """WCS + mid-exposure time of the IMAGE HDU (starts at byte 2880)."""
    hdr, start = {}, 2880
    while "MJD-AVG" not in hdr and start < 2880 + 46080:
        hdr.update(parse_cards(http(BUCKET + key, {"Range": f"bytes={start}-{start + 23039}"})))
        start += 23040
    return {k: float(hdr[k]) for k in ("CRVAL1", "CRVAL2", "PC1_1", "PC1_2", "PC2_1", "PC2_2", "CRPIX1", "CRPIX2", "MJD-AVG")}


def tan_project(ra0, dec0, ra, dec):
    """Gnomonic projection of (ra, dec) about (ra0, dec0); returns degrees (xi, eta)."""
    r0, d0, r, d = map(math.radians, (ra0, dec0, ra, dec))
    cosc = math.sin(d0) * math.sin(d) + math.cos(d0) * math.cos(d) * math.cos(r - r0)
    xi = math.cos(d) * math.sin(r - r0) / cosc
    eta = (math.cos(d0) * math.sin(d) - math.sin(d0) * math.cos(d) * math.cos(r - r0)) / cosc
    return math.degrees(xi), math.degrees(eta)


def to_pixel(w, ra, dec):
    """Sky -> detector pixel (FITS 1-based) for a TAN WCS (SIP ignored; ~1 px)."""
    xi, eta = tan_project(w["CRVAL1"], w["CRVAL2"], ra, dec)
    a, b, c, d = w["PC1_1"], w["PC1_2"], w["PC2_1"], w["PC2_2"]
    det = a * d - b * c
    return (d * xi - b * eta) / det + w["CRPIX1"], (-c * xi + a * eta) / det + w["CRPIX2"]


def list_pointings(skip_folders):
    """Map (weekseg, exp) -> {folder, ver, subs} for every detector-1 file."""
    weeks = []
    for rel in RELEASES:
        weeks += s3_list(f"{rel}/level2/", "/")[1]
    weeks = [w for w in weeks if w.count("/") == 3]

    def versions(week):
        return s3_list(week, "/")[1]

    folders = []
    with cf.ThreadPoolExecutor(32) as ex:
        for vs in ex.map(versions, weeks):
            folders += [v.rstrip("/") for v in vs]
    folders = [f for f in folders if f not in skip_folders]
    print(f"{len(weeks)} week segments, {len(folders)} new folders", flush=True)

    def d1_files(folder):
        return folder, s3_list(folder + "/1/")[0]

    pts = {}
    with cf.ThreadPoolExecutor(32) as ex:
        for folder, keys in ex.map(d1_files, folders):
            for k in keys:
                m = NAME_RE.search(k)
                if not m:
                    continue
                weekseg, exp, sub, _, ver = m.groups()
                p = pts.setdefault((weekseg, int(exp)), {})
                p.setdefault((folder, ver), set()).add(int(sub))
    out = {}
    for key, by_folder in pts.items():
        # A pointing reprocessed in a "retry" folder: keep the most complete, newest copy.
        (folder, ver), subs = max(by_folder.items(), key=lambda kv: (len(kv[1]), kv[0][1][-8:]))
        out[key] = {"folder": folder, "ver": ver, "subs": subs}
    return out, set(folders)


def file_key(folder, weekseg, exp, sub, det, ver):
    return f"{folder}/{det}/level2_{weekseg}_{exp:04d}_{sub}D{det}_spx_{ver}.fits"


def calibrate_detectors(sample):
    """Centers and corners of detectors 2 and 3 in detector-1 pixel coordinates."""
    rows = {2: [], 3: []}

    def one(p):
        k1 = file_key(p["folder"], p["weekseg"], p["exp"], p["sub"], 1, p["ver"])
        w1 = read_wcs(k1)
        res = {}
        for det in (2, 3):
            try:
                wd = read_wcs(file_key(p["folder"], p["weekseg"], p["exp"], p["sub"], det, p["ver"]))
            except Exception:
                continue
            # detector-d pixel axes expressed in detector-1 pixels
            res[det] = to_pixel(w1, wd["CRVAL1"], wd["CRVAL2"])
        return res

    with cf.ThreadPoolExecutor(16) as ex:
        for res in ex.map(one, sample):
            for det, xy in res.items():
                rows[det].append(xy)
    geo = {}
    for det, xs in rows.items():
        xs.sort()
        mx = sorted(x for x, _ in xs)[len(xs) // 2]
        my = sorted(y for _, y in xs)[len(xs) // 2]
        spread = max(math.hypot(x - mx, y - my) for x, y in xs)
        geo[str(det)] = {"x": round(mx, 2), "y": round(my, 2), "n": len(xs), "max_dev_px": round(spread, 2)}
        print(f"detector {det} center in D1 pixels: ({mx:.1f}, {my:.1f}) n={len(xs)} max dev {spread:.1f}px", flush=True)
    return geo


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--threads", type=int, default=96)
    ap.add_argument("--limit", type=int, default=0, help="debug: index only N pointings")
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    meta_path, bin_path = os.path.join(OUT, "pointings.json"), os.path.join(OUT, "pointings.bin")

    old_rows, old_meta = [], None
    if not args.full and os.path.exists(meta_path):
        old_meta = json.load(open(meta_path))
        old_rows = decode(old_meta, open(bin_path, "rb").read())
    done_folders = set(old_meta["folders"]) if old_meta else set()

    pts, new_folders = list_pointings(done_folders)
    todo = []
    for (weekseg, exp), p in sorted(pts.items()):
        todo.append({"weekseg": weekseg, "exp": exp, "sub": min(p["subs"]), "subs": p["subs"], "folder": p["folder"], "ver": p["ver"]})
    if args.limit:
        todo = todo[:: max(1, len(todo) // args.limit)]
    print(f"reading {len(todo)} headers", flush=True)

    def work(p):
        try:
            w = read_wcs(file_key(p["folder"], p["weekseg"], p["exp"], p["sub"], 1, p["ver"]))
        except Exception as e:
            print("skip", p["weekseg"], p["exp"], e, flush=True)
            return None
        p.update(w)
        return p

    rows, t0 = [], time.time()
    with cf.ThreadPoolExecutor(args.threads) as ex:
        for i, r in enumerate(ex.map(work, todo)):
            if r:
                rows.append(r)
            if i % 2000 == 0:
                print(f"  {i}/{len(todo)} {time.time() - t0:.0f}s", flush=True)

    folders = sorted(set(old_meta["folders"] if old_meta else []) | {r["folder"] for r in rows} | new_folders)
    geometry = old_meta["detectors"] if old_meta and old_meta.get("detectors") else None
    if geometry is None and rows:
        step = max(1, len(rows) // 60)
        geometry = calibrate_detectors(rows[::step])

    allrows = old_rows + [
        {"mjd": r["MJD-AVG"], "ra": r["CRVAL1"], "dec": r["CRVAL2"],
         "pc": (r["PC1_1"], r["PC1_2"], r["PC2_1"], r["PC2_2"]),
         "folder": r["folder"], "exp": r["exp"], "mask": sum(1 << (s - 1) for s in r["subs"])}
        for r in rows
    ]
    allrows = dedupe(allrows)
    allrows.sort(key=lambda r: r["mjd"])
    write(allrows, folders, geometry, meta_path, bin_path)


def dedupe(rows):
    """One row per exposure. Reprocessed weeks can list an exposure under a
    second folder; keep the latest folder (it sorts last), so incremental runs
    never index the same pointing twice."""
    best = {}
    for r in rows:
        key = (r["folder"].split("/")[2], r["exp"])
        if key not in best or r["folder"] > best[key]["folder"]:
            best[key] = r
    return list(best.values())


COLUMNS = [("t", "f4"), ("ra", "f4"), ("dec", "f4"), ("pc", "i2x4"), ("folder", "u2"), ("exp", "u2"), ("mask", "u1")]


def write(rows, folders, geometry, meta_path, bin_path):
    n = len(rows)
    fidx = {f: i for i, f in enumerate(folders)}
    parts = [
        struct.pack(f"<{n}f", *[r["mjd"] - MJD0 for r in rows]),
        struct.pack(f"<{n}f", *[r["ra"] for r in rows]),
        struct.pack(f"<{n}f", *[r["dec"] for r in rows]),
        struct.pack(f"<{4 * n}h", *[max(-32767, min(32767, round(v / PC_SCALE))) for r in rows for v in r["pc"]]),
        struct.pack(f"<{n}H", *[fidx[r["folder"]] for r in rows]),
        struct.pack(f"<{n}H", *[r["exp"] for r in rows]),
        struct.pack(f"<{n}B", *[r["mask"] for r in rows]),
    ]
    blob, offsets, off = b"".join(parts), {}, 0
    for (name, _), part in zip(COLUMNS, parts):
        offsets[name] = off
        off += len(part)
    meta = {
        "source": BUCKET,
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": n,
        "mjd0": MJD0,
        "pcScale": PC_SCALE,
        "columns": [{"name": c, "type": t, "offset": offsets[c]} for c, t in COLUMNS],
        "folders": folders,
        "detectors": geometry,
        "detectorSize": 2040,
        "crpix": 1020.5,
        "time_range": [rows[0]["mjd"], rows[-1]["mjd"]] if rows else None,
    }
    open(bin_path, "wb").write(blob)
    json.dump(meta, open(meta_path, "w"), indent=1)
    print(f"wrote {n} pointings, {len(blob) / 1e6:.2f} MB", flush=True)


def decode(meta, blob):
    n, off = meta["count"], {c["name"]: c["offset"] for c in meta["columns"]}
    t = struct.unpack_from(f"<{n}f", blob, off["t"])
    ra = struct.unpack_from(f"<{n}f", blob, off["ra"])
    dec = struct.unpack_from(f"<{n}f", blob, off["dec"])
    pc = struct.unpack_from(f"<{4 * n}h", blob, off["pc"])
    folder = struct.unpack_from(f"<{n}H", blob, off["folder"])
    exp = struct.unpack_from(f"<{n}H", blob, off["exp"])
    mask = struct.unpack_from(f"<{n}B", blob, off["mask"])
    return [
        {"mjd": t[i] + meta["mjd0"], "ra": ra[i], "dec": dec[i],
         "pc": tuple(v * meta["pcScale"] for v in pc[4 * i:4 * i + 4]),
         "folder": meta["folders"][folder[i]], "exp": exp[i], "mask": mask[i]}
        for i in range(n)
    ]


if __name__ == "__main__":
    sys.exit(main())
