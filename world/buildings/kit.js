// Settlement building kit: seeded RNG, a merged-geometry builder (one draw call per material),
// a local-frame helper, shared materials (CC0 Poly Haven textures + procedural canvases).
import * as THREE from 'three';

export function makeRng(seed) {
  let a = seed >>> 0;
  const r = () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
  r.pick = arr => arr[Math.floor(r() * arr.length)];
  r.chance = p => r() < p;
  return r;
}
export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

const colCache = new Map();
export function col(c, mul = 1) {
  if (Array.isArray(c)) return mul === 1 ? c : [c[0] * mul, c[1] * mul, c[2] * mul];
  const k = c + '|' + mul; let v = colCache.get(k);
  if (!v) { const t = new THREE.Color(c); v = [t.r * mul, t.g * mul, t.b * mul]; colCache.set(k, v); }
  return v;
}

// unit primitives
export const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  cyl12: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
  cyl24: new THREE.CylinderGeometry(0.5, 0.5, 1, 24),
  halfCyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 1, false, -Math.PI / 2, Math.PI),
  cone8: new THREE.ConeGeometry(0.5, 1, 8),
  cone24: new THREE.ConeGeometry(0.5, 1, 24),
  pyr4: new THREE.ConeGeometry(0.7071, 1, 4, 1).rotateY(Math.PI / 4),
  blob: new THREE.IcosahedronGeometry(0.5, 1),
  dome: new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  sphere: new THREE.SphereGeometry(0.5, 12, 8),
};

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();
// Accumulates transformed geometry with vertex colours; UVs are world-space triplanar (metres) unless own=true.
export class MB {
  constructor() { this.p = []; this.n = []; this.c = []; this.u = []; this.i = []; this.count = 0; }
  // bot: optional colour for the vertices in the lower half of the unit primitive (vertex-colour grime / plinth gradient)
  add(geom, m, color, own = false, bot = null) {
    const P = geom.attributes.position, N = geom.attributes.normal, U = geom.attributes.uv, I = geom.index, C = geom.attributes.color;
    _m3.getNormalMatrix(m); const base = this.count; const c = col(color), cb = bot == null ? null : col(bot);
    for (let k = 0; k < P.count; k++) {
      const ly = P.getY(k);
      _v.fromBufferAttribute(P, k).applyMatrix4(m); _n.fromBufferAttribute(N, k).applyMatrix3(_m3).normalize();
      this.p.push(_v.x, _v.y, _v.z); this.n.push(_n.x, _n.y, _n.z);
      if (C && color == null) this.c.push(C.getX(k), C.getY(k), C.getZ(k));
      else { const cc = cb && ly < 0 ? cb : c; this.c.push(cc[0], cc[1], cc[2]); }
      if (own && U) this.u.push(U.getX(k), U.getY(k));
      else { const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
        if (ay >= ax && ay >= az) this.u.push(_v.x, _v.z); else if (ax >= az) this.u.push(_v.z, _v.y); else this.u.push(_v.x, _v.y); }
    }
    if (I) for (let k = 0; k < I.count; k++) this.i.push(I.getX(k) + base);
    else for (let k = 0; k < P.count; k++) this.i.push(base + k);
    this.count += P.count;
  }
  quad(a, b, c2, d, color) { // four world-space [x,y,z] corners, CCW seen from the front
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c2, ...a, ...c2, ...d], 3)); g.computeVertexNormals();
    this.add(g, IDENT, color);
  }
  get empty() { return this.count === 0; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
const IDENT = new THREE.Matrix4();

// A bag of MBs keyed by material name -> meshes.
export class Bag {
  constructor(mats) { this.mats = mats; this.mb = {}; }
  get(name) { return this.mb[name] || (this.mb[name] = new MB()); }
  meshes(parent, { shadow = true } = {}) {
    const out = [];
    for (const [k, mb] of Object.entries(this.mb)) {
      if (mb.empty) continue;
      const mesh = new THREE.Mesh(mb.geometry(), this.mats[k] || this.mats.paint);
      mesh.castShadow = shadow && !NO_SHADOW.has(k); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      mesh.name = k; parent.add(mesh); out.push(mesh);
    }
    return out;
  }
}
const NO_SHADOW = new Set(['glass', 'glassLit', 'bulb', 'redLight', 'cone', 'ground', 'pad', 'asphalt', 'paving', 'water', 'paint2', 'regimeFlag']);

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
// Local frame: origin (x,y,z), yaw a. Local +x/+z rotate with a (THREE convention).
export class Frame {
  constructor(x, y, z, a = 0) { this.x = x; this.y = y; this.z = z; this.a = a; this.c = Math.cos(a); this.s = Math.sin(a); }
  w(lx, lz) { return [this.x + lx * this.c + lz * this.s, this.z - lx * this.s + lz * this.c]; }
  mat(lx, ly, lz, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
    const [wx, wz] = this.w(lx, lz); _e.set(rx, this.a + ry, rz, 'YXZ'); _q.setFromEuler(_e);
    return _m.compose(_p.set(wx, this.y + ly, wz), _q, _s.set(sx, sy, sz));
  }
  box(mb, lx, ly, lz, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) { mb.add(G.box, this.mat(lx, ly, lz, ry, sx, sy, sz, rx, rz), color); }
  // box with a bottom-to-top vertex-colour gradient (dirt / plinth at the base)
  boxG(mb, lx, ly, lz, sx, sy, sz, color, bot, ry = 0) { mb.add(G.box, this.mat(lx, ly, lz, ry, sx, sy, sz), color, false, bot); }
  geo(mb, g, lx, ly, lz, ry, sx, sy, sz, color, own = false, rx = 0, rz = 0) { mb.add(g, this.mat(lx, ly, lz, ry, sx, sy, sz, rx, rz), color, own); }
  // a cylinder/box "beam" between two local points
  beam(mb, a, b, r, color, g = G.cyl8) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
    _v.set(dx, dy, dz).normalize(); _q.setFromUnitVectors(_n.set(0, 1, 0), _v);
    const yaw = new THREE.Quaternion().setFromAxisAngle(_n.set(0, 1, 0), this.a); _q.premultiply(yaw);
    const [wx, wz] = this.w((a[0] + b[0]) / 2, (a[2] + b[2]) / 2);
    mb.add(g, _m.compose(_p.set(wx, this.y + (a[1] + b[1]) / 2, wz), _q, _s.set(r * 2, L, r * 2)), color);
  }
}

