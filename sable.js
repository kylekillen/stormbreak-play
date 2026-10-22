// STORMBREAK: Sable Marrow's procedural body. Smooth lofted limbs/torso, head + tied-back hair, fitted jacket,
// red scarf, cargo trousers, boots, slim chute pack and a left-forearm grapple gauntlet, authored in the bind
// (T-pose) space of the rigged mannequin and skinned onto its skeleton, so every clip + procedural pose drives it.
// Output: two SkinnedMeshes (cloth/skin vertex-coloured + metal) = 2 draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const SABLE = {
  skin: 0xc8916f, hair: 0x22160f, jacket: 0x5d4a35, jacketHi: 0x6f5a42, scarf: 0xc0271d, pants: 0x6e6650,
  boots: 0x2a1d15, sole: 0x141110, gloves: 0x2a2520, belt: 0x3a2717, pack: 0x2b3236, strap: 0x17191a, eye: 0x120d0b, lip: 0x9a5c4e,
};

// build a lofted tube. rings: [{c:Vector3, ru, rv, w:[[bone,weight],..], col}] ; ref = vector defining 'u' axis
function loft(rings, { ref = V(0, 1, 0), segs = 12, capA = true, capB = true } = {}) {
  const R = rings.slice();
  const tan = i => { const a = R[Math.max(0, i - 1)].c, b = R[Math.min(R.length - 1, i + 1)].c; return b.clone().sub(a).normalize(); };
  const cap = (end, sgn) => { // hemispherical-ish cap rings
    const r = end === 0 ? R[0] : R[R.length - 1], t = tan(end === 0 ? 0 : R.length - 1).multiplyScalar(sgn);
    const out = [], len = Math.min(r.ru, r.rv) * 0.9;
    for (const [s, o] of [[0.82, 0.45], [0.52, 0.78], [0.0, 1.0]]) out.push({ ...r, c: r.c.clone().addScaledVector(t, o * len), ru: Math.max(1e-4, r.ru * s), rv: Math.max(1e-4, r.rv * s), _tan: tan(end === 0 ? 0 : R.length - 1) });
    return out;
  };
  let all = R.map((r, i) => ({ ...r, _tan: tan(i) }));
  if (capA) all = cap(0, -1).reverse().concat(all);
  if (capB) all = all.concat(cap(1, 1));
  const pos = [], col = [], si = [], sw = [], idx = [], c = new THREE.Color();
  for (const r of all) {
    const t = r._tan, u = ref.clone().addScaledVector(t, -ref.dot(t)).normalize(), v = t.clone().cross(u);
    c.setHex(r.col);
    const w = r.w.slice(0, 4); while (w.length < 4) w.push([0, 0]);
    const tot = w.reduce((s, x) => s + x[1], 0) || 1;
    for (let k = 0; k < segs; k++) {
      const a = k / segs * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const p = r.c.clone().addScaledVector(u, ca * r.ru).addScaledVector(v, sa * r.rv);
      if (r.squash) r.squash(p, ca, sa);
      pos.push(p.x, p.y, p.z); col.push(c.r, c.g, c.b);
      for (const x of w) { si.push(x[0]); sw.push(x[1] / tot); }
    }
  }
  for (let i = 0; i < all.length - 1; i++) for (let k = 0; k < segs; k++) {
    const a = i * segs + k, b = i * segs + (k + 1) % segs, cc = a + segs, d = b + segs;
    idx.push(a, cc, b, b, cc, d);
  }
  return geo(pos, col, si, sw, idx);
}
function geo(pos, col, si, sw, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// wrap a stock geometry: transform, single colour, rigid (or weighted) skin
function prim(g, m, col, w) {
  g = g.index ? g : g; g.deleteAttribute('uv'); if (g.attributes.uv1) g.deleteAttribute('uv1');
  g.applyMatrix4(m);
  const n = g.attributes.position.count, c = new THREE.Color(col), cs = [], si = [], sw = [];
  const ws = w.slice(0, 4); while (ws.length < 4) ws.push([0, 0]); const tot = ws.reduce((s, x) => s + x[1], 0) || 1;
  for (let i = 0; i < n; i++) { cs.push(c.r, c.g, c.b); for (const x of ws) { si.push(x[0]); sw.push(x[1] / tot); } }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cs, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  if (!g.index) { const ix = []; for (let i = 0; i < n; i++) ix.push(i); g.setIndex(ix); }
  return g;
}
const M = (p, s = [1, 1, 1], r = [0, 0, 0]) => new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), V(...s));
function roundBox(w, h, d, k = 0.25) { // superellipse-rounded box
  const g = new THREE.BoxGeometry(w, h, d, 3, 3, 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = V().fromBufferAttribute(p, i).multiply(V(2 / w, 2 / h, 2 / d)); const l = v.length(); v.multiplyScalar(Math.pow(l, -k)).multiply(V(w / 2, h / 2, d / 2)); p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals(); return g;
}

// skinned: the mannequin SkinnedMesh whose skeleton we bind to (bind space == its local space)
export function buildSable(skinned, pal = SABLE) {
  const sk = skinned.skeleton, bones = sk.bones, norm = n => n.replace(/[.]/g, '');
  const bi = {}; bones.forEach((b, i) => { bi[norm(b.name)] = i; });
  const I = n => { const i = bi[norm('DEF-' + n)]; if (i == null) throw new Error('sable: missing bone ' + n); return i; };
  const J = n => { const m = sk.boneInverses[I(n)].clone().invert(); return V().setFromMatrixPosition(m); };
  const hips = I('hips'), s1 = I('spine.001'), s2 = I('spine.002'), s3 = I('spine.003'), neck = I('neck'), head = I('head');
  const cloth = [], metal = [];
  const j = { neck: J('neck'), head: J('head') };

  // ---- torso: hips -> chest, feminine taper (wide hip, narrow waist), jacket over trousers with a hem lip
  const ring = (y, ru, rv, w, col, z = 0) => ({ c: V(0, y, z), ru, rv, w, col });
  cloth.push(loft([
    ring(0.835, 0.085, 0.125, [[hips, 1]], pal.pants, 0.0),
    ring(0.90, 0.112, 0.148, [[hips, 1]], pal.pants, -0.005),
    ring(0.975, 0.11, 0.144, [[hips, 1]], pal.pants, -0.008),
    ring(0.975, 0.122, 0.155, [[hips, 1]], pal.jacket, -0.008), // hem lip
    ring(1.03, 0.11, 0.14, [[hips, 0.5], [s1, 0.5]], pal.jacket, -0.008),
    ring(1.11, 0.098, 0.130, [[s1, 0.6], [s2, 0.4]], pal.jacket, -0.006),
    ring(1.20, 0.105, 0.140, [[s2, 1]], pal.jacket, -0.002),
    ring(1.29, 0.118, 0.158, [[s2, 0.35], [s3, 0.65]], pal.jacketHi, 0.006),
    ring(1.37, 0.115, 0.170, [[s3, 1]], pal.jacket, 0.0),
    ring(1.435, 0.095, 0.168, [[s3, 1]], pal.jacket, -0.012),
    ring(1.475, 0.06, 0.10, [[s3, 0.7], [neck, 0.3]], pal.jacket, -0.012),
    ring(1.50, 0.05, 0.052, [[neck, 1]], pal.skin, -0.008),
  ], { ref: V(0, 0, 1), segs: 18, capA: true, capB: false }));
  // neck + head
  cloth.push(loft([
    { c: V(0, 1.49, -0.008), ru: 0.046, rv: 0.048, w: [[neck, 1]], col: pal.skin },
    { c: V(0, 1.56, 0.0), ru: 0.044, rv: 0.044, w: [[neck, 0.4], [head, 0.6]], col: pal.skin },
  ], { ref: V(0, 0, 1), segs: 12, capA: false, capB: false }));
  const hc = V(0, 1.655, 0.014);
  const headG = new THREE.SphereGeometry(1, 22, 16), hp = headG.attributes.position;
  for (let i = 0; i < hp.count; i++) { // egg skull, narrow jaw + chin
    let x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i);
    if (y < 0) { const k = 1 - 0.32 * (-y); x *= k; z *= 1 - 0.12 * (-y); if (z > 0) z *= 1 + 0.12 * (-y); }
    hp.setXYZ(i, x * 0.087, y * 0.118, z * 0.104);
  }
  headG.computeVertexNormals();
  cloth.push(prim(headG, M(hc), pal.skin, [[head, 1]]));
  const face = (g, p, s, col, r = [0, 0, 0]) => cloth.push(prim(g, M(hc.clone().add(p), s, r), col, [[head, 1]]));
  face(new THREE.SphereGeometry(1, 8, 6), V(0, -0.005, 0.094), [0.014, 0.024, 0.02], pal.skin); // nose
  for (const s of [1, -1]) {
    face(new THREE.SphereGeometry(1, 8, 6), V(0.031 * s, 0.012, 0.088), [0.012, 0.011, 0.006], pal.eye);
    face(new THREE.SphereGeometry(1, 8, 6), V(0.079 * s, 0.0, -0.005), [0.012, 0.026, 0.018], pal.skin); // ears
  }
  face(new THREE.SphereGeometry(1, 8, 6), V(0, -0.052, 0.078), [0.02, 0.006, 0.008], pal.lip);
  // hair: skull cap swept back + low ponytail
  // hair shell: a slightly larger ellipsoid pushed up + back, so the face (and only the face) breaks through it
  const hairG = new THREE.SphereGeometry(1, 24, 16), hq = hairG.attributes.position;
  for (let i = 0; i < hq.count; i++) { const y = hq.getY(i), z = hq.getZ(i); if (z > 0 && y < 0.2) hq.setZ(i, z * (0.72 + 0.28 * Math.max(0, y + 0.8))); }
  hairG.computeVertexNormals();
  cloth.push(prim(hairG, M(hc.clone().add(V(0, 0.024, -0.014)), [0.093, 0.118, 0.11], [-0.18, 0, 0]), pal.hair, [[head, 1]]));
  // side-swept fringe + brows give her a hairline instead of a bald mannequin forehead
  cloth.push(prim(new THREE.SphereGeometry(1, 14, 8), M(hc.clone().add(V(0.012, 0.074, 0.07)), [0.082, 0.036, 0.045], [0.5, 0, -0.16]), pal.hair, [[head, 1]]));
  for (const s of [1, -1]) cloth.push(prim(new THREE.BoxGeometry(1, 1, 1), M(hc.clone().add(V(0.032 * s, 0.034, 0.094)), [0.028, 0.006, 0.008], [0, 0, -0.16 * s]), pal.hair, [[head, 1]]));
  cloth.push(prim(new THREE.SphereGeometry(1, 12, 10), M(hc.clone().add(V(0, -0.005, -0.098)), [0.038, 0.034, 0.03]), pal.hair, [[head, 1]]));
  cloth.push(loft([
    { c: hc.clone().add(V(0, -0.01, -0.11)), ru: 0.026, rv: 0.03, w: [[head, 1]], col: pal.hair },
    { c: hc.clone().add(V(0, -0.07, -0.13)), ru: 0.03, rv: 0.032, w: [[head, 1]], col: pal.hair },
    { c: hc.clone().add(V(0, -0.14, -0.125)), ru: 0.022, rv: 0.024, w: [[head, 0.6], [neck, 0.4]], col: pal.hair },
    { c: hc.clone().add(V(0, -0.2, -0.11)), ru: 0.01, rv: 0.012, w: [[neck, 0.7], [s3, 0.3]], col: pal.hair },
  ], { ref: V(1, 0, 0), segs: 8, capA: false, capB: true }));
  // scarf: wrap + tail over the left chest
  cloth.push(prim(new THREE.TorusGeometry(0.06, 0.03, 8, 18), M(V(0, 1.475, 0.0), [1.05, 1.15, 1], [Math.PI / 2 - 0.15, 0, 0]), pal.scarf, [[neck, 0.5], [s3, 0.5]]));
  cloth.push(loft([
    { c: V(0.035, 1.47, 0.08), ru: 0.012, rv: 0.04, w: [[s3, 0.6], [neck, 0.4]], col: pal.scarf },
    { c: V(0.06, 1.40, 0.125), ru: 0.01, rv: 0.038, w: [[s3, 1]], col: pal.scarf },
    { c: V(0.07, 1.34, 0.138), ru: 0.009, rv: 0.032, w: [[s3, 1]], col: pal.scarf },
  ], { ref: V(0, 0, 1), segs: 8 }));

  // ---- arms (T-pose along ±X)
  for (const S of ['L', 'R']) {
    const s = S === 'L' ? 1 : -1, sh = I('shoulder.' + S), ua = I('upper_arm.' + S), fa = I('forearm.' + S), hd = I('hand.' + S);
    const pU = J('upper_arm.' + S), pF = J('forearm.' + S), pH = J('hand.' + S);
    const at = (p, x, y = 0, z = 0) => V(x * s, p.y + y, p.z + z);
    cloth.push(loft([
      { c: at(pU, 0.14, 0.0, 0.0), ru: 0.05, rv: 0.055, w: [[sh, 0.5], [ua, 0.5]], col: pal.jacket },
      { c: at(pU, 0.195, 0.0, 0.0), ru: 0.056, rv: 0.058, w: [[ua, 0.85], [sh, 0.15]], col: pal.jacket },
      { c: at(pU, 0.31), ru: 0.05, rv: 0.052, w: [[ua, 1]], col: pal.jacket },
      { c: at(pF, pF.x * s - 0.005), ru: 0.044, rv: 0.046, w: [[ua, 0.5], [fa, 0.5]], col: pal.jacket },
      { c: at(pF, pF.x * s + 0.06), ru: 0.042, rv: 0.044, w: [[fa, 0.85], [ua, 0.15]], col: pal.jacket },
      { c: at(pF, pF.x * s + 0.2), ru: 0.036, rv: 0.04, w: [[fa, 1]], col: pal.jacket },
      { c: at(pF, pF.x * s + 0.2), ru: 0.04, rv: 0.044, w: [[fa, 1]], col: pal.jacketHi }, // cuff
      { c: at(pH, pH.x * s - 0.035), ru: 0.04, rv: 0.044, w: [[fa, 1]], col: pal.jacketHi },
      { c: at(pH, pH.x * s - 0.035), ru: 0.028, rv: 0.032, w: [[fa, 0.7], [hd, 0.3]], col: pal.gloves },
      { c: at(pH, pH.x * s + 0.0), ru: 0.027, rv: 0.031, w: [[hd, 0.6], [fa, 0.4]], col: pal.gloves },
    ], { ref: V(0, 1, 0), segs: 12, capA: true, capB: false }));
    // hand: gloved palm to the knuckles, then four jointed fingers that follow their own bones + thumb
    const pM1 = J('f_middle01.' + S);
    cloth.push(loft([
      { c: at(pH, pH.x * s + 0.01, -0.002, 0.0), ru: 0.022, rv: 0.04, w: [[hd, 1]], col: pal.gloves },
      { c: at(pH, pM1.x * s - 0.03, 0.0, -0.002), ru: 0.019, rv: 0.044, w: [[hd, 1]], col: pal.gloves },
      { c: at(pH, pM1.x * s - 0.004, 0.0, -0.002), ru: 0.015, rv: 0.042, w: [[hd, 0.7], [I('f_middle01.' + S), 0.3]], col: pal.gloves },
    ], { ref: V(0, 1, 0), segs: 10, capA: false }));
    for (const [f, r0] of [['index', 0.0098], ['middle', 0.0102], ['ring', 0.0095], ['pinky', 0.0082]]) {
      const b1 = I('f_' + f + '01.' + S), b2 = I('f_' + f + '02.' + S), b3 = I('f_' + f + '03.' + S);
      const q1 = J('f_' + f + '01.' + S), q2 = J('f_' + f + '02.' + S), q3 = J('f_' + f + '03.' + S);
      const d3 = q3.clone().sub(q2), tipLen = Math.max(0.014, d3.length() * 0.9);
      cloth.push(loft([
        { c: q1.clone(), ru: r0, rv: r0 * 1.12, w: [[b1, 0.7], [hd, 0.3]], col: pal.gloves },
        { c: q2.clone(), ru: r0 * 0.92, rv: r0 * 1.02, w: [[b1, 0.4], [b2, 0.6]], col: pal.gloves },
        { c: q3.clone(), ru: r0 * 0.85, rv: r0 * 0.94, w: [[b2, 0.4], [b3, 0.6]], col: pal.gloves },
        { c: q3.clone().addScaledVector(d3.normalize(), tipLen), ru: r0 * 0.78, rv: r0 * 0.85, w: [[b3, 1]], col: pal.gloves },
      ], { ref: V(0, 1, 0), segs: 6, capA: false }));
    }
    const t1 = J('thumb01.' + S), t3 = J('thumb03.' + S), tdir = t3.clone().sub(t1).normalize();
    cloth.push(loft([
      { c: t1.clone(), ru: 0.017, rv: 0.017, w: [[I('thumb01.' + S), 0.7], [hd, 0.3]], col: pal.gloves },
      { c: J('thumb02.' + S), ru: 0.014, rv: 0.014, w: [[I('thumb02.' + S), 1]], col: pal.gloves },
      { c: t3.clone().addScaledVector(tdir, 0.02), ru: 0.012, rv: 0.012, w: [[I('thumb03.' + S), 1]], col: pal.gloves },
    ], { ref: V(0, 0, 1), segs: 8 }));
    if (S === 'L') { // grapple gauntlet: sleeve + spool housing + vents (metal mesh)
      const g0 = pF.x + 0.075, g1 = pH.x - 0.03;
      metal.push(loft([
        { c: V(g0, pF.y, pF.z), ru: 0.046, rv: 0.05, w: [[fa, 1]], col: 0x4a5056 },
        { c: V((g0 + g1) / 2, pF.y + 0.004, pF.z), ru: 0.05, rv: 0.052, w: [[fa, 1]], col: 0x5a6168 },
        { c: V(g1, pF.y, pF.z), ru: 0.044, rv: 0.047, w: [[fa, 1]], col: 0x4a5056 },
      ], { ref: V(0, 1, 0), segs: 12 }));
      metal.push(prim(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 12), M(V(g0 + 0.07, pF.y + 0.052, pF.z), [1, 1, 1], [0, 0, 0]), 0x30353a, [[fa, 1]]));
      metal.push(prim(new THREE.BoxGeometry(0.1, 0.012, 0.02), M(V(g0 + 0.07, pF.y - 0.02, pF.z + 0.05)), 0xc8962e, [[fa, 1]]));
    }
  }

  // ---- legs (T-pose along -Y): cargo trousers into boots
  for (const S of ['L', 'R']) {
    const s = S === 'L' ? 1 : -1, th = I('thigh.' + S), sn = I('shin.' + S), ft = I('foot.' + S), to = I('toe.' + S);
    const pT = J('thigh.' + S), pS = J('shin.' + S), pFt = J('foot.' + S), pTo = J('toe.' + S);
    const x = pT.x, at = (y, dx = 0, dz = 0) => V(x + dx * s, y, dz);
    cloth.push(loft([
      { c: at(0.965, -0.008, -0.004), ru: 0.084, rv: 0.08, w: [[hips, 0.6], [th, 0.4]], col: pal.pants },
      { c: at(0.88, 0.004, 0.0), ru: 0.082, rv: 0.076, w: [[th, 0.85], [hips, 0.15]], col: pal.pants },
      { c: at(0.74, 0.006, 0.004), ru: 0.07, rv: 0.066, w: [[th, 1]], col: pal.pants },
      { c: at(pS.y + 0.06, 0.0, 0.006), ru: 0.056, rv: 0.054, w: [[th, 0.8], [sn, 0.2]], col: pal.pants },
      { c: at(pS.y, 0.0, 0.01), ru: 0.056, rv: 0.052, w: [[th, 0.5], [sn, 0.5]], col: pal.pants },
      { c: at(pS.y - 0.12, 0.0, -0.006), ru: 0.058, rv: 0.052, w: [[sn, 1]], col: pal.pants },
      { c: at(0.25, 0.0, -0.01), ru: 0.05, rv: 0.046, w: [[sn, 1]], col: pal.pants },
      { c: at(0.25, 0.0, -0.01), ru: 0.056, rv: 0.052, w: [[sn, 1]], col: pal.boots }, // boot cuff
      { c: at(0.16, 0.0, -0.022), ru: 0.05, rv: 0.046, w: [[sn, 1]], col: pal.boots },
      { c: at(pFt.y + 0.01, 0.0, pFt.z + 0.005), ru: 0.05, rv: 0.045, w: [[sn, 0.4], [ft, 0.6]], col: pal.boots },
    ], { ref: V(0, 0, 1), segs: 14, capA: false, capB: true }));
    // cargo pocket on the outer thigh
    cloth.push(prim(roundBox(0.03, 0.11, 0.09, 0.3), M(at(0.72, 0.068, 0.0)), 0x4b4839, [[th, 1]]));
    // boot foot: heel -> toe (along +Z), sole as a darker flat underneath
    const fx = pFt.x;
    cloth.push(loft([
      { c: V(fx, 0.066, pFt.z - 0.04), ru: 0.052, rv: 0.043, w: [[ft, 1]], col: pal.boots },
      { c: V(fx, 0.058, pFt.z + 0.04), ru: 0.048, rv: 0.046, w: [[ft, 1]], col: pal.boots },
      { c: V(fx, 0.04, pTo.z), ru: 0.034, rv: 0.046, w: [[ft, 0.4], [to, 0.6]], col: pal.boots },
      { c: V(fx, 0.034, pTo.z + 0.05), ru: 0.026, rv: 0.04, w: [[to, 1]], col: pal.boots },
    ], { ref: V(0, 1, 0), segs: 12 }));
    cloth.push(prim(roundBox(0.088, 0.02, 0.25, 0.2), M(V(fx, 0.01, pFt.z + 0.06)), pal.sole, [[ft, 0.6], [to, 0.4]]));
  }

  // ---- belt + buckle, harness straps, slim chute pack
  cloth.push(prim(new THREE.TorusGeometry(1, 0.13, 6, 24), M(V(0, 0.955, -0.008), [0.165, 0.118, 0.17], [Math.PI / 2, 0, 0]), pal.belt, [[hips, 1]]));
  metal.push(prim(roundBox(0.05, 0.035, 0.012, 0.2), M(V(0, 0.955, 0.122)), 0xc8962e, [[hips, 1]]));
  const pack = V(0, 1.25, -0.142);
  cloth.push(prim(roundBox(0.22, 0.28, 0.06, 0.34), M(pack, [1, 1, 1], [0.08, 0, 0]), pal.pack, [[s3, 0.7], [s2, 0.3]]));
  cloth.push(prim(roundBox(0.17, 0.045, 0.025, 0.3), M(pack.clone().add(V(0, -0.095, -0.033))), 0x23292c, [[s3, 0.6], [s2, 0.4]]));
  metal.push(prim(new THREE.TorusGeometry(0.02, 0.006, 6, 10), M(pack.clone().add(V(0.09, -0.17, 0.0)), [1, 1, 1], [0, Math.PI / 2, 0]), 0xc8962e, [[s2, 1]])); // ripcord ring
  for (const s of [1, -1]) {
    cloth.push(loft([
      { c: V(0.075 * s, 1.36, -0.135), ru: 0.008, rv: 0.022, w: [[s3, 1]], col: pal.strap },
      { c: V(0.085 * s, 1.445, -0.085), ru: 0.008, rv: 0.022, w: [[s3, 1]], col: pal.strap },
      { c: V(0.09 * s, 1.45, 0.02), ru: 0.008, rv: 0.022, w: [[s3, 1]], col: pal.strap },
      { c: V(0.085 * s, 1.37, 0.112), ru: 0.008, rv: 0.022, w: [[s3, 1]], col: pal.strap },
      { c: V(0.075 * s, 1.22, 0.112), ru: 0.008, rv: 0.022, w: [[s2, 0.6], [s3, 0.4]], col: pal.strap },
      { c: V(0.08 * s, 1.08, 0.102), ru: 0.008, rv: 0.02, w: [[s1, 1]], col: pal.strap },
    ], { ref: V(0, 0, 0).set(0, 0, 0).add(V(0, 0, 1)), segs: 6, capA: false, capB: false }));
  }

  const mk = (parts, mat) => {
    const g = mergeGeometries(parts, false); if (!g) throw new Error('sable: merge failed');
    g.computeBoundingBox(); g.computeBoundingSphere();
    const m = new THREE.SkinnedMesh(g, mat); m.name = 'sable';
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    m.bind(sk, skinned.bindMatrix.clone());
    return m;
  };
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.0 });
  // backlight lift: a small albedo-proportional fill + fresnel rim so dark leather reads as material, not void
  bodyMat.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { float fr = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        totalEmissiveRadiance += diffuseColor.rgb * (0.07 + 0.32 * fr * fr * fr); }`);
  };
  bodyMat.customProgramCacheKey = () => 'sable-rim1';
  const body = mk(cloth, bodyMat);
  const gear = mk(metal, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.85 }));
  return [body, gear];
}
