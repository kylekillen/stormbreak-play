// Settlements: site planning, town + military base construction, and the destructible / liberation system.
// Called by world/index.js: plan(game) after heights exist (returns sites to flatten), then build(game).
import * as THREE from 'three';
import { makeRng, hashStr, getMaterials, G, MB, decalBias } from './buildings/kit.js';
import { STATS, propDef, wreckParts } from './buildings/props.js';
import { buildTown } from './buildings/town.js';
import { buildBase } from './buildings/military.js';

const NAMES = {
  city: ['Porto Calce'],
  town: ['Santa Ombra', 'Vel Marisca', 'Castelluzzo', 'Aspramare', 'Monteverra', 'Lucerna Bassa', 'San Teodoro al Faro', 'Borgo Ventoso'],
  village: ['Olivastra', 'Calanchi', 'Pietrafonda', 'Ruvo Piccolo', 'Sorgente', 'Casale Brina', 'Fiumarella', 'Spina d\'Oro'],
  base: ['Rocca Ferra Garrison', 'Punta Nera Battery', 'Monte Grigio Barracks', 'Forte Sabbione', 'Caserma Vask', 'Bastione Ardo', 'Valfosca Depot', 'Cresta Lupa Fort', 'Torre Scura Command', 'Campo Ruggine'],
  airbase: ['Capo Sereno Airfield'],
  naval: ['Darsena Ferro Naval Yard'],
  outpost: ['Checkpoint Olmo', 'Posto Gabbiano', 'Vedetta Alta', 'Posto Cicala', 'Checkpoint Ginestra', 'Vedetta Falesia', 'Posto Salina', 'Checkpoint Corbezzolo', 'Vedetta Neve', 'Posto Scoglio', 'Checkpoint Mirto', 'Vedetta Vento'],
};
const slug = s => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let SITES = null;
const LOD_NEAR = 620; // m beyond a site's edge where its full-detail core swaps to one merged low-detail mesh
const LOD_FAR = 4200;
const DETAIL_CHUNK_DIST = 270; // m from a town detail chunk's centre (facade windows/shutters/balconies) before it hides

