// Named places to explore. Coordinates are ICRS (J2000) catalog positions
// (SIMBAD); stars with large proper motion carry their motion so the Lab can
// place them where they really were on each SPHEREx date.

export const TARGETS = [
  { id: 'orion', name: 'Orion Nebula', alt: 'M42', ra: 83.8221, dec: -5.3911, kind: 'Star-forming nebula' },
  { id: 'galactic-center', name: 'Galactic Center', alt: 'Sgr A*', ra: 266.41684, dec: -29.00781, kind: 'Heart of the Milky Way' },
  { id: 'andromeda', name: 'Andromeda Galaxy', alt: 'M31', ra: 10.68471, dec: 41.26875, kind: 'Spiral galaxy' },
  { id: 'pleiades', name: 'Pleiades', alt: 'M45', ra: 56.75, dec: 24.1167, kind: 'Star cluster' },
  { id: 'crab', name: 'Crab Nebula', alt: 'M1', ra: 83.63308, dec: 22.0145, kind: 'Supernova remnant' },
  { id: 'eagle', name: 'Eagle Nebula', alt: 'M16', ra: 274.7, dec: -13.8067, kind: 'Star-forming nebula' },
  { id: 'lagoon', name: 'Lagoon Nebula', alt: 'M8', ra: 270.9042, dec: -24.3867, kind: 'Star-forming nebula' },
  { id: 'carina', name: 'Carina Nebula', alt: 'NGC 3372', ra: 161.265, dec: -59.8667, kind: 'Star-forming nebula' },
  { id: 'lmc', name: 'Large Magellanic Cloud', alt: 'LMC', ra: 80.8938, dec: -69.7561, kind: 'Dwarf galaxy' },
  { id: 'smc', name: 'Small Magellanic Cloud', alt: 'SMC', ra: 13.1867, dec: -72.8286, kind: 'Dwarf galaxy' },
  { id: 'nep', name: 'North Ecliptic Pole', alt: 'SPHEREx deep field', ra: 270.0, dec: 66.56071, kind: 'Most-revisited spot on the sky' },
  { id: 'sep', name: 'South Ecliptic Pole', alt: 'SPHEREx deep field', ra: 90.0, dec: -66.56071, kind: 'Most-revisited spot on the sky' },
  { id: 'betelgeuse', name: 'Betelgeuse', alt: 'α Orionis', ra: 88.79294, dec: 7.40706, kind: 'Red supergiant' },
  { id: 'vega', name: 'Vega', alt: 'α Lyrae', ra: 279.23473, dec: 38.78369, kind: 'Bright star' },
  { id: 'm13', name: 'Hercules Cluster', alt: 'M13', ra: 250.4235, dec: 36.4613, kind: 'Globular cluster' },
  { id: 'm51', name: 'Whirlpool Galaxy', alt: 'M51', ra: 202.4696, dec: 47.1952, kind: 'Spiral galaxy' },
  { id: 'rho-oph', name: 'Rho Ophiuchi cloud', alt: 'ρ Oph', ra: 246.7958, dec: -23.4472, kind: 'Dusty star nursery' },
  { id: 'horsehead', name: 'Horsehead Nebula', alt: 'B33', ra: 85.2458, dec: -2.4583, kind: 'Dark nebula' },
  {
    id: 'barnard',
    name: "Barnard's Star",
    alt: 'Fastest star in our sky',
    ra: 269.45208,
    dec: 4.69339,
    pmRa: -801.6,
    pmDec: 10362.4,
    epoch: 2000.0,
    kind: 'Red dwarf, 6 light-years away',
  },
  {
    id: 'luhman16',
    name: 'Luhman 16 AB',
    alt: 'Nearest brown dwarfs',
    ra: 162.31488,
    dec: -53.31836,
    pmRa: -2762.2,
    pmDec: 355.0,
    epoch: 2010.5,
    kind: 'Brown dwarf pair, 6.5 light-years away',
  },
  {
    id: 'kapteyn',
    name: "Kapteyn's Star",
    alt: 'Second-fastest star',
    ra: 77.91904,
    dec: -45.01842,
    pmRa: 6505.1,
    pmDec: -5730.8,
    epoch: 2000.0,
    kind: 'Halo red subdwarf',
  },
];

export const SOLAR_SYSTEM = ['Pluto', 'Neptune', 'Uranus', 'Saturn', 'Jupiter', 'Mars'];

export function searchTargets(q) {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const hits = TARGETS.filter((t) => `${t.name} ${t.alt} ${t.kind}`.toLowerCase().includes(s)).map((t) => ({ type: 'target', ...t }));
  const bodies = SOLAR_SYSTEM.filter((b) => b.toLowerCase().includes(s)).map((b) => ({ type: 'body', id: b.toLowerCase(), name: b, kind: 'Solar-system body' }));
  return [...bodies, ...hits].slice(0, 8);
}
