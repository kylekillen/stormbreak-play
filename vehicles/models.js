// Procedural vehicle models. Built once per type (geometry merged per material and cached),
// then instanced per vehicle as a handful of meshes sharing geometry.
// Model space: +Z forward, +Y up, ground at y=0 with wheels resting on it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DEFS, REGIME } from './defs.js';

const V3 = THREE.Vector3;
const cache = new Map();
const mats = {};
const paintCache = new Map();

export function materials() {
  if (mats.trim) return mats;
  mats.trim = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.62, metalness: 0.2 });
  mats.chrome = new THREE.MeshStandardMaterial({ color: 0xd8dadd, roughness: 0.14, metalness: 1 });
  mats.rim = new THREE.MeshStandardMaterial({ color: 0xa9adb3, roughness: 0.25, metalness: 0.95 });
  mats.rubber = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92, metalness: 0 });
  mats.glass = new THREE.MeshPhysicalMaterial({ color: 0x0b1218, roughness: 0.03, metalness: 0.2, transparent: true,
    opacity: 0.62, envMapIntensity: 1.8, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false });
  mats.head = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff1d2, emissiveIntensity: 0.4, roughness: 0.1, metalness: 0.3 });
  mats.tail = new THREE.MeshStandardMaterial({ color: 0x5a0606, emissive: 0xff1a10, emissiveIntensity: 0.35, roughness: 0.2 });
  mats.stripe = new THREE.MeshStandardMaterial({ color: REGIME.stripe, roughness: 0.55, metalness: 0.1 });
  mats.olive = new THREE.MeshStandardMaterial({ color: REGIME.olive, roughness: 0.78, metalness: 0.18 });
  mats.gunmetal = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.45, metalness: 0.8 });
  mats.seat = new THREE.MeshStandardMaterial({ color: 0x2b211b, roughness: 0.8 });
  mats.deck = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.7 });
  mats.charred = new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.95, metalness: 0.15 });
  mats.blur = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
  mats.flame = new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  mats.skin = new THREE.MeshStandardMaterial({ color: 0xc08a64, roughness: 0.7 });
  mats.cloth = new THREE.MeshStandardMaterial({ color: 0x3b4a5a, roughness: 0.9 });
  return mats;
}

export function paintMaterial(color, regime) {
  const key = color + (regime ? 'r' : '');
  if (paintCache.has(key)) return paintCache.get(key);
  const m = regime ? new THREE.MeshPhysicalMaterial({ color, roughness: 0.72, metalness: 0.2, clearcoat: 0.15, clearcoatRoughness: 0.6 })
    : new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.2 });
  paintCache.set(key, m);
  return m;
}

// ---------- geometry helpers ----------
const norm = g => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals(); return g; };
function xf(g, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
  const m = new THREE.Matrix4().compose(new V3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new V3(...s));
  return g.applyMatrix4(m);
}
function deform(g, fn) {
  const a = g.attributes.position, v = new V3();
  for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i); fn(v); a.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g;
}
const box = (w, h, d, o) => xf(new THREE.BoxGeometry(w, h, d), o);
function rbox(w, h, d, r = 0.06, o) { // rounded box via beveled extrude
  r = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  const s = new THREE.Shape(); const hw = w / 2 - r, hh = h / 2 - r;
  s.moveTo(-hw, -hh); s.lineTo(hw, -hh); s.lineTo(hw, hh); s.lineTo(-hw, hh); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(d - 2 * r) / 2); return xf(g, o);
}
const cyl = (rt, rb, h, seg = 16, o) => xf(new THREE.CylinderGeometry(rt, rb, h, seg), o);
const sph = (r, o, ws = 16, hs = 10) => xf(new THREE.SphereGeometry(r, ws, hs), o);
// Side profile (points [z,y]) extruded across the width (x), beveled.
function profile(pts, width, bevel = 0.07, o, arches) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.length === 4) s.quadraticCurveTo(p[2], p[3], p[0], p[1]); else s.lineTo(p[0], p[1]);
  }
  s.closePath();
  if (arches) for (const [z, y, r] of arches) { const h = new THREE.Path(); h.absarc(z, y, r, 0, Math.PI * 2, false); s.holes.push(h); }
  const d = Math.max(0.01, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 10 });
  g.rotateY(-Math.PI / 2); g.translate(d / 2, 0, 0);
  return o ? xf(g, o) : g;
}
// Plan-view shape (points [x,z]) extruded vertically from y0 to y1.
function plan(pts, y0, y1, bevel = 0.05) {
  const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.01, y1 - y0 - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 12 });
  g.rotateX(-Math.PI / 2); g.translate(0, y0 + bevel, 0); return g;
}
function lathe(pts, seg = 20, o) { // pts [r, z] along +Z axis
  const g = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(Math.max(0.0001, r), z)), seg);
  g.rotateX(Math.PI / 2); g.rotateY(Math.PI); // lathe Y axis -> +Z
  return o ? xf(g, o) : g;
}

class Parts {
  constructor() { this.m = {}; }
  add(k, g) { (this.m[k] ||= []).push(norm(g)); return this; }
  merged() { const out = {}; for (const [k, a] of Object.entries(this.m)) out[k] = mergeGeometries(a, false); return out; }
}

