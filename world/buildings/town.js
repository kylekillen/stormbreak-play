// Mediterranean towns: grid of blocks with row houses (plaster, shutters, balconies, terracotta roofs),
// a plaza with fountain, market stalls, string lights, a bell-tower church, ring walls, propaganda to destroy.
import * as THREE from 'three';
import { makeRng, hashStr, Bag, Frame, G, PAL, col, gableRoof, hipRoof, archGeom, drape } from './kit.js';

export function buildTown(ctx, site) {
  const { H } = ctx, R = makeRng(hashStr(site.id) ^ 0x51ed);
  const core = new Bag(ctx.mats);
  // Facade detail is split into spatial chunks (CH m cells in town space) so each one distance-culls on its own; small
  // untextured-looking bits share the 'paint' material to keep draws per chunk low. Detail never casts shadows.
  const WIN = { glass: [0, 0, 0], glassLit: [0, 1, 0], bulb: [0, 1, 1] }, CH = 110, REMAP = { stone: 'paint', plaster: 'paint', metal: 'paint', planks: 'paint' }, chunks = new Map();
  const chunkAt = (lu, lv) => { const k = Math.round(lu / CH) + ',' + Math.round(lv / CH); let c = chunks.get(k);
    if (!c) { const bag = new Bag(ctx.mats), win = bag.get('window'), wp = {};
      for (const [n, cc] of Object.entries(WIN)) wp[n] = { add: (g, m, _c, own, bot) => win.add(g, m, cc, own, bot) };
      c = { bag, u: Math.round(lu / CH) * CH, v: Math.round(lv / CH) * CH, get: n => wp[n] || bag.get(REMAP[n] || n) }; chunks.set(k, c); } return c; };
  let det = chunkAt(0, 0);
  const city = site.type === 'city', village = site.type === 'village';
  const rad = site.radius, a = site.rotY, T = new Frame(site.x, 0, site.z, a);
  const street = city ? 9 : 7, B = city ? R.range(36, 42) : R.range(28, 34), P = B + street;
  const nB = Math.ceil(rad / P);
  const ePh = R() * 6; // one phase per town: calling R() inside edge() made every paving cell roll its own edge (the blocky checker)
  const edge = ang => rad * (0.78 + 0.12 * Math.sin(ang * 3 + ePh) + 0.06 * Math.sin(ang * 7));
  const lots = [];
  // ground paving over the built area
  drape(core.get('paving'), H, site.x, site.z, a, rad * 2.1, rad * 2.1, 6, (lx, lz) => Math.hypot(lx, lz) < edge(Math.atan2(lz, lx)) + 5, 0.06, col(0xf2e3c8, 1.18)); // warm limestone
  const LOD = site._lodMB, LOD_ROOF = 0xa8502e; // far LOD: houses as plain boxes + roofs, coarse paving plate (albedo baked)
  if (LOD) drape(LOD, H, site.x, site.z, a, rad * 2.1, rad * 2.1, 18, (lx, lz) => Math.hypot(lx, lz) < edge(Math.atan2(lz, lx)), 0.25, col(0xf2e3c8, 0.3));
  // ---- blocks
  for (let i = -nB; i <= nB; i++) for (let j = -nB; j <= nB; j++) {
    const cu = i * P, cv = j * P, d = Math.hypot(cu, cv);
    if (d > edge(Math.atan2(cv, cu))) continue;
    if (i === 0 && j === 0) continue; // plaza
    if (i === 0 && j === 1) continue; // church
    if (village && R.chance(0.2)) continue;
    const dep = Math.min(B / 2 - 1, city ? R.range(10, 14) : R.range(8, 11));
    const edges = [ // [startU, startV, dirU, dirV, length, faceAngle(local +z of lot)]
      [cu - B / 2, cv - B / 2, 1, 0, B, Math.PI], [cu + B / 2, cv + B / 2, -1, 0, B, 0],
      [cu - B / 2, cv + B / 2 - dep, 0, -1, B - 2 * dep, -Math.PI / 2], [cu + B / 2, cv - B / 2 + dep, 0, 1, B - 2 * dep, Math.PI / 2]];
    for (const [su, sv, du, dv, L, face] of edges) {
      let t = 0;
      while (t < L - 4) {
        const w = Math.min(L - t, R.range(6, 11)); if (L - t - w < 4) { /* absorb */ }
        const ww = L - t - w < 4 ? L - t : w;
        const mu = su + du * (t + ww / 2), mv = sv + dv * (t + ww / 2);
        const nu = Math.sin(face) * 0, ou = mu - (face === Math.PI ? 0 : face === 0 ? 0 : (face > 0 ? -dep / 2 : dep / 2)), ov = mv + (face === Math.PI ? dep / 2 : face === 0 ? -dep / 2 : 0);
        void nu;
        if (!(village && R.chance(0.3))) lots.push({ u: ou, v: ov, w: ww, d: dep, face, distC: Math.hypot(ou, ov) });
        t += ww;
      }
    }
  }
  // ---- town fill (all merged into existing per-material meshes: zero extra draw calls): courtyard gardens with palms /
  // olives, café tables and umbrellas; static parked cars along the streets; street palms and planters.
  const palm = (bag, F, lx, lz, h0) => { const th = R.range(6, 9.5), lean = R.range(-0.35, 0.35), lr = R() * 6.28, dx = Math.sin(lr) * lean, dz = Math.cos(lr) * lean;
    let px = lx, pz = lz, py = h0; for (let k = 1; k <= 3; k++) { const f = k / 3, nx = lx + dx * f * f * th * 0.3, nz = lz + dz * f * f * th * 0.3, ny = h0 + th * f;
      F.beam(bag.get('paint'), [px, py, pz], [nx, ny, nz], 0.2 - k * 0.025, k % 2 ? 0x8a7556 : 0x7d6a4c); px = nx; py = ny; pz = nz; }
    for (let k = 0; k < 9; k++) { const ry = k / 9 * 6.28 + R() * 0.3, dr = R.range(0.25, 0.6), L = R.range(2.6, 3.6);
      F.box(bag.get('foliage'), px + Math.sin(ry) * L * 0.5 * Math.cos(dr), py - L * 0.5 * Math.sin(dr), pz + Math.cos(ry) * L * 0.5 * Math.cos(dr), 0.7, 0.06, L, R.pick([0x4f7a32, 0x5b8a3a, 0x46702c]), ry, dr); }
    F.geo(bag.get('foliage'), G.blob, px, py - 0.2, pz, 0, 0.7, 0.6, 0.7, 0x6b5a2a); };
  const olive = (bag, F, lx, lz, h0) => { F.geo(bag.get('paint'), G.cyl8, lx, h0 + 1.1, lz, 0, 0.35, 2.2, 0.35, 0x5a4632, false, 0.08);
    for (let k = 0; k < 3; k++) F.geo(bag.get('foliage'), G.blob, lx + R.range(-0.9, 0.9), h0 + 2.7 + R.range(0, 0.8), lz + R.range(-0.9, 0.9), 0, 2.2, 1.5, 2.2, R.pick([0x7d8c5c, 0x6f7f52, 0x8a9466])); };
  const CARC = [0xd8d2c4, 0x2f5f8a, 0xb3261e, 0xe0b31f, 0x3f6e4a, 0x9aa3a8, 0x6a8fb0, 0xf0ece2, 0x7a3f24];
  const parkQ = []; // built after the drivable vehicle spawns are placed, skipping any spot that would overlap one
  const parked = (F, lx, lz, ry) => { const [wx, wz] = F.w(lx, lz); parkQ.push([wx, wz, F.a + ry, det, R.pick(CARC)]); };
  const buildParked = (wx, wz, ang, dch, c) => { const h0 = H(wx, wz); if (h0 < 1) return;
    const C = new Frame(wx, h0, wz, ang), dm = dch.get('paint'), F = { y: 0, a: ang }, ry = 0, det = dch; void det;
    C.box(dm, 0, 0.62, 0, 1.75, 0.62, 4.1, c); C.box(dm, 0, 1.18, -0.2, 1.6, 0.55, 2.1, c); C.box(dch.get('glass'), 0, 1.2, -0.2, 1.62, 0.42, 1.9, 0xffffff);
    for (const [ox, oz] of [[-0.82, 1.3], [0.82, 1.3], [-0.82, -1.3], [0.82, -1.3]]) C.geo(dm, G.cyl8, ox, 0.33, oz, 0, 0.66, 0.24, 0.66, 0x1c1c1c, false, 0, Math.PI / 2);
    C.box(dm, 0, 0.55, 2.06, 1.5, 0.18, 0.05, 0xd8d8d0); ctx.collider(wx, h0 + 0.8, wz, 0.9, 0.8, 2.05, F.a + ry); };
  const fill = () => {
    for (let i = -nB; i <= nB; i++) for (let j = -nB; j <= nB; j++) {
      const cu = i * P, cv = j * P; if (Math.hypot(cu, cv) > edge(Math.atan2(cv, cu)) || (i === 0 && j <= 1)) continue;
      det = chunkAt(cu, cv);
      const inner = B - 2 * (city ? 12 : 9.5) - 2; const [wx, wz] = T.w(cu, cv), h0 = H(wx, wz); if (h0 < 1) continue;
      const F = new Frame(wx, 0, wz, a);
      if (inner > 5) { // courtyard garden
        F.box(core.get('foliage'), 0, h0 + 0.1, 0, inner, 0.25, inner, R.pick([0x6b8a3e, 0x5f7f38, 0x7a9447]));
        const nT = R.int(1, 3); for (let k = 0; k < nT; k++) { const lx = R.range(-inner / 3, inner / 3), lz = R.range(-inner / 3, inner / 3); (R.chance(0.55) ? palm : olive)(core, F, lx, lz, h0 + 0.2); }
        if (R.chance(0.6)) { const lx = R.range(-inner / 4, inner / 4), lz = R.range(-inner / 4, inner / 4), uc = R.pick(PAL.awnings);
          F.geo(det.get('paint'), G.cyl8, lx, h0 + 0.6, lz, 0, 1.2, 0.08, 1.2, 0xf2ead8); F.geo(det.get('paint'), G.cyl8, lx, h0 + 1.3, lz, 0, 0.06, 2.6, 0.06, 0x404040);
          F.geo(det.get('paint'), G.cone8, lx, h0 + 2.7, lz, 0, 3, 0.7, 3, uc[0]); }
      }
      // street side: parked cars, a palm or planter, along the street east (+u) of this block
      const su = cu + P / 2;
      for (let k = 0; k < (village ? 1 : city ? 4 : 3); k++) { const t = R.range(-B / 2 + 4, B / 2 - 4), sd = (street / 2 - 1.3) * (R.chance(0.5) ? 1 : -1);
        if (R.chance(0.7)) { if (k % 2) parked(F, P / 2 + sd, t, R.chance(0.5) ? 0 : Math.PI); else parked(F, t, P / 2 + sd, Math.PI / 2 + (R.chance(0.5) ? 0 : Math.PI)); } }
      if (R.chance(0.5)) { const [px, pz] = T.w(su - street / 2 + 0.8, cv + B / 2 - 1.5), ph = H(px, pz); if (ph > 1) { const Q = new Frame(px, 0, pz, a);
        if (R.chance(0.5)) palm(core, Q, 0, 0, ph); else { Q.box(det.get('paint'), 0, ph + 0.3, 0, 1.8, 0.6, 0.7, 0xb5643a); for (let q = 0; q < 3; q++) Q.geo(det.get('foliage'), G.blob, -0.55 + q * 0.55, ph + 0.75, 0, 0, 0.6, 0.5, 0.6, R.pick(PAL.flowers)); } } }
    }
    // palms ringing the plaza
    det = chunkAt(0, 0);
    for (let k = 0; k < 8; k++) { const an = k / 8 * Math.PI * 2 + 0.39, r = B / 2 + street * 0.5, [px, pz] = T.w(Math.cos(an) * r, Math.sin(an) * r), ph = H(px, pz); if (ph > 1) palm(core, new Frame(px, 0, pz, a), 0, 0, ph); }
  };
  // ---- buildings
  const roofCols = [0xffffff, 0xf2e6dc, 0xe6dccf, 0xfff0e0];
  const built = [];
  for (const L of lots) {
    const fl = city ? Math.max(2, Math.round(5 - L.distC / rad * 3 + R.range(-0.6, 0.6))) : village ? R.int(1, 2) : R.int(2, 3);
    det = chunkAt(L.u, L.v); const b = house(L, fl, Math.hypot(L.u, L.v) < B * 0.9 + street); if (b) built.push(b);
  }
  function house(L, floors, plaza) {
    const [x, z] = T.w(L.u, L.v), ang = a + L.face, w = L.w, d = L.d;
    const F0 = new Frame(x, 0, z, ang);
    const hs = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0], [0, d / 2]].map(([lx, lz]) => { const [wx, wz] = F0.w(lx, lz); return H(wx, wz); });
    const lo = Math.min(...hs), hi = Math.max(...hs);
    if (lo < 0.8 || hi - lo > 7) return null;
    const F = new Frame(x, lo, z, ang), lvl = hi - lo + 0.15, fh = 3.3, top = lvl + floors * fh;
    const wc = col(R.pick(PAL.walls), 1.35), trim = col(R.pick(roofCols), 1.3), sc = col(R.pick(PAL.shutters));
    F.box(core.get('plaster'), 0, (top - 0.8) / 2, 0, w, top + 0.8, d, wc);
    if (LOD) F.box(LOD, 0, (top - 0.8) / 2, 0, w, top + 0.8, d, col(wc, 0.42));
    if (lvl > 0.4 || R.chance(0.4)) F.box(core.get('stone'), 0, (lvl + 0.7 - 0.8) / 2, 0, w + 0.12, lvl + 1.5, d + 0.12, 0xd8cbb0);
    F.box(core.get('plaster'), 0, top - 0.12, 0, w + 0.3, 0.28, d + 0.3, trim);
    let rise = 0;
    const flat = R.chance(city ? 0.35 : village ? 0.15 : 0.3);
    if (flat) {
      for (const [px, pz, sx, sz] of [[0, d / 2, w, 0.25], [0, -d / 2, w, 0.25], [w / 2, 0, 0.25, d], [-w / 2, 0, 0.25, d]]) F.box(core.get('plaster'), px, top + 0.45, pz, sx, 0.9, sz, wc);
      if (R.chance(0.4)) { F.geo(det.get('metal'), G.cyl12, R.range(-w / 4, w / 4), top + 0.9, R.range(-d / 4, d / 4), 0, 1.2, 1.4, 1.2, 0xd0d0cc); }
      if (R.chance(0.5)) for (let k = 0; k < 3; k++) { const px = R.range(-w / 2 + 1, w / 2 - 1), pz = d / 2 - 0.8; F.box(det.get('paint'), px, top + 0.25, pz, 0.6, 0.5, 0.6, 0xb5643a); F.geo(det.get('foliage'), G.blob, px, top + 0.8, pz, 0, 0.9, 0.8, 0.9, R.pick(PAL.greens)); }
    } else {
      rise = Math.min(w, d) / 2 * 0.42;
      const rc = col(0xffffff, R.range(0.85, 1.1));
      const lr = col(LOD_ROOF, rc[0]);
      if (w > d + 1 && R.chance(0.4)) { const g = hipRoof(w, d, rise); F.geo(core.get('roof'), g, 0, top, 0, 0, 1, 1, 1, rc, true); if (LOD) F.geo(LOD, g, 0, top, 0, 0, 1, 1, 1, lr); }
      else { const g = gableRoof(w, d, rise); F.geo(core.get('roof'), g.roof, 0, top, 0, 0, 1, 1, 1, rc, true); F.geo(core.get('plaster'), g.gables, 0, top, 0, 0, 1, 1, 1, wc);
        if (LOD) { F.geo(LOD, g.roof, 0, top, 0, 0, 1, 1, 1, lr); F.geo(LOD, g.gables, 0, top, 0, 0, 1, 1, 1, col(wc, 0.42)); } }
    }
    if (R.chance(0.35)) { const cx = R.range(-w / 3, w / 3), cz = R.range(-d / 4, d / 4); F.box(core.get('plaster'), cx, top + rise * 0.6 + 0.7, cz, 0.7, 1.6 + rise, 0.7, wc); F.box(core.get('roof'), cx, top + rise * 0.6 + 1.6, cz, 0.95, 0.15, 0.95, 0xffffff); }
    // facades: front (+z) and back (-z) always, sides when free-standing
    const sides = [{ cx: 0, cz: d / 2, tx: 1, tz: 0, nx: 0, nz: 1, ry: 0, L: w, front: true }, { cx: 0, cz: -d / 2, tx: -1, tz: 0, nx: 0, nz: -1, ry: Math.PI, L: w }];
    if (village || R.chance(0.2)) sides.push({ cx: -w / 2, cz: 0, tx: 0, tz: 1, nx: -1, nz: 0, ry: -Math.PI / 2, L: d }, { cx: w / 2, cz: 0, tx: 0, tz: -1, nx: 1, nz: 0, ry: Math.PI / 2, L: d });
    const sb = (mb, sd, t, y, o, sx, sy, sz, c, g) => { const lx = sd.cx + sd.tx * t + sd.nx * o, lz = sd.cz + sd.tz * t + sd.nz * o; if (g) F.geo(mb, g, lx, y, lz, sd.ry, sx, sy, sz, c); else F.box(mb, lx, y, lz, sx, sy, sz, c, sd.ry); };
    let door = null;
    for (const sd of sides) {
      const n = Math.max(1, Math.floor((sd.L - 0.8) / 2.9)), sp = sd.L / n, di = R.int(0, n - 1);
      const balc = sd.front && R.chance(0.35);
      for (let k = 0; k < floors; k++) {
        const y0 = lvl + k * fh;
        for (let s = 0; s < n; s++) {
          const t = -sd.L / 2 + sp * (s + 0.5);
          if (k === 0 && sd.front && s === di) { // door
            sb(det.get('paint'), sd, t, y0 + 1.15, 0.04, 1.3, 2.3, 0.1, R.pick(PAL.doors));
            sb(det.get('stone'), sd, t, y0 + 2.4, 0.08, 1.6, 0.22, 0.2, 0xe2d6bd);
            sb(det.get('bulb'), sd, t + 0.95, y0 + 2.5, 0.25, 0.22, 0.32, 0.22, 0xffffff);
            door = { lx: sd.cx + sd.tx * t + sd.nx * 1.6, lz: sd.cz + sd.tz * t + sd.nz * 1.6, F, y0 };
            if (lvl > 0.6) for (let st = 0; st < Math.ceil(lvl / 0.3); st++) sb(core.get('stone'), sd, t, lvl - 0.15 - st * 0.3, 0.5 + st * 0.35, 1.8, 0.3, 0.35, 0xd6c9ae);
            continue;
          }
          if (k === 0 && sd.front && (plaza || (city && R.chance(0.5)))) { // shop arch
            sb(det.get('plaster'), sd, t, y0, 0.08, 1, 1, 1, trim, archGeom(sp - 0.1, 3.1, Math.min(2.2, sp - 0.6), 2.7, 0.2));
            sb(det.get(R.chance(0.4) ? 'glassLit' : 'glass'), sd, t, y0 + 1.3, 0.03, Math.min(2.2, sp - 0.6), 2.6, 0.05, 0xffffff);
            if (R.chance(0.5)) { const aw = R.pick(PAL.awnings); for (let q = 0; q < 4; q++) sb(det.get('paint'), sd, t - 0.9 + q * 0.6 + 0.3 - 0.3, y0 + 3.0, 0.8, 0.6, 0.06, 1.6, aw[q % 2]); }
            continue;
          }
          const isB = balc && k >= 1 && (k === 1 || R.chance(0.4));
          const gh = isB ? 2.2 : 1.55, gy = isB ? y0 + 1.15 : y0 + 1.75;
          sb(det.get(R.chance(0.22) ? 'glassLit' : 'glass'), sd, t, gy, 0.03, 1.05, gh, 0.05, 0xffffff);
          sb(det.get('plaster'), sd, t, gy + gh / 2 + 0.12, 0.05, 1.35, 0.2, 0.1, trim);
          if (R.chance(0.85)) for (const sgn of [-1, 1]) sb(det.get('paint'), sd, t + sgn * 0.82, gy, 0.07, 0.55, gh, 0.06, sc);
          if (isB) {
            sb(det.get('stone'), sd, t, y0 + 0.02, 0.5, 1.9, 0.14, 1.0, 0xe0d4ba);
            sb(det.get('metal'), sd, t, y0 + 1.0, 0.98, 1.9, 0.05, 0.05, 0x26282a);
            for (let q = 0; q < 7; q++) sb(det.get('metal'), sd, t - 0.9 + q * 0.3, y0 + 0.55, 0.98, 0.03, 0.9, 0.03, 0x26282a);
            if (R.chance(0.6)) { sb(det.get('paint'), sd, t + 0.6, y0 + 0.35, 0.75, 0.4, 0.4, 0.4, 0xb5643a); sb(det.get('foliage'), sd, t + 0.6, y0 + 0.8, 0.75, 0.6, 0.6, 0.6, R.pick(PAL.flowers), G.blob); }
          } else {
            sb(det.get('stone'), sd, t, gy - gh / 2 - 0.06, 0.12, 1.35, 0.1, 0.26, 0xe2d6bd);
            if (k > 0 && R.chance(0.25)) { sb(det.get('paint'), sd, t, gy - gh / 2 + 0.1, 0.3, 1.1, 0.25, 0.3, 0xa85a35); sb(det.get('foliage'), sd, t, gy - gh / 2 + 0.35, 0.3, 1.1, 0.35, 0.4, R.pick(PAL.flowers), G.blob); }
          }
        }
      }
    }
    const [cx, cz] = F.w(0, 0);
    ctx.collider(cx, lo + (top + rise * 0.5 - 0.8) / 2, cz, w / 2, (top + rise * 0.5 + 0.8) / 2, d / 2, ang);
    return { x, z, ang, w, d, top: lo + top, door, L };
  }
  fill();
  det = chunkAt(0, 0);
  // ---- plaza (block 0,0)
  const pz = new Frame(site.x, H(site.x, site.z), site.z, a), half = B / 2 + street / 2;
  const g0 = H(site.x, site.z);
  drape(core.get('stone'), H, site.x, site.z, a, B, B, 4, null, 0.1, col(0xece2cf, 0.95));
  // fountain
  pz.geo(core.get('stone'), G.cyl24, 0, 0.4, 0, 0, 7, 0.8, 7, 0xe6dcc6); pz.geo(core.get('water'), G.cyl24, 0, 0.72, 0, 0, 6.4, 0.1, 6.4, 0xffffff);
  pz.geo(core.get('stone'), G.cyl12, 0, 1.6, 0, 0, 0.8, 2.4, 0.8, 0xe6dcc6); pz.geo(core.get('stone'), G.cyl12, 0, 2.6, 0, 0, 2.4, 0.3, 2.4, 0xe6dcc6); pz.geo(core.get('water'), G.cyl12, 0, 2.78, 0, 0, 2.1, 0.06, 2.1, 0xffffff);
  ctx.collider(site.x, g0 + 0.5, site.z, 3.4, 0.6, 3.4, 0);
  // corner olive trees in planters, benches, lamps
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const lx = sx * (B / 2 - 4), lz = sz * (B / 2 - 4);
    pz.box(core.get('stone'), lx, 0.35, lz, 2.6, 0.7, 2.6, 0xd9ccb0);
    pz.geo(core.get('paint'), G.cyl8, lx, 1.8, lz, 0, 0.45, 2.6, 0.45, 0x5a4632, false, 0.1);
    for (let k = 0; k < 4; k++) pz.geo(core.get('foliage'), G.blob, lx + R.range(-1.3, 1.3), 3.4 + R.range(0, 1.2), lz + R.range(-1.3, 1.3), 0, 2.6, 1.8, 2.6, 0x7d8c5c);
    pz.box(det.get('planks'), lx - sx * 3.5, 0.45, lz, 0.6, 0.12, 2.2, 0xffffff); pz.box(det.get('metal'), lx - sx * 3.5, 0.22, lz, 0.5, 0.44, 2, 0x2a2a2a);
    pz.geo(det.get('metal'), G.cyl8, lx + sx * 2.2, 2, lz - sz * 2.2, 0, 0.14, 4, 0.14, 0x1f2224); pz.box(det.get('bulb'), lx + sx * 2.2, 4.1, lz - sz * 2.2, 0.45, 0.55, 0.45, 0xffffff);
  }
  // market stalls on one side
  const ms = R.int(3, city ? 6 : 4);
  for (let k = 0; k < ms; k++) {
    const lx = -B / 2 + 6 + k * ((B - 12) / Math.max(1, ms - 1)), lz = -B / 2 + 4.5, aw = R.pick(PAL.awnings);
    for (const [ox, oz] of [[-1.3, -1], [1.3, -1], [-1.3, 1], [1.3, 1]]) pz.box(det.get('paint'), lx + ox, 1.25, lz + oz, 0.1, 2.5, 0.1, 0x6a4a2a);
    pz.box(det.get('planks'), lx, 0.9, lz, 2.8, 0.1, 1.8, 0xffffff);
    for (let q = 0; q < 6; q++) pz.box(det.get('paint'), lx - 1.25 + q * 0.5, 2.6, lz, 0.5, 0.06, 2.6, aw[q % 2], 0, 0.18);
    for (let q = 0; q < 4; q++) pz.box(det.get('paint'), lx - 1 + q * 0.66, 1.08, lz + R.range(-0.4, 0.4), 0.55, 0.25, 0.45, R.pick([0xe07a1f, 0xc62828, 0x6b8e23, 0xe8c547, 0x8e3a6e]));
  }
  // string lights: across the plaza and along the first stretch of each street
  const lights = (p1, p2, h1, h2) => {
    const n = 12, sag = 1.2, wmb = det.get('paint'), bmb = det.get('bulb'); let prev = null;
    for (let k = 0; k <= n; k++) {
      const f = k / n, p = [p1[0] + (p2[0] - p1[0]) * f, h1 + (h2 - h1) * f - Math.sin(f * Math.PI) * sag, p1[1] + (p2[1] - p1[1]) * f];
      if (prev) pz.beam(wmb, prev, p, 0.015, 0x202020);
      if (k > 0 && k < n) pz.geo(bmb, G.sphere, p[0], p[1] - 0.12, p[2], 0, 0.2, 0.26, 0.2, 0xffffff);
      prev = p;
    }
  };
  const hb = B / 2 + street;
  lights([-hb, -hb], [hb, hb], 6, 6); lights([hb, -hb], [-hb, hb], 6, 6);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, -1]]) for (let k = 0; k < 4; k++) {
    const along = hb + 4 + k * 7, o = street / 2 + 0.2; const tx = -dz, tz = dx;
    lights([dx * along + tx * o, dz * along + tz * o], [dx * (along + 3.5) - tx * o, dz * (along + 3.5) - tz * o], 5.5, 5.5);
  }
  // ---- church on block (0,1), facade toward the plaza
  {
    const cw = city ? 16 : village ? 9 : 12, cl = city ? 30 : village ? 16 : 24, ch = city ? 13 : village ? 7.5 : 10, th = city ? 32 : village ? 17 : 24, ts = city ? 6 : 4.5;
    const fz = P - B / 2 + 4; const [x, z] = T.w(0, fz + cl / 2); const gy = Math.min(H(x, z), g0);
    const C = new Frame(x, gy, z, a); const wc = col(0xf3ecdc, 1.3), st = core.get('stone');
    C.box(core.get('plaster'), 0, ch / 2 - 1, 0, cw, ch + 2, cl, wc);
    if (LOD) { C.box(LOD, 0, ch / 2 - 1, 0, cw, ch + 2, cl, col(wc, 0.42)); C.geo(LOD, gableRoof(cl, cw, cw * 0.35).roof, 0, ch, 0, Math.PI / 2, 1, 1, 1, LOD_ROOF);
      const tx = cw / 2 + (city ? 6 : 4.5) / 2 - 0.5, tz = -cl / 2 + (city ? 6 : 4.5) / 2, ts = city ? 6 : 4.5; C.box(LOD, tx, th / 2, tz, ts, th, ts, col(wc, 0.42)); C.geo(LOD, G.pyr4, tx, th + 1.7, tz, 0, ts + 0.6, 4.6, ts + 0.6, LOD_ROOF); }
    C.box(st, 0, 0.4, 0, cw + 0.3, 1.6, cl + 0.3, 0xd8cbb0);
    const g = gableRoof(cl, cw, cw * 0.35); C.geo(core.get('roof'), g.roof, 0, ch, 0, Math.PI / 2, 1, 1, 1, 0xffffff, true); C.geo(core.get('plaster'), g.gables, 0, ch, 0, Math.PI / 2, 1, 1, 1, wc);
    C.geo(det.get('stone'), archGeom(3, 5, 2, 4.2, 0.4), 0, 0, -cl / 2 - 0.1, 0, 1, 1, 1, 0xe2d6bd); C.box(det.get('paint'), 0, 1.9, -cl / 2 - 0.02, 2, 3.8, 0.1, 0x4a3324);
    C.geo(det.get('stone'), G.cyl24, 0, ch - 2.5, -cl / 2 - 0.1, 0, 2.6, 2.6, 0.3, 0xe2d6bd, false, Math.PI / 2); C.geo(det.get('glassLit'), G.cyl24, 0, ch - 2.5, -cl / 2 - 0.2, 0, 2, 2, 0.1, 0xffffff, false, Math.PI / 2);
    for (let s = 0; s < 5; s++) C.box(st, 0, 0.15 + s * 0.3 - 1.2 + 1.2, -cl / 2 - 1 - (4 - s) * 0.45, 6, 0.3, 0.45 + (4 - s) * 0.0, 0xd6c9ae);
    for (let k = 0; k < 4; k++) for (const sg of [-1, 1]) C.box(det.get('glass'), sg * (cw / 2 + 0.03), ch * 0.55, -cl / 2 + 4 + k * (cl - 8) / 3, 0.05, 3, 1.2, 0xffffff);
    const tx = cw / 2 + ts / 2 - 0.5, tz = -cl / 2 + ts / 2;
    C.box(core.get('plaster'), tx, th / 2 - 1, tz, ts, th - 4 + 2, ts, wc); C.box(st, tx, th - 4.8, tz, ts + 0.3, 0.4, ts + 0.3, 0xe2d6bd);
    for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) C.box(st, tx + ox * (ts / 2 - 0.4), th - 2.8, tz + oz * (ts / 2 - 0.4), 0.8, 3.6, 0.8, 0xe8dcc4);
    C.box(st, tx, th - 0.8, tz, ts + 0.4, 0.5, ts + 0.4, 0xe2d6bd);
    C.geo(det.get('bronze'), G.cone8, tx, th - 2.6, tz, 0, 1.4, 1.6, 1.4, 0x9a7a3a);
    C.geo(core.get('roof'), G.pyr4, tx, th + 1.7, tz, 0, ts + 0.6, 4.6, ts + 0.6, 0xffffff);
    C.geo(det.get('stone'), G.cyl24, tx, th - 7, tz - ts / 2 - 0.05, 0, 2, 2, 0.15, 0xf6f2e8, false, Math.PI / 2);
    C.box(det.get('paint'), tx, th - 6.6, tz - ts / 2 - 0.15, 0.08, 0.8, 0.05, 0x111111); C.box(det.get('paint'), tx + 0.25, th - 7, tz - ts / 2 - 0.15, 0.55, 0.08, 0.05, 0x111111);
    const [ccx, ccz] = C.w(0, 0), [tcx, tcz] = C.w(tx, tz);
    ctx.collider(ccx, gy + ch / 2 + 0.5, ccz, cw / 2, ch / 2 + 1.5, cl / 2, a); ctx.collider(tcx, gy + th / 2, tcz, ts / 2, th / 2, ts / 2, a);
  }
  // ---- town wall ring with gaps
  if (!village) {
    const wr = rad * 0.98, seg = 9, n = Math.floor(Math.PI * 2 * wr / seg);
    for (let k = 0; k < n; k++) {
      const an = k / n * Math.PI * 2, rel = ((an % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
      if (rel < 0.12 || rel > Math.PI / 2 - 0.12 || R.chance(0.12)) continue;
      const lx = Math.cos(an) * wr, lz = Math.sin(an) * wr, [x, z] = T.w(lx, lz), h0 = H(x, z); if (h0 < 1) continue;
      const W = new Frame(x, h0, z, a - an + Math.PI / 2), wh = R.range(3.2, 4.2);
      W.box(core.get('stone'), 0, wh / 2 - 1, 0, seg + 0.4, wh + 2, 1.4, 0xcfc2a5);
      for (let q = -2; q <= 2; q++) W.box(core.get('stone'), q * 1.9, wh + 0.4, 0, 0.9, 0.8, 1.4, 0xcfc2a5);
      ctx.collider(x, h0 + wh / 2 - 0.5, z, seg / 2, wh / 2 + 0.5, 0.7, a - an + Math.PI / 2);
    }
  }
  // ---- cypresses around the edge
  for (let k = 0; k < (city ? 30 : 14); k++) {
    const an = R() * Math.PI * 2, r = rad * R.range(0.82, 1.05), [x, z] = T.w(Math.cos(an) * r, Math.sin(an) * r), h = H(x, z); if (h < 1) continue;
    const C = new Frame(x, h, z, 0), th = R.range(7, 12);
    C.geo(core.get('foliage'), G.cone8, 0, th / 2 + 0.8, 0, 0, 1.8, th, 1.8, 0x3a5230);
  }
  // ---- harbour pier for coastal towns
  if (site.coast) {
    const ca = site.coast.ang, dirx = Math.sin(ca), dirz = Math.cos(ca); let d0 = site.coast.dist - 20;
    for (let d = site.coast.dist - 60; d < site.coast.dist + 40; d += 4) if (H(site.x + dirx * d, site.z + dirz * d) < 0.6) { d0 = d - 6; break; }
    const Pf = new Frame(site.x + dirx * d0, 1.6, site.z + dirz * d0, ca);
    Pf.box(core.get('planks'), 0, 0, 20, 5, 0.4, 44, 0xffffff);
    for (let q = 0; q < 12; q++) for (const sx of [-2.2, 2.2]) Pf.geo(core.get('paint'), G.cyl8, sx, -3, q * 4, 0, 0.4, 6, 0.4, 0x4a3a2a);
    const [px, pzz] = Pf.w(0, 20); ctx.collider(px, 1.6, pzz, 2.5, 0.2, 22, ca);
    const [b1x, b1z] = Pf.w(6, 30), [b2x, b2z] = Pf.w(-6, 38);
    ctx.vehicle('boat', b1x, b1z, ca, site.id, 0.3); ctx.vehicle(R.chance(0.5) ? 'jetski' : 'boat', b2x, b2z, ca, site.id, 0.3);
  }
  // ---- propaganda (liberation targets) + regime flag pole
  const wp = (lx, lz) => T.w(lx, lz);
  { const [x, z] = wp(-B / 2 + 2, B / 2 - 2); ctx.prop(site, 'flagpole', x, z, a); }
  const nBill = city ? 3 : village ? 1 : 2, nSpk = city ? 3 : village ? 1 : 2;
  for (let k = 0; k < nBill; k++) { const s = [[0, B / 2 + street - 1, Math.PI], [B / 2 + street - 1, 0, -Math.PI / 2], [-B / 2 - street + 1, 0, Math.PI / 2]][k]; const [x, z] = wp(s[0] * 0.75, s[1] * 0.75); ctx.prop(site, 'billboard', x, z, a + s[2] + Math.PI); }
  for (let k = 0; k < nSpk; k++) { const an = k / nSpk * Math.PI * 2 + 0.6, [x, z] = wp(Math.cos(an) * (B / 2 - 1.5), Math.sin(an) * (B / 2 - 1.5)); ctx.prop(site, 'loudspeaker', x, z, a + an); }
  if (city) { // Vask statue on a second square
    const [x, z] = wp(P, 0), h = H(x, z), S = new Frame(x, h, z, a);
    S.box(core.get('stone'), 0, 1.5, 0, 6, 3, 6, 0xd8cbb0); S.box(core.get('stone'), 0, 3.4, 0, 4.6, 0.8, 4.6, 0xe2d6bd);
    ctx.collider(x, h + 1.9, z, 3, 1.9, 3, a);
    ctx.prop(site, 'statue', x, z, a - Math.PI / 2, { y: h + 3.8 });
    for (const sg of [-1, 1]) { const [bx, bz] = wp(P + sg * 4, 4); ctx.banner(site, site._group, bx, H(bx, bz) + 6, bz, 2.4, 7, a); }
  }
  // regime banners hung from plaza facades
  for (const b of built.filter(b => b.L.distC < B + street + 8).slice(0, city ? 6 : 3)) {
    const F = new Frame(b.x, 0, b.z, b.ang), [x, z] = F.w(0, b.d / 2 + 0.15); ctx.banner(site, site._group, x, b.top - 3.2, z, 1.6, 4.5, b.ang);
  }
  // ---- safehouse, vehicles, guards
  const sh = built.filter(b => b.door && b.L.distC > B * 1.4);
  const safe = sh.length ? sh[Math.floor(R() * sh.length)] : built.find(b => b.door);
  if (safe) {
    const { lx, lz, F, y0 } = safe.door, [x, z] = F.w(lx, lz); ctx.safehouse(x, z, site.id);
    const [bx, bz] = F.w(lx * 0.9, lz - 1.45 * Math.sign(lz || 1)); const m = ctx.banner(site, site._detail, bx, F.y + y0 + 3.6, bz, 1.2, 1.6, safe.ang);
    m.material = ctx.mats.rebelFlag; site._flags.splice(site._flags.indexOf(m), 1);
  }
  const ncar = city ? 10 : village ? 2 : 5;
  for (let k = 0, tries = 0; k < ncar && tries < 60; tries++) {
    const i = R.int(-nB, nB - 1), alongV = R.range(-rad * 0.7, rad * 0.7), lu = i * P + P / 2 + (R.chance(0.5) ? 2.2 : -2.2);
    const swap = R.chance(0.5), lx = swap ? alongV : lu, lz = swap ? lu : alongV;
    if (Math.hypot(lx, lz) > rad * 0.75 || Math.hypot(lx, lz) < B) continue;
    const [x, z] = T.w(lx, lz); if (H(x, z) < 1) continue;
    ctx.vehicle(R.pick(['sedan', 'sedan', 'pickup', 'sports']), x, z, a + (swap ? Math.PI / 2 : 0) + (R.chance(0.5) ? Math.PI : 0), site.id); k++;
  }
  for (let k = 0; k < (city ? 8 : village ? 2 : 4); k++) { const an = R() * Math.PI * 2, r = R.range(4, B / 2), [x, z] = T.w(Math.cos(an) * r, Math.sin(an) * r); site.spawns.push({ x, y: H(x, z) + 1, z, type: k === 0 && city ? 'officer' : 'soldier' }); }
  { const vs = (ctx.game.world?.vehicleSpawns || []).filter(v => v.siteId === site.id), sf = ctx.game.world?.safehouses?.filter(q => q.siteId === site.id) || [];
    for (const q of parkQ) if (!vs.some(v => Math.hypot(v.x - q[0], v.z - q[1]) < 7) && !sf.some(v => Math.hypot(v.x - q[0], v.z - q[1]) < 5)) buildParked(...q); }
  core.meshes(site._core || site._group);
  site._detailChunks = [];
  for (const c of chunks.values()) { const g = new THREE.Group(); g.name = 'detail-chunk'; c.bag.meshes(g, { shadow: false }); if (!g.children.length) continue;
    const [x, z] = T.w(c.u, c.v); g.userData.cx = x; g.userData.cz = z; site._detail.add(g); site._detailChunks.push(g); }
}
