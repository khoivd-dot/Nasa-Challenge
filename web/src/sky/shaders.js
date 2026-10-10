// GLSL for the sky map. Every layer shares one projection so the globe and the
// full-sky Hammer-Aitoff map can morph into each other: positions are mixed
// in screen space by uMorph (0 = globe, 1 = map). uGround switches the globe
// to a stereographic view from the ground (the "From Earth" mode).

const HEAD = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
#define PI 3.14159265359
#define TAU 6.28318530718
#define SQRT2 1.41421356237
`;

const PROJ = /* glsl */ `
uniform vec3 uRight;     // view basis in equatorial coordinates (east is to the left)
uniform vec3 uUp;
uniform vec3 uFwd;
uniform float uR;        // globe radius, CSS px
uniform float uMorph;    // 0 globe .. 1 full-sky map
uniform vec2 uLon0;      // cos, sin of the map's central right ascension
uniform float uMapS;     // CSS px per Hammer unit
uniform vec2 uMapPan;    // CSS px, y up
uniform vec2 uCenter;    // projection center, CSS px from the top-left corner
uniform vec2 uViewport;  // canvas size, CSS px
uniform float uGround;   // 1: stereographic view from a place on Earth

float lonRel(vec3 d) {
  return atan(d.y * uLon0.x - d.x * uLon0.y, d.x * uLon0.x + d.y * uLon0.y);
}
// Hammer-Aitoff, mirrored so right ascension increases to the left.
vec2 hammer(float lam, float z) {
  float cp = sqrt(max(0.0, 1.0 - z * z));
  float h = sqrt(max(1e-6, 1.0 + cp * cos(0.5 * lam)));
  return vec2(-2.0 * SQRT2 * cp * sin(0.5 * lam) / h, SQRT2 * z / h);
}
// Orthographic view of the sphere from inside; the far side is folded onto the limb.
vec2 globeUnit(vec3 d) {
  vec2 p = vec2(dot(d, uRight), dot(d, uUp));
  if (uGround > 0.5) return p / max(1.0 + dot(d, uFwd), 0.05);
  if (dot(d, uFwd) < 0.0) {
    float l = length(p);
    p = l > 1e-6 ? p / l : vec2(1.0, 0.0);
  }
  return p;
}
vec2 projPx(vec3 d, float lam) {
  vec2 g = uR * globeUnit(d);
  if (uMorph <= 0.0) return g;
  return mix(g, uMapPan + uMapS * hammer(lam, d.z), uMorph);
}
float visOf(vec3 d) {
  if (uGround > 0.5) return smoothstep(-0.62, -0.5, dot(d, uFwd));
  return mix(smoothstep(-0.005, 0.035, dot(d, uFwd)), 1.0, uMorph);
}
vec4 toClip(vec2 p) {
  vec2 s = uCenter + vec2(p.x, -p.y);
  return vec4(s.x / uViewport.x * 2.0 - 1.0, 1.0 - s.y / uViewport.y * 2.0, 0.0, 1.0);
}
const vec4 HIDDEN = vec4(2.0, 2.0, 2.0, 1.0);
`;

// Survey pass of a time (days since mjd0): 0 commissioning, 1..3 (3 = 3 and later).
const PASS = /* glsl */ `
uniform float uS0;
uniform float uPeriod;
int passOf(float t) {
  return t < uS0 ? 0 : min(3, 1 + int(floor((t - uS0) / uPeriod)));
}
`;

// Instanced spherical quads: 4 corner unit vectors per instance, drawn as a
// 4-vertex triangle strip. Handles the map seam with two passes (uWrap +1/-1).
const QUAD_VS = /* glsl */ `${HEAD}${PROJ}${PASS}
in vec3 aC0;
in vec3 aC1;
in vec3 aC2;
in vec3 aC3;
in float aT;
uniform float uWrap;
uniform float uTime;
uniform float uWindow;   // > 0: only instances with uTime - uWindow < t <= uTime
out vec3 vDir;
out vec2 vGlobe;
out vec2 vHam;
out vec2 vUV;
out float vAge;
out float vKeep;
flat out int vPass;