// ---------- wheels ----------
const wheelCache = new Map();
export function wheelGeometry(r, w, chunky) {
  const key = `${r}|${w}|${chunky}`;
  if (wheelCache.has(key)) return wheelCache.get(key);
  // tire: cylinder with displaced tread blocks + rounded shoulders
  const tire = new THREE.CylinderGeometry(r, r, w, 48, 4, true);
  deform(tire, v => {
    const a = Math.atan2(v.z, v.x), edge = Math.abs(v.y) / (w / 2);
    const tread = chunky ? (Math.sin(a * 22) > 0.1 ? 1 : 0) * 0.035 * r / 0.4 : (Math.sin(a * 40 + (v.y > 0 ? 0.6 : 0)) > 0.3 ? 0.008 : 0);
    const rr = r - (edge > 0.99 ? 0.06 * r : 0) + (edge < 0.99 ? tread : 0);
    const k = rr / Math.hypot(v.x, v.z); v.x *= k; v.z *= k;
  });
  const side = new THREE.RingGeometry(r * 0.66, r * 0.94, 40, 1);
  const tp = new Parts();
  tp.add('t', tire);
  tp.add('t', xf(side.clone(), { p: [0, w / 2, 0], r: [-Math.PI / 2, 0, 0] }));
  tp.add('t', xf(side.clone(), { p: [0, -w / 2, 0], r: [Math.PI / 2, 0, 0] }));
  // rim: dish, spokes, hub, lug ring
  const rp = new Parts();
  const rimR = r * 0.68;
  rp.add('r', cyl(rimR, rimR, w * 0.82, 28, { p: [0, 0, 0] }));
  for (const s of [1, -1]) {
    rp.add('r', cyl(rimR * 0.3, rimR * 0.3, 0.05, 12, { p: [0, s * w * 0.43, 0] }));
    const n = chunky ? 6 : 5;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      rp.add('r', box(rimR * 0.95, 0.04, rimR * 0.16, { p: [Math.cos(a) * rimR * 0.5, s * w * 0.42, Math.sin(a) * rimR * 0.5], r: [0, -a, 0] }));
    }
    rp.add('r', xf(new THREE.TorusGeometry(rimR * 0.98, 0.022, 6, 32), { p: [0, s * w * 0.41, 0], r: [Math.PI / 2, 0, 0] }));
  }
  const g = { tire: tp.merged().t, rim: rp.merged().r };
  // cylinder axis is Y; rotate so the axle is X
  g.tire.rotateZ(Math.PI / 2); g.rim.rotateZ(Math.PI / 2);
  wheelCache.set(key, g); return g;
}

// ---------- people (drivers / pilots) ----------
let personGeo = null;
export function personGeometry() {
  if (personGeo) return personGeo;
  const p = new Parts();
  p.add('cloth', rbox(0.42, 0.55, 0.26, 0.08, { p: [0, 0.32, 0] }));
  p.add('cloth', rbox(0.36, 0.22, 0.42, 0.06, { p: [0, 0.02, 0.15] })); // thighs
  p.add('cloth', rbox(0.12, 0.42, 0.12, 0.04, { p: [0.27, 0.32, 0.12], r: [-0.9, 0, 0] }));
  p.add('cloth', rbox(0.12, 0.42, 0.12, 0.04, { p: [-0.27, 0.32, 0.12], r: [-0.9, 0, 0] }));
  p.add('skin', sph(0.12, { p: [0, 0.72, 0.02] }));
  personGeo = p.merged(); return personGeo;
}

// ---------- car-like bodies ----------
function addLights(P, L, W, frontY, rearY, opts = {}) {
  const hw = W / 2;
  for (const s of [1, -1]) {
    P.add('head', rbox(0.34, 0.12, 0.1, 0.04, { p: [s * (hw - 0.3), frontY, L / 2 - 0.02] }));
    P.add('tail', rbox(opts.tailW || 0.38, 0.1, 0.08, 0.03, { p: [s * (hw - 0.26), rearY, -L / 2 + 0.02] }));
    if (opts.mirrors !== false) P.add('trim', rbox(0.18, 0.1, 0.08, 0.03, { p: [s * (hw + 0.05), opts.mirrorY || frontY + 0.45, opts.mirrorZ || 0.7] }));
  }
}
function cabinGlass(P, W, zr, zrt, zft, zf, yb, yt, inset = 0.06) {
  // cabin painted shell + side windows + windscreen + rear screen
  P.add('paint', profile([[zr, yb], [zrt, yt, (zr + zrt) / 2 - 0.05, (yb + yt) / 2 + 0.12], [zft, yt], [zf, yb, (zf + zft) / 2 + 0.05, (yb + yt) / 2 + 0.12]], W, 0.06));
  const cut = (k) => deform(profile([[zr + 0.12, yb + 0.04], [zrt + 0.06, yt - 0.06], [zft - 0.06, yt - 0.06], [zf - 0.14, yb + 0.04]], 0.03, 0.01), v => { v.x += k; });
  P.add('glass', cut(W / 2 - 0.035 + inset * 0)); P.add('glass', cut(-W / 2 + 0.035));
  const ws = (z0, y0, z1, y1, s) => {
    const len = Math.hypot(z1 - z0, y1 - y0), ang = Math.atan2(y1 - y0, z1 - z0);
    P.add('glass', box(W - 0.2, len - 0.08, 0.025, { p: [0, (y0 + y1) / 2 + 0.02, (z0 + z1) / 2 + s * 0.035], r: [-(Math.PI / 2 - ang * -1) * 0 + (Math.PI / 2 - ang) * -1 * -1 - Math.PI / 2 + 0, 0, 0] }));
  };
  // windscreen and rear glass as tilted panels laid along the cabin edges
  const panel = (z0, y0, z1, y1, out) => {
    const len = Math.hypot(z1 - z0, y1 - y0); const g = new THREE.BoxGeometry(W - 0.22, 0.025, len - 0.06);
    const ang = Math.atan2(y1 - y0, z1 - z0);
    g.rotateX(-ang); g.translate(0, (y0 + y1) / 2 + out * 0.03, (z0 + z1) / 2 + out * Math.sign(z1 - z0) * -0.0);
    P.add('glass', g);
  };
  void ws;
  panel(zf, yb, zft, yt, 1); panel(zr, yb, zrt, yt, 1);
}