// ------------------------------------------------------------------ plan
export function plan(game) {
  const W = game.world || {};
  const H = (x, z) => { const h = W.heightAt?.(x, z); return Number.isFinite(h) ? h : 10; };
  const R = makeRng((game.seed ?? 1337) * 7919 + 101);
  const half = (W.size ? W.size / 2 : 4000) - 180;
  // coarse land grid + island labelling (4-connected flood fill)
  const step = 80, n = Math.floor(half * 2 / step) + 1, land = new Float32Array(n * n), isl = new Int32Array(n * n).fill(-1);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) land[i * n + j] = H(-half + i * step, -half + j * step);
  const islands = [];
  for (let k = 0; k < n * n; k++) {
    if (land[k] <= 1.5 || isl[k] >= 0) continue;
    const id = islands.length, st = [k]; isl[k] = id; let area = 0, sx = 0, sz = 0;
    while (st.length) { const c = st.pop(), i = (c / n) | 0, j = c % n; area++; sx += i; sz += j;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= n || b >= n) continue; const q = a * n + b; if (land[q] > 1.5 && isl[q] < 0) { isl[q] = id; st.push(q); } } }
    islands.push({ id, area, cells: area });
  }
  islands.sort((a, b) => b.area - a.area);
  const cands = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const k = i * n + j; if (land[k] > 2.5) cands.push({ x: -half + i * step, z: -half + j * step, h: land[k], isl: isl[k] }); }
  for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }

  const ring = (x, z, r, cnt = 12) => { let lo = 1e9, hi = -1e9, wet = 0;
    for (let k = 0; k < cnt; k++) { const a = k / cnt * Math.PI * 2, h = H(x + Math.cos(a) * r, z + Math.sin(a) * r); lo = Math.min(lo, h); hi = Math.max(hi, h); if (h < 1.5) wet++; }
    return { lo, hi, range: hi - lo, wet: wet / cnt }; };
  const coast = (x, z, r) => { let best = null;
    for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2;
      for (let d = r * 0.5; d < r + 220; d += 15) { if (H(x + Math.sin(a) * d, z + Math.cos(a) * d) < -0.5) { if (!best || d < best.dist) best = { ang: a, dist: d }; break; } } }
    return best; };
  const sites = [];
  const minD = (x, z, r) => { let m = 1e9; for (const s of sites) m = Math.min(m, Math.hypot(s.x - x, s.z - z) - s.radius - r); return m; };
  const names = {}; for (const [k, v] of Object.entries(NAMES)) { names[k] = v.slice(); for (let i = names[k].length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [names[k][i], names[k][j]] = [names[k][j], names[k][i]]; } }
  const add = (type, c, r, extra = {}) => {
    const name = names[type].shift() || `${type} ${sites.length}`;
    const s = { id: slug(name), type, name, x: Math.round(c.x), z: Math.round(c.z), radius: r, y: extra.y ?? Math.max(2, c.h), islandId: c.isl, rotY: extra.rotY ?? R() * Math.PI * 2, coast: extra.coast || null, ...extra };
    sites.push(s); return s;
  };
  // generic picker: evaluate random candidates, keep up to `want` valid ones, take best score
  const pick = (r, test, { want = 40, gap = 140, island = null, score = () => 0 } = {}) => {
    let best = null, bestS = -1e18, found = 0;
    for (const c of cands) {
      if (island != null && c.isl !== island) continue;
      if (Math.abs(c.x) > half - r * 0.6 || Math.abs(c.z) > half - r * 0.6) continue;
      const md = minD(c.x, c.z, r); if (md < gap) continue;
      const t = test(c); if (!t) continue;
      const s = Math.min(md, 1600) + score(c, t) + R() * 120;
      if (s > bestS) { bestS = s; best = { c, t }; }
      if (++found >= want) break;
    }
    return best;
  };
  const mainIsl = islands.filter(i => i.cells * step * step > 400000).slice(0, 4).map(i => i.id);
  if (!mainIsl.length && islands.length) mainIsl.push(islands[0].id);

  // airbase: long flat runway
  {
    const L = 640; let res = null;
    for (const c of cands.slice(0, 1500)) {
      if (c.h > 120) continue; if (minD(c.x, c.z, L / 2) < 100) continue;
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI; let lo = 1e9, hi = -1e9, ok = true;
        for (let t = -L / 2 - 40; t <= L / 2 + 40 && ok; t += 40) for (const o of [-60, 0, 60]) {
          const x = c.x + Math.cos(a) * t - Math.sin(a) * o, z = c.z - Math.sin(a) * t - Math.cos(a) * o, h = H(x, z);
          if (h < 2) { ok = false; break; } lo = Math.min(lo, h); hi = Math.max(hi, h); }
        if (ok && (!res || hi - lo < res.range)) res = { c, a, range: hi - lo, y: (lo + hi) / 2 };
      }
      if (res && res.range < 12) break;
    }
    if (!res && cands.length) res = { c: cands[0], a: 0, y: cands[0].h };
    if (res) add('airbase', res.c, L / 2 + 70, { rotY: res.a, y: res.y, runway: { length: L, width: 32 }, flatten: { shape: 'rect', w: L + 120, d: 220, rotY: res.a } });
  }
  // city: low, coastal preferred
  {
    const r = 250, p = pick(r, c => { if (c.h > 90) return null; const g = ring(c.x, c.z, r * 0.6); if (g.wet > 0.2 || g.range > 50) return null; return { co: coast(c.x, c.z, r) }; },
      { want: 60, score: (c, t) => (t.co ? 900 : 0) - c.h * 3, island: mainIsl[0] ?? null });
    if (p) add('city', p.c, r, { coast: p.t.co, y: Math.max(3, p.c.h) });
  }
  // naval: coastal
  {
    const r = 190, p = pick(r, c => { if (c.h > 60) return null; const g = ring(c.x, c.z, r * 0.45); if (g.wet > 0) return null; const co = coast(c.x, c.z, r * 0.6); return co && co.dist > r * 0.45 && co.dist < r + 60 ? { co } : null; }, { want: 30 });
    if (p) add('naval', p.c, r, { coast: p.t.co, rotY: p.t.co.ang });
  }
  // towns & villages, spread across main islands
  const townTypes = ['town', 'town', 'town', 'town', 'village', 'village', 'village', 'village'];
  townTypes.forEach((type, i) => {
    const r = type === 'town' ? 150 : 90, isl = mainIsl.length ? mainIsl[(i + 1) % mainIsl.length] : null;
    const test = c => { if (c.h > 260) return null; const g = ring(c.x, c.z, r * 0.6, 8); if (g.wet > 0.13 || g.range > r * 0.45) return null; return { co: coast(c.x, c.z, r) }; };
    const p = pick(r, test, { island: isl, want: 30, score: c => -Math.abs(c.h - 60) }) || pick(r, test, { want: 30 });
    if (p) add(type, p.c, r, { coast: p.t.co });
  });
  // military bases
  for (let i = 0; i < 8; i++) {
    const r = 120 + R() * 40, isl = mainIsl.length ? mainIsl[i % mainIsl.length] : null;
    const test = c => { const g = ring(c.x, c.z, r * 0.8, 10); return g.wet === 0 && g.range < r * 0.55 ? {} : null; };
    const p = pick(r, test, { island: isl, want: 30 }) || pick(r, test, { want: 30 });
    if (p) add('base', p.c, Math.round(r));
  }
  // outposts anywhere (incl. peaks and small islands)
  for (let i = 0; i < 10; i++) {
    const r = 50, test = c => { const g = ring(c.x, c.z, r * 0.8, 8); return g.wet === 0 && g.range < 26 ? {} : null; };
    const p = pick(r, test, { want: 25, gap: 120, score: c => (i % 3 === 0 ? c.h : 0) });
    if (p) add('outpost', p.c, r);
  }
  // suggested flatten height = median ground under the site
  for (const s of sites) if (s.type !== 'airbase') {
    const hs = [H(s.x, s.z)]; for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; for (const f of [0.4, 0.8]) hs.push(H(s.x + Math.cos(a) * s.radius * f, s.z + Math.sin(a) * s.radius * f)); }
    hs.sort((a, b) => a - b); s.y = Math.max(2.5, hs[hs.length >> 1]);
  }
  SITES = sites;
  if (game.world) game.world.settlementSites = sites;
  return sites;
}