void main() {
  int id = gl_VertexID;
  vec3 c = id == 0 ? aC0 : id == 1 ? aC1 : id == 2 ? aC3 : aC2;
  vUV = vec2(id == 1 || id == 3 ? 1.0 : 0.0, id >= 2 ? 1.0 : 0.0);
  vPass = passOf(aT);
  vAge = 0.0;
  if (uWindow > 0.0) {
    float age = uTime - aT;
    if (age < 0.0 || age > uWindow) { gl_Position = HIDDEN; return; }
    vAge = age / uWindow;
  }
  float lam = lonRel(c);
  vKeep = 1.0;
  if (uGround > 0.5 && min(min(visOf(aC0), visOf(aC1)), min(visOf(aC2), visOf(aC3))) < 0.01) {
    gl_Position = HIDDEN;
    return;
  }
  if (uMorph > 0.0) {
    vec4 L = vec4(lonRel(aC0), lonRel(aC1), lonRel(aC2), lonRel(aC3));
    float lmin = min(min(L.x, L.y), min(L.z, L.w));
    float lmax = max(max(L.x, L.y), max(L.z, L.w));
    if (lmax - lmin > PI) {
      // Straddles the map edge: unwrap toward this pass's side.
      if (uWrap > 0.0) {
        L += TAU * vec4(lessThan(L, vec4(0.0)));
        if (lam < 0.0) lam += TAU;
      } else {
        L -= TAU * vec4(greaterThan(L, vec4(0.0)));
        if (lam > 0.0) lam -= TAU;
      }
      float spread = max(max(L.x, L.y), max(L.z, L.w)) - min(min(L.x, L.y), min(L.z, L.w));
      if (spread > 0.5 * PI) vKeep = 1.0 - uMorph; // contains a pole: no sane map shape
    } else if (uWrap < 0.0) {
      gl_Position = HIDDEN;
      return;
    }
  } else if (uWrap < 0.0) {
    gl_Position = HIDDEN;
    return;
  }
  vDir = c;
  vGlobe = globeUnit(c);
  vHam = hammer(lam, c.z);
  gl_Position = toClip(projPx(c, lam));
}
`;

// Milky Way and the accumulated footprint cube map along a sky direction.
const SKY_LAYERS = /* glsl */ `
uniform samplerCube uCube;
uniform sampler2D uMilky;
uniform float uFoot;
uniform float uMW;
uniform float uCountScale;
uniform float uSatLog;
uniform float uEdge;
uniform vec3 uPassCol[4];
vec3 skyLayers(vec3 d) {
  vec3 col = vec3(0.0);
  if (uMW > 0.0) {
    float ra = atan(d.y, d.x);
    float dec = asin(clamp(d.z, -1.0, 1.0));
    float mw = texture(uMilky, vec2(ra / TAU, dec / PI + 0.5)).r;
    col += (vec3(0.60, 0.58, 0.54) * mw * 0.26 + vec3(0.95, 0.80, 0.62) * mw * mw * 0.12) * uMW;
  }
  if (uFoot > 0.0) {
    vec4 c = max(texture(uCube, d) * uCountScale, 0.0);
    float total = c.r + c.g + c.b + c.a;
    // Footprint edges: the visit count steps across a footprint boundary.
    float edge = min(fwidth(total), 3.0) * uEdge;
    if (total > 0.002) {
      // Hue leans to the most recent pass; brightness follows log(visits).
      vec4 w = c * vec4(1.0, 2.0, 4.0, 8.0);
      vec3 hue = (w.r * uPassCol[0] + w.g * uPassCol[1] + w.b * uPassCol[2] + w.a * uPassCol[3]) / (w.r + w.g + w.b + w.a);
      float I = clamp(log2(1.0 + total) / uSatLog, 0.0, 1.0);
      float cover = clamp(total, 0.0, 1.0);
      float lum = 0.115 + 0.28 * pow(I, 1.8) + 0.04 * edge;
      vec3 f = hue * lum + vec3(1.0, 0.95, 0.88) * pow(smoothstep(0.6, 1.0, I), 2.0) * 0.9;
      col += f * cover * uFoot;
    }
  }
  return col;
}
`;

// Sky body: base color, Milky Way and the accumulated footprint cube map.
const SKY_FS = /* glsl */ `${HEAD}${SKY_LAYERS}
uniform float uMorph;
uniform vec3 uFwd;
uniform float uAlphaMul;
in vec3 vDir;
in vec2 vGlobe;
in vec2 vHam;
in float vKeep;
out vec4 o;