function carModel(type, d) {
  const P = new Parts();
  const [W, , L] = d.size, R = d.wheelR, l2 = L / 2;
  const zF = d.wheelZ[0], zB = d.wheelZ[d.wheelZ.length - 1];
  const ar = R + 0.07, ay = R;
  const arches = d.wheelZ.map(z => [z, ay, ar]);
  const bodyGround = (pts, top) => deform(profile(pts, W, 0.08, null, null), v => {
    const zt = Math.abs(v.z) / l2; v.x *= 1 - 0.07 * zt ** 4;
    if (top && v.y > top) v.x *= 1 - 0.1 * Math.min(1, (v.y - top) / 0.3);
  });
  // arch cut: rebuild bottom contour going around each wheel
  const bottom = (y0) => { // returns points from rear to front along the bottom with arches
    const pts = []; const zs = [...d.wheelZ].sort((a, b) => a - b);
    for (const z of zs) {
      pts.push([z - ar, y0]);
      const n = 8; for (let i = 1; i < n; i++) { const a = Math.PI - i / n * Math.PI; pts.push([z + Math.cos(a) * ar, ay + Math.sin(a) * ar]); }
      pts.push([z + ar, y0]);
    }
    return pts;
  };
  void arches;
  const regime = !!d.regime;
  if (type === 'sports') {
    const b = 0.28;
    const pts = [[-l2, b + 0.08], [-l2 + 0.05, 0.78], [-1.2, 0.86, -l2 + 0.1, 0.86], [1.0, 0.74], [l2, 0.5, 1.9, 0.72], [l2 - 0.05, b], ...bottom(b).reverse()];
    P.add('paint', bodyGround(pts, 0.7));
    cabinGlass(P, W - 0.32, -1.25, -0.55, 0.15, 1.05, 0.78, 1.18);
    P.add('trim', box(W - 0.3, 0.06, 0.35, { p: [0, 0.98, -l2 + 0.18] })); // spoiler
    for (const s of [1, -1]) P.add('trim', box(0.05, 0.16, 0.06, { p: [s * 0.6, 0.9, -l2 + 0.2] }));
    P.add('trim', rbox(W - 0.5, 0.12, 0.1, 0.04, { p: [0, 0.34, l2 - 0.01] }));
    P.add('chrome', cyl(0.05, 0.05, 0.12, 10, { p: [0.4, 0.3, -l2], r: [Math.PI / 2, 0, 0] }));
    P.add('chrome', cyl(0.05, 0.05, 0.12, 10, { p: [-0.4, 0.3, -l2], r: [Math.PI / 2, 0, 0] }));
    addLights(P, L, W, 0.58, 0.72, { mirrorY: 0.95, mirrorZ: 0.85, tailW: 0.5 });
  } else if (type === 'sedan') {
    const b = 0.3;
    const pts = [[-l2, b + 0.08], [-l2 + 0.03, 0.92], [-1.25, 0.98, -l2 + 0.2, 0.99], [1.25, 0.95], [l2, 0.74, 2.15, 0.94], [l2 - 0.02, b + 0.02], ...bottom(b).reverse()];
    P.add('paint', bodyGround(pts, 0.88));
    cabinGlass(P, W - 0.22, -1.35, -0.75, 0.55, 1.25, 0.95, 1.45);
    P.add('chrome', rbox(W - 0.3, 0.14, 0.08, 0.04, { p: [0, 0.4, l2 + 0.02] }));
    P.add('chrome', rbox(W - 0.3, 0.12, 0.08, 0.04, { p: [0, 0.42, -l2 - 0.02] }));
    P.add('trim', box(0.8, 0.18, 0.04, { p: [0, 0.66, l2 + 0.005] }));
    addLights(P, L, W, 0.74, 0.82);
  } else if (type === 'pickup') {
    const b = 0.42;
    const pts = [[-l2, b + 0.1], [-l2, 1.12], [0.95, 1.12], [1.3, 1.18], [l2, 1.06, 2.5, 1.18], [l2, b + 0.04], ...bottom(b).reverse()];
    P.add('paint', bodyGround(pts));
    cabinGlass(P, W - 0.16, -0.5, -0.35, 0.65, 1.15, 1.12, 1.8);
    // bed: hollow
    P.add('trim', box(W - 0.3, 0.06, 2.1, { p: [0, 1.14, -1.45] }));
    P.add('chrome', rbox(W - 0.1, 0.2, 0.12, 0.05, { p: [0, 0.6, l2 + 0.03] }));
    P.add('chrome', rbox(W - 0.1, 0.18, 0.12, 0.05, { p: [0, 0.6, -l2 - 0.03] }));
    P.add('trim', box(1.0, 0.32, 0.04, { p: [0, 0.88, l2 + 0.01] }));
    for (let i = -2; i <= 2; i++) P.add('chrome', box(0.95, 0.02, 0.045, { p: [0, 0.88 + i * 0.06, l2 + 0.02] }));
    addLights(P, L, W, 0.94, 0.98, { mirrorY: 1.45, mirrorZ: 0.95 });
  } else if (type === 'jeep') {
    const b = 0.45;
    const pts = [[-l2, b + 0.06], [-l2, 1.12], [0.6, 1.12], [l2, 1.08], [l2, b + 0.04], ...bottom(b).reverse()];
    P.add('paint', deform(profile(pts, W, 0.06), v => { v.x *= 1; }));
    // windscreen frame + roll cage
    P.add('trim', box(W - 0.1, 0.05, 0.05, { p: [0, 1.72, 0.48] }));
    for (const s of [1, -1]) {
      P.add('trim', box(0.05, 0.62, 0.05, { p: [s * (W / 2 - 0.08), 1.42, 0.5], r: [-0.2, 0, 0] }));
      P.add('trim', cyl(0.04, 0.04, 0.95, 8, { p: [s * (W / 2 - 0.12), 1.55, -0.6] }));
      P.add('olive', box(0.32, 0.12, 1.1, { p: [s * (W / 2 + 0.06), 1.12, 1.32] })); // fenders
      P.add('olive', box(0.32, 0.12, 1.0, { p: [s * (W / 2 + 0.06), 1.12, -1.3] }));
    }
    P.add('trim', box(W - 0.16, 0.05, 0.05, { p: [0, 2.0, -0.6] }));
    P.add('glass', box(W - 0.3, 0.52, 0.02, { p: [0, 1.42, 0.5], r: [-0.2, 0, 0] }));
    P.add('trim', box(1.1, 0.45, 0.06, { p: [0, 0.82, l2 + 0.02] })); // grille
    for (let i = 0; i < 7; i++) P.add('olive', box(0.06, 0.4, 0.05, { p: [-0.45 + i * 0.15, 0.82, l2 + 0.05] }));
    P.add('rubber', cyl(0.4, 0.4, 0.26, 20, { p: [0, 1.0, -l2 - 0.16], r: [Math.PI / 2, 0, 0] })); // spare
    P.add('seat', rbox(0.5, 0.5, 0.5, 0.08, { p: [0.42, 1.25, -0.1] }));
    P.add('seat', rbox(0.5, 0.5, 0.5, 0.08, { p: [-0.42, 1.25, -0.1] }));
    P.add('trim', cyl(0.07, 0.09, 0.8, 10, { p: [0, 1.5, -1.25] })); // gun post
    for (const s of [1, -1]) P.add('stripe', box(0.02, 0.14, L - 0.8, { p: [s * (W / 2 + 0.005), 0.98, 0] }));
    addLights(P, L, W, 1.0, 0.95, { mirrors: false });
  } else if (type === 'truck') {
    const b = 0.65;
    // armored cab (angled plates)
    P.add('paint', profile([[1.5, b], [1.5, 2.25], [2.1, 2.55], [2.95, 2.45], [l2, 1.7], [l2, b]], W, 0.06));
    // rear armored box
    P.add('paint', profile([[-l2, b + 0.15], [-l2, 2.85], [1.35, 2.85], [1.45, b + 0.15]], W, 0.08));
    for (const s of [1, -1]) {
      P.add('glass', box(0.03, 0.18, 0.9, { p: [s * (W / 2 + 0.01), 2.25, 2.4] }));
      for (let i = 0; i < 6; i++) P.add('trim', box(0.04, 0.06, 0.12, { p: [s * (W / 2 + 0.02), 1.4 + (i % 2) * 0.9, -2.8 + Math.floor(i / 2) * 1.6] })); // rivets / ports
      P.add('stripe', box(0.02, 0.22, L - 1.2, { p: [s * (W / 2 + 0.01), 1.55, -0.3] }));
      P.add('trim', box(0.4, 0.12, 1.8, { p: [s * (W / 2 - 0.05), 0.55, 0.0] })); // step
    }
    P.add('glass', box(W - 0.5, 0.25, 0.03, { p: [0, 2.15, l2 - 0.55], r: [-0.95, 0, 0] }));
    P.add('trim', box(W - 0.2, 0.5, 0.25, { p: [0, 0.9, l2 + 0.05] })); // bumper ram
    for (let i = 0; i < 5; i++) P.add('gunmetal', box(0.08, 0.6, 0.08, { p: [-0.8 + i * 0.4, 1.2, l2 + 0.2] }));
    P.add('trim', box(W - 0.2, 0.3, 0.2, { p: [0, 0.8, -l2 - 0.05] }));
    P.add('gunmetal', cyl(0.5, 0.55, 0.3, 12, { p: [0, 3.0, -0.8] })); // roof hatch ring
    addLights(P, L, W, 1.35, 1.2, { mirrors: false });
  }
  if (regime && type !== 'jeep' && type !== 'truck') for (const s of [1, -1]) P.add('stripe', box(0.02, 0.1, L - 1, { p: [s * (W / 2 + 0.01), 0.7, 0] }));
  // underbody shadow catcher
  P.add('trim', box(W - 0.3, 0.08, L - 0.6, { p: [0, (d.chunky ? 0.55 : 0.3), 0] }));
  return { parts: P.merged(), wheels: wheelLayout(d) };
}