// ------------------------------------------------------------------ build
export function build(game) {
  const world = game.world || (game.world = {});
  const sites = SITES || plan(game);
  const mats = getMaterials();
  const H = (x, z) => { const h = world.heightAt?.(x, z); return Number.isFinite(h) ? h : 10; };
  const RAP = game.RAPIER, phys = game.physics;
  const root = new THREE.Group(); root.name = 'settlements'; game.scene?.add(root);
  world.colliderOwner = world.colliderOwner || new Map();
  const S = { list: [], pending: [], debris: [], dyn: new Set(), flags: [], spins: [], cones: [], blinkers: [], banners: [], t: 0, cullT: 0 };
  world.settlements = []; world.bases = []; world.vehicleSpawns = world.vehicleSpawns || []; world.safehouses = world.safehouses || []; world.destructibles = S.list;
  const _q = new THREE.Quaternion(), _e = new THREE.Euler();

  const collider = (x, y, z, hx, hy, hz, rotY = 0) => {
    if (!phys || !RAP) return null;
    _q.setFromEuler(_e.set(0, rotY, 0));
    return phys.createCollider(RAP.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }));
  };
  const regionOf = (x, z) => {
    const r = world.regionAt?.(x, z); if (r != null) return typeof r === 'object' ? r.id : r;
    let best = null, bd = 1e18;
    for (const g of world.regions || []) { const cx = g.x ?? g.center?.x ?? g.cx, cz = g.z ?? g.center?.z ?? g.cz; if (cx == null) continue; const d = (cx - x) ** 2 + (cz - z) ** 2; if (d < bd) { bd = d; best = g.id; } }
    return best ?? `isl-${Math.sign(x) + 1}${Math.sign(z) + 1}`;
  };

  // cloth flag: plane anchored at its left edge, animated near the camera
  const flag = (site, parent, x, y, z, w, h, rotY = 0) => {
    const g = new THREE.PlaneGeometry(w, h, 10, 6); g.translate(w / 2, 0, 0);
    const m = new THREE.Mesh(g, site.liberated ? mats.rebelFlag : mats.regimeFlag); m.position.set(x, y, z); m.rotation.y = rotY; m.castShadow = true;
    m.userData.base = Float32Array.from(g.attributes.position.array); m.userData.w = w; m.userData.ph = Math.random() * 6;
    parent.add(m); S.flags.push({ mesh: m, site }); site._flags.push(m); return m;
  };
  const banner = (site, parent, x, y, z, w, h, rotY = 0) => { // static hanging banner with the regime emblem
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mats.regimeFlag); m.position.set(x, y, z); m.rotation.y = rotY;
    parent.add(m); site._flags.push(m); return m;
  };
  const cone = (site, parent, x, y, z, rotY) => {
    const g = new THREE.CylinderGeometry(0.3, 9, 60, 16, 1, true); g.translate(0, -30, 0); g.rotateX(Math.PI / 2 + 0.0); g.rotateX(-Math.PI / 2); // pointing -y
    const piv = new THREE.Group(); piv.position.set(x, y, z); piv.rotation.y = rotY;
    const m = new THREE.Mesh(g, mats.cone); m.rotation.x = -0.9 - Math.random() * 0.3; m.rotation.order = 'YXZ'; m.renderOrder = 5;
    piv.add(m); parent.add(piv); S.cones.push({ piv, base: rotY, ph: Math.random() * 6, site }); return piv;
  };

  // a destructible prop
  const prop = (site, kind, x, z, rotY = 0, o = {}) => {
    const st = STATS[kind], def = propDef(kind);
    const y = o.y ?? H(x, z);
    const obj = new THREE.Group(); obj.name = kind; obj.position.set(x, y, z); obj.rotation.y = rotY;
    const intact = new THREE.Group(); obj.add(intact);
    const batched = kind !== 'statue' && !!site._pb; // static parts go into the site's per-material prop batch (1 draw per material)
    if (!batched) for (const p of def.parts) { const m = new THREE.Mesh(p.geom, p.matObj); m.castShadow = p.mat !== 'redLight'; m.receiveShadow = true; intact.add(m); if (p.mat === 'redLight') S.blinkers.push(m); }
    let spin = null;
    if (def.spinParts.length) { spin = new THREE.Group(); for (const p of def.spinParts) { const m = new THREE.Mesh(p.geom, p.matObj); m.castShadow = true; spin.add(m); } intact.add(spin); S.spins.push({ g: spin, def: def.spin, obj, ph: Math.random() * 6 }); }
    if (def.flag) { const f = flag(site, intact, def.flag.x, def.flag.y, 0, def.flag.w, def.flag.h, 0); f.userData.prop = obj; }
    site._group.add(obj);
    const [hx, hy, hz, cy] = st.coll; const sc = o.scale || 1;
    if (sc !== 1) obj.scale.setScalar(sc);
    const ud = obj.userData;
    if (batched) { obj.updateMatrix(); ud.batch = def.parts.map(p => batchAdd(site, p.mat, p.geom, obj.matrix)); }
    ud.destructible = { hp: st.hp * sc, maxHp: st.hp * sc, kind, chaos: st.chaos, baseId: site.id, counts: o.counts ?? st.counts ?? true, id: `${site.id}:${site._n++}` };
    ud.intact = intact; ud.site = site; ud.spin = spin;
    if (phys && RAP) {
      if (kind === 'statue') { // fixed body that can be switched to dynamic by the tether
        _q.setFromEuler(_e.set(0, rotY, 0));
        const body = phys.createRigidBody(RAP.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }).setCanSleep(true));
        ud.collider = phys.createCollider(RAP.ColliderDesc.cuboid(hx * sc, hy * sc, hz * sc).setTranslation(0, cy * sc, 0).setDensity(0.6).setFriction(0.8), body);
        ud.body = body; ud.tetherable = true; ud.makeDynamic = () => world.makeDynamic(obj);
      } else {
        const c = Math.cos(rotY), s = Math.sin(rotY);
        ud.collider = collider(x, y + cy * sc, z, hx * sc, hy * sc, hz * sc, rotY); void c; void s;
      }
    }
    world.registerDestructible(obj);
    return obj;
  };

  // ---------- static prop batching: one mesh per (site, material); destroying a prop zeroes its index range ----------
  const _bm = new THREE.Matrix4(), _bn = new THREE.Matrix3(), _bv = new THREE.Vector3();
  function batchAdd(site, key, geom, m) {
    const A = site._pb[key] || (site._pb[key] = { p: [], n: [], c: [], u: [], i: [], count: 0 });
    const P = geom.attributes.position, N = geom.attributes.normal, C = geom.attributes.color, U = geom.attributes.uv, I = geom.index;
    _bn.getNormalMatrix(m); const base = A.count, start = A.i.length;
    for (let k = 0; k < P.count; k++) {
      _bv.fromBufferAttribute(P, k).applyMatrix4(m); A.p.push(_bv.x, _bv.y, _bv.z);
      _bv.fromBufferAttribute(N, k).applyMatrix3(_bn).normalize(); A.n.push(_bv.x, _bv.y, _bv.z);
      if (C) A.c.push(C.getX(k), C.getY(k), C.getZ(k)); else A.c.push(1, 1, 1);
      if (U) A.u.push(U.getX(k), U.getY(k)); else A.u.push(0, 0);
    }
    if (I) for (let k = 0; k < I.count; k++) A.i.push(I.getX(k) + base); else for (let k = 0; k < P.count; k++) A.i.push(base + k);
    A.count += P.count;
    return { key, start, count: A.i.length - start };
  }
  function batchFinish(site) {
    site._pbMeshes = {};
    for (const [key, A] of Object.entries(site._pb)) {
      if (!A.count) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(A.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(A.n, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(A.c, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(A.u, 2));
      g.setIndex(new THREE.Uint32BufferAttribute(A.i, 1)); g.computeBoundingSphere(); g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, mats[key] || mats.paint); mesh.name = 'props-' + key; mesh.userData.propBatch = true;
      mesh.castShadow = key !== 'redLight'; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      site._group.add(mesh); site._pbMeshes[key] = mesh;
    }
    site._pb = null;
  }
  function batchHide(site, ranges) {
    for (const r of ranges || []) {
      const mesh = site._pbMeshes?.[r.key];
      if (mesh) { const ix = mesh.geometry.index; ix.array.fill(0, r.start, r.start + r.count); ix.needsUpdate = true; }
      else if (site._pb?.[r.key]) site._pb[r.key].i.fill(0, r.start, r.start + r.count);
    }
  }

  const ctx = {
    THREE, game, H, mats, root, collider, prop, flag, banner, cone, regionOf,
    vehicle: (type, x, z, rotY, siteId, y) => world.vehicleSpawns.push({ type, x, y: y ?? H(x, z) + 0.6, z, rotY, siteId }),
    safehouse: (x, z, siteId) => world.safehouses.push({ x, y: H(x, z) + 0.2, z, siteId }),
  };

  // ---------- destructible API ----------
  world.registerDestructible = obj => {
    const ud = obj.userData; const d = ud.destructible; if (!d || ud.registered) return obj;
    d.maxHp = d.maxHp ?? d.hp; ud.alive = true; ud.registered = true; S.list.push(obj);
    if (ud.collider) world.colliderOwner.set(ud.collider.handle, obj);
    const site = ud.site || world.getBase?.(d.baseId);
    if (site && d.counts !== false) { site.destructibles.push(obj); site.remaining = (site.remaining || 0) + 1; site.total = (site.total || 0) + 1; }
    return obj;
  };
  world.damageDestructible = (obj, amount, hitPos) => {
    while (obj && !obj.userData?.destructible && obj.parent) obj = obj.parent;
    const ud = obj?.userData; if (!ud?.destructible || !ud.alive) return false;
    ud.destructible.hp -= amount;
    if (hitPos) try { game.fx?.sparks?.(hitPos); } catch (e) { /* optional */ }
    if (ud.destructible.hp <= 0) destroy(obj, { hitPos });
    return true;
  };
  world.getDestructiblesNear = (pos, r) => S.list.filter(o => o.userData.alive && o.position.distanceTo(pos) < r);
  world.makeDynamic = obj => {
    const ud = obj?.userData; if (!ud?.body || !ud.alive || !RAP) return null;
    if (!ud.body.isDynamic()) { ud.body.setBodyType(RAP.RigidBodyType.Dynamic, true); ud.body.wakeUp(); S.dyn.add(obj); }
    return ud.body;
  };

  const camPos = new THREE.Vector3();
  function destroy(obj, { silent = false } = {}) {
    const ud = obj.userData, d = ud.destructible, st = STATS[d.kind] || {};
    ud.alive = false; d.hp = 0;
    const pos = obj.position.clone(); pos.y += (st.coll?.[3] || 1) * (obj.scale.x || 1);
    // swap to wreck
    ud.intact.visible = false; if (ud.batch) { batchHide(ud.site, ud.batch); ud.batch = null; }
    const wreck = new THREE.Group(); for (const g of wreckParts(d.kind)) { const m = new THREE.Mesh(g, mats.charred); m.castShadow = true; m.receiveShadow = true; wreck.add(m); }
    if (ud.body) { // statue: leave wreck where the body was
      const t = ud.body.translation(), r = ud.body.rotation(); obj.position.set(t.x, t.y, t.z); obj.quaternion.set(r.x, r.y, r.z, r.w);
      wreck.quaternion.copy(obj.quaternion).invert(); wreck.rotation.z += Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
      if (phys) { world.colliderOwner.delete(ud.collider?.handle); phys.removeRigidBody(ud.body); } ud.body = null; S.dyn.delete(obj);
    } else if (ud.collider && phys) { world.colliderOwner.delete(ud.collider.handle); phys.removeCollider(ud.collider, false); }
    ud.collider = null;
    obj.add(wreck); ud.wreck = wreck;
    if (!silent) {
      const big = st.fx || 1;
      try { game.fx?.explosion?.(pos, big); } catch (e) { console.warn(e); }
      try { if (big > 1.2) game.fx?.fire?.(pos, big); game.fx?.smoke?.(pos, big); } catch (e) { /* optional */ }
      const dist = (game.player?.pos || game.camera?.position || pos).distanceTo?.(pos) ?? 0;
      if (dist < 260) try { game.gfx?.shake?.(0.6 * Math.min(1.5, big / 2) * (1 - dist / 260), 0.5); } catch (e) { /* optional */ }
      try { game.audio?.play?.('explosion', { pos, size: big }); } catch (e) { /* optional */ }
      spawnDebris(pos, Math.round(3 + big * 2.5), d.kind === 'statue' ? 0x8a6a3a : 0x2a2420);
      // chain reaction
      for (const o of S.list) { if (!o.userData.alive || o === obj) continue; const dd = o.position.distanceTo(obj.position); if (dd < st.blast) S.pending.push({ obj: o, amt: 140 * (1 - dd / st.blast) + 10, t: S.t + 0.12 + Math.random() * 0.3 }); }
      game.events?.emit('explosion', { pos, radius: st.blast, source: 'destructible', kind: d.kind });
      game.events?.emit('destructible:destroyed', { obj, pos, kind: d.kind, chaos: d.chaos, baseId: d.baseId, id: d.id });
      game.events?.emit('chaos', { amount: d.chaos, pos, reason: d.kind });
    }
    const site = ud.site;
    if (site && d.counts !== false && !site.liberated) { site.remaining--; game.events?.emit('base:progress', { baseId: site.id, remaining: site.remaining, total: site.total }); if (site.remaining <= 0) liberate(site, silent); }
  }
  function liberate(site, silent = false) {
    if (site.liberated) return; site.liberated = true;
    for (const m of site._flags) m.material = mats.rebelFlag;
    for (const c of S.cones) if (c.site === site) c.piv.visible = false;
    if (silent) return;
    if (site.military) game.events?.emit('base:liberated', { baseId: site.id, id: site.id, name: site.name, type: site.type, regionId: site.regionId });
    else game.events?.emit('settlement:liberated', { id: site.id, baseId: site.id, name: site.name, type: site.type, regionId: site.regionId });
    try { game.audio?.play?.('liberated', { pos: new THREE.Vector3(site.x, site.y, site.z) }); } catch (e) { /* optional */ }
  }
  world.destroyById = (id, silent = true) => { const o = S.list.find(o => o.userData.destructible.id === id); if (o && o.userData.alive) destroy(o, { silent }); return !!o; };
  world.setLiberated = (id, silent = true) => { const s = world.getBase(id); if (!s) return false; for (const o of s.destructibles.slice()) if (o.userData.alive) destroy(o, { silent: true }); liberate(s, silent); return true; };
  world.destroyedIds = () => S.list.filter(o => !o.userData.alive).map(o => o.userData.destructible.id);

  // debris: pooled instanced boxes with dynamic bodies
  const DMAX = 120, dGeo = new THREE.BoxGeometry(1, 1, 1), dMesh = new THREE.InstancedMesh(dGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), DMAX);
  dMesh.castShadow = true; dMesh.count = 0; dMesh.frustumCulled = false; root.add(dMesh); const free = [...Array(DMAX).keys()].reverse();
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _qq = new THREE.Quaternion();
  for (let i = 0; i < DMAX; i++) { dMesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); dMesh.setColorAt(i, _c.set(0x333333)); }
  dMesh.count = DMAX;
  function spawnDebris(pos, cnt, color) {
    if (!phys || !RAP) return;
    for (let i = 0; i < cnt && free.length; i++) {
      const idx = free.pop(), sz = 0.3 + Math.random() * 0.9;
      const b = phys.createRigidBody(RAP.RigidBodyDesc.dynamic().setTranslation(pos.x + (Math.random() - 0.5) * 2, pos.y + Math.random() * 2, pos.z + (Math.random() - 0.5) * 2)
        .setLinvel((Math.random() - 0.5) * 18, 6 + Math.random() * 14, (Math.random() - 0.5) * 18).setAngvel({ x: Math.random() * 10 - 5, y: Math.random() * 10 - 5, z: Math.random() * 10 - 5 }).setCcdEnabled(false));
      phys.createCollider(RAP.ColliderDesc.cuboid(sz / 2, sz / 2, sz / 2).setDensity(0.5).setFriction(0.9), b);
      dMesh.setColorAt(idx, _c.set(color).multiplyScalar(0.7 + Math.random() * 0.6)); dMesh.instanceColor.needsUpdate = true;
      S.debris.push({ b, idx, sz, life: 7 + Math.random() * 5 });
    }
  }

  // far-LOD material: plain vertex colours (albedo baked by the builders), decal-biased so the coarse ground plate wins over terrain
  const lodMat = decalBias(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 0.004);
  // ---------- build every site ----------
  for (const s of sites) {
    const site = { ...s, military: ['base', 'airbase', 'naval', 'outpost'].includes(s.type), destructibles: [], remaining: 0, total: 0, liberated: false, spawns: [], _flags: [], _n: 0 };
    site.regionId = regionOf(s.x, s.z);
    site._group = new THREE.Group(); site._group.name = site.id; root.add(site._group);
    site._detail = new THREE.Group(); site._detail.name = site.id + '-detail'; root.add(site._detail);
    site._props = site._group; site._pb = {};
    site._core = new THREE.Group(); site._core.name = site.id + '-core'; site._group.add(site._core); site._lodMB = new MB();
    world.settlements.push(site); if (site.military) world.bases.push(site);
    try { (site.military ? buildBase : buildTown)(ctx, site); }
    catch (e) { console.error(`[settlements] ${site.id} failed`, e); game.errors?.push({ system: 'settlements:' + site.id, error: String(e?.stack || e) }); }
    try { batchFinish(site); } catch (e) { console.error(`[settlements] ${site.id} prop batch failed`, e); }
    if (!site._lodMB.empty) { const m = new THREE.Mesh(site._lodMB.geometry(), lodMat); m.name = site.id + '-lod'; m.matrixAutoUpdate = false; m.updateMatrix(); m.visible = false; root.add(m); site._lod = m; }
    site._lodMB = null;
    site.y = H(site.x, site.z);
  }
  world.getBase = id => world.settlements.find(s => s.id === id) || null;
  world.nearestSite = (pos, filter) => { let b = null, bd = 1e18; for (const s of world.settlements) { if (filter && !filter(s)) continue; const d = (s.x - pos.x) ** 2 + (s.z - pos.z) ** 2; if (d < bd) { bd = d; b = s; } } return b; };
  world.siteAt = pos => world.settlements.find(s => (s.x - pos.x) ** 2 + (s.z - pos.z) ** 2 < s.radius ** 2) || null;

  // tether integration (defensive: whatever the grapple module emits)
  for (const ev of ['tether:attached', 'tether:attach', 'grapple:attached']) game.events?.on(ev, e => { const o = e?.obj || e?.target || e?.b || e?.a; if (o?.userData?.tetherable) world.makeDynamic(o); });

  // ---------- per-frame ticker ----------
  const nightOf = () => {
    const sd = game.gfx?.sunDir; if (sd) return THREE.MathUtils.clamp(0.25 - sd.y * 4, 0, 1); // the key light follows the moon at night, so ask for the sun itself
    const sun = game.gfx?.sun;
    if (sun?.position) { const t = sun.target?.position || { x: 0, y: 0, z: 0 }; const dx = sun.position.x - t.x, dy = sun.position.y - t.y, dz = sun.position.z - t.z; const e = dy / (Math.hypot(dx, dy, dz) || 1); return THREE.MathUtils.clamp(0.25 - e * 4, 0, 1); }
    const h = game.gfx?.hour ?? game.gfx?.timeOfDay; if (Number.isFinite(h)) return THREE.MathUtils.clamp(Math.abs(h - 12) / 2 - 2.5, 0, 1);
    return 0;
  };
  const update = dt => {
    if (!dt) return; S.t += dt; const t = S.t;
    const cam = game.camera; if (cam) camPos.copy(cam.position);
    // chain reactions
    for (let i = S.pending.length - 1; i >= 0; i--) { const p = S.pending[i]; if (p.t <= t) { S.pending.splice(i, 1); world.damageDestructible(p.obj, p.amt, null); } }
    // dynamic statues: sync + topple check
    for (const o of S.dyn) {
      const b = o.userData.body; if (!b) { S.dyn.delete(o); continue; }
      const tr = b.translation(), r = b.rotation(); o.position.set(tr.x, tr.y, tr.z); o.quaternion.set(r.x, r.y, r.z, r.w);
      const up = _p.set(0, 1, 0).applyQuaternion(o.quaternion).y; if (up < 0.55 && o.userData.alive) destroy(o);
    }
    // debris
    let dirty = false;
    for (let i = S.debris.length - 1; i >= 0; i--) {
      const d = S.debris[i]; d.life -= dt; const tr = d.b.translation(), r = d.b.rotation();
      const k = d.sz * Math.min(1, d.life); _m.compose(_p.set(tr.x, tr.y, tr.z), _qq.set(r.x, r.y, r.z, r.w), _s.set(k, k, k)); dMesh.setMatrixAt(d.idx, _m); dirty = true;
      if (d.life <= 0 || tr.y < -30) { phys.removeRigidBody(d.b); dMesh.setMatrixAt(d.idx, _m.makeScale(0, 0, 0)); free.push(d.idx); S.debris.splice(i, 1); }
    }
    if (dirty) dMesh.instanceMatrix.needsUpdate = true;
    // night lighting
    const night = nightOf();
    mats.glassLit.emissiveIntensity = 0.08 + night * 2.4; mats.bulb.emissiveIntensity = 0.25 + night * 5; mats.poster.emissiveIntensity = night * 0.35;
    mats.cone.opacity = night * 0.16; mats.window.emissiveIntensity = mats.glassLit.emissiveIntensity;
    mats.redLight.emissiveIntensity = (Math.sin(t * 3) > 0.3 ? 3 : 0.3) * (0.5 + night);
    // distance culling (4 Hz)
    if ((S.cullT -= dt) <= 0) {
      S.cullT = 0.25;
      for (const s of world.settlements) {
        const d = Math.hypot(s.x - camPos.x, s.z - camPos.z) - s.radius;
        // beyond LOD_NEAR the whole site (core, prop batches, flags) is replaced by its single merged LOD mesh
        const nearCore = d < LOD_NEAR || !s._lod;
        s._detail.visible = d < 520; s._group.visible = nearCore && d < 1700; s._near = d < 380;
        if (s._lod) s._lod.visible = !nearCore && d < LOD_FAR;
        if (s._detailChunks && s._detail.visible) for (const g of s._detailChunks) g.visible = Math.hypot(g.userData.cx - camPos.x, g.userData.cz - camPos.z, (camPos.y - s.y) * 0.8) < DETAIL_CHUNK_DIST;
        // shadow LOD: small destructible props only cast shadows close up, buildings to mid range
        const sh = d < 140 ? 2 : d < 420 ? 1 : 0;
        if (sh !== s._shLod) {
          s._shLod = sh;
          if (!s._casters) { s._casters = []; const walk = (o, inProp) => { inProp = inProp || !!o.userData?.destructible || !!o.userData?.propBatch; if (o.isMesh && o.castShadow) s._casters.push([o, inProp]); for (const c of o.children) walk(c, inProp); }; walk(s._group, false); walk(s._detail, false); }
          for (const [m, inProp] of s._casters) m.castShadow = inProp ? sh >= 2 : sh >= 1;
        }
      }
    }
    for (const c of S.cones) { if (!c.site._group.visible) continue; c.piv.visible = night > 0.03 && !c.site.liberated; if (c.piv.visible) c.piv.rotation.y = c.base + Math.sin(t * 0.35 + c.ph) * 1.1; }
    for (const s of S.spins) { if (!s.obj.userData.alive || !s.obj.userData.site._group.visible) continue; s.g.rotation.y = s.def.sweep ? Math.sin(t * s.def.speed + s.ph) * 1.4 : s.g.rotation.y + dt * s.def.speed; }
    // flags (only near ones, 30 Hz-ish)
    if (((t * 30) | 0) !== S.lastFlag) {
      S.lastFlag = (t * 30) | 0;
      for (const f of S.flags) {
        if (!f.site._near || !f.mesh.visible) continue;
        const g = f.mesh.geometry, P = g.attributes.position, B = f.mesh.userData.base, W = f.mesh.userData.w, ph = f.mesh.userData.ph;
        for (let i = 0; i < P.count; i++) { const x = B[i * 3], y = B[i * 3 + 1], k = x / W;
          P.setXYZ(i, x - k * 0.15 * W * (1 - Math.cos(t * 3 + ph) * 0.1), y - k * k * 0.35, Math.sin(x * 1.6 - t * 6 + ph + y * 0.4) * 0.28 * k + Math.sin(x * 0.7 - t * 3.1) * 0.12 * k); }
        P.needsUpdate = true; g.computeVertexNormals();
      }
    }
  };
  if (!game._settlementsTicker) { game._settlementsTicker = true; (game.systems || (game.systems = [])).push({ name: 'settlements', update: (dt) => update(dt) }); }
  S.update = update;
  world._settlementsState = S;
  console.info(`[settlements] ${world.settlements.length} sites, ${S.list.length} destructibles, ${world.vehicleSpawns.length} vehicle spawns`);
  return world.settlements;
}

export default { name: 'settlements', plan, build, NAMES };
