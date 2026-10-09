// GLSL for the sky map. Every layer shares one projection so the globe and the
// full-sky Hammer-Aitoff map can morph into each other: positions are mixed
// in screen space by uMorph (0 = globe, 1 = map).

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

// Sky body: base color, Milky Way and the accumulated footprint cube map.
const SKY_FS = /* glsl */ `${HEAD}
uniform samplerCube uCube;
uniform sampler2D uMilky;
uniform float uMorph;
uniform vec3 uFwd;
uniform float uFoot;
uniform float uMW;
uniform float uCountScale;
uniform float uSatLog;
uniform float uAlphaMul;
uniform float uEdge;
uniform vec3 uPassCol[4];
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

  // Base: deep blue sphere with a soft limb (globe) or edge glow (map).
  vec3 col = vec3(0.026, 0.038, 0.088);
  float rim = smoothstep(0.6, 1.0, rg);
  col += vec3(0.04, 0.09, 0.19) * rim * rim * rim * (1.0 - uMorph);
  col += vec3(0.025, 0.06, 0.13) * pow(smoothstep(0.8, 1.0, eh), 2.0) * uMorph;

  if (uMW > 0.0) {
    float ra = atan(d.y, d.x);
    float dec = asin(clamp(d.z, -1.0, 1.0));
    float mw = texture(uMilky, vec2(ra / TAU, dec / PI + 0.5)).r;
    col += (vec3(0.50, 0.56, 0.80) * mw * 0.20 + vec3(0.95, 0.80, 0.62) * mw * mw * 0.10) * uMW;
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
      float lum = 0.095 + 0.26 * pow(I, 1.8) + 0.04 * edge;
      vec3 f = hue * lum + vec3(1.0, 0.95, 0.88) * pow(smoothstep(0.6, 1.0, I), 2.0) * 0.9;
      col += f * cover * uFoot;
    }
  }
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
  float alpha = atB ? visOf(aB) : visOf(aA);
  if (uMorph > 0.0 && abs(la - lb) > PI) alpha *= 1.0 - smoothstep(0.0, 0.3, uMorph);
  if (alpha <= 0.001) { gl_Position = HIDDEN; return; }
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

// Full-screen background: deep space gradient, vignette, halo around the sky.
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
  vec3 col = mix(vec3(0.013, 0.017, 0.040), vec3(0.006, 0.008, 0.020), uv.y);
  col += vec3(0.016, 0.010, 0.034) * smoothstep(0.9, 0.0, length(uv - vec2(0.85, 0.1)));
  float v = length((uv - 0.5) * vec2(uViewport.x / uViewport.y, 1.0));
  col *= 1.0 - 0.6 * smoothstep(0.35, 1.15, v);
  float r = length(p) / uR;
  float hg = exp(-max(r - 1.0, 0.0) * 7.0) * step(0.98, r) * 0.9 + exp(-max(r - 1.0, 0.0) * 28.0) * 0.4;
  vec2 q = (p - uMapPan) / uMapS;
  float e = sqrt(q.x * q.x * 0.125 + q.y * q.y * 0.5);
  float hm = exp(-max(e - 1.0, 0.0) * 12.0) * 0.6;
  col += vec3(0.07, 0.14, 0.28) * mix(hg, hm, uMorph) * 0.55;
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(col, 1.0);
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
};