function wheelLayout(d) {
  const out = [];
  for (let i = 0; i < d.wheelZ.length; i++) for (const s of [1, -1]) out.push({ x: s * d.wheelX, y: d.wheelR, z: d.wheelZ[i], steer: i === 0, drive: true, rear: i === d.wheelZ.length - 1, side: s });
  return out;
}

// ---------- tank ----------
function tankModel(d) {
  const P = new Parts();
  const [W, , L] = d.size, l2 = L / 2;
  P.add('paint', profile([[-l2, 0.65], [-l2 + 0.3, 1.45], [1.8, 1.55], [l2, 1.05], [l2 - 0.4, 0.65]], W - 1.0, 0.08));
  P.add('paint', box(W, 0.12, L - 0.6, { p: [0, 1.25, -0.1] })); // track fenders
  for (const s of [1, -1]) {
    const x = s * (W / 2 - 0.33);
    // track loop (stadium) and road wheels
    const t = new THREE.Shape(); const r = 0.45, za = l2 - 0.5, zb = -l2 + 0.5;
    t.moveTo(zb, 0.0); t.lineTo(za, 0.0); t.absarc(za, r, r, -Math.PI / 2, Math.PI / 2, false); t.lineTo(zb, 2 * r); t.absarc(zb, r, r, Math.PI / 2, Math.PI * 1.5, false);
    const tg = new THREE.ExtrudeGeometry(t, { depth: 0.6, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1, curveSegments: 12 });
    tg.rotateY(-Math.PI / 2); tg.translate(x + 0.3, 0.05, 0);
    P.add('rubber', tg);
    for (let i = 0; i < 6; i++) P.add('gunmetal', cyl(0.36, 0.36, 0.08, 16, { p: [x + s * 0.32, 0.48, -l2 + 0.95 + i * (L - 1.9) / 5], r: [0, 0, Math.PI / 2] }));
    for (let i = 0; i < 26; i++) P.add('trim', box(0.62, 0.05, 0.1, { p: [x, 0.04, -l2 + 0.5 + i * (L - 1) / 25] }));
    P.add('stripe', box(0.02, 0.12, L - 1.6, { p: [s * (W / 2 - 0.5 + 0.01), 1.38, -0.2] }));
    P.add('olive', box(0.4, 0.4, 0.8, { p: [s * 1.0, 1.6, -l2 + 0.7] })); // stowage
  }
  P.add('head', rbox(0.2, 0.12, 0.08, 0.03, { p: [0.9, 1.3, l2 - 0.1] }));
  P.add('head', rbox(0.2, 0.12, 0.08, 0.03, { p: [-0.9, 1.3, l2 - 0.1] }));
  P.add('tail', rbox(0.2, 0.1, 0.08, 0.03, { p: [1.0, 1.3, -l2] }));
  P.add('tail', rbox(0.2, 0.1, 0.08, 0.03, { p: [-1.0, 1.3, -l2] }));
  // turret (own group, rotates)
  const T = new Parts();
  T.add('paint', deform(profile([[-1.9, 0], [-1.7, 0.75], [0.9, 0.8], [1.7, 0.35], [1.6, 0]], 2.5, 0.1), v => { v.x *= 1 - 0.18 * (v.y / 0.8); }));
  T.add('gunmetal', cyl(0.32, 0.32, 0.4, 12, { p: [0.55, 0.95, -0.4] })); // cupola
  T.add('trim', cyl(0.04, 0.04, 0.9, 6, { p: [0.55, 1.25, -0.2], r: [Math.PI / 2, 0, 0] }));
  T.add('olive', box(2.2, 0.5, 0.7, { p: [0, 0.4, -2.0] })); // bustle
  T.add('stripe', box(2.0, 0.12, 0.02, { p: [0, 0.55, -2.36] }));
  const B = new Parts();
  B.add('gunmetal', cyl(0.13, 0.15, 4.4, 14, { p: [0, 0, 2.2], r: [Math.PI / 2, 0, 0] }));
  B.add('gunmetal', cyl(0.22, 0.22, 0.6, 14, { p: [0, 0, 1.4], r: [Math.PI / 2, 0, 0] }));
  B.add('gunmetal', cyl(0.18, 0.18, 0.35, 12, { p: [0, 0, 4.35], r: [Math.PI / 2, 0, 0] }));
  B.add('paint', box(0.9, 0.5, 0.5, { p: [0, 0, 0.3] }));
  return { parts: P.merged(), turret: { parts: T.merged(), pos: [0, 1.55, 0.2] }, barrel: { parts: B.merged(), pos: [0, 0.45, 1.5], muzzle: 4.6 },
    wheels: wheelLayout(d).map(w => ({ ...w, steer: false, hidden: true })) };
}