// Gable roof over w (local x) x d (local z), ridge along x. Returns {roof (own uv), gables}.
export function gableRoof(w, d, rise, o = 0.45) {
  const W = w / 2 + 0.25, D = d / 2 + o, drop = o * rise / (d / 2), sl = Math.hypot(D, rise + drop);
  const pos = [], uv = [];
  const q = (p, u) => { pos.push(...p); uv.push(...u); };
  // front slope (+z)
  q([-W, -drop, D], [-W, 0]); q([W, -drop, D], [W, 0]); q([W, rise, 0], [W, sl]);
  q([-W, -drop, D], [-W, 0]); q([W, rise, 0], [W, sl]); q([-W, rise, 0], [-W, sl]);
  // back slope (-z)
  q([W, -drop, -D], [W, 0]); q([-W, -drop, -D], [-W, 0]); q([-W, rise, 0], [-W, sl]);
  q([W, -drop, -D], [W, 0]); q([-W, rise, 0], [-W, sl]); q([W, rise, 0], [W, sl]);
  const roof = new THREE.BufferGeometry();
  roof.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); roof.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); roof.computeVertexNormals();
  const gp = [w / 2, 0, d / 2, w / 2, 0, -d / 2, w / 2, rise, 0, -w / 2, 0, -d / 2, -w / 2, 0, d / 2, -w / 2, rise, 0];
  const gables = new THREE.BufferGeometry(); gables.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); gables.computeVertexNormals();
  return { roof, gables };
}
// Hip roof (w >= d): two trapezoids and two triangles.
export function hipRoof(w, d, rise, o = 0.45) {
  const W = w / 2 + o, D = d / 2 + o, drop = o * rise / (d / 2), r = Math.max(0, w / 2 - d / 2), sl = Math.hypot(D, rise + drop);
  const pos = [], uv = [];
  const t = (a, b, c, ua, ub, uc) => { pos.push(...a, ...b, ...c); uv.push(...ua, ...ub, ...uc); };
  const e1 = [-W, -drop, D], e2 = [W, -drop, D], e3 = [W, -drop, -D], e4 = [-W, -drop, -D], r1 = [-r, rise, 0], r2 = [r, rise, 0];
  t(e1, e2, r2, [-W, 0], [W, 0], [r, sl]); t(e1, r2, r1, [-W, 0], [r, sl], [-r, sl]);
  t(e3, e4, r1, [W, 0], [-W, 0], [-r, sl]); t(e3, r1, r2, [W, 0], [-r, sl], [r, sl]);
  t(e2, e3, r2, [D, 0], [-D, 0], [0, sl]); t(e4, e1, r1, [D, 0], [-D, 0], [0, sl]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  return g;
}
// Arch frame (unit-ish): outer w x h, opening ow wide with semicircular top reaching oh; depth dep. Cached.
const archCache = new Map();
export function archGeom(w, h, ow, oh, dep) {
  const k = [w, h, ow, oh, dep].join(); if (archCache.has(k)) return archCache.get(k);
  const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h); s.lineTo(-w / 2, h); s.lineTo(-w / 2, 0);
  const r = ow / 2, hole = new THREE.Path(); hole.moveTo(-r, 0); hole.lineTo(r, 0); hole.lineTo(r, oh - r); hole.absarc(0, oh - r, r, 0, Math.PI, false); hole.lineTo(-r, 0);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: dep, bevelEnabled: false, curveSegments: 8 }); g.translate(0, 0, -dep / 2);
  archCache.set(k, g); return g;
}
// Parabolic dish (Lathe), radius r, depth dpt, opening +y.
export function dishGeom(r, dpt) {
  const pts = []; for (let i = 0; i <= 8; i++) { const x = r * i / 8; pts.push(new THREE.Vector2(x, dpt * (x / r) ** 2)); }
  for (let i = 8; i >= 0; i--) { const x = r * i / 8; pts.push(new THREE.Vector2(x * 0.98, dpt * (x / r) ** 2 - 0.12)); }
  return new THREE.LatheGeometry(pts, 20);
}