void main() {
  vec3 d = normalize(vDir);
  float rg = length(vGlobe);
  float aG = clamp(0.5 + (1.0 - rg) / max(fwidth(rg), 1e-5), 0.0, 1.0);
  float eh = sqrt(vHam.x * vHam.x * 0.125 + vHam.y * vHam.y * 0.5);
  float aM = clamp(0.5 + (1.0 - eh) / max(fwidth(eh), 1e-5), 0.0, 1.0);
  float shape = mix(aG, 1.0, smoothstep(0.0, 0.25, uMorph)) * mix(1.0, aM, smoothstep(0.55, 1.0, uMorph));
  shape *= uAlphaMul * vKeep;
  if (shape <= 0.0) discard;

  // Base: a dark photographic plate with a warm limb (globe) or edge glow (map).
  vec3 col = vec3(0.036, 0.035, 0.034);
  float rim = smoothstep(0.6, 1.0, rg);
  col += vec3(0.10, 0.075, 0.045) * rim * rim * rim * (1.0 - uMorph);
  col += vec3(0.06, 0.045, 0.028) * pow(smoothstep(0.8, 1.0, eh), 2.0) * uMorph;
  col += skyLayers(d);
  o = vec4(col * shape, shape);
}
`;

// Recently observed footprints ("scan head"), additive.
const SCAN_FS = /* glsl */ `${HEAD}
uniform vec3 uPassCol[4];
uniform float uGain;
uniform float uMorph;
uniform float uAlphaMul;
in vec2 vUV;
in float vAge;
in float vKeep;
in vec2 vHam;
flat in int vPass;
out vec4 o;