// ---------- helicopters ----------
function rotorParts(R, blades, chord) {
  const P = new Parts();
  for (let i = 0; i < blades; i++) {
    const a = i / blades * Math.PI * 2;
    P.add('trim', deform(box(chord, 0.04, R, { p: [0, 0, R / 2] }), v => { v.x *= 1 - 0.35 * (v.z / R); v.y += 0.01 * v.z; }).rotateY(a));
  }
  P.add('gunmetal', cyl(0.18, 0.22, 0.25, 12));
  return P.merged();
}
function heliModel(type, d) {
  const P = new Parts();
  const attack = type === 'attackHeli';
  const paint = 'paint';
  if (!attack) {
    P.add(paint, lathe([[0, 2.0], [0.55, 1.85], [0.9, 1.3], [1.0, 0.4], [0.95, -0.6], [0.6, -1.2], [0.3, -1.6], [0, -1.7]], 24, { p: [0, 1.55, 0.3], s: [0.92, 1, 1] }));
    P.add('glass', deform(sph(0.98, { p: [0, 1.62, 0.95], s: [0.9, 0.92, 1.1] }, 24, 14), v => { if (v.z < 1.0) v.z = 1.0 + (v.z - 1.0) * 0.1; }));
    P.add(paint, lathe([[0.32, 0], [0.22, -2.4], [0.12, -4.2]], 12, { p: [0, 1.85, -1.2] }));
    P.add(paint, profile([[-5.3, 1.8], [-5.6, 3.0], [-5.25, 3.0], [-4.8, 1.85]], 0.08, 0.02));
    P.add(paint, box(1.2, 0.05, 0.4, { p: [0, 1.9, -4.6] }));
    for (const s of [1, -1]) {
      P.add('chrome', cyl(0.04, 0.04, 2.6, 8, { p: [s * 0.85, 0.06, 0.2], r: [Math.PI / 2, 0, 0] }));
      P.add('chrome', cyl(0.035, 0.035, 0.75, 8, { p: [s * 0.75, 0.4, 0.9], r: [0, 0, s * 0.3] }));
      P.add('chrome', cyl(0.035, 0.035, 0.75, 8, { p: [s * 0.75, 0.4, -0.4], r: [0, 0, s * 0.3] }));
      P.add('trim', box(0.02, 0.12, 2.0, { p: [s * 0.9, 1.45, 0.0] }));
    }
    P.add('gunmetal', cyl(0.35, 0.45, 0.45, 12, { p: [0, 2.75, 0.1] }));
    P.add('head', sph(0.1, { p: [0, 0.75, 1.75] }));
    P.add('tail', sph(0.08, { p: [0, 3.05, -5.45] }));
    P.add('seat', rbox(0.5, 0.6, 0.5, 0.08, { p: [0.35, 1.2, 0.8] }));
  } else {
    P.add(paint, lathe([[0, 2.6], [0.35, 2.3], [0.62, 1.4], [0.7, 0], [0.65, -1.2], [0.4, -2.0], [0, -2.2]], 20, { p: [0, 1.6, 0.4], s: [1, 1.25, 1] }));
    P.add('glass', deform(sph(0.55, { p: [0, 2.15, 1.75], s: [0.85, 0.8, 1.5] }, 20, 12), v => { if (v.y < 2.05) v.y = 2.05; }));
    P.add('glass', deform(sph(0.55, { p: [0, 2.3, 0.75], s: [0.85, 0.85, 1.4] }, 20, 12), v => { if (v.y < 2.1) v.y = 2.1; }));
    P.add(paint, lathe([[0.36, 0], [0.24, -2.8], [0.14, -4.6]], 12, { p: [0, 1.95, -1.4] }));
    P.add(paint, profile([[-5.8, 1.9], [-6.3, 3.3], [-5.9, 3.35], [-5.3, 2.0]], 0.1, 0.02));
    P.add(paint, box(1.6, 0.06, 0.5, { p: [0, 2.0, -5.2] }));
    for (const s of [1, -1]) {
      P.add(paint, box(1.5, 0.12, 0.7, { p: [s * 1.2, 1.55, 0.0], r: [0, 0, s * -0.08] })); // stub wing
      P.add('gunmetal', cyl(0.22, 0.22, 1.5, 14, { p: [s * 1.6, 1.32, 0.05], r: [Math.PI / 2, 0, 0] })); // rocket pod
      P.add('trim', cyl(0.24, 0.24, 0.05, 14, { p: [s * 1.6, 1.32, 0.8], r: [Math.PI / 2, 0, 0] }));
      P.add('olive', box(0.25, 0.25, 0.9, { p: [s * 1.0, 1.25, 0.1] }));
      P.add('stripe', box(0.02, 0.14, 3.2, { p: [s * 0.72, 1.6, -0.6] }));
      P.add('trim', cyl(0.05, 0.05, 0.9, 8, { p: [s * 0.55, 0.4, -1.0], r: [0, 0, s * 0.3] }));
    }
    P.add('rubber', cyl(0.28, 0.28, 0.14, 14, { p: [0.75, 0.28, 1.4], r: [0, 0, Math.PI / 2] }));
    P.add('rubber', cyl(0.28, 0.28, 0.14, 14, { p: [-0.75, 0.28, 1.4], r: [0, 0, Math.PI / 2] }));
    P.add('rubber', cyl(0.18, 0.18, 0.1, 12, { p: [0, 0.18, -4.7], r: [0, 0, Math.PI / 2] }));
    P.add('gunmetal', cyl(0.35, 0.45, 0.5, 12, { p: [0, 3.15, 0.2] }));
    P.add('gunmetal', sph(0.24, { p: [0, 0.95, 2.4] })); // chin turret
    for (let i = 0; i < 3; i++) P.add('gunmetal', cyl(0.035, 0.035, 1.1, 6, { p: [Math.cos(i * 2.1) * 0.06, 0.92 + Math.sin(i * 2.1) * 0.06, 3.0], r: [Math.PI / 2, 0, 0] }));
    P.add('tail', sph(0.08, { p: [0, 3.4, -6.1] }));
    P.add('head', sph(0.1, { p: [0, 0.9, 2.2] }));
  }
  const R = d.rotorR;
  return { parts: P.merged(), rotors: [
    { parts: rotorParts(R, attack ? 4 : 3, 0.32), pos: [0, attack ? 3.45 : 3.05, attack ? 0.2 : 0.1], axis: 'y', rate: 28, blurR: R },
    { parts: rotorParts(attack ? 1.2 : 1.0, attack ? 4 : 2, 0.16), pos: [attack ? 0.15 : 0.1, attack ? 2.9 : 2.6, attack ? -6.0 : -5.4], axis: 'x', rate: 60, blurR: 0 },
  ], wheels: [] };
}

