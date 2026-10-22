// Military bases / airbase / naval yard / outposts. FIRST PASS (budget-limited): walls, towers, searchlights, barracks,
// helipads, runway, piers, destructibles, spawns. Needs a detail pass.
import * as THREE from 'three';
import { makeRng, hashStr, Bag, Frame, G, PAL, drape } from './kit.js';
const UNITQ = new THREE.PlaneGeometry(1, 1);
const M = PAL.mil;
export function buildBase(ctx, site) {
  const { H } = ctx, R = makeRng(hashStr(site.id) ^ 0xba5e), core = new Bag(ctx.mats), out = site.type === 'outpost';
  const air = site.type === 'airbase', a = site.rotY, T = new Frame(site.x, 0, site.z, a);
  const W = air ? site.runway.length + 60 : out ? 40 : site.radius * 1.4, D = air ? 180 : out ? 40 : site.radius * 1.2;
  const wp = (lx, lz) => T.w(lx, lz), gy = (lx, lz) => { const [x, z] = wp(lx, lz); return H(x, z); };
  drape(core.get(out ? 'ground' : 'pad'), H, site.x, site.z, a, W, D, 8, null, 0.05, out ? 0xc9bfa6 : 0xe6dcc6);
  const LOD = site._lodMB; // far LOD: pad plate, wall segments, towers, buildings (albedo baked)
  if (LOD) { drape(LOD, H, site.x, site.z, a, W, D, 20, null, 0.25, out ? 0x6e6450 : 0x77756e);
    if (air) drape(LOD, H, site.x, site.z, a, site.runway.length, site.runway.width, 20, null, 0.35, 0x2a2a28); }
  if (air) { drape(core.get('asphalt'), H, site.x, site.z, a, site.runway.length, site.runway.width, 8, null, 0.1, 0x6a6a66);
    for (let x = -site.runway.length / 2 + 20; x < site.runway.length / 2 - 20; x += 30) { const [px, pz] = wp(x, 0); new Frame(px, H(px, pz) + 0.14, pz, a).box(core.get('paint2'), 0, 0, 0, 14, 0.04, 0.9, 0xf0f0f0); } }
  // perimeter wall with gate gap on -z side: precast panels (milWall shader), dirty plinth, regime red/black band,
  // coping, inner buttresses, Y-outrigger posts with wire strands, emblem banners on the outer face every few panels.
  const flagMB = core.get('regimeFlag'), FLAG = ctx.mats.regimeFlag;
  const emblem = (F, lx, ly, lz, w, h, ry = 0) => { // flat emblem panel, own uv 0..1 (merged; swaps to rebel on liberation)
    const g = UNITQ; F.geo(flagMB, g, lx, ly, lz, ry, w, h, 1, 0xffffff, true); };
  let seg = 0;
  const wall = (x0, z0, x1, z1) => { const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 6)), ry = Math.atan2(-(z1 - z0), x1 - x0);
    for (let i = 0; i < n; i++) { const lx = x0 + (x1 - x0) * (i + 0.5) / n, lz = z0 + (z1 - z0) * (i + 0.5) / n, [x, z] = wp(lx, lz), h = H(x, z), F = new Frame(x, h, z, a + ry);
      const sl = L / n + 0.05, [ox, oz] = F.w(0, 1), out1 = Math.hypot(ox - site.x, oz - site.z) > Math.hypot(x - site.x, z - site.z) ? 1 : -1;
      if (out) {
        F.boxG(core.get('hesco'), 0, 0.2, 0, sl, 2.2, 1.1, 0xf2e8d0, 0xa89670);
        F.box(core.get('sandbag'), 0, 1.45, 0, sl, 0.3, 1.0, 0xb3a277);
      } else {
        F.boxG(core.get('milWall'), 0, 1.6, 0, sl, 4.2, 0.6, 0xefe5d0, 0x9e8f76);
        F.boxG(core.get('milWall'), 0, -0.1, 0, sl, 1.2, 0.72, 0xa59d8e, 0x7a6e5c);            // plinth
        F.box(core.get('paint'), 0, 3.05, out1 * 0.31, sl, 0.42, 0.02, M.red);                 // regime band (outer face)
        F.box(core.get('paint'), 0, 2.78, out1 * 0.31, sl, 0.1, 0.02, M.black);
        F.box(core.get('milWall'), 0, 3.82, 0, sl, 0.24, 0.86, 0xcdc7b9);                     // coping
        if (i % 2 === 0) F.boxG(core.get('milWall'), 0, 1.6, -out1 * 0.52, 0.7, 4.2, 0.45, 0xd0cabc, 0x8f8473); // buttress
        for (const ex of [-sl / 2 + 0.2, sl / 2 - 0.2]) { // outrigger post + three strands
          F.box(core.get('milMetal'), ex, 4.3, 0, 0.08, 0.8, 0.08, 0x55585c);
          F.box(core.get('milMetal'), ex, 4.55, out1 * 0.28, 0.06, 0.7, 0.06, 0x55585c, 0, out1 * -0.7); }
        for (const [yy, zz] of [[4.2, 0], [4.55, out1 * 0.3], [4.8, out1 * 0.45]]) F.box(core.get('milMetal'), 0, yy, zz, sl, 0.035, 0.035, 0x3a3c3f);
        if ((seg++) % 4 === 1) emblem(F, 0, 1.7, out1 * 0.32, 2.0, 1.25, out1 > 0 ? 0 : Math.PI);
      }
      if (LOD) F.box(LOD, 0, out ? 0.6 : 1.7, 0, sl, out ? 2.2 : 4.4, out ? 1.1 : 0.7, out ? 0x7a6a4a : 0x8a8478);
      ctx.collider(x, h + (out ? 0.9 : 1.6), z, L / n / 2, out ? 0.9 : 2.2, 0.3, a + ry); } };
  const hw = W / 2, hd = D / 2, gate = 8;
  wall(-hw, -hd, -gate, -hd); wall(gate, -hd, hw, -hd); wall(hw, -hd, hw, hd); wall(hw, hd, -hw, hd); wall(-hw, hd, -hw, -hd);
  for (const s of [-1, 1]) { const [x, z] = wp(s * (gate + 1), -hd), F = new Frame(x, H(x, z), z, a);
    F.boxG(core.get('milWall'), 0, 4, 0, 1.8, 8, 1.8, 0xe0dacb, 0x958a76); F.box(core.get('paint'), 0, 8.15, 0, 2.0, 0.3, 2.0, M.red); F.box(core.get('paint'), 0, 7.4, 0, 1.84, 0.35, 1.84, M.black);
    emblem(F, 0, 5.2, -0.92, 1.5, 2.6, Math.PI); emblem(F, 0, 5.2, 0.92, 1.5, 2.6, 0); }
  // watchtowers: steel legs with X-bracing, ladder, plank deck, painted cabin walls, regime-red roof edge, sandbag base
  for (const [sx, sz] of out ? [[1, 1]] : [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lx = sx * (hw - 3), lz = sz * (hd - 3), [x, z] = wp(lx, lz), h = H(x, z), F = new Frame(x, h, z, a), mm = core.get('milMetal');
    for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) F.box(mm, ox * 1.4, 4, oz * 1.4, 0.28, 8, 0.28, 0x8d9296);
    for (const [ax, az, bx, bz] of [[-1.4, -1.4, 1.4, -1.4], [1.4, -1.4, 1.4, 1.4], [1.4, 1.4, -1.4, 1.4], [-1.4, 1.4, -1.4, -1.4]])
      for (const [y0, y1] of [[0.5, 4], [4, 7.6]]) { F.beam(mm, [ax, y0, az], [bx, y1, bz], 0.06, 0x7a7f84); F.beam(mm, [bx, y0, bz], [ax, y1, az], 0.06, 0x7a7f84); }
    for (let r = 0; r < 14; r++) F.box(mm, 0, 0.5 + r * 0.55, 1.75, 0.6, 0.05, 0.05, 0x55585c);
    for (const ox of [-0.32, 0.32]) F.box(mm, ox, 4, 1.75, 0.06, 8, 0.06, 0x55585c);
    F.box(core.get('planks'), 0, 8.1, 0, 4.2, 0.3, 4.2, 0xffffff);
    for (const [px, pz, w, d] of [[0, 2.0, 4.2, 0.1], [0, -2.0, 4.2, 0.1], [2.0, 0, 0.1, 4.2], [-2.0, 0, 0.1, 4.2]]) F.box(core.get('paint'), px, 8.85, pz, w, 1.2, d, 0x6b7048);
    for (const ox of [-1.95, 1.95]) for (const oz of [-1.95, 1.95]) F.box(mm, ox, 10.1, oz, 0.14, 2.2, 0.14, 0x4a4d50);
    F.box(mm, 0, 11.25, 0, 4.8, 0.25, 4.8, 0x5c5f62); F.box(core.get('paint'), 0, 11.25, 0, 4.86, 0.18, 4.86, M.red);
    const sbm = core.get('sandbag');
    for (let row = 0; row < 2; row++) for (let k = 0; k < 8; k++) { const t = k / 8 * Math.PI * 2 + row * 0.4; F.geo(sbm, G.blob, Math.cos(t) * 2.6, 0.2 + row * 0.36, Math.sin(t) * 2.6, -t, 1.15, 0.4, 0.6, row ? 0xb9a982 : 0xa99872); }
    if (LOD) { F.box(LOD, 0, 4, 0, 3, 8, 3, 0x55585a); F.box(LOD, 0, 9.6, 0, 4.4, 3.2, 4.4, 0x4a4e38); }
    ctx.collider(x, h + 4.1, z, 2, 4.1, 2, a);
    ctx.cone(site, site._group, x, h + 10.5, z, a + Math.atan2(-lx, -lz));
    site.spawns.push({ x, y: h + 8.6, z, type: 'sniper' });
  }
  // buildings: barracks / hangars
  const blds = out ? [[0, 6, 10, 5, 3]] : air ? [[-150, -60, 40, 30, 12], [-90, -60, 40, 30, 12], [150, -60, 24, 16, 6]] : [[-hw * 0.6, 0, 9, 26, 4], [-hw * 0.35, 0, 9, 26, 4], [hw * 0.1, hd * 0.55, 22, 12, 7]];
  for (const [lx, lz, w, d, h] of blds) { const [x, z] = wp(lx, lz), y = H(x, z) - 0.5, F = new Frame(x, y, z, a);
    if (h >= 12) F.geo(core.get('milMetal'), G.halfCyl, 0, 0, 0, Math.PI / 2, h * 2, w, d, M.grey, false, 0, Math.PI / 2);
    else { F.boxG(core.get('milWall'), 0, h / 2, 0, w, h + 0.5, d, 0xe2dccd, 0xa0947f); F.box(core.get('milMetal'), 0, h + 0.4, 0, w + 0.6, 0.3, d + 0.6, M.olive);
      F.box(core.get('paint'), 0, h - 0.3, 0, w + 0.04, 0.3, d + 0.04, M.red);
      for (const sd of [-1, 1]) { const nW = Math.max(1, Math.floor(d / 3.2)); for (let k = 0; k < nW; k++) { const zz = -d / 2 + (k + 0.5) * d / nW;
        if (k === (nW >> 1) && sd > 0) { F.box(core.get('paint'), sd * (w / 2 + 0.03), 1.25, zz, 0.06, 2.4, 1.3, 0x3d4a3a); continue; }
        F.box(core.get('glass'), sd * (w / 2 + 0.03), h * 0.55, zz, 0.05, 1.1, 1.6, 0xffffff); F.box(core.get('milWall'), sd * (w / 2 + 0.08), h * 0.55 - 0.62, zz, 0.12, 0.12, 1.9, 0xbdb6a6); } } }
    if (LOD) { if (h >= 12) F.geo(LOD, G.halfCyl, 0, 0, 0, Math.PI / 2, h * 2, w, d, 0x6a6e72, false, 0, Math.PI / 2); else { F.box(LOD, 0, h / 2, 0, w, h + 0.5, d, 0x8f897c); F.box(LOD, 0, h + 0.4, 0, w + 0.6, 0.3, d + 0.6, 0x3c4028); } }
    ctx.collider(x, y + h / 2, z, w / 2, h / 2 + 0.3, d / 2, a); site.spawns.push({ x: x + 6, y: y + 1.5, z, type: 'soldier' }, { x: x - 6, y: y + 1.5, z, type: 'soldier' }); }
  // helipad
  if (!out) { const [x, z] = wp(hw * 0.55, -hd * 0.45), F = new Frame(x, H(x, z), z, a); F.geo(core.get('milWall'), G.cyl24, 0, 0.1, 0, 0, 16, 0.3, 16, 0x8a8680);
    F.box(core.get('paint2'), -2, 0.27, 0, 0.8, 0.04, 6, M.yellow); F.box(core.get('paint2'), 2, 0.27, 0, 0.8, 0.04, 6, M.yellow); F.box(core.get('paint2'), 0, 0.27, 0, 4, 0.04, 0.8, M.yellow);
    ctx.vehicle(air ? 'attackHeli' : 'heli', x, z, a, site.id, H(x, z) + 0.6); }
  // ---- detail pass (bases / naval / airbase): roads, HQ, tents, containers, floodlights, sandbags, gate ----
  if (!out) {
    const atF = (lx, lz) => { const [x, z] = wp(lx, lz); return new Frame(x, H(x, z), z, a); };
    const strip = (lx0, lz0, lx1, lz1, w) => { // flat asphalt strip in local space, draped on the pad
      const L = Math.hypot(lx1 - lx0, lz1 - lz0), ry = Math.atan2(-(lz1 - lz0), lx1 - lx0), [cx, cz] = wp((lx0 + lx1) / 2, (lz0 + lz1) / 2);
      drape(core.get('asphalt'), H, cx, cz, a + ry, L, w, 6, null, 0.11, 0x8a8a84);
      for (let t = 4; t < L - 4; t += 9) { const k = t / L, [px, pz] = wp(lx0 + (lx1 - lx0) * k, lz0 + (lz1 - lz0) * k); new Frame(px, H(px, pz) + 0.16, pz, a + ry).box(core.get('paint2'), 0, 0, 0, 4, 0.03, 0.3, 0xe8d9a0); }
    };
    if (!air) { strip(0, -hd - 4, 0, hd * 0.2, 9); strip(-hw * 0.92, -hd * 0.25, hw * 0.92, -hd * 0.25, 8); }
    // gate: guard booth + boom barrier + sandbag nests
    { const F = atF(gate + 4.5, -hd + 4); F.box(core.get('milWall'), 0, 1.4, 0, 3, 2.8, 3, 0xd8d2c4); F.box(core.get('glass'), 0, 1.9, -1.52, 2.4, 1, 0.05, 0xffffff); F.box(core.get('milMetal'), 0, 2.95, 0, 3.6, 0.2, 3.6, M.olive);
      const [bx, bz] = wp(gate + 4.5, -hd + 4); ctx.collider(bx, H(bx, bz) + 1.4, bz, 1.5, 1.4, 1.5, a);
      const G2 = atF(0, -hd - 1.5); G2.box(core.get('milMetal'), -gate + 0.5, 0.6, 0, 0.5, 1.2, 0.5, M.dark); for (let k = 0; k < 8; k++) G2.box(core.get('paint'), -gate + 1.4 + k * 1.75, 1.05, 0, 1.75, 0.18, 0.18, k % 2 ? M.red : M.white); }
    const sandbags = (lx, lz, r, a0, a1) => { const F = atF(lx, lz); for (let row = 0; row < 3; row++) for (let t = a0 + row * 0.12; t < a1; t += 0.95 / r) F.geo(core.get('sandbag'), G.blob, Math.cos(t) * r, 0.22 + row * 0.38, Math.sin(t) * r, -t + Math.PI / 2, 1.05, 0.42, 0.58, R.pick([0xbfae84, 0xb3a277, 0xa8976c, 0xc4b48c])); };
    const hesco = (lx0, lz0, lx1, lz1, hgt = 1.4) => { const L = Math.hypot(lx1 - lx0, lz1 - lz0), n = Math.max(1, Math.round(L / 1.1)), ry = Math.atan2(-(lz1 - lz0), lx1 - lx0);
      for (let k = 0; k < n; k++) { const f = (k + 0.5) / n, [x, z] = wp(lx0 + (lx1 - lx0) * f, lz0 + (lz1 - lz0) * f), F = new Frame(x, H(x, z), z, a + ry);
        F.boxG(core.get('hesco'), 0, hgt / 2 - 0.05, 0, L / n - 0.04, hgt, 1.05, R.pick([0xffffff, 0xf2ece0, 0xe8e0cc]), 0xa89878); }
      const [cx, cz] = wp((lx0 + lx1) / 2, (lz0 + lz1) / 2); ctx.collider(cx, H(cx, cz) + hgt / 2, cz, L / 2, hgt / 2, 0.55, a + ry); };
    hesco(-gate - 14, -hd + 12, -gate - 2, -hd + 12); hesco(gate + 16, -hd + 15, gate + 16, -hd + 26);
    { const [hx, hz] = [hw * 0.55, -hd * 0.45]; hesco(hx - 12, hz - 11, hx + 12, hz - 11, 1.1); hesco(hx + 12, hz - 11, hx + 12, hz + 6, 1.1); }
    sandbags(-gate - 6, -hd + 6, 3, 0, Math.PI); sandbags(gate + 11, -hd + 9, 3, 0.4, Math.PI + 0.4);
    if (!air) {
      // HQ: two storeys, window bands, parapet, roof antenna
      { const lx = -hw * 0.62, lz = -hd * 0.62, F = atF(lx, lz), w = 18, d = 12;
        F.box(core.get('milWall'), 0, 3.5, 0, w, 7.4, d, 0xe2dccd); if (LOD) F.box(LOD, 0, 3.8, 0, w, 8, d, 0x938d80); F.box(core.get('milWall'), 0, 7.45, 0, w + 0.4, 0.9, d + 0.4, 0xc9c2b2);
        for (const y of [2, 5.2]) for (const sd of [-1, 1]) F.box(core.get('glass'), 0, y, sd * (d / 2 + 0.03), w - 2, 1.2, 0.05, 0xffffff);
        F.box(core.get('paint'), 0, 1.3, -d / 2 - 0.9, 4, 0.2, 1.8, M.olive); F.box(core.get('milMetal'), 0, 0.1, -d / 2 - 0.9, 3, 2.6, 0.1, M.dark);
        F.beam(core.get('milMetal'), [w / 2 - 2, 7.9, 0], [w / 2 - 2, 16, 0], 0.12, M.grey); F.geo(core.get('milMetal'), G.dome, -w / 2 + 3, 7.9, 2, 0, 2.4, 1.2, 2.4, M.white);
        const [x, z] = wp(lx, lz); ctx.collider(x, H(x, z) + 3.8, z, w / 2, 3.8, d / 2, a);
        ctx.flag(site, site._group, ...(() => { const [fx, fz] = wp(lx + w / 2 + 4, lz - d / 2 - 4); return [fx, H(fx, fz) + 9.5, fz]; })(), 3, 2, a);
        { const [fx, fz] = wp(lx + w / 2 + 4, lz - d / 2 - 4); new Frame(fx, H(fx, fz), fz, a).beam(core.get('milMetal'), [0, 0, 0], [0, 10.6, 0], 0.08, M.white); } }
      // tents
      for (let k = 0; k < 3; k++) { const lx = -hw * 0.82 + k * 9, lz = hd * 0.62, F = atF(lx, lz);
        F.geo(core.get('paint'), G.halfCyl, 0, 0, 0, Math.PI / 2, 7.2, 7, 5.4, M.olive, false, 0, Math.PI / 2);
        F.box(core.get('paint'), 0, 1.6, -2.72, 2, 3.2, 0.05, 0x3f432b); const [x, z] = wp(lx, lz); ctx.collider(x, H(x, z) + 1.4, z, 2.7, 1.4, 3.5, a); }
      // container stacks
      const CC = [0x6b3a26, 0x2f4e6b, M.olive, 0x8a6a2a, 0x6e2f2a];
      for (let k = 0; k < 5; k++) { const lx = -hw * 0.3 + (k % 3) * 2.7, lz = hd * 0.78, lev = k >= 3 ? 1 : 0, F = atF(lx + lev * 1.35, lz);
        F.box(core.get('milMetal'), 0, 1.3 + lev * 2.6, 0, 2.44, 2.6, 6.1, CC[(k + site.id.length) % CC.length]);
        for (let r = -2; r <= 2; r++) F.box(core.get('milMetal'), 1.24, 1.3 + lev * 2.6, r * 1.2, 0.06, 2.4, 0.12, M.dark); }
      { const [x, z] = wp(-hw * 0.3 + 2.7, hd * 0.78); ctx.collider(x, H(x, z) + 2.6, z, 4.1, 2.6, 3.05, a); }
    }
    // floodlight poles along the main road / apron
    for (let k = 0; k < 4; k++) for (const sd of [-1, 1]) { const lx = air ? -150 + k * 100 : sd * 7.5, lz = air ? -95 : -hd + 18 + k * (hd * 0.85 / 3), F = atF(lx, lz);
      F.beam(core.get('milMetal'), [0, 0, 0], [0, 10, 0], 0.13, M.grey); F.box(core.get('milMetal'), 0, 10.1, 0, 1.6, 0.3, 0.5, M.dark); F.box(core.get('bulb'), 0, 9.9, 0, 1.4, 0.12, 0.4, 0xffffff);
      const [x, z] = wp(lx, lz); ctx.collider(x, H(x, z) + 5, z, 0.2, 5, 0.2, a); if (air) break; }
  }
  // destructibles
  const kinds = out ? ['generator', 'commAntenna', 'loudspeaker'] : air ? ['fuelTank', 'fuelTank', 'gasSilo', 'sam', 'sam', 'radar', 'generator', 'transformer', 'commAntenna', 'satUplink', 'billboard', 'loudspeaker', 'statue']
    : ['fuelTank', 'fuelTank', 'gasSilo', 'sam', 'radar', 'generator', 'transformer', 'commAntenna', 'satUplink', 'billboard', 'loudspeaker', 'loudspeaker', ...(R.chance(0.5) ? ['statue'] : [])];
  if (site.type === 'naval') kinds.push('fuelTank', 'sam');
  kinds.forEach((k, i) => { const col = i % 4, row = (i / 4) | 0; const lx = (-0.1 + col * 0.25) * hw * (out ? 1.2 : 1), lz = (-0.5 + row * 0.45) * hd * (out ? 1.2 : 1) + (out ? -6 : 0);
    const [x, z] = wp(lx + R.range(-4, 4), lz + R.range(-4, 4));
    if (k === 'statue') { const h = H(x, z), F = new Frame(x, h, z, a); F.box(core.get('stone'), 0, 1.5, 0, 5, 3, 5, 0xbdb3a0); ctx.collider(x, h + 1.5, z, 2.5, 1.5, 2.5, a); ctx.prop(site, k, x, z, a + Math.PI, { y: h + 3 }); }
    else ctx.prop(site, k, x, z, a + R.range(-0.3, 0.3)); });
  for (let i = 0; i < (out ? 2 : 6); i++) { const [x, z] = wp(R.range(-hw, hw) * 0.7, R.range(-hd, hd) * 0.7); ctx.prop(site, 'barrel', x, z, R() * 6); }
  { const [x, z] = wp(-hw * 0.1, -hd * 0.1); site.spawns.push({ x, y: H(x, z) + 1, z, type: 'officer' }, { x: x + 8, y: H(x, z) + 1, z, type: 'heavy' }); }
  // vehicles
  const vt = out ? ['jeep'] : air ? ['plane', 'jet', 'jet', 'jeep', 'truck'] : site.type === 'naval' ? ['jeep', 'truck'] : ['jeep', 'jeep', 'truck', R.chance(0.6) ? 'tank' : 'truck'];
  vt.forEach((t, i) => { const [x, z] = air && i < 3 ? wp(-60 + i * 40, -35) : wp(hw * 0.5 + (i % 2) * 8, -hd * 0.8 + 6 + ((i / 2) | 0) * 8); ctx.vehicle(t, x, z, a + (air && i < 3 ? Math.PI : 0), site.id); });
  // naval piers
  if (site.type === 'naval' && site.coast) { const ca = site.coast.ang, dx = Math.sin(ca), dz = Math.cos(ca);
    for (const off of [-25, 25]) { const F = new Frame(site.x + dx * (site.coast.dist - 15) + dz * off, 2.2, site.z + dz * (site.coast.dist - 15) - dx * off, ca);
      F.box(core.get('milWall'), 0, 0, 45, 10, 0.8, 90, 0x9a968c); for (let q = 0; q < 10; q++) F.geo(core.get('milWall'), G.cyl8, 0, -4, q * 9 + 4, 0, 1.2, 8, 1.2, 0x8a8680);
      const [px, pz] = F.w(0, 45); ctx.collider(px, 2.2, pz, 5, 0.4, 45, ca);
      const [b1x, b1z] = F.w(9, 40), [b2x, b2z] = F.w(9, 70); ctx.vehicle('boat', b1x, b1z, ca, site.id, 0.3); ctx.vehicle(off > 0 ? 'jetski' : 'boat', b2x, b2z, ca, site.id, 0.3); } }
  for (const m of core.meshes(site._core || site._group)) if (m.name === 'regimeFlag') site._flags.push(m);
}