void main() {
  float eh = sqrt(vHam.x * vHam.x * 0.125 + vHam.y * vHam.y * 0.5);
  if (uMorph > 0.5 && eh > 1.0) discard;
  float k = 1.0 - vAge;
  vec2 e = abs(vUV - 0.5) * 2.0;
  float edge = max(e.x, e.y);
  float rim = smoothstep(1.0 - 1.6 * fwidth(edge), 1.0, edge);
  vec3 pc = uPassCol[vPass];
  vec3 col = pc * (0.02 + 0.075 * k * k) + pc * rim * (0.04 + 0.26 * k) + vec3(1.0) * pow(k, 40.0) * 0.5;
  o = vec4(col * uGain * vKeep * uAlphaMul, 0.0);
}
`;

// Footprint accumulation into a cube map: one face per draw, one channel per pass.
const CUBE_VS = /* glsl */ `${HEAD}${PASS}
in vec3 aC0;
in vec3 aC1;
in vec3 aC2;
in vec3 aC3;
in float aT;
uniform mat3 uFace;
uniform float uInc;
out vec4 vInc;
void main() {
  int id = gl_VertexID;
  vec3 c = id == 0 ? aC0 : id == 1 ? aC1 : id == 2 ? aC3 : aC2;
  vec3 f = c * uFace;
  gl_Position = vec4(f.x, f.y, f.z - 0.002, f.z);
  int p = passOf(aT);
  vInc = vec4(p == 0 ? 1.0 : 0.0, p == 1 ? 1.0 : 0.0, p == 2 ? 1.0 : 0.0, p == 3 ? 1.0 : 0.0) * uInc;
}
`;

const CUBE_FS = /* glsl */ `${HEAD}
in vec4 vInc;
out vec4 o;
void main() { o = vInc; }
`;

// Thin footprint outlines when zoomed in: instanced GL_LINES, 8 vertices per quad.
const OUTLINE_VS = /* glsl */ `${HEAD}${PROJ}${PASS}
in vec3 aC0;
in vec3 aC1;
in vec3 aC2;
in vec3 aC3;
in float aT;
uniform float uTime;
uniform vec3 uPassCol[4];
uniform float uAlpha;
out vec3 vCol;
vec3 corner(int k) { return k == 0 ? aC0 : k == 1 ? aC1 : k == 2 ? aC2 : aC3; }
void main() {
  if (aT > uTime) { gl_Position = HIDDEN; return; }
  int id = gl_VertexID;
  int k = ((id >> 1) + (id & 1)) & 3;
  vec3 c = corner(k);
  float vis = min(visOf(aC0), visOf(aC2));
  if (vis < 0.01) { gl_Position = HIDDEN; return; }
  float lam = lonRel(c);
  if (uMorph > 0.0) {
    vec4 L = vec4(lonRel(aC0), lonRel(aC1), lonRel(aC2), lonRel(aC3));
    if (max(max(L.x, L.y), max(L.z, L.w)) - min(min(L.x, L.y), min(L.z, L.w)) > PI) {
      gl_Position = HIDDEN;
      return;
    }
  }
  vCol = uPassCol[passOf(aT)] * uAlpha * vis;
  gl_Position = toClip(projPx(c, lam));
}
`;

const OUTLINE_FS = /* glsl */ `${HEAD}
in vec3 vCol;
out vec4 o;
void main() { o = vec4(vCol, 0.0); }
`;

// Anti-aliased lines from instanced segments (a, b unit vectors).
const LINE_VS = /* glsl */ `${HEAD}${PROJ}
in vec3 aA;
in vec3 aB;
in float aS;
uniform float uWidth;
uniform float uDpr;
out float vAcross;
out float vHalf;
out float vAlong;
out float vAlpha;
void main() {
  int id = gl_VertexID;
  float side = (id & 1) == 0 ? -1.0 : 1.0;
  bool atB = id >= 2;
  float la = lonRel(aA);
  float lb = lonRel(aB);
  vec2 pa = projPx(aA, la);
  vec2 pb = projPx(aB, lb);
  float va = visOf(aA);
  float vb = visOf(aB);
  float seam = uMorph > 0.0 && abs(la - lb) > PI ? 1.0 - smoothstep(0.0, 0.3, uMorph) : 1.0;
  // Hide whole segments only (per-vertex hiding would tear the strip).
  if (max(va, vb) * seam <= 0.001) { gl_Position = HIDDEN; return; }
  float alpha = (atB ? vb : va) * seam;
  vec2 dir = pb - pa;
  float len = length(dir);
  dir = len > 1e-5 ? dir / len : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  float hw = 0.5 * uWidth + 1.0 / uDpr;
  vec2 p = (atB ? pb : pa) + n * side * hw;
  vAcross = side * hw;
  vHalf = 0.5 * uWidth;
  float seg = acos(clamp(dot(aA, aB), -1.0, 1.0)) * 57.29578;
  vAlong = aS + (atB ? seg : 0.0);
  vAlpha = alpha;
  gl_Position = toClip(p);
}
`;

const LINE_FS = /* glsl */ `${HEAD}
uniform vec4 uColor;
uniform float uDpr;
uniform float uDash;
in float vAcross;
in float vHalf;
in float vAlong;
in float vAlpha;
out vec4 o;
void main() {
  float cov = clamp((vHalf - abs(vAcross)) * uDpr + 0.5, 0.0, 1.0);
  if (uDash > 0.0) {
    float f = fract(vAlong / uDash);
    float w = fwidth(vAlong / uDash);
    cov *= smoothstep(0.0, w, f) * (1.0 - smoothstep(0.55 - w, 0.55, f));
  }
  float a = uColor.a * cov * vAlpha;
  o = vec4(uColor.rgb * a, a);
}
`;

const STAR_VS = /* glsl */ `${HEAD}${PROJ}
in vec3 aDir;
in float aMag;
in vec3 aCol;
uniform float uDpr;
uniform float uScale;
uniform float uBright;
out vec3 vCol;
out float vCore;
void main() {
  float vis = visOf(aDir);
  if (vis < 0.01) { gl_Position = HIDDEN; gl_PointSize = 0.0; return; }
  vec2 p = projPx(aDir, lonRel(aDir));
  float m = aMag;
  float core = clamp(1.1 + 0.62 * pow(max(6.8 - m, 0.0), 1.25), 1.1, 9.0) * uScale; // CSS px
  float b = clamp(0.32 + 0.17 * (6.5 - m), 0.25, 1.6) * vis * uBright;
  float size = core * 4.0;
  gl_PointSize = size * uDpr;
  vCore = core / size;
  vCol = aCol * b;
  gl_Position = toClip(p);
}
`;

const STAR_FS = /* glsl */ `${HEAD}
in vec3 vCol;
in float vCore;
out vec4 o;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = length(q);
  if (r > 1.0) discard;
  float x = r / vCore;
  float core = exp(-x * x * 2.2);
  float halo = exp(-r * 5.5) * 0.22;
  o = vec4(vCol * (core + halo), 0.0);
}
`;

// Full-screen background: ink gradient, vignette, a warm halo around the sky.
const BG_VS = /* glsl */ `${HEAD}
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const BG_FS = /* glsl */ `${HEAD}
uniform vec2 uViewport;
uniform vec2 uCenter;
uniform float uDpr;
uniform float uR;
uniform float uMorph;
uniform float uMapS;
uniform vec2 uMapPan;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 px = vec2(gl_FragCoord.x, uViewport.y * uDpr - gl_FragCoord.y) / uDpr;
  vec2 uv = px / uViewport;
  vec2 p = px - uCenter;
  p.y = -p.y;
  vec3 col = mix(vec3(0.034, 0.035, 0.040), vec3(0.020, 0.021, 0.024), uv.y);
  float v = length((uv - 0.5) * vec2(uViewport.x / uViewport.y, 1.0));
  col *= 1.0 - 0.6 * smoothstep(0.35, 1.15, v);
  float r = length(p) / uR;
  float hg = exp(-max(r - 1.0, 0.0) * 7.0) * step(0.98, r) * 0.9 + exp(-max(r - 1.0, 0.0) * 28.0) * 0.4;
  vec2 q = (p - uMapPan) / uMapS;
  float e = sqrt(q.x * q.x * 0.125 + q.y * q.y * 0.5);
  float hm = exp(-max(e - 1.0, 0.0) * 12.0) * 0.6;
  col += vec3(0.16, 0.115, 0.06) * mix(hg, hm, uMorph) * 0.55;
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}
`;