// ---------- planes ----------
function wing(span, root, tip, thick, sweep = 0) {
  const s = new THREE.Shape(); // airfoil in (z,y)
  s.moveTo(root * 0.5, 0); s.quadraticCurveTo(root * 0.35, thick, 0, thick * 0.6); s.lineTo(-root * 0.5, 0.01); s.lineTo(-root * 0.5, -0.01); s.quadraticCurveTo(0, -thick * 0.3, root * 0.5, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: span, bevelEnabled: false, curveSegments: 8 });
  g.rotateY(-Math.PI / 2); g.translate(span / 2, 0, 0); // span along x, chord along z
  return deform(g, v => { const t = Math.abs(v.x) / (span / 2); const k = 1 - (1 - tip / root) * t; v.z = v.z * k - sweep * t; v.y *= k; });
}
function planeModel(type, d) {
  const P = new Parts();
  if (type === 'plane') {
    P.add('paint', lathe([[0.15, 3.2], [0.55, 2.9], [0.68, 1.6], [0.7, 0.2], [0.5, -1.6], [0.22, -3.6], [0.08, -4.0]], 20, { p: [0, 1.55, 0] }));
    P.add('glass', deform(sph(0.62, { p: [0, 2.0, 0.85], s: [0.95, 0.75, 1.6] }, 20, 12), v => { if (v.y < 1.95) v.y = 1.95; }));
    P.add('paint', wing(d.span, 1.7, 1.1, 0.2, 0.15).translate(0, 2.05, 0.6));
    P.add('paint', wing(3.6, 1.0, 0.6, 0.1, 0.2).translate(0, 1.7, -3.6));
    P.add('paint', profile([[-4.1, 1.65], [-3.9, 2.95], [-3.5, 2.95], [-3.0, 1.75]], 0.08, 0.02));
    P.add('stripe', box(0.02, 0.12, 6.2, { p: [0.69, 1.6, -0.2] }).clone());
    P.add('stripe', box(0.02, 0.12, 6.2, { p: [-0.69, 1.6, -0.2] }));
    for (const s of [1, -1]) {
      P.add('trim', cyl(0.04, 0.05, 1.3, 8, { p: [s * 0.95, 0.85, 0.95], r: [0, 0, s * 0.45] }));
      P.add('head', sph(0.07, { p: [s * d.span / 2, 2.05, 0.6] }));
    }
    P.add('trim', cyl(0.04, 0.04, 1.1, 8, { p: [0, 0.95, 2.7] }));
    P.add('chrome', lathe([[0, 3.6], [0.18, 3.35], [0.22, 3.15]], 14, { p: [0, 1.55, 0] }));
    return { parts: P.merged(), rotors: [{ parts: propParts(1.0, 2), pos: [0, 1.55, 3.42], axis: 'z', rate: 50, blurR: 1.0 }],
      wheels: [{ x: 1.25, y: d.wheelR, z: 0.95, steer: false, rear: true }, { x: -1.25, y: d.wheelR, z: 0.95, steer: false, rear: true }, { x: 0, y: d.wheelR, z: 2.7, steer: true }] };
  }
  // jet
  P.add('paint', lathe([[0, 7.4], [0.3, 6.4], [0.75, 4.6], [0.95, 2.5], [1.05, -2.5], [0.85, -5.8], [0.7, -6.6]], 22, { p: [0, 1.85, 0], s: [1, 0.85, 1] }));
  P.add('glass', deform(sph(0.55, { p: [0, 2.45, 3.6], s: [0.85, 0.85, 2.6] }, 20, 12), v => { if (v.y < 2.3) v.y = 2.3; }));
  const delta = new THREE.Shape(); delta.moveTo(0, 2.5); delta.lineTo(4.7, -3.0); delta.lineTo(4.7, -4.2); delta.lineTo(0, -4.6); delta.lineTo(-4.7, -4.2); delta.lineTo(-4.7, -3.0); delta.closePath();
  const dg = new THREE.ExtrudeGeometry(delta, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 });
  dg.rotateX(-Math.PI / 2); dg.translate(0, 1.7, 0); dg.scale(1, 1, -1); dg.translate(0, 0, -0.6);
  P.add('paint', deform(dg, v => { v.z = -v.z - 1.2; }));
  for (const s of [1, -1]) {
    P.add('paint', profile([[-6.4, 2.2], [-6.9, 4.4], [-6.2, 4.4], [-4.4, 2.3]], 0.12, 0.03, { p: [s * 0.9, 0, 0], r: [0, 0, s * -0.3] }));
    P.add('paint', box(2.4, 0.08, 1.4, { p: [s * 1.6, 1.75, -6.0] }));
    P.add('trim', box(0.5, 0.7, 2.0, { p: [s * 0.95, 1.6, 1.6] })); // intakes
    P.add('stripe', box(0.02, 0.18, 6, { p: [s * 1.03, 1.95, -1.5] }));
    P.add('gunmetal', cyl(0.12, 0.12, 2.4, 10, { p: [s * 3.2, 1.5, -1.6], r: [Math.PI / 2, 0, 0] })); // missiles
    P.add('head', sph(0.08, { p: [s * 4.7, 1.8, -3.6] }));
  }
  P.add('gunmetal', cyl(0.72, 0.65, 0.9, 18, { p: [0, 1.85, -6.9], r: [Math.PI / 2, 0, 0] }));
  for (const s of [1, -1]) P.add('trim', cyl(0.05, 0.05, 1.3, 8, { p: [s * 1.4, 0.95, -1.4] }));
  P.add('trim', cyl(0.05, 0.05, 1.3, 8, { p: [0, 0.95, 4.4] }));
  return { parts: P.merged(), flame: { pos: [0, 1.85, -7.4], r: 0.62 },
    wheels: [{ x: 1.4, y: d.wheelR, z: -1.4, rear: true }, { x: -1.4, y: d.wheelR, z: -1.4, rear: true }, { x: 0, y: d.wheelR, z: 4.4, steer: true }] };
}
function propParts(R, n) {
  const P = new Parts();
  for (let i = 0; i < n; i++) P.add('trim', deform(box(0.16, R, 0.04, { p: [0, R / 2, 0] }), v => { v.x *= 1 - 0.4 * v.y / R; }).rotateZ(i / n * Math.PI * 2));
  return P.merged();
}