// Ground plate draped over terrain: rotated rectangle around (cx,cz), w x d, cells; keep(lx,lz) filters cells.
export function drape(mb, H, cx, cz, a, w, d, cell, keep, yOff, color) {
  const F = new Frame(cx, 0, cz, a), nx = Math.max(1, Math.ceil(w / cell)), nz = Math.max(1, Math.ceil(d / cell));
  const cw = w / nx, cd = d / nz, hs = new Float32Array((nx + 1) * (nz + 1));
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) { const [x, z] = F.w(-w / 2 + i * cw, -d / 2 + j * cd); hs[i * (nz + 1) + j] = H(x, z) + yOff; }
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const lx = -w / 2 + (i + 0.5) * cw, lz = -d / 2 + (j + 0.5) * cd; if (keep && !keep(lx, lz)) continue;
    const P = (ii, jj) => { const [x, z] = F.w(-w / 2 + ii * cw, -d / 2 + jj * cd); return [x, hs[ii * (nz + 1) + jj], z]; };
    mb.quad(P(i, j + 1), P(i + 1, j + 1), P(i + 1, j), P(i, j), color);
  }
}

// ---------- materials ----------
// Ground decals (paving, aprons, asphalt) sit a few cm above a terrain whose distant LOD chunks are coarser than
// the drape grid, so the terrain poked through in a blocky checker. Pull the decal toward the camera in view space
// by a fraction of its distance: screen position is unchanged (pure perspective), only depth moves, and the bias
// grows with distance exactly like the LOD error does.
export function decalBias(mat, k = 0.004) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      gl_Position = projectionMatrix * vec4( mvPosition.xyz * ( 1.0 - ${k.toFixed(5)} * smoothstep( 2.0, 30.0, - mvPosition.z ) ), 1.0 );`);
  };
  mat.customProgramCacheKey = () => 'decal' + k;
  return mat;
}
// Military pad concrete: world-space slab joints, dust/dirt patches, oil stains and tyre tracks, all in-shader (no extra draws).
export function padDetail(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPadW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPadW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vPadW;
      float padH( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
      float padN( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( padH( i ), padH( i + vec2( 1, 0 ) ), f.x ), mix( padH( i + vec2( 0, 1 ) ), padH( i + vec2( 1, 1 ) ), f.x ), f.y ); }
      float padF( vec2 p ) { return padN( p ) * 0.55 + padN( p * 2.1 ) * 0.3 + padN( p * 4.3 ) * 0.15; }
      float padTrack( float v, float w ) { float a = abs( fract( v ) - 0.5 ); return 1.0 - smoothstep( w * 0.5, w, a ); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec2 p = vPadW.xz;
        float big = padF( p * 0.018 ), mid = padF( p * 0.09 ), fine = padN( p * 1.7 );
        vec3 c = diffuseColor.rgb;
        c *= mix( 0.86, 1.08, big ) * mix( 0.94, 1.04, fine );
        c = mix( c, c * vec3( 1.08, 0.98, 0.82 ), smoothstep( 0.55, 0.75, mid ) * 0.6 );            // sandy dust drifts
        vec2 g = abs( fract( p / 7.5 ) - 0.5 ) * 7.5;                                                 // slab joints
        float joint = 1.0 - smoothstep( 0.03, 0.09, min( g.x, g.y ) );
        c *= 1.0 - joint * 0.35;
        float stain = smoothstep( 0.72, 0.86, padF( p * 0.21 + 17.0 ) );                              // oil stains
        c = mix( c, c * 0.45, stain * 0.75 );
        // tyre tracks: wavy twin lines, broken up by noise
        float v1 = ( p.y + sin( p.x * 0.021 ) * 9.0 + padN( p * 0.05 ) * 6.0 ) / 19.0;
        float v2 = ( p.x + sin( p.y * 0.017 + 2.0 ) * 11.0 ) / 27.0;
        float tk = max( padTrack( v1, 0.012 ) + padTrack( v1 + 0.11, 0.012 ), padTrack( v2, 0.009 ) + padTrack( v2 + 0.08, 0.009 ) );
        tk *= smoothstep( 0.35, 0.6, padN( p * 0.03 + 5.0 ) ) * ( 0.6 + 0.4 * fine );
        c *= 1.0 - clamp( tk, 0.0, 1.0 ) * 0.28;
        diffuseColor.rgb = c;
      }`);
  };
  const k = mat.customProgramCacheKey?.() || ''; mat.customProgramCacheKey = () => k + 'pad';
  return mat;
}
// Precast military concrete: panel joints along the wall (world-space tangent from the face normal, so it works at any
// yaw), per-panel tone, horizontal course seams, mottling and rain streaks. All in-shader, no extra draws.
export function panelDetail(mat, panel = 3.0, course = 2.1) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPnW; varying vec3 vPnN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPnW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz; vPnN = normalize( mat3( modelMatrix ) * objectNormal );');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vPnW; varying vec3 vPnN;
      float pnH( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
      float pnN( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( pnH( i ), pnH( i + vec2( 1, 0 ) ), f.x ), mix( pnH( i + vec2( 0, 1 ) ), pnH( i + vec2( 1, 1 ) ), f.x ), f.y ); }
      float pnLine( float v, float w ) { float d = abs( fract( v ) - 0.5 ) * 2.0; float fw = fwidth( v ) * 2.0; return 1.0 - smoothstep( 1.0 - w - fw, 1.0 - w * 0.3, d ); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 n = normalize( vPnN ); vec2 t = normalize( vec2( -n.z, n.x ) + 1e-5 );
        float side = 1.0 - smoothstep( 0.6, 0.8, abs( n.y ) );
        float u = mix( vPnW.x + vPnW.z * 0.37, dot( vPnW.xz, t ), side ), y = mix( vPnW.z, vPnW.y, side );
        vec3 c = diffuseColor.rgb;
        float pid = floor( u / ${panel.toFixed(2)} );
        c *= 0.93 + 0.12 * pnH( vec2( pid, 3.1 ) );                                         // per-panel tone
        c *= mix( 0.9, 1.05, pnN( vec2( u, y ) * 0.7 ) ) * mix( 0.95, 1.03, pnN( vec2( u, y ) * 4.0 ) );
        float streak = pnN( vec2( u * 2.3, y * 0.12 + pid * 7.0 ) );                          // rain streaks
        c *= 1.0 - side * smoothstep( 0.55, 0.85, streak ) * 0.18;
        float fade = 1.0 - smoothstep( 40.0, 140.0, length( vPnW - cameraPosition ) );
        float seam = max( pnLine( u / ${panel.toFixed(2)}, 0.03 ), pnLine( y / ${course.toFixed(2)}, 0.018 ) * 0.6 ) * side * fade;
        c *= 1.0 - seam * 0.45;
        diffuseColor.rgb = c;
      }`);
  };
  const k = mat.customProgramCacheKey?.() || ''; mat.customProgramCacheKey = () => k + 'panel' + panel;
  return mat;
}
function hescoCanvas(g, W, H) { // gabion: beige geotextile with a welded wire grid, sand bulging between wires
  g.fillStyle = '#d4c49c'; g.fillRect(0, 0, W, H);
  let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) { const v = 150 + rnd() * 60 | 0; g.fillStyle = `rgba(${v},${v * 0.9 | 0},${v * 0.66 | 0},0.25)`; g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 4, 2 + rnd() * 4); }
  const n = 8, cw = W / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const gr = g.createRadialGradient(i * cw + cw / 2, j * cw + cw / 2, 1, i * cw + cw / 2, j * cw + cw / 2, cw * 0.7);
    gr.addColorStop(0, 'rgba(255,245,215,0.18)'); gr.addColorStop(1, 'rgba(60,50,30,0.22)'); g.fillStyle = gr; g.fillRect(i * cw, j * cw, cw, cw); }
  g.strokeStyle = 'rgba(88,88,82,0.85)'; g.lineWidth = 1.4;
  for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * cw, 0); g.lineTo(i * cw, H); g.stroke(); g.beginPath(); g.moveTo(0, i * cw); g.lineTo(W, i * cw); g.stroke(); }
}
let MATS = null;
export function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function roofCanvas(g, W, H) {
  g.fillStyle = '#9a4426'; g.fillRect(0, 0, W, H);
  const cols = 8, rows = 8, cw = W / cols, rh = H / rows; let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
    const x = k * cw, y = r * rh, t = rnd();
    const base = [184 + t * 40 - 20, 84 + t * 30 - 12, 48 + t * 16 - 8].map(v => v | 0);
    const gr = g.createLinearGradient(x, 0, x + cw, 0);
    gr.addColorStop(0, `rgb(${base[0] * 0.55 | 0},${base[1] * 0.5 | 0},${base[2] * 0.5 | 0})`);
    gr.addColorStop(0.45, `rgb(${Math.min(255, base[0] * 1.15) | 0},${base[1] * 1.12 | 0},${base[2] * 1.1 | 0})`);
    gr.addColorStop(1, `rgb(${base[0] * 0.6 | 0},${base[1] * 0.55 | 0},${base[2] * 0.55 | 0})`);
    g.fillStyle = gr; g.fillRect(x + 1, y, cw - 2, rh);
    g.fillStyle = 'rgba(30,10,5,0.45)'; g.fillRect(x, y + rh - 4, cw, 4);
    if (rnd() < 0.25) { g.fillStyle = `rgba(90,95,70,${0.15 + rnd() * 0.2})`; g.fillRect(x + 2, y + rnd() * rh, cw - 4, 6 + rnd() * 10); }
  }
}
// Original regime emblem: a black iron crown-of-spikes over a bar, on red/black. Rebel "Undertow": white wave + star on teal.
export function drawRegime(g, W, H) {
  g.fillStyle = '#a3141b'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#141011'; g.fillRect(0, H * 0.36, W, H * 0.28);
  const cx = W * 0.5, cy = H * 0.5, R = H * 0.3;
  g.fillStyle = '#efe6d2'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
  g.fillStyle = '#141011'; g.beginPath(); g.arc(cx, cy, R * 0.86, 0, 7); g.fill();
  g.fillStyle = '#efe6d2';
  g.beginPath(); g.moveTo(cx - R * 0.6, cy + R * 0.35); g.lineTo(cx - R * 0.6, cy - R * 0.1); g.lineTo(cx - R * 0.42, cy + R * 0.05);
  g.lineTo(cx - R * 0.2, cy - R * 0.55); g.lineTo(cx, cy - R * 0.05); g.lineTo(cx + R * 0.2, cy - R * 0.55); g.lineTo(cx + R * 0.42, cy + R * 0.05);
  g.lineTo(cx + R * 0.6, cy - R * 0.1); g.lineTo(cx + R * 0.6, cy + R * 0.35); g.closePath(); g.fill();
  g.fillRect(cx - R * 0.6, cy + R * 0.45, R * 1.2, R * 0.14);
}
export function drawRebel(g, W, H) {
  g.fillStyle = '#138a8a'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#0b5f63'; g.fillRect(0, H * 0.78, W, H * 0.22);
  g.strokeStyle = '#f4f7f2'; g.lineWidth = H * 0.07; g.lineCap = 'round';
  for (const yy of [0.6, 0.74]) { g.beginPath(); for (let x = 0; x <= W; x += 4) { const y = H * yy + Math.sin(x / W * Math.PI * 4) * H * 0.05; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
  g.fillStyle = '#f4f7f2'; g.beginPath(); const cx = W * 0.5, cy = H * 0.3, R = H * 0.16;
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R * 0.42 : R; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  g.fill();
}
function drawPoster(g, W, H) {
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#b3191f'); gr.addColorStop(1, '#5e0b0f'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.fillStyle = '#efe3c4'; g.beginPath(); g.arc(W * 0.24, H * 0.5, H * 0.42, 0, 7); g.fill();
  g.fillStyle = '#17110f'; // stylised general: shoulders, head, peaked cap
  g.beginPath(); g.moveTo(W * 0.06, H * 0.92); g.quadraticCurveTo(W * 0.24, H * 0.58, W * 0.42, H * 0.92); g.fill();
  g.beginPath(); g.ellipse(W * 0.24, H * 0.48, H * 0.12, H * 0.15, 0, 0, 7); g.fill();
  g.beginPath(); g.ellipse(W * 0.24, H * 0.32, H * 0.17, H * 0.05, 0, 0, 7); g.fill(); g.fillRect(W * 0.24 - H * 0.12, H * 0.22, H * 0.24, H * 0.1);
  g.fillStyle = '#c9a43a'; g.fillRect(W * 0.1, H * 0.78, H * 0.1, H * 0.035); g.fillRect(W * 0.33, H * 0.78, H * 0.1, H * 0.035);
  g.fillStyle = '#f3ead2'; g.font = `900 ${H * 0.34 | 0}px Impact, Arial Black, sans-serif`; g.textAlign = 'left'; g.fillText('VASK', W * 0.48, H * 0.5);
  g.font = `700 ${H * 0.085 | 0}px Arial, sans-serif`; g.fillText('ORDINE  ·  PANE  ·  PATRIA', W * 0.485, H * 0.68);
  g.fillStyle = '#141011'; g.fillRect(W * 0.48, H * 0.75, W * 0.48, H * 0.05);
  g.fillStyle = '#f3ead2'; g.font = `700 ${H * 0.06 | 0}px Arial, sans-serif`; g.fillText('THE GENERAL WATCHES OVER CORVANA', W * 0.485, H * 0.88);
}

export function getMaterials() {
  if (MATS) return MATS;
  const loader = new THREE.TextureLoader(), base = new URL('../../assets/tex/', import.meta.url).href;
  const cache = {};
  const tex = (file, tile, srgb) => {
    const k = file + tile; if (cache[k]) return cache[k];
    const t = loader.load(base + file, undefined, undefined, () => console.warn('[settlements] missing texture', file));
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / tile, 1 / tile); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return (cache[k] = t);
  };
  const pbr = (n, tile, o = {}, useMap = true) => {
    const arm = tex(n + '_arm.jpg', tile);
    return new THREE.MeshStandardMaterial({ map: useMap ? tex(n + '_diff.jpg', tile, true) : null, normalMap: tex(n + '_nor.jpg', tile),
      roughnessMap: arm, metalnessMap: o.metalness ? arm : null, vertexColors: true, roughness: 1, metalness: 0, ...o });
  };
  const roofT = canvasTex(256, 256, roofCanvas); roofT.wrapS = roofT.wrapT = THREE.RepeatWrapping; roofT.repeat.set(1 / 2.6, 1 / 2.4);
  const mk = o => new THREE.MeshStandardMaterial(o);
  const regimeT = canvasTex(256, 160, drawRegime), rebelT = canvasTex(256, 160, drawRebel), posterT = canvasTex(1024, 512, drawPoster);
  MATS = {
    plaster: pbr('plaster', 3.2, { normalScale: new THREE.Vector2(0.6, 0.6) }),
    stone: pbr('stone', 2.5),
    brick: pbr('brick', 2.2),
    paving: pbr('paving', 3, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    ground: pbr('wall', 4, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    pad: pbr('concrete', 5, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    asphalt: pbr('asphalt', 6, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    concrete: pbr('wall', 3),
    planks: pbr('planks', 2),
    metal: pbr('metal', 2, { metalness: 0.6, roughness: 0.8 }, false),
    roof: mk({ map: roofT, bumpMap: roofT, bumpScale: 2, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
    paint: mk({ vertexColors: true, roughness: 0.65, side: THREE.DoubleSide }),
    paint2: mk({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    foliage: mk({ vertexColors: true, roughness: 0.9, flatShading: true }),
    bronze: pbr('metal', 1.5, { metalness: 0.85, roughness: 0.45 }, false),
    glass: mk({ color: 0x1b242c, roughness: 0.12, metalness: 0.7, vertexColors: false }),
    glassLit: mk({ color: 0x2e2416, emissive: 0xffb45e, emissiveIntensity: 0.1, roughness: 0.3 }),
    bulb: mk({ color: 0xfff1cf, emissive: 0xffc878, emissiveIntensity: 0.3, roughness: 0.4 }),
    redLight: mk({ color: 0x400806, emissive: 0xff2010, emissiveIntensity: 2 }),
    water: mk({ color: 0x2f7f8f, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.85 }),
    milWall: pbr('concrete', 2.5, { normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.92 }, false),
    milMetal: pbr('metal', 2, { roughness: 0.55, metalness: 0.2, normalScale: new THREE.Vector2(0.5, 0.5) }, false),
    hesco: mk({ map: (() => { const t = canvasTex(128, 128, hescoCanvas); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 1.1, 1 / 1.1); return t; })(), vertexColors: true, roughness: 0.95 }),
    sandbag: mk({ vertexColors: true, roughness: 0.97, flatShading: true }),
    // town windows + door lamps in ONE material: vertex colour encodes (unused, lit, lamp) -> unlit glass (0,0,0), lit
    // window (0,1,0), lamp (0,1,1). Lets each town detail chunk draw glass/lit glass/bulbs in a single call.
    window: (() => { const m = mk({ color: 0x1b242c, roughness: 0.15, metalness: 0.6, emissive: 0xffb45e, emissiveIntensity: 0.1, vertexColors: true });
      m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', 'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 1.0, 0.93, 0.8 ), vColor.b );')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor.g * ( 1.0 + vColor.b * 1.5 );'); };
      m.customProgramCacheKey = () => 'sbwindow'; return m; })(),
    charred: mk({ color: 0x1f1a17, roughness: 1, metalness: 0.1 }),
    cone: new THREE.MeshBasicMaterial({ color: 0xfff3d0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }),
    regimeFlag: mk({ map: regimeT, side: THREE.DoubleSide, roughness: 0.85 }),
    rebelFlag: mk({ map: rebelT, side: THREE.DoubleSide, roughness: 0.85 }),
    poster: mk({ map: posterT, roughness: 0.7, emissive: 0xffffff, emissiveMap: posterT, emissiveIntensity: 0 }),
  };
  MATS.glass.vertexColors = false; MATS.milMetal.metalnessMap = null; panelDetail(MATS.milWall);
  decalBias(MATS.paving); decalBias(MATS.ground); padDetail(decalBias(MATS.pad)); decalBias(MATS.asphalt, 0.005); decalBias(MATS.paint2, 0.006);
  return MATS;
}

// Colour palettes
export const PAL = {
  walls: [0xf4efe4, 0xf2ecdf, 0xeee6d4, 0xf6f1e7, 0xe9dcc0, 0xe6c58f, 0xdcae6a, 0xd59c58, 0xe8c9a5, 0xdfb7a0, 0xcfd6c2, 0xf0d9a2, 0xbfd0d6, 0xe6d2b4],
  shutters: [0x4c7a4a, 0x2f6e72, 0x3c5d88, 0x6e4a2c, 0x5f7f3a, 0x2c5a6e, 0x8a3a2c, 0x46664f],
  doors: [0x5b3a22, 0x3d5f7a, 0x2f5a4a, 0x7a3f24, 0x4a3324],
  flowers: [0xd8325a, 0xe0508a, 0xb33a8a, 0xf08a2a, 0xe8e0e0, 0xc62828],
  greens: [0x55703a, 0x4b6633, 0x6b7f45, 0x3f5a2e, 0x7a8a55],
  awnings: [[0xb3261e, 0xf2ead8], [0x1f5f8a, 0xf2ead8], [0x2f7a4a, 0xf2ead8], [0xd98a1e, 0xf2ead8]],
  mil: { olive: 0x5a5f3c, grey: 0x7d8186, dark: 0x3a3d40, white: 0xe8e6e0, red: 0xb3191f, black: 0x1a1a1c, yellow: 0xe0b31f, sand: 0xb9a57a },
};