// Ground view, per pixel: the sky direction under each screen point
// (inverse stereographic), so the sky is exact out to the corners.
const VIEW_DIR = /* glsl */ `
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
uniform float uR;
uniform vec2 uCenter;
uniform vec2 uViewport;
uniform float uDpr;
vec2 screenPx() {
  return vec2(gl_FragCoord.x, uViewport.y * uDpr - gl_FragCoord.y) / uDpr;
}
vec3 viewDir(vec2 px) {
  vec2 p = (px - uCenter) / uR;
  p.y = -p.y;
  float r2 = dot(p, p);
  float s = 2.0 / (1.0 + r2);
  return normalize(uRight * p.x * s + uUp * p.y * s + uFwd * (1.0 - r2) / (1.0 + r2));
}
`;

// Night sky seen from the ground: dark sky, Milky Way and SPHEREx coverage.
const GSKY_FS = /* glsl */ `${HEAD}${VIEW_DIR}${SKY_LAYERS}
uniform vec3 uZenith;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 d = viewDir(screenPx());
  float a = dot(d, uZenith);
  // Darkest at the zenith, a little airglow toward the horizon.
  vec3 col = mix(vec3(0.020, 0.030, 0.062), vec3(0.008, 0.012, 0.030), smoothstep(0.0, 0.9, a));
  col += skyLayers(d);
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}
`;