// ---------- boats ----------
function boatModel(type, d) {
  const P = new Parts();
  const [W, , L] = d.size, l2 = L / 2, hw = W / 2;
  const hullPts = [[0, l2], [hw * 0.55, l2 - 0.8], [hw, l2 * 0.2], [hw, -l2], [-hw, -l2], [-hw, l2 * 0.2], [-hw * 0.55, l2 - 0.8]];
  const H = type === 'boat' ? 1.0 : 0.55;
  const hull = deform(plan(hullPts, 0, H, 0.06), v => {
    const t = Math.min(1, Math.max(0, 1 - v.y / H)); // 1 at keel (clamped: bevel verts above H gave NaN from t ** 1.5)
    v.x *= 1 - 0.55 * t ** 1.5; // V-hull
    if (v.z > l2 * 0.3) v.y += t * (v.z - l2 * 0.3) / (l2 * 0.7) * H * 0.6; // bow rake
  });
  P.add('paint', hull);
  P.add('stripe', deform(plan(hullPts, H * 0.55, H * 0.68, 0), v => { v.x *= 1.012; }));
  if (type === 'boat') {
    P.add('deck', deform(plan(hullPts.map(([x, z]) => [x * 0.92, z * 0.97]), H - 0.02, H + 0.04, 0), () => {}));
    P.add('paint', rbox(1.5, 0.7, 0.9, 0.12, { p: [0, H + 0.35, 0.3] })); // console
    P.add('glass', box(1.6, 0.5, 0.03, { p: [0, H + 0.85, 0.75], r: [-0.5, 0, 0] }));
    P.add('chrome', xf(new THREE.TorusGeometry(0.2, 0.025, 6, 20), { p: [0.2, H + 0.85, 0.5], r: [-0.6, 0, 0] }));
    P.add('seat', rbox(0.6, 0.45, 0.55, 0.1, { p: [0.35, H + 0.25, -0.5] }));
    P.add('seat', rbox(0.6, 0.45, 0.55, 0.1, { p: [-0.35, H + 0.25, -0.5] }));
    P.add('seat', rbox(W - 0.4, 0.4, 0.7, 0.1, { p: [0, H + 0.2, -l2 + 0.9] }));
    P.add('paint', rbox(0.5, 1.0, 0.45, 0.1, { p: [0, H - 0.1, -l2 - 0.2] })); // outboard
    P.add('trim', box(0.12, 0.7, 0.2, { p: [0, H - 0.75, -l2 - 0.25] }));
    for (const s of [1, -1]) P.add('chrome', cyl(0.025, 0.025, 2.2, 6, { p: [s * (hw - 0.12), H + 0.25, l2 - 1.6], r: [Math.PI / 2, 0, 0] }));
    P.add('head', sph(0.07, { p: [0, H + 0.1, l2 - 0.15] }));
  } else {
    P.add('seat', rbox(0.45, 0.25, 1.2, 0.1, { p: [0, H + 0.12, -0.35] }));
    P.add('paint', rbox(0.7, 0.35, 0.8, 0.15, { p: [0, H + 0.1, 0.65] }));
    P.add('trim', cyl(0.025, 0.025, 0.8, 6, { p: [0, H + 0.45, 0.55], r: [0, 0, Math.PI / 2] }));
    P.add('trim', box(0.1, 0.35, 0.1, { p: [0, H + 0.3, 0.6], r: [-0.4, 0, 0] }));
    P.add('glass', box(0.5, 0.18, 0.02, { p: [0, H + 0.35, 0.95], r: [-0.8, 0, 0] }));
  }
  return { parts: P.merged(), wheels: [] };
}

// ---------- public ----------
export function buildTypeGeometry(type) {
  if (cache.has(type)) return cache.get(type);
  const d = DEFS[type];
  let m;
  if (d.kind === 'car') m = carModel(type, d);
  else if (d.kind === 'tank') m = tankModel(d);
  else if (d.kind === 'heli') m = heliModel(type, d);
  else if (d.kind === 'plane') m = planeModel(type, d);
  else m = boatModel(type, d);
  cache.set(type, m); return m;
}

function meshesFor(parts, paint, inst) {
  const M = materials(); const g = new THREE.Group();
  for (const [k, geo] of Object.entries(parts)) {
    const mat = k === 'paint' ? paint : k === 'head' ? inst.head : k === 'tail' ? inst.tail : M[k] || M.trim;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = k !== 'glass'; mesh.receiveShadow = k !== 'glass';
    mesh.userData.matKey = k;
    g.add(mesh);
  }
  return g;
}

// Builds a vehicle's visual: { root, wheels[], rotors[], turret, barrel, flame, seat }
export function buildVisual(type, color) {
  const d = DEFS[type], M = materials();
  const geo = buildTypeGeometry(type);
  const paint = paintMaterial(color, d.regime);
  const inst = { head: M.head.clone(), tail: M.tail.clone() };
  const root = new THREE.Group();
  root.add(meshesFor(geo.parts, paint, inst));
  const out = { root, inst, paint, wheels: [], rotors: [], turret: null, barrel: null, flame: null };
  for (const w of geo.wheels) {
    const wg = new THREE.Group(); wg.position.set(w.x, w.y, w.z);
    if (!w.hidden) {
      const spin = new THREE.Group();
      const wgeo = wheelGeometry(d.wheelR, d.wheelW || 0.2, d.chunky);
      const t = new THREE.Mesh(wgeo.tire, M.rubber), r = new THREE.Mesh(wgeo.rim, d.regime ? M.gunmetal : M.rim);
      t.castShadow = true; spin.add(t, r); wg.add(spin); wg.userData.spin = spin;
    }
    root.add(wg); out.wheels.push({ group: wg, def: w });
  }
  for (const r of geo.rotors || []) {
    const g = new THREE.Group(); g.position.set(...r.pos);
    const blades = meshesFor(r.parts, paint, inst);
    if (r.axis === 'x') blades.rotation.z = Math.PI / 2;
    if (r.axis === 'z') blades.rotation.x = 0;
    const spin = new THREE.Group(); spin.add(blades); g.add(spin);
    let blur = null;
    if (r.blurR) {
      blur = new THREE.Mesh(new THREE.CircleGeometry(r.blurR, 40), M.blur);
      blur.rotation.x = r.axis === 'y' ? -Math.PI / 2 : 0; blur.visible = false; g.add(blur);
    }
    root.add(g); out.rotors.push({ group: g, spin, axis: r.axis, rate: r.rate, blur, angle: 0 });
  }
  if (geo.turret) {
    const t = meshesFor(geo.turret.parts, paint, inst); const tg = new THREE.Group(); tg.position.set(...geo.turret.pos); tg.add(t);
    const bg = new THREE.Group(); bg.position.set(...geo.barrel.pos); bg.add(meshesFor(geo.barrel.parts, paint, inst)); tg.add(bg);
    root.add(tg); out.turret = tg; out.barrel = bg; out.muzzle = geo.barrel.muzzle;
  }
  if (type === 'jeep') { // pintle MG on post
    const tg = new THREE.Group(); tg.position.set(0, 1.95, -1.25);
    const P = new Parts();
    P.add('gunmetal', box(0.16, 0.2, 0.7)); P.add('gunmetal', cyl(0.04, 0.04, 1.0, 8, { p: [0, 0.02, 0.8], r: [Math.PI / 2, 0, 0] }));
    P.add('olive', box(0.7, 0.45, 0.04, { p: [0, 0.15, 0.3] }));
    const bg = new THREE.Group(); bg.add(meshesFor(P.merged(), paint, inst)); tg.add(bg); root.add(tg);
    out.turret = tg; out.barrel = bg; out.muzzle = 1.3;
  }
  if (geo.flame || d.nitro) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(geo.flame ? geo.flame.r * 0.9 : 0.09, geo.flame ? 3.2 : 0.7, 14, 1, true), M.flame.clone());
    f.rotation.x = -Math.PI / 2;
    if (geo.flame) f.position.set(geo.flame.pos[0], geo.flame.pos[1], geo.flame.pos[2] - 1.5);
    else f.position.set(0.4, d.chunky ? 0.55 : 0.3, -d.size[2] / 2 - 0.35);
    f.visible = false; root.add(f); out.flame = f;
  }
  return out;
}

export function buildPerson(color = 0x3b4a5a) {
  const g = personGeometry(), M = materials();
  const grp = new THREE.Group();
  const cloth = M.cloth.clone(); cloth.color.setHex(color);
  grp.add(new THREE.Mesh(g.cloth, cloth), new THREE.Mesh(g.skin, M.skin));
  grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return grp;
}