// Drawn last in the ground view: daylight and twilight, haze near the horizon,
// the Sun, and the ground itself (a gentle hill line) covering what has set.
const GROUND_FS = /* glsl */ `${HEAD}${VIEW_DIR}
uniform vec3 uZenith;
uniform vec3 uNorth;
uniform vec3 uEast;
uniform vec3 uSun;
uniform float uSunAlt;   // sine of the Sun's altitude
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float hills(float az) {
  return 0.0045 + 0.0035 * sin(3.0 * az + 0.7) + 0.0022 * sin(7.0 * az + 2.1) + 0.0012 * sin(17.0 * az + 0.3) + 0.0006 * sin(41.0 * az);
}
void main() {
  vec3 d = viewDir(screenPx());
  float a = dot(d, uZenith);
  float az = atan(dot(d, uEast), dot(d, uNorth));
  float sunA = uSunAlt;
  float day = smoothstep(-0.10, 0.10, sunA);           // ~ -6 deg .. +6 deg
  float twi = smoothstep(-0.31, -0.06, sunA) * (1.0 - smoothstep(0.02, 0.18, sunA));
  vec3 sh = normalize(uSun - uZenith * dot(uSun, uZenith) + 1e-6 * uNorth);
  vec3 dh = normalize(d - uZenith * a + 1e-6 * uNorth);
  float toSun = max(dot(sh, dh), 0.0);
  float cosSun = dot(d, uSun);
  float above = max(a, 0.0);

  // Sky light: a premultiplied layer over the stars and the coverage map.
  vec3 dayCol = mix(vec3(0.40, 0.56, 0.80), vec3(0.11, 0.24, 0.52), pow(above, 0.6));
  float dayA = day * 0.82;
  vec3 col = dayCol * dayA;
  float alpha = dayA;
  // Twilight: warm near the Sun's side of the horizon, blue above it.
  float tw = twi * exp(-above * 5.0) * (0.25 + 0.75 * pow(toSun, 3.0));
  col += vec3(0.85, 0.42, 0.18) * tw * 0.55 + vec3(0.10, 0.16, 0.34) * twi * exp(-above * 2.0) * 0.35;
  alpha = max(alpha, tw * 0.35);
  // Haze and airglow: stars fade into it near the horizon.
  float haze = exp(-above * 18.0);
  col += mix(vec3(0.030, 0.045, 0.080), vec3(0.45, 0.58, 0.78), day) * haze * 0.45;
  alpha = max(alpha, haze * 0.5);
  // The Sun and its glow.
  float sunUp = smoothstep(-0.02, 0.01, sunA);
  col += vec3(1.0, 0.92, 0.78) * (pow(max(cosSun, 0.0), 3000.0) * 3.0 + pow(max(cosSun, 0.0), 60.0) * 0.35 * day) * sunUp;

  // Ground with an anti-aliased hill line.
  float h = hills(az);
  float g = clamp((h - a) / max(fwidth(a), 1e-5) + 0.5, 0.0, 1.0);
  float depth = clamp(-a, 0.0, 1.0);
  vec3 groundCol = mix(vec3(0.020, 0.026, 0.034), vec3(0.010, 0.012, 0.016), sqrt(depth));
  groundCol = mix(groundCol, vec3(0.09, 0.11, 0.09), day * (1.0 - 0.6 * sqrt(depth)));
  groundCol += vec3(0.85, 0.42, 0.18) * twi * 0.05 * pow(toSun, 3.0) * exp(-depth * 30.0);
  groundCol += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  // A faint rim of light along the skyline.
  float rim = exp(-abs(a - h) / max(fwidth(a), 1e-5) * 0.7) * 0.06;
  col = mix(col, groundCol, g) + vec3(0.35, 0.45, 0.65) * rim * (1.0 - g);
  alpha = mix(alpha, 1.0, g);
  o = vec4(col, alpha);
}
`;

export const SHADERS = {
  quadVs: QUAD_VS,
  skyFs: SKY_FS,
  scanFs: SCAN_FS,
  cubeVs: CUBE_VS,
  cubeFs: CUBE_FS,
  outlineVs: OUTLINE_VS,
  outlineFs: OUTLINE_FS,
  lineVs: LINE_VS,
  lineFs: LINE_FS,
  starVs: STAR_VS,
  starFs: STAR_FS,
  bgVs: BG_VS,
  bgFs: BG_FS,
  gskyFs: GSKY_FS,
  groundFs: GROUND_FS,
};
