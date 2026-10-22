// STORMBREAK missions: story campaign + repeatable side jobs, driven by a small objective DSL.
// Every objective spawns its own fallback targets/props so missions complete even if enemies/vehicles/world are absent.
// game.missions = { active, list, start(id), abort(), objectiveWaypoint, skip(), debugJump(id), step, flags, ended, endCard,
//   showEndCard(), closeEndCard() }. Emits mission:start|update|complete|fail, dialogue, campaign:complete, endcard:shown|closed.
let game, THREE, M;
const CAST = {
  mira: { name: 'Mira Castell', color: '#3fd0c9', role: 'Undertow handler' },
  dov: { name: 'Dov Arrin', color: '#f2b544', role: 'Mechanic' },
  vask: { name: 'General Aurek Vask', color: '#e8452c', role: 'Loudspeaker' },
  sable: { name: 'Sable Marrow', color: '#e9e4d8', role: 'You' },
};
// ---- location specs, resolved lazily against the world ----
function spawnPt() { const s = game.world?.spawnPoint; return s ? { x: s.x, z: s.z } : { x: 0, z: 0 }; }
function bases() { return (game.progress?.sites || []).filter(s => s.kind === 'base'); }
function setts() { return (game.progress?.sites || []).filter(s => s.kind === 'settlement'); }
function byDist(list, p) { return [...list].sort((a, b) => Math.hypot(a.pos.x - p.x, a.pos.z - p.z) - Math.hypot(b.pos.x - p.x, b.pos.z - p.z)); }
function resolveLoc(spec) {
  const sp = spawnPt();
  if (!spec) return sp;
  if (spec.x != null) return spec;
  const ring = (r, a) => ({ x: sp.x + Math.cos(a) * r, z: sp.z + Math.sin(a) * r });
  if (spec.base != null) {
    const b = spec.base === 'highest' ? [...bases()].sort((a, c) => (c.height || 0) - (a.height || 0))[0] : byDist(bases(), sp)[spec.base];
    return b ? { ...b.pos, site: b } : ring(500 + 300 * (spec.base === 'highest' ? 6 : spec.base), (spec.base === 'highest' ? 2 : spec.base) * 1.7);
  }
  if (spec.baseWith) { const b = baseWith(spec.baseWith, spec.skip || 0); return b ? { ...b.pos, site: b } : ring(900 + 200 * (spec.skip || 0), 2.4 + (spec.skip || 0)); }
  if (spec.settlement != null) { const s = byDist(setts(), sp)[spec.settlement]; return s ? { ...s.pos, site: s } : ring(250 + 260 * spec.settlement, spec.settlement * 2.3 + 0.5); }
  if (spec.peak) { const w = game.world; let best = null; if (w?.heightAt) for (let i = 0; i < 300; i++) { const a = i * 2.4, r = 300 + (i % 30) * 60, x = sp.x + Math.cos(a) * r, z = sp.z + Math.sin(a) * r, h = w.heightAt(x, z); if (!best || h > best.h) best = { x, z, h }; } return best || ring(900, 1); }
  if (spec.coast) { const w = game.world; for (let r = 200; r < 3500; r += 60) for (let a = 0; a < 6.28; a += 0.3) { const x = sp.x + Math.cos(a + spec.coast) * r, z = sp.z + Math.sin(a + spec.coast) * r; if (w?.isWater?.(x, z)) return { x: x - Math.cos(a + spec.coast) * 40, z: z - Math.sin(a + spec.coast) * 40 }; } return ring(1200, spec.coast); }
  if (spec.near) { const b = resolveLoc(spec.near); const a = spec.angle ?? 0.8; return { x: b.x + Math.cos(a) * (spec.r || 150), z: b.z + Math.sin(a) * (spec.r || 150) }; }
  if (spec.ring) return ring(spec.ring, spec.a || 0);
  if (spec.dryFrom) { // the site of `kind` reachable over land (straight line mostly dry) from another location, nearest to `ideal` metres
    const c = resolveLoc(spec.dryFrom), w = game.world, pool = spec.kind === 'settlement' ? setts() : bases();
    const wet = (a, b) => { let n = 0; for (let i = 1; i < 40; i++) if (w?.isWater?.(a.x + (b.x - a.x) * i / 40, a.z + (b.z - a.z) * i / 40)) n++; return n; };
    const ok = pool.filter(x => { const d = d2(x.pos, c); return d > (spec.min || 300) && d < (spec.max || 2000) && wet(c, x.pos) <= 1; })
      .sort((a, b) => Math.abs(d2(a.pos, c) - (spec.ideal || 1000)) - Math.abs(d2(b.pos, c) - (spec.ideal || 1000)));
    const x = ok[0] || byDist(pool.filter(x => d2(x.pos, c) > 150), c)[0];
    return x ? { ...x.pos, site: x } : { x: c.x + 600, z: c.z };
  }
  if (spec.landmark) { const l = game.world?.landmarks?.find(l => l.id === spec.landmark); return l ? { x: l.x, z: l.z, landmark: l } : ring(900, 0.3); }
  if (spec.peakNear) { // highest dry ground in a ring min..max metres around another location (wingsuit launch points)
    const c = resolveLoc(spec.peakNear), w = game.world, mn = spec.min || 500, mx = spec.max || 1300; let best = null;
    if (w?.heightAt) for (let i = 0; i < 400; i++) { const a = i * 2.39996, r = mn + (i % 20) / 19 * (mx - mn), x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r; if (w.isWater?.(x, z)) continue; const h = w.heightAt(x, z); if (!best || h > best.h) best = { x, z, h }; }
    return best || { x: c.x + mx, z: c.z };
  }
  return sp;
}
// the Nth-nearest-to-spawn base (excluding the tutorial base 0) whose real props include one of `kinds`
function baseWith(kinds, skip = 0) {
  const has = b => (b.src?.destructibles || []).some(o => kinds.includes(o.userData?.destructible?.kind));
  return byDist(bases(), spawnPt()).slice(1).filter(has)[skip] || null;
}
const gy = (x, z) => Math.max(game.world?.heightAt?.(x, z) ?? 0, game.world?.isWater?.(x, z) ? 0 : -1e9);
const ppos = () => game.player?.pos || game.camera.position;
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ---- fallback props: our own damageable targets (explosions in radius, or plant a charge with F) ----
const props = new Set();
const MATS = {};
function mat(c) { return MATS[c] ||= new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.3 }); }
function makeProp(kind, p, opts = {}) {
  const g = new THREE.Group();
  const add = (geo, c, y = 0, x = 0, z = 0) => { const m = new THREE.Mesh(geo, mat(c)); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  if (kind === 'tower') { add(new THREE.CylinderGeometry(0.4, 1.4, 30, 6), 0x777a80, 15); add(new THREE.BoxGeometry(5, 3, 1), 0xb02a1e, 26); add(new THREE.BoxGeometry(3, 2, 2), 0x333333, 2); }
  else if (kind === 'statue') { add(new THREE.BoxGeometry(4, 3, 4), 0xbdb5a0, 1.5); add(new THREE.CylinderGeometry(1.1, 1.3, 7, 8), 0x8c7a4a, 6.5); add(new THREE.SphereGeometry(1.2, 10, 8), 0x8c7a4a, 10.6); add(new THREE.BoxGeometry(5, 0.6, 0.6), 0x8c7a4a, 8.5); }
  else if (kind === 'truck' || kind === 'courier' || kind === 'heli') {
    const c = kind === 'truck' ? 0x55603f : kind === 'heli' ? 0x2a2f36 : 0x1d1d22;
    add(new THREE.BoxGeometry(2.4, 2, 6), c, 1.6); add(new THREE.BoxGeometry(2.3, 1.4, 2), c, 2.4, 0, 2.6);
    if (kind === 'heli') { g.userData.rotor = add(new THREE.BoxGeometry(14, 0.15, 0.5), 0x111111, 3.4); add(new THREE.BoxGeometry(0.6, 0.6, 6), c, 2, 0, -5); }
    else for (const [x, z] of [[-1.2, -2], [1.2, -2], [-1.2, 2], [1.2, 2]]) add(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 10).rotateZ(Math.PI / 2), 0x111111, 0.5, x, z);
  } else if (kind === 'generator') { add(new THREE.CylinderGeometry(2.5, 3, 6, 10), 0x3b4a5a, 3); g.userData.core = add(new THREE.SphereGeometry(1.6, 12, 10), 0x55ccff, 7); g.userData.core.material = new THREE.MeshStandardMaterial({ color: 0x55ccff, emissive: 0x2299ff, emissiveIntensity: 2 }); }
  else if (kind === 'crate') { add(new THREE.BoxGeometry(2, 1.6, 3), 0x6b5a3a, 0.8); }
  else { add(new THREE.CylinderGeometry(2.2, 2.2, 5, 12), 0xc9c2b0, 2.5); add(new THREE.BoxGeometry(5, 0.4, 5), 0x8a2a20, 5.2); } // fuel tank
  g.position.set(p.x, (opts.y ?? gy(p.x, p.z)), p.z);
  game.scene.add(g);
  const pr = { kind, obj: g, hp: opts.hp ?? 100, maxHp: opts.hp ?? 100, dead: false, label: opts.label || kind, onDeath: opts.onDeath, charge: 0, plant: opts.plant !== false };
  g.userData.destructible = { hp: pr.hp, maxHp: pr.hp, kind: 'mission_' + kind, chaos: opts.chaos ?? 600, baseId: null };
  g.userData.missionProp = pr;
  // Mission props are NOT world destructibles (world.destroy() expects its own prop rigs). They get their own
  // kinematic collider (so bullets/blasts find them via world.colliderOwner) and combat routes damage to onDamage.
  g.userData.onDamage = (amt) => damageProp(pr, amt);
  try {
    const R = game.RAPIER, P = game.physics;
    if (R && P) {
      const bb = new THREE.Box3().setFromObject(g), sz = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
      pr.body = P.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(g.position.x, g.position.y, g.position.z));
      pr.collider = P.createCollider(R.ColliderDesc.cuboid(Math.max(0.5, sz.x / 2), Math.max(0.5, sz.y / 2), Math.max(0.5, sz.z / 2)).setTranslation(c.x - g.position.x, c.y - g.position.y, c.z - g.position.z), pr.body);
      (game.world && (game.world.colliderOwner ||= new Map()))?.set(pr.collider.handle, g);
    }
  } catch (e) { console.warn('[missions] prop collider', e); }
  props.add(pr); return pr;
}
function dropProp(pr) {
  props.delete(pr); game.scene.remove(pr.obj);
  if (pr.collider) game.world?.colliderOwner?.delete(pr.collider.handle);
  if (pr.body) { try { game.physics.removeRigidBody(pr.body); } catch (e) { /* */ } }
  pr.body = pr.collider = null;
}
function syncProps() { for (const pr of props) if (pr.body) { const p = pr.obj.position, q = pr.obj.quaternion; pr.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z }); pr.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w }); } }
function killProp(pr, silent) {
  if (pr.dead) return; pr.dead = true; props.delete(pr);
  const p = pr.obj.position.clone();
  if (!silent) {
    const sz = { fuel: 11, generator: 8, tower: 7, truck: 9, courier: 7, heli: 9 }[pr.kind] ?? 6;
    game.fx?.explosion?.(p.clone().setY(p.y + 2), sz, { big: sz >= 9 }); game.events.emit('explosion', { pos: p, radius: 7 });
    game.gfx?.shake?.(0.6); game.events.emit('chaos', { amount: pr.obj.userData.destructible.chaos, pos: p, reason: pr.label });
  }
  dropProp(pr); pr.onDeath?.(pr);
}
function clearProps() { for (const p of [...props]) { if (p.keep) continue; p.dead = true; dropProp(p); } } // keep: world-activity props (convoy)
function damageProp(pr, amt) { if (pr.dead) return; pr.hp -= amt; pr.obj.userData.destructible.hp = pr.hp; if (pr.hp <= 0) killProp(pr); }

const NAMED = {
  tankdrop: { dryFrom: { base: 4 }, kind: 'settlement', min: 400, max: 2200, ideal: 1100 },
  convoyfrom: { dryFrom: { base: 'highest' }, kind: 'base', min: 400, max: 2200, ideal: 1400 },
};
// '{base0}'-style tokens -> the real name of the Nth-nearest base (world names are generated per seed)
function fill(t) {
  if (typeof t !== 'string') return t;
  return t.replace(/\{base(\d)\}/g, (m, n) => resolveLoc({ base: +n }).site?.name || 'the outpost')
    .replace(/\{radar\}/g, () => baseWith(['radar', 'sam', 'satUplink', 'commAntenna'])?.name || 'the radar station')
    .replace(/\{fuel\}/g, () => baseWith(['fuelTank', 'gasSilo'])?.name || 'the depot')
    .replace(/\{set(\d)\}/g, (m, n) => resolveLoc({ settlement: +n }).site?.name || 'the village')
    .replace(/\{@(\w+)\}/g, (m, k) => (NAMED[k] && resolveLoc(NAMED[k]).site?.name) || 'the rendezvous')
    .replace(/\{fortress\}/g, () => resolveLoc({ base: 'highest' }).site?.name || 'Mount Kael');
}
// ---- dialogue queue ----
let lines = [], lineT = 0;
function say(arr) { for (const l of arr) lines.push(l); }
function dialogueTick(dt) {
  if (lineT > 0) { lineT -= dt; return; }
  const l = lines.shift(); if (!l) return;
  const [who, text, dur] = l, c = CAST[who] || { name: who, color: '#fff' };
  lineT = dur || Math.min(7, 1.6 + text.length * 0.055);
  game.events.emit('dialogue', { speaker: c.name, text: fill(text), dur: lineT, color: c.color, id: who, radio: who !== 'sable', loudspeaker: who === 'vask' });
  game.audio?.play?.('radio', { volume: who === 'vask' ? 0.9 : 0.5 });
}

// ---- objective implementations: create(spec, ctx) -> { text, update(dt)->'done'|'fail'|null, waypoint(), progress?, cleanup() } ----
const O = {};
O.say = s => ({ text: s.text || '', start() { say(s.alt && run?.flags?.[s.alt.flag] ? s.alt.lines : s.lines); }, update() { return lines.length || lineT > 0.3 ? null : 'done'; } });
O.goto = s => { const p = resolveLoc(s.at); return { text: s.text || 'Reach the marker', waypoint: () => p, update() { return d2(ppos(), p) < (s.radius || 25) && (!s.vehicle || game.player?.state === 'vehicle') ? 'done' : null; } }; };
O.flyTo = s => { // chain of airborne points, must be flying/gliding (fallback: any state if player module lacks wingsuit)
  const base = resolveLoc(s.at), pts = (s.points || [[0, 0, 60]]).map(([dx, dz, h]) => ({ x: base.x + dx, z: base.z + dz, y: gy(base.x + dx, base.z + dz) + h }));
  let i = 0; const ring = new THREE.Mesh(new THREE.TorusGeometry(10, 0.8, 8, 32), new THREE.MeshBasicMaterial({ color: 0x66d9ff, transparent: true, opacity: 0.85 })); game.scene.add(ring);
  return {
    text: s.text || 'Fly through the rings', waypoint: () => pts[i], get progress() { return `${i}/${pts.length}`; },
    update(dt) {
      const p = pts[i]; if (!p) return 'done'; ring.position.set(p.x, p.y, p.z); ring.rotation.y += dt;
      const pp = ppos(), air = !game.player || !['ground', 'swim'].includes(game.player.state);
      if (Math.hypot(pp.x - p.x, (pp.y ?? p.y) - p.y, pp.z - p.z) < 14 && air) { i++; game.audio?.play?.('objective', { volume: 0.5 }); }
      return i >= pts.length ? 'done' : null;
    }, cleanup() { game.scene.remove(ring); },
  };
};
function targetsObj(s, kinds, at, n, text) {
  const c = resolveLoc(at); const list = [];
  for (let k = 0; k < n; k++) { const a = k / n * 6.28 + 0.4, r = n === 1 ? 0 : (s.spread || 35); list.push(makeProp(kinds[k % kinds.length], { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r }, { hp: s.hp || 120, label: s.label, chaos: s.chaos })); }
  return {
    text, targets: list, get progress() { return `${list.filter(p => p.dead).length}/${n}`; },
    waypoint: () => { const pp = ppos(); const alive = list.filter(p => !p.dead).sort((a, b) => d2(a.obj.position, pp) - d2(b.obj.position, pp)); return alive[0]?.obj.position || c; },
    update() { return list.every(p => p.dead) ? 'done' : null; }, cleanup() { },
  };
}
O.destroyN = s => targetsObj(s, s.kinds || ['fuel'], s.at, s.n || 3, s.text || `Destroy the ${s.label || 'targets'}`);
// real world targets at a site (settlements.js registers them on site.destructibles; liberation is world-driven)
function realTargets(site) { return (site?.src?.destructibles || []).filter(o => o.userData?.alive); }
function nearestObj(objs) { const pp = ppos(); let best = null, bd = 1e18; for (const o of objs) { const w = o.getWorldPosition(new THREE.Vector3()); const d = d2(w, pp); if (d < bd) { bd = d; best = w; } } return best; }
const siteFreed = site => !!site && (site.src?.liberated || game.progress?.liberatedSites?.has(site.id));
O.destroyAtBase = s => { // real base destructibles when the world provides them; mission props only as a fallback
  const at = s.base != null ? { base: s.base } : s.at, L = resolveLoc(at), site = L.site, n = s.n || 4;
  if (realTargets(site).length || siteFreed(site)) { // already-freed base (e.g. a retry after death) completes at once
    const need = Math.max(1, Math.min(n, realTargets(site).length)); let got = 0;
    const h = d => { if (d?.baseId != null && String(d.baseId) === String(site.rawId)) got++; };
    game.events.on('destructible:destroyed', h);
    return { text: s.text || `Destroy regime assets at ${site.name}`, get progress() { return `${Math.min(need, got)}/${need}`; },
      waypoint: () => nearestObj(realTargets(site)) || L,
      update() { return got >= need || siteFreed(site) ? 'done' : null; }, cleanup() { game.events.off('destructible:destroyed', h); } };
  }
  const o = targetsObj(s, s.kinds || ['fuel', 'tower', 'generator'], at, n, s.text || 'Destroy regime assets at the base');
  return { ...o, update() { return o.targets.every(p => p.dead) ? 'done' : null; } };
};
O.destroyKinds = s => { // every real destructible of the given kinds at a world base (falls back to mission props)
  const L = resolveLoc(s.at), site = L.site, kinds = s.kinds;
  const objs = (site?.src?.destructibles || []).filter(o => kinds.includes(o.userData?.destructible?.kind));
  if (!objs.length) { const o = targetsObj(s, s.fallback || ['tower'], s.at, s.n || 3, s.text || `Destroy the ${s.label || 'targets'}`); return { ...o, update() { return o.targets.every(p => p.dead) ? 'done' : null; } }; }
  const alive = () => objs.filter(o => o.userData.alive !== false && (o.userData.destructible?.hp ?? 1) > 0);
  return { text: s.text || `Destroy the ${s.label || 'targets'} at ${site.name}`, get progress() { return `${objs.length - alive().length}/${objs.length}`; },
    waypoint: () => nearestObj(alive()) || L, update() { return alive().length ? null : 'done'; } };
};
O.liberate = s => { // done when the world/progress marks the site liberated; fallback props if the world has no targets there
  const at = { base: s.base }, L = resolveLoc(at), site = L.site;
  if (site && (realTargets(site).length || siteFreed(site))) {
    const src = site.src;
    return { text: s.text ? `${s.text}: ${site.name}` : `Destroy every regime target to liberate ${site.name}`, get progress() { return `${(src.total || 0) - (src.remaining || 0)}/${src.total || 0}`; },
      waypoint: () => nearestObj(realTargets(site).filter(o => o.userData.destructible.counts !== false)) || L,
      update() { return siteFreed(site) ? 'done' : null; } };
  }
  const o = targetsObj(s, ['generator', 'tower', 'fuel'], at, s.n || 5, s.text || `Liberate ${site?.name || 'the base'}`);
  return { ...o, update() {
    if (siteFreed(site)) return 'done';
    if (o.targets.every(p => p.dead)) {
      if (site && game.world?.setLiberated) game.world.setLiberated(site.rawId, false);
      else if (site) game.events.emit('base:liberated', { baseId: site.rawId });
      else game.events.emit('chaos', { amount: 3000, reason: 'Base liberated' });
      return 'done';
    }
    return null;
  } };
};
function spawnWave(p, n) {
  const sp = game.enemies?.spawn || game.enemies?.spawnSquad;
  if (!sp) return false;
  try { for (let k = 0; k < n; k++) { const a = Math.random() * 6.28; sp.call(game.enemies, 'soldier', new THREE.Vector3(p.x + Math.cos(a) * 70, gy(p.x, p.z) + 1, p.z + Math.sin(a) * 70)); } return true; } catch (e) { return false; }
}
O.surviveWaves = s => { let w = 0, t = 0; const p = resolveLoc(s.at); const waves = s.waves || 3, per = s.time || 30; return {
  text: s.text || 'Survive the counter-attack', waypoint: () => p, get progress() { return `Wave ${Math.min(waves, w + 1)}/${waves} · ${Math.ceil(per - t)}s`; },
  start() { spawnWave(p, 4); }, update(dt) { if (d2(ppos(), p) > (s.radius || 160)) return null; t += dt; if (t >= per) { t = 0; w++; if (w < waves) { spawnWave(p, 4 + w * 2); game.events.emit('heat', { level: Math.min(5, 2 + w) }); } } return w >= waves ? 'done' : null; } }; };
O.defend = s => { const p = resolveLoc(s.at); const pr = makeProp(s.kind || 'crate', p, { hp: s.hp || 600, label: s.label || 'Undertow cache', chaos: 0, plant: false }); let t = 0; const time = s.time || 60;
  return { text: s.text || `Defend the ${s.label || 'cache'}`, waypoint: () => p, get progress() { return `${Math.ceil(time - t)}s · ${Math.max(0, Math.round(pr.hp / pr.maxHp * 100))}%`; },
    start() { spawnWave(p, 6); }, update(dt) { if (pr.dead) return 'fail'; if (d2(ppos(), p) < 200) t += dt; if (t > time * 0.5 && !this._w2) { this._w2 = 1; spawnWave(p, 8); } return t >= time ? 'done' : null; }, cleanup() { if (!pr.dead) dropProp(pr); } }; };
function mover(kind, path, speed, opts = {}) {
  const pr = makeProp(kind, path[0], { hp: opts.hp || 300, label: opts.label, chaos: opts.chaos ?? 0, plant: opts.plant ?? false });
  let seg = 0, u = 0; const fly = kind === 'heli';
  return { pr, at: () => pr.obj.position, step(dt, mult = 1) {
    if (pr.dead || seg >= path.length - 1) return seg >= path.length - 1;
    let a = path[seg], b = path[seg + 1], len = Math.max(1, d2(a, b)); u += speed * mult * dt / len;
    while (u >= 1) { const left = (u - 1) * len; seg++; if (seg >= path.length - 1) return true; a = path[seg]; b = path[seg + 1]; len = Math.max(1, d2(a, b)); u = left / len; }
    const x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u; const y = fly ? Math.max(gy(x, z) + 60, 60) : gy(x, z);
    pr.obj.position.set(x, y, z); pr.obj.lookAt(b.x, y, b.z); if (pr.obj.userData.rotor) pr.obj.userData.rotor.rotation.y += dt * 30;
    return false;
  } };
}
// road-following path: Dijkstra over game.world.roads (nodes = site ids at polyline ends), downsampled polylines.
// Returns null when there is no usable road route (caller falls back to the straight line).
function roadPath(a, b) {
  try {
    const roads = (game.world?.roads || []).filter(r => r.points?.length >= 2); if (!roads.length || !a || !b) return null;
    const pos = new Map(), adj = new Map(), len = r => { let L = 0; for (let i = 1; i < r.points.length; i++) L += d2(r.points[i - 1], r.points[i]); return L; };
    for (const r of roads) {
      if (!pos.has(r.from)) pos.set(r.from, r.points[0]); if (!pos.has(r.to)) pos.set(r.to, r.points[r.points.length - 1]);
      const L = r._len ?? (r._len = len(r));
      (adj.get(r.from) || adj.set(r.from, []).get(r.from)).push({ to: r.to, r, L });
      (adj.get(r.to) || adj.set(r.to, []).get(r.to)).push({ to: r.from, r, L });
    }
    const near = p => { let best = null, bd = Infinity; for (const [id, q] of pos) { const d = d2(p, q); if (d < bd) { bd = d; best = id; } } return bd < 450 ? best : null; };
    const s0 = near(a), s1 = near(b); if (s0 == null || s1 == null || s0 === s1) return null;
    const dist = new Map([[s0, 0]]), prev = new Map(), done = new Set();
    for (;;) {
      let u = null, ud = Infinity; for (const [id, d] of dist) if (!done.has(id) && d < ud) { ud = d; u = id; }
      if (u == null) return null; if (u === s1) break; done.add(u);
      for (const e of adj.get(u) || []) { const nd = ud + e.L; if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, { from: u, r: e.r }); } }
    }
    const chain = []; for (let id = s1; id !== s0; id = prev.get(id).from) chain.unshift(prev.get(id));
    const out = [{ x: a.x, z: a.z }];
    for (const { from, r } of chain) {
      let pts = r.points; if (d2(pts[0], pos.get(from)) > d2(pts[pts.length - 1], pos.get(from))) pts = pts.slice().reverse();
      for (const q of pts) { const last = out[out.length - 1]; if (d2(last, q) >= 6) out.push({ x: q.x, z: q.z }); }
    }
    out.push({ x: b.x, z: b.z });
    return out.length >= 3 ? out : null;
  } catch (e) { console.warn('[missions] roadPath', e); return null; }
}
function pathBetween(a, b, n = 6, road = false) { if (road) { const rp = roadPath(a, b); if (rp) return rp; } const out = []; for (let i = 0; i <= n; i++) { const u = i / n, w = Math.sin(u * Math.PI) * 60; out.push({ x: a.x + (b.x - a.x) * u + w * Math.sin(i), z: a.z + (b.z - a.z) * u + w * Math.cos(i) }); } return out; }
O.escort = s => { const a = resolveLoc(s.from), b = resolveLoc(s.to), mv = mover('truck', pathBetween(a, b, 6, true), s.speed || 9, { hp: 500, label: s.label || "Dov's truck" });
  let t = 0; return { text: s.text || `Escort ${s.label || "Dov's truck"}`, waypoint: () => mv.at(), get progress() { return `${Math.max(0, Math.round(mv.pr.hp / 5))}% hull`; },
    update(dt) { if (mv.pr.dead) return 'fail'; const near = d2(ppos(), mv.at()) < 90; t += dt; if (t > 6 && !this._a) { this._a = 1; spawnWave(mv.at(), 4); } return mv.step(dt, near ? 1 : 0) ? 'done' : null; }, cleanup() { if (!mv.pr.dead) killProp(mv.pr, true); } }; };
O.chase = s => { const a = resolveLoc(s.from), b = resolveLoc(s.to), kind = s.kind || 'courier';
  const mv = mover(kind, pathBetween(a, b, 10), s.speed || 16, { hp: s.hp || 200, label: s.label || 'courier', chaos: 1500, plant: true }); let caught = 0;
  return { text: s.text || `Stop the ${s.label || 'courier'}`, waypoint: () => mv.at(), get progress() { return caught > 0 ? `Intercepting… ${Math.round(caught / 2 * 100)}%` : `${Math.round(d2(ppos(), mv.at()))} m`; },
    update(dt) {
      if (mv.pr.dead) return 'done';
      const d = d2(ppos(), mv.at()); if (d < (kind === 'heli' ? 30 : 9)) { caught += dt; game.hud?.prompt?.('Stay close to intercept'); } else caught = Math.max(0, caught - dt);
      if (caught >= 2) { killProp(mv.pr); return 'done'; }
      const escaped = mv.step(dt, d < 500 ? 1 : 0.3); return escaped ? 'fail' : null;
    }, cleanup() { if (!mv.pr.dead) killProp(mv.pr, true); } }; };
O.tether = s => { // tether X to Y: X moves to within range of Y (via grapple physics) or reel near it; fallback: hold F to rig a winch cable
  const c = resolveLoc(s.at); const x = makeProp(s.kind || 'statue', c, { hp: 99999, label: s.label || 'statue', chaos: 0, plant: false });
  const anchor = { x: c.x + 22, z: c.z + 6 }; const y = makeProp('truck', anchor, { hp: 99999, label: 'winch truck', chaos: 0, plant: false });
  let rig = 0, fall = 0; const start = x.obj.position.clone();
  const evt = d => { const objs = [d?.a, d?.b, d?.from, d?.to, d?.obj, d?.target].filter(Boolean); if (objs.some(o => o === x.obj || o?.parent === x.obj || x.obj.children.includes(o))) rig = 3; };
  game.events.on('grapple:tether', evt); game.events.on('tether:attached', evt);
  return { text: s.text || `Tether the ${s.label || 'statue'} to the truck and pull it down`, waypoint: () => (rig < 3 ? x.obj.position : y.obj.position), get progress() { return rig >= 3 ? 'Pulling!' : rig > 0 ? `Rigging ${Math.round(rig / 3 * 100)}%` : ''; },
    update(dt) {
      if (x.obj.position.distanceTo(start) > 4) rig = 3;
      if (rig < 3) { if (d2(ppos(), x.obj.position) < 8) { game.hud?.prompt?.(`Hold to rig tether`, 'F'); if (game.input.down('interact') || game.input.down('tether')) rig += dt; } return null; }
      fall += dt; x.obj.rotation.x = Math.min(Math.PI / 2, fall * fall * 0.6); if (fall > 0.05 && !this._s) { this._s = 1; game.audio?.play?.('tether'); }
      if (fall > 2.2) { game.events.emit('chaos', { amount: 2000, pos: x.obj.position, reason: s.label || 'Statue toppled' }); game.fx?.debris?.(x.obj.position, 20); game.gfx?.shake?.(0.8); game.audio?.play?.('explosion_small', { pos: x.obj.position }); return 'done'; }
      return null;
    }, cleanup() { game.events.off('grapple:tether', evt); game.events.off('tether:attached', evt); setTimeout(() => { killProp(x, true); killProp(y, true); }, 8000); } };
};
O.timed = s => { const inner = O[s.step.do](s.step); let t = s.time; return { ...inner, text: inner.text, get progress() { return `${Math.max(0, t).toFixed(0)}s ${inner.progress || ''}`; }, start() { inner.start?.(); },
  update(dt) { t -= dt; const r = inner.update(dt); if (r) return r; return t <= 0 ? 'fail' : null; }, cleanup() { inner.cleanup?.(); }, waypoint: inner.waypoint }; };
O.cam = s => { // cutscene-lite: orbit/push toward a location for `dur` seconds; letterboxed via game.state='cutscene'
  const p = resolveLoc(s.at); let t = 0; const dur = s.dur || 4; return { text: '', cam: true, start() { game.state = 'cutscene'; game.events.emit('cutscene', { on: true }); say(s.lines || []); },
    update(dt) { t += dt; const a = (s.angle ?? 0.6) + t * 0.12, r = (s.r || 140) - t * 8, y = gy(p.x, p.z); camBeat = { pos: new THREE.Vector3(p.x + Math.cos(a) * r, y + (s.h || 60) - t * 3, p.z + Math.sin(a) * r), look: new THREE.Vector3(p.x, y + 10, p.z) };
      return t >= dur && !(s.waitDialogue && (lines.length || lineT > 0.3)) ? 'done' : null; },
    cleanup() { camBeat = null; if (game.state === 'cutscene') game.state = 'play'; game.events.emit('cutscene', { on: false }); } }; };
let camBeat = null;
// ---- round 3 objectives: real vehicles, timed glide, story convoy, gunship duel, landmark ----
const vpos = v => { const t = v.body.translation(); return new THREE.Vector3(t.x, t.y, t.z); };
const liveV = v => !!v && !v.dead && (game.vehicles?.list?.includes(v) ?? true);
// steal a specific parked regime vehicle (F hijacks the crew out) and drive it to a drop point
O.hijackDeliver = s => {
  const at = resolveLoc(s.at), to = resolveLoc(s.to), type = s.vehicle || 'tank';
  let v = null;
  try { v = game.vehicles?.spawn?.(type, { x: at.x, z: at.z }, s.rot ?? 0.6, { driver: true, faction: 'regime' }); } catch (e) { console.warn('[missions] hijack spawn', e); }
  if (!v) return O.goto({ at: s.to, radius: s.radius || 35, text: s.textDrive || 'Reach the drop point' });
  v.faction = 'regime'; v.regime = true; v.missionVehicle = s.label || type;
  let bc = null; const label = s.label || 'the vehicle';
  return {
    get text() { return game.vehicles.current === v ? fill(s.textDrive || `Drive ${label} to the drop point`) : fill(s.text || `Steal ${label} (F to hijack)`); },
    waypoint: () => (game.vehicles.current === v ? to : (liveV(v) ? vpos(v) : to)),
    get progress() { if (!liveV(v)) return ''; const hp = Math.round(v.health / (v.def?.health || v.health || 1) * 100); return game.vehicles.current === v ? `${Math.round(d2(vpos(v), to))} m · hull ${hp}%` : `hull ${hp}%`; },
    start() { bc = game.progress?.beacon?.(to, 0x3fd0c9, 220); },
    update() {
      if (!liveV(v)) { this.reason = `${label[0].toUpperCase() + label.slice(1)} was destroyed`; return 'fail'; }
      if (game.vehicles.current === v && d2(vpos(v), to) < (s.radius || 35)) { this._ok = true; return 'done'; }
      return null;
    },
    cleanup() { bc?.remove?.(); if (v) v.missionVehicle = null; if (!this._ok && liveV(v) && game.vehicles.current !== v) { try { game.vehicles.despawn(v); } catch (e) { /* */ } } }, // failed/aborted: no stray tanks on retry
  };
};
// timed wingsuit drop: the clock starts when Sable leaves the launch point; landing short (or taking a vehicle) fails
O.glideTo = s => {
  const from = resolveLoc(s.from), to = resolveLoc(s.to), dist = d2(from, to);
  const time = s.time || Math.round(dist / 15 + 25); let t = 0, air = false, grounded = 0, bc = null;
  return {
    text: s.text || 'Wingsuit to the drop point before time runs out', waypoint: () => ({ x: to.x, y: gy(to.x, to.z) + 10, z: to.z }),
    get progress() { return air ? `${Math.max(0, time - t).toFixed(0)}s · ${Math.round(d2(ppos(), to))} m` : `${time}s once you jump · ${Math.round(dist)} m`; },
    start() { bc = game.progress?.beacon?.(to, 0x66d9ff, 300); },
    update(dt) {
      const P = game.player, stt = P?.state || 'air', pp = ppos();
      if (d2(pp, to) < (s.radius || 45)) return 'done';
      if (!air) { if (stt !== 'ground' || d2(pp, from) > 150) air = true; else { game.hud?.prompt?.('Jump off, Space to open the chute, Shift for the wingsuit'); return null; } }
      t += dt; if (t > time) { this.reason = 'Too slow — the codes burned'; return 'fail'; }
      if (stt === 'ground' || stt === 'swim' || stt === 'vehicle') grounded += dt; else grounded = 0;
      if (grounded > 4) { this.reason = stt === 'vehicle' ? 'No vehicles — the roads are watched' : 'You came down short'; return 'fail'; }
      return null;
    },
    cleanup() { bc?.remove?.(); },
  };
};
// a story convoy: every truck must burn before it reaches the far end of the road
O.convoy = s => {
  const a = resolveLoc(s.from), b = resolveLoc(s.to), path = pathBetween(a, b, 12, true), n = s.n || 4;
  const kinds = s.kinds || ['courier', 'truck', 'truck', 'courier'];
  const trucks = []; for (let k = 0; k < n; k++) trucks.push({ mv: mover(kinds[k % kinds.length], path, s.speed || 8, { hp: kinds[k % kinds.length] === 'truck' ? 420 : 260, label: s.label || 'convoy truck', chaos: 1200, plant: true }), delay: k * 2.5 });
  for (const t of trucks) t.mv.pr.obj.visible = t.delay <= 0;
  let guards = false; const lead = () => trucks.find(t => !t.mv.pr.dead && t.delay <= 0) || trucks.find(t => !t.mv.pr.dead);
  return {
    text: s.text || 'Destroy the convoy before it reaches the fortress', targets: trucks.map(t => t.mv.pr),
    get progress() { const dead = trucks.filter(t => t.mv.pr.dead).length; const l = lead(); return `${dead}/${n} destroyed${l ? ` · ${Math.round(d2(l.mv.at(), b))} m to go` : ''}`; },
    waypoint: () => lead()?.mv.at() || b,
    update(dt) {
      let alive = 0, arrived = false; const near = (() => { const l = lead(); return l ? d2(ppos(), l.mv.at()) : 1e9; })();
      for (const t of trucks) {
        if (t.mv.pr.dead) continue; alive++;
        if (t.delay > 0) { t.delay -= dt; if (t.delay <= 0) t.mv.pr.obj.visible = true; continue; }
        if (t.mv.step(dt, near < 700 ? 1 : 0.35)) arrived = true;
      }
      if (!guards && near < 160) { guards = true; const l = lead(); if (l) spawnWave(l.mv.at(), 4); }
      if (!alive) return 'done';
      if (arrived) { this.reason = 'The convoy reached the fortress'; return 'fail'; }
      return null;
    },
    cleanup() { for (const t of trucks) if (!t.mv.pr.dead) killProp(t.mv.pr, true); },
  };
};
// the finale duel: a real regime attack helicopter with hunt AI. Shoot it down, or grapple on and throw the pilot out.
O.gunship = s => {
  const c = resolveLoc(s.at); let v = null;
  try { v = game.vehicles?.spawn?.('attackHeli', { x: c.x, y: gy(c.x, c.z) + 45, z: c.z }, 0, { ai: 'hunt', faction: 'regime', target: game.player }); } catch (e) { console.warn('[missions] gunship spawn', e); }
  if (!v) return O.chase({ from: s.at, to: { coast: 4 }, kind: 'heli', speed: 24, hp: 400, label: s.label, text: s.text });
  // act one: Vask bolts for the sea (hunt AI chases a far-off point); act two, after `flee` s, he turns on Sable
  const pp0 = ppos(), dir = Math.atan2(c.z - pp0.z, c.x - pp0.x); // straight away from Sable
  const flee = { pos: new THREE.Vector3(c.x + Math.cos(dir) * 3000, 120, c.z + Math.sin(dir) * 3000) };
  v.faction = 'regime'; v.regime = true; v.aiTarget = s.flee === 0 ? game.player : flee; v.vask = true; let t = 0, turned = s.flee === 0;
  // Virtual hull: the AI scrapes ridges at speed and one terrain impact can one-shot a heli, so the real health sits on a
  // huge buffer and only damage that set lastHitBy (bullets, rockets, blasts — never 'impact') comes off Vask's hull.
  const max = Math.round((v.def?.health || v.health || 900) * (s.hpMul || 1.4)), BIG = 1e6, SENT = {}; let hull = max;
  v.health = BIG; v.lastHitBy = SENT;
  const onHijack = d => { if (d?.v === v && run) run.flags.hijacked = true; }; game.events.on('vehicle:hijacked', onHijack);
  return {
    text: s.text || "Bring down Vask's gunship", waypoint: () => (liveV(v) ? vpos(v) : c),
    get progress() { return liveV(v) ? `Gunship hull ${Math.max(0, Math.round(hull / max * 100))}%` : ''; },
    update(dt) {
      if (run?.flags.hijacked || v.dead || !liveV(v)) return 'done'; if (game.vehicles.current === v || v.occupied) { run.flags.hijacked = true; return 'done'; }
      if (v.health < BIG && v.lastHitBy !== SENT) hull -= BIG - v.health;
      v.health = BIG; v.lastHitBy = SENT;
      if (hull <= 0) { game.vehicles.damage(v, BIG * 2, null, 'player'); return 'done'; }
      t += dt; if (!turned && (t > (s.flee ?? 12) || hull < max * 0.85)) { turned = true; if (v.ai) v.aiTarget = game.player; say(s.turnLines || []); }
      return null;
    },
    cleanup() { game.events.off('vehicle:hijacked', onHijack); if (!v.dead) v.health = Math.max(1, Math.min(v.def?.health || max, hull)); if (v.lastHitBy === SENT) v.lastHitBy = null; if (liveV(v) && !run?.flags.hijacked && game.vehicles.current !== v && !v.dead) { try { game.vehicles.despawn(v); } catch (e) { /* */ } } },
  };
};
// a world landmark destructible (the Vask Colossus). Already rubble (old save) -> done at once.
O.landmark = s => {
  const lm = game.world?.landmarks?.find(l => l.id === (s.id || 'colossus')), obj = lm?.obj, d = obj?.userData?.destructible;
  if (!obj || !d) { const o = targetsObj({ ...s, hp: 1500 }, ['statue'], s.id ? { landmark: s.id } : { ring: 900 }, 1, s.text || 'Topple the statue'); return { ...o, update() { return o.targets.every(p => p.dead) ? 'done' : null; } }; }
  const dead = () => obj.userData.alive === false || (d.hp ?? 1) <= 0 || !obj.visible;
  return { text: s.text || `Bring down ${lm.name}`, waypoint: () => ({ x: lm.x, y: lm.y + 25, z: lm.z }),
    get progress() { return `${Math.max(0, Math.round(d.hp / (d.maxHp || 1) * 100))}% standing`; }, update() { return dead() ? 'done' : null; } };
};

// ---- the campaign ----
const STORY = [
  { id: 'm1', title: 'Undertow', giver: 'mira', start: { settlement: 0 }, reward: { chaos: 1000 }, steps: [
    { do: 'say', lines: [['mira', 'Sable Marrow. The stuntman who jumped a burning bus over Vask\'s parade. You\'re either brave or broken.'], ['sable', 'Can\'t it be both?'], ['mira', 'It\'ll have to be. Welcome to the Undertow. Get to the village — Dov is waiting.']] },
    { do: 'goto', at: { settlement: 0 }, radius: 40, text: 'Meet Dov in the village' },
    { do: 'say', lines: [['dov', 'So you\'re the new grapple monkey. That rig on your wrist? My work. Don\'t scratch it.'], ['dov', 'See that propaganda mast? Vask\'s voice poisons this whole valley. Bring it down.']] },
    { do: 'destroyN', at: { near: { settlement: 0 }, r: 90 }, n: 1, kinds: ['tower'], label: 'propaganda mast', text: 'Destroy the propaganda mast (explosives, or plant a charge: F)' },
    { do: 'say', lines: [['vask', 'Citizens of Corvana. A vandal is loose among you. Report him and your families will eat this winter.'], ['mira', 'He noticed you. Good. Now he\'ll make mistakes.']] } ] },
  { id: 'm2', title: 'Loud Introductions', giver: 'mira', start: { near: { base: 0 }, r: 260 }, reward: { chaos: 3000, mods: ['tether4'] }, steps: [
    { do: 'cam', at: { base: 0 }, dur: 5, lines: [['mira', '{base0}. Fuel, radar, a garrison of bored conscripts.'], ['mira', 'Burn it all. Let the island see the regime bleed.']] },
    { do: 'destroyAtBase', base: 0, n: 4, text: 'Destroy regime assets at {base0}' },
    { do: 'say', lines: [['vask', '{base0} was a storage yard. You have taken nothing from me, little acrobat.']] },
    { do: 'liberate', base: 0, n: 2, text: 'Topple the command relays to liberate the outpost' } ] },
  { id: 'm3', title: 'Fuel for the Fire', giver: 'dov', start: { coast: 0.5 }, reward: { chaos: 2500, unlock: 'hp1' }, steps: [
    { do: 'say', lines: [['dov', 'I\'ve got a truck full of stolen avgas and exactly zero friends with guns. Keep the soldiers off me.']] },
    { do: 'escort', from: { coast: 0.5 }, to: { settlement: 0 }, text: "Escort Dov's fuel truck to the village" },
    { do: 'say', lines: [['dov', 'Not a scratch! Well. Several scratches. I\'ll call them character.']] } ] },
  { id: 'm3b', title: 'Blind the Sky', giver: 'mira', start: { near: { baseWith: ['radar', 'sam', 'satUplink', 'commAntenna'] }, r: 240, angle: 2.1 }, reward: { chaos: 3500, ammo: true }, steps: [
    { do: 'cam', at: { baseWith: ['radar', 'sam', 'satUplink', 'commAntenna'] }, dur: 5, angle: 2.1, lines: [['mira', 'Vask\'s gunships find us because {radar} sees everything that moves.'], ['mira', 'Put out its eyes and the sky is ours.']] },
    { do: 'destroyKinds', at: { baseWith: ['radar', 'sam', 'satUplink', 'commAntenna'] }, kinds: ['radar', 'sam', 'satUplink', 'commAntenna'], label: 'radar and air-defence', fallback: ['tower', 'generator'] },
    { do: 'say', lines: [['vask', 'Who switched off my sky? Somebody will hang for this.'], ['dov', 'Blind and angry. My favourite kind of general.']] } ] },
  { id: 'm3c', title: 'Dry Tanks', giver: 'dov', start: { near: { baseWith: ['fuelTank', 'gasSilo'] }, r: 240, angle: 4 }, reward: { chaos: 4000, mods: ['reel1'] }, steps: [
    { do: 'say', lines: [['dov', '{fuel} is where Vask\'s tanks drink. Every drop you burn is a tank that never leaves the yard.'], ['dov', 'Ninety seconds after the first blast they\'ll seal the depot. Be quick and be loud.']] },
    { do: 'goto', at: { baseWith: ['fuelTank', 'gasSilo'] }, radius: 90, text: 'Get to the fuel depot at {fuel}' },
    { do: 'timed', time: 120, step: { do: 'destroyKinds', at: { baseWith: ['fuelTank', 'gasSilo'] }, kinds: ['fuelTank', 'gasSilo'], label: 'fuel tanks', fallback: ['fuel'] } },
    { do: 'surviveWaves', at: { baseWith: ['fuelTank', 'gasSilo'] }, waves: 2, time: 20, text: 'Survive the depot guard' },
    { do: 'say', lines: [['dov', 'You can see that smoke from the mainland. Mira\'s going to frame a photo of it.']] } ] },
  { id: 'm4', title: 'Wings of the Undertow', giver: 'dov', start: { peak: 1 }, reward: { chaos: 2000, mods: ['boost1'] }, steps: [
    { do: 'say', lines: [['dov', 'New wingsuit membrane. Theory says it glides. Practice says you tell me.']] },
    { do: 'goto', at: { peak: 1 }, radius: 40, text: 'Climb to the summit' },
    { do: 'timed', time: 90, step: { do: 'flyTo', at: { peak: 1 }, points: [[120, 60, 80], [260, 150, 70], [400, 210, 60], [540, 320, 55], [680, 420, 50]], text: 'Wingsuit through the rings (Shift while falling)' } },
    { do: 'say', lines: [['dov', 'You\'re alive! Write that down. I owe Mira money.']] } ] },
  { id: 'm5', title: 'The Courier', giver: 'mira', start: { settlement: 1 }, reward: { chaos: 3000 }, steps: [
    { do: 'say', lines: [['mira', 'A regime courier is running Vask\'s codebooks to the coast. Stop that car.']] },
    { do: 'chase', from: { near: { settlement: 1 }, r: 120 }, to: { coast: 2 }, label: 'courier car', text: 'Stop the courier car (destroy it or stay close)' },
    { do: 'goto', at: { coast: 2 }, radius: 60, text: 'Recover the codebooks from the wreck' },
    { do: 'say', lines: [['mira', 'Patrol rotations, fortress shield schedules… Sable, this is the key to the mountain.']] } ] },
  { id: 'm6', title: 'Pull the Statue', giver: 'mira', start: { settlement: 2 }, reward: { chaos: 4000, mods: ['chute'] }, steps: [
    { do: 'say', lines: [['mira', 'Every village has one: Vask in bronze, pointing at a future nobody asked for.'], ['vask', 'That statue is the people\'s love made metal. Touch it and you touch me.']] },
    { do: 'tether', at: { near: { settlement: 2 }, r: 40 }, label: 'statue of Vask' },
    { do: 'surviveWaves', at: { settlement: 2 }, waves: 2, time: 25, text: 'Hold the square against the garrison' },
    { do: 'say', lines: [['mira', 'Listen to them cheering. That\'s the sound of a province waking up.']] } ] },
  { id: 'm7', title: 'Radio Silence', giver: 'mira', start: { settlement: 3 }, reward: { chaos: 4500, mods: ['reel2'] }, steps: [
    { do: 'say', lines: [['vask', 'Corvana, your General watches over you. Every hour. Every channel.'], ['mira', 'Then let\'s take away his channels.']] },
    { do: 'destroyN', at: { near: { settlement: 3 }, r: 220 }, n: 3, spread: 260, kinds: ['tower'], label: 'broadcast towers' },
    { do: 'say', lines: [['vask', 'Static? Static! Find him!'], ['dov', 'Ha! That\'s the sweetest sound I\'ve heard all year.']] } ] },
  { id: 'm8', title: 'Hold the Line', giver: 'dov', start: { settlement: 0 }, reward: { chaos: 5000, unlock: 'tether5' }, steps: [
    { do: 'say', lines: [['dov', 'They found our cache in the village. Armor\'s coming up the road. We hold or we lose everything.'], ['sable', 'Everything?'], ['dov', 'The guns, the rope, and my good kettle. In ascending order of importance.']] },
    { do: 'defend', at: { near: { settlement: 0 }, r: 30 }, time: 75, label: 'Undertow arms cache' },
    { do: 'say', lines: [['mira', 'You held. The villages are sending us volunteers now.'], ['dov', 'And the kettle survived. Morale is through the roof.']] } ] },
  { id: 'm9', title: 'Iron Harbor', giver: 'mira', start: { near: { base: 1 }, r: 300 }, reward: { chaos: 6000, unlock: 'boom1' }, steps: [
    { do: 'cam', at: { base: 1 }, dur: 5, angle: 2.2, lines: [['mira', '{base1} feeds the fortress. Gut it and Vask\'s mountain starves.']] },
    { do: 'destroyAtBase', base: 1, n: 5 },
    { do: 'surviveWaves', at: { base: 1 }, waves: 2, time: 25 },
    { do: 'liberate', base: 1, n: 2 },
    { do: 'say', lines: [['dov', 'The fortress just lost its groceries. Let\'s see how long a general lasts on ration biscuits.'], ['mira', 'Longer than his soldiers will. That\'s the point.']] } ] },
  { id: 'm10', title: 'Dov\'s Masterpiece', giver: 'dov', start: { near: { base: 2 }, r: 280 }, reward: { chaos: 6000, mods: ['boom2'] }, steps: [
    { do: 'say', lines: [['dov', 'I built an EMP from a microwave, a tractor alternator and spite. Plant it in the base\'s heart before the timer pops.'], ['sable', 'What happens if the timer pops first?'], ['dov', 'Then you\'ll be very well heated.']] },
    { do: 'timed', time: 150, step: { do: 'goto', at: { base: 2 }, radius: 30, text: 'Carry the EMP into the base' } },
    { do: 'destroyAtBase', base: 2, n: 3, kinds: ['generator'], text: 'Destroy the shorted generators' },
    { do: 'liberate', base: 2, n: 1 },
    { do: 'say', lines: [['dov', 'Did it work? It worked. Mira, it WORKED.'], ['mira', 'You sound surprised.'], ['dov', 'I\'m professionally surprised. It keeps me humble.']] } ] },
  // ---- round 3: the road to Mount Kael ----
  { id: 'm10b', title: 'Borrowed Thunder', giver: 'dov', start: { near: { base: 4 }, r: 260, angle: 1.4 }, reward: { chaos: 6500, mods: ['drop_tank'] }, steps: [
    { do: 'say', lines: [['dov', 'Vask took delivery of a brand-new tank this morning. Paint\'s still wet. Treads have never touched a peasant.'], ['dov', 'It\'s parked at {base4}. Go and get it. I\'ll be in {@tankdrop} with a bow on my head.'], ['mira', 'Dov. We are not keeping a tank.'], ['dov', 'We are absolutely keeping a tank.']] },
    { do: 'hijackDeliver', vehicle: 'tank', at: { near: { base: 4 }, r: 45, angle: 0.3 }, to: NAMED.tankdrop, radius: 40, label: 'the new tank', text: 'Steal the new tank at {base4} (F to hijack)', textDrive: 'Drive the tank to Dov in {@tankdrop}' },
    { do: 'say', lines: [['dov', 'Look at her. Not a scratch. Smells like a general\'s aftershave.'], ['mira', 'Hide it under something.'], ['dov', 'Under WHAT, Mira? It\'s a TANK.'], ['dov', 'Need her, Sable, whistle: Alt+B and she drops in on a chute. Don\'t ask how. I don\'t know how.']] } ] },
  { id: 'm10c', title: 'Dead Drop', giver: 'mira', start: { peakNear: { settlement: 4 }, min: 550, max: 1300 }, reward: { chaos: 6500, mods: ['boost2'] }, steps: [
    { do: 'say', lines: [['mira', 'Our man inside Mount Kael got us the shield codes. If he doesn\'t hear from us in two minutes, he burns them and runs.'], ['mira', 'He\'s in the bell tower at {set4}. Every road is locked down. That leaves the sky.'], ['sable', 'And if I miss the bell tower?'], ['mira', 'Then you\'ll be the most expensive thing that ever landed in a goat pen.']] },
    { do: 'goto', at: { peakNear: { settlement: 4 }, min: 550, max: 1300 }, radius: 45, text: 'Climb to the launch ridge' },
    { do: 'glideTo', from: { peakNear: { settlement: 4 }, min: 550, max: 1300 }, to: { settlement: 4 }, radius: 50, text: 'Wingsuit into {set4} before the codes burn (Space, then Shift)' },
    { do: 'say', lines: [['mira', 'He\'s got them. Shield rotations, door codes, the lot.'], ['mira', 'Sable… that was the best thing I\'ve ever watched through binoculars.'], ['sable', 'You should see it from inside.']] } ] },
  { id: 'm10d', title: 'Iron Procession', giver: 'mira', start: { near: NAMED.convoyfrom, r: 220, angle: 2.6 }, reward: { chaos: 7500, ammo: true }, steps: [
    { do: 'say', lines: [['vask', 'Tomorrow the Victory Procession carries fireworks to Mount Kael for my birthday. Line the road. Wave. Waving will be counted.'], ['mira', 'Fireworks. They\'re anti-air missiles, Sable. If that convoy reaches the mountain, nothing flies near Kael again. Including you.'], ['mira', 'Hit it on the road out of {@convoyfrom}. Nothing reaches the fortress.']] },
    { do: 'goto', at: { near: NAMED.convoyfrom, r: 160, angle: 2.6 }, radius: 70, text: 'Get to the ambush point outside {@convoyfrom}' },
    { do: 'convoy', from: NAMED.convoyfrom, to: { base: 'highest' }, n: 4, speed: 7, label: 'missile truck', text: 'Destroy the missile convoy before it reaches {fortress}' },
    { do: 'say', lines: [['dov', 'Happy birthday, General.'], ['mira', 'Every rocket on that road was meant for one of us. Now they\'re a sunset.']] } ] },
  { id: 'm11', title: 'Storm Front', giver: 'mira', start: { near: { base: 3 }, r: 300 }, reward: { chaos: 7000, unlock: 'tether6' }, steps: [
    { do: 'say', lines: [['vask', 'You think a few burned depots make you a nation? I built this nation with my own hands.'], ['mira', 'And we\'ll take it back with ours. {base3}, Sable. The last wall before the mountain.']] },
    { do: 'liberate', base: 3, n: 5 },
    { do: 'say', lines: [['mira', 'Colonel Brask is bolting in his helicopter. He knows the fortress layout better than Vask does.'], ['dov', 'Then he shouldn\'t be allowed to finish the trip.']] },
    { do: 'chase', from: { base: 3 }, to: { base: 'highest' }, kind: 'heli', speed: 22, hp: 260, label: 'Colonel Brask\'s helicopter', text: 'Stop Colonel Brask\'s helicopter (destroy it or stay close)' } ] },
  { id: 'm11b', title: 'Pirate Radio', giver: 'mira', start: { near: { base: 4 }, r: 280, angle: 4.2 }, reward: { chaos: 8000, mods: ['drop_heli'] }, steps: [
    { do: 'say', lines: [['mira', 'Twenty years Vask has been talking at this island. Tonight it talks back.'], ['mira', 'The relay at {base4} reaches every radio on Corvana. Clear the garrison and I\'ll park the van in their courtyard.'], ['dov', 'They\'ve repainted the spot where their tank used to be. It\'s very sad.']] },
    { do: 'liberate', base: 4, n: 4 },
    { do: 'say', lines: [['mira', 'Van\'s in. I\'m patching into the relay. Keep them off me — I need sixty seconds on air.']] },
    { do: 'defend', at: { near: { base: 4 }, r: 25 }, kind: 'truck', time: 60, hp: 900, label: 'Mira\'s broadcast van', text: 'Protect Mira\'s broadcast van while she goes live' },
    { do: 'say', lines: [['mira', 'Corvana, this is the Undertow. You don\'t know my voice. You know his.'], ['mira', 'He told you the mountain can\'t fall. Look out your window tomorrow night.'], ['vask', 'That woman is a paid actress. I know, because I didn\'t pay her.'], ['dov', 'Gunship\'s yours whenever you want it, Sable. Shift+B. Bring it back with fewer holes than the last one.']] } ] },
  { id: 'm12', title: 'Stormbreak', giver: 'mira', start: { near: { base: 'highest' }, r: 400 }, finale: true, reward: { chaos: 25000, mods: ['hp2'] }, steps: [
    { do: 'cam', at: { base: 'highest' }, dur: 7, h: 160, r: 260, lines: [['mira', 'Mount Kael. Twenty years he\'s looked down on us from up there.'], ['vask', 'Come up, Marrow. The view is wasted on me.'], ['sable', 'Not for long.']], waitDialogue: true },
    { do: 'goto', at: { near: { base: 'highest' }, r: 80 }, radius: 50, text: 'Breach the fortress perimeter' },
    { do: 'liberate', base: 'highest', n: 4, text: 'Tear the fortress apart' },
    { do: 'surviveWaves', at: { base: 'highest' }, waves: 2, time: 25, text: 'Survive Vask\'s Iron Guard' },
    { do: 'say', lines: [['vask', 'Prepare my helicopter. No — the good one.'], ['mira', 'He\'s running! Sable, he\'s in the gunship — don\'t let him reach the sea!']] },
    { do: 'gunship', at: { near: { base: 'highest' }, r: 260, angle: 3.6 }, hpMul: 2, flee: 12,
      turnLines: [['dov', 'He\'s not running. Sable — he\'s turning around.'], ['vask', 'I built this island, Marrow. I can certainly bury one stuntman in it.']], text: 'Bring down Vask\'s gunship (shoot it down, or grapple on and hijack it)' },
    { do: 'say', lines: [['mira', 'It\'s down! Gunship down!'], ['mira', 'Ground team has him. Alive. Singed. Still talking.'], ['vask', 'This is a temporary setback in a permanent—'], ['dov', 'Somebody take the man\'s microphone.']],
      alt: { flag: 'hijacked', lines: [['mira', 'Did you just throw the General out of his own helicopter?'], ['sable', 'He was in my seat.'], ['mira', 'Ground team has him. He landed in a hay cart. He is demanding a better hay cart.'], ['dov', 'Somebody take the man\'s microphone.']] } },
    { do: 'say', lines: [['mira', 'One Vask left standing on this island, Sable. The big one.'], ['dov', 'Forty-five metres of bronze. I\'m melting it down for church bells.']] },
    { do: 'landmark', id: 'colossus', text: 'Bring down the Vask Colossus' },
    { do: 'cam', at: { landmark: 'colossus' }, dur: 6, h: 70, r: 160, lines: [['dov', 'Timber.'], ['mira', 'Listen. Every town on the coast can see that.']], waitDialogue: true },
    { do: 'cam', at: { base: 'highest' }, dur: 8, h: 200, r: 320, lines: [['mira', 'It\'s over. Corvana is free.'], ['dov', 'I\'m keeping the helicopter parts. And the tank. Don\'t argue.'], ['mira', 'Sable… whatever you were before you came here — a stuntman, a madman — you\'re the storm that broke him.'], ['sable', 'Stuntman. It\'s a real job.'], ['mira', 'Not anymore it isn\'t. Now it\'s a holiday.']], waitDialogue: true } ] },
];
// Vask propaganda broadcasts that play between story missions (keyed by the mission just completed)
const BROADCASTS = {
  m1: [['vask', 'Today\'s weather: sunny, by decree. Today\'s rumour of a resistance: cloudy, and false.']],
  m2: [['vask', 'A correction to this morning\'s bulletin. {base0} was not attacked. It was renovated. Loudly. By fire.']],
  m3: [['vask', 'Fuel rationing begins at sundown. Any citizen found in possession of petrol will be presumed to be a stuntman.']],
  m3b: [['vask', 'The radar at {radar} is resting its eyes. So, I remind you, is justice. Report to it anyway.']],
  m3c: [['vask', 'Our tanks are not out of fuel. They are fasting. A hungry tank is a patient tank.']],
  m4: [['vask', 'A man was seen flying over the hills in a suit of bedsheets. Gravity is a loyal citizen. Gravity will deal with him.']],
  m5: [['vask', 'Lost: one briefcase, regime grey. Contents: boring. Reward for its return: your life, unchanged.']],
  m6: [['vask', 'The statue in the square has been removed for cleaning. It will be returned larger.']],
  m7: [['vask', 'This is a test of the emergency broadcast system. If you can hear this, the emergency is that you can barely hear this.']],
  m8: [['vask', 'To the villagers feeding the vandal: I know which of you bakes the good bread. I will be so sad to stop eating it.']],
  m9: [['vask', 'The harbour is closed for inventory. All ships are now submarines. Please do not ask about the bubbles.']],
  m10: [['vask', 'Tonight\'s power cut is a gift. It is in the dark that your General thinks of you most.']],
  m10b: [['vask', 'If you see one of our tanks driving politely and using its indicators, it is not one of ours. Fire on it.']],
  m10c: [['vask', 'The airspace over Corvana is closed. Birds will be issued permits. Unlicensed birds will be addressed.']],
  m10d: [['vask', 'My birthday is postponed. Your birthdays are cancelled. Fair is fair.']],
  m11: [['vask', 'Colonel Brask has been promoted. To the sea floor. His family may collect the medal, should it surface.']],
  m11b: [['vask', 'Citizens, do not adjust your radios. That woman is not real. The mountain is real. I am on it. Hello.']],
};
// repeatable side jobs, generated from templates against random sites
const SIDE = [
  { id: 'side_sabotage', title: 'Sabotage Contract', make: r => [{ do: 'destroyN', at: { near: { base: r % 4 }, r: 60 }, n: 3, kinds: ['fuel'], label: 'fuel bladders' }] },
  { id: 'side_supply', title: 'Supply Run', make: r => [{ do: 'escort', from: { coast: r }, to: { settlement: r % 4 }, label: 'supply truck' }] },
  { id: 'side_bounty', title: 'Bounty: Regime Colonel', make: r => [{ do: 'chase', from: { settlement: r % 4 }, to: { base: (r + 1) % 4 }, label: "colonel's car" }] },
  { id: 'side_purge', title: 'Propaganda Purge', make: r => [{ do: 'destroyN', at: { settlement: r % 5 }, n: 2, spread: 80, kinds: ['tower', 'statue'], label: 'propaganda' }] },
];

// ---- runner ----
let st = { done: [], sideCount: 0, ended: false };
let run = null, markers = [];
function list() { return STORY.map((m, i) => ({ id: m.id, title: m.title, giver: CAST[m.giver]?.name, done: st.done.includes(m.id), available: i === 0 || st.done.includes(STORY[i - 1].id), finale: !!m.finale, pos: resolveLoc(m.start) })).concat(SIDE.map(s => ({ id: s.id, title: s.title, side: true, available: true, done: false }))); }
function start(id, opts = {}) {
  if (run) abort(true);
  const def = STORY.find(m => m.id === id) || SIDE.find(s => s.id === id); if (!def) return false;
  let steps = def.steps || def.make(st.sideCount++ + Math.floor(Math.random() * 7));
  if (opts.travel && def.start) { const p = resolveLoc(def.start); if (d2(ppos(), p) > 80) steps = [{ do: 'goto', at: { x: p.x, z: p.z }, radius: 45, text: `Travel to the mission area`, travel: true }, ...steps]; }
  run = { def, steps, i: -1, obj: null, side: !def.steps, retry: opts.retry || 0, flags: {} };
  M.active = run; game.progress?.activeChallenge;
  game.events.emit('mission:start', { id: def.id, title: def.title });
  next(); return true;
}
function next() {
  run.obj?.cleanup?.(); run.i++;
  const s = run.steps[run.i];
  if (!s) return complete();
  try { run.obj = O[s.do](s); } catch (e) { console.warn('[missions] objective failed to build, skipping', s, e); run.obj = { text: '', update: () => 'done' }; }
  run.obj.start?.();
  if (run.i > 0 && !run.obj.cam && s.do !== 'say') game.audio?.play?.('objective', { volume: 0.7 });
  game.events.emit('mission:update', { id: run.def.id, objective: fill(run.obj.text), index: run.i, total: run.steps.length });
}
function complete() {
  const def = run.def; const r = def.reward || { chaos: 1500 };
  if (!run.side && !st.done.includes(def.id)) st.done.push(def.id);
  if (r.chaos) game.events.emit('chaos', { amount: r.chaos, reason: `${def.title} complete` });
  for (const m of r.mods || []) game.progress?.unlock?.(m); if (r.unlock) game.progress?.unlock?.(r.unlock);
  if (r.ammo) { try { game.combat?.addAmmo?.('all'); game.events.emit('toast', { text: 'Undertow resupply: ammo and explosives refilled' }); } catch (e) { /* optional */ } }
  run = null; M.active = null; persist(); refreshMarkers();
  if (def.finale) { st.ended = true; for (const m of STORY) if (!st.done.includes(m.id)) st.done.push(m.id); persist(); }
  game.events.emit('mission:complete', { id: def.id, title: def.title, reward: r, finale: !!def.finale });
  if (def.finale) { game.events.emit('campaign:complete', { id: def.id }); setTimeout(showEndCard, M.endCardDelay ?? 2500); return; }
  if (BROADCASTS[def.id] && !run) setTimeout(() => { if (!run || run.i <= 0) say(BROADCASTS[def.id]); }, 1500); // Vask cuts in between jobs
  // story chains: the next story mission starts on its own after a short beat (player travels there as step 1)
  const nx = !def.steps ? null : STORY[STORY.findIndex(m => m.id === def.id) + 1];
  if (nx && !st.done.includes(nx.id)) setTimeout(() => { if (!run && game.state !== 'title') start(nx.id, { travel: true }); }, M.chainDelay ?? 4000);
}
function fail(reason, o = {}) {
  const def = run.def, retry = run.retry; run.obj?.cleanup?.(); clearProps(); run = null; M.active = null; lines = []; refreshMarkers();
  game.events.emit('mission:fail', { id: def.id, title: def.title, reason, retry: !!o.retry });
  // genre checkpoint: a story mission lost to death restarts by itself once Sable is back on her feet
  if (o.retry && def.steps) setTimeout(() => { if (!run && game.state !== 'title' && game.player?.state !== 'dead') { start(def.id, { travel: true, retry: retry + 1 }); game.events.emit('toast', { text: `Retrying: ${def.title}`, kind: 'warn' }); } }, M.retryDelay ?? 6000);
}
function abort(silent) { if (!run) return; run.obj?.cleanup?.(); clearProps(); const id = run.def.id; run = null; M.active = null; lines = []; if (!silent) game.events.emit('mission:fail', { id, reason: 'Abandoned' }); refreshMarkers(); }
function persist() { game.save?.set?.('missions', { done: st.done, sideCount: st.sideCount, ended: st.ended }); }
function refreshMarkers() {
  for (const m of markers) m.b.remove(); markers = [];
  if (!game.progress?.beacon || run) return;
  const nx = list().find(m => !m.side && m.available && !m.done);
  if (nx) markers.push({ id: nx.id, pos: nx.pos, b: game.progress.beacon(nx.pos, 0xffd34d, 320) });
}
// ---- finale end card: "Corvana is free" + credits, then free roam (DOM overlay owned by missions) ----
let endCard = null;
function showEndCard() {
  if (endCard || typeof document === 'undefined') return;
  const P = game.progress, secs = Math.round(game.save?.data?.playTime || 0);
  const pct = Math.round((P?.islandPct || 0) * 100), chaos = (P?.chaos || 0).toLocaleString();
  const d = document.createElement('div'); d.id = 'sb-endcard';
  d.style.cssText = 'position:fixed;inset:0;z-index:9000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;color:#e9e4d8;'
    + 'background:radial-gradient(ellipse at 50% 40%,rgba(20,28,36,.55),rgba(4,6,9,.94) 70%);font-family:"Avenir Next Condensed","Arial Narrow",sans-serif;opacity:0;transition:opacity 2.2s;cursor:pointer';
  const credit = (role, name) => `<div style="display:flex;gap:18px;justify-content:center;font-size:15px;letter-spacing:.18em"><span style="opacity:.55;width:300px;text-align:right">${role}</span><span style="width:360px;text-align:left">${name}</span></div>`;
  d.innerHTML = `<div style="font-weight:700;font-size:13px;letter-spacing:.8em;color:#3fd0c9">STORMBREAK</div>
    <div style="font-weight:900;font-style:italic;font-size:84px;line-height:1;letter-spacing:.06em;text-shadow:0 0 40px rgba(232,69,44,.55)">CORVANA IS FREE</div>
    <div style="font-weight:600;font-size:16px;letter-spacing:.3em;opacity:.8;margin-bottom:22px">GENERAL AUREK VASK · DEPOSED · STILL TALKING</div>
    ${credit('Sable Marrow', 'stuntman, retired from the ground')}${credit('Mira Castell', 'Undertow, who never raised her voice')}${credit('Dov Arrin', 'mechanic, keeper of one tank')}${credit('The Undertow', 'every village that hid a rope')}${credit('The Vask Colossus', '1999 – tonight')}
    <div style="margin-top:26px;font-weight:700;font-size:15px;letter-spacing:.25em;opacity:.9">${pct}% OF CORVANA LIBERATED · ${chaos} CHAOS · ${Math.floor(secs / 3600)}h ${String(Math.floor(secs / 60) % 60).padStart(2, '0')}m</div>
    <div style="margin-top:30px;font-weight:700;font-size:13px;letter-spacing:.4em;color:#f2b544;animation:sbpop 2s infinite alternate">CLICK OR PRESS F TO KEEP PLAYING — THE ISLAND IS YOURS</div>`;
  document.body.appendChild(d); requestAnimationFrame(() => { d.style.opacity = '1'; });
  try { document.exitPointerLock?.(); } catch (e) { /* */ }
  const prev = game.state; game.state = 'cutscene';
  const key = e => { if (['KeyF', 'Enter', 'Space', 'Escape'].includes(e.code)) { e.preventDefault(); close(); } };
  const close = () => { if (!endCard) return; removeEventListener('keydown', key, true); d.style.opacity = '0'; setTimeout(() => d.remove(), 1200); endCard = null;
    if (game.state === 'cutscene') game.state = prev === 'cutscene' ? 'play' : (prev || 'play');
    game.events.emit('endcard:closed', {});
    setTimeout(() => say([['vask', '(recording) …This broadcast will repeat until further notice. This broadcast will repeat until—'], ['dov', 'Somebody find the tape deck. I am begging.'], ['mira', 'The island\'s ours, Sable. Go enjoy it. Carefully. Or not.']]), 1500); };
  d.addEventListener('click', close); addEventListener('keydown', key, true);
  endCard = { el: d, close };
  game.events.emit('endcard:shown', {});
}
function debugJump(id, o = {}) {
  const i = STORY.findIndex(m => m.id === id); if (i < 0) return false;
  abort(true); lines = []; lineT = 0; endCard?.close?.();
  st.done = STORY.slice(0, i).map(m => m.id); st.ended = false; persist();
  if (o.teleport !== false) { const p = resolveLoc(STORY[i].start); game.teleport?.(p.x, p.z); }
  return start(id);
}
// charges: plant on any nearby mission prop with F (3 s fuse), and explosions damage props in radius
let charges = [];
function propTick(dt) {
  const pp = ppos();
  for (const pr of props) {
    if (!pr.plant || pr.dead || pr.charged) continue;
    if (pp.distanceTo ? pp.distanceTo(pr.obj.position) < 9 : d2(pp, pr.obj.position) < 9) {
      game.hud?.prompt?.(`Plant charge on ${pr.label}`, 'F');
      if (game.input.pressed('interact') && game.player?.state !== 'vehicle') { pr.charged = true; charges.push({ pr, t: 3 }); game.audio?.play?.('beep'); }
    }
  }
  for (let i = charges.length - 1; i >= 0; i--) { const c = charges[i]; c.t -= dt; if (Math.floor(c.t * 3) !== Math.floor((c.t + dt) * 3)) game.audio?.play?.('beep', { pos: c.pr.obj.position, pitch: 1 + (3 - c.t) * 0.3 }); if (c.t <= 0) { charges.splice(i, 1); killProp(c.pr); } }
  if (camBeat && game.camera) { game.camera.position.lerp(camBeat.pos, Math.min(1, dt * 2.5)); game.camera.lookAt(camBeat.look); }
}

// ---- Convoy Ambush: a repeatable world activity. A regime convoy runs between two bases; wreck every truck before
// it arrives. Only rolls while no mission/challenge is running. Shown on the minimap + world map (game.missions.convoy).
const CV = { trucks: [], cd: 75, n: 0, from: null, to: null, guards: false, t: 0 };
function convoyStart() {
  const bs = byDist(bases().filter(b => !siteFreed(b)), ppos()); if (bs.length < 2) return;
  const a = bs[CV.n % Math.min(3, bs.length)], b = byDist(bs.filter(x => x !== a), a.pos)[0]; if (!b) return;
  const path = pathBetween(a.pos, b.pos, 10, true); CV.n++;
  CV.trucks = [0, 1, 2].map(k => ({ mv: mover(k === 1 ? 'truck' : 'courier', path, 7, { hp: k === 1 ? 420 : 260, label: k === 1 ? 'convoy fuel truck' : 'convoy escort', chaos: 900, plant: true }), delay: k * 3 }));
  for (const t of CV.trucks) { t.mv.pr.keep = true; t.mv.pr.obj.visible = t.delay <= 0; }
  CV.from = a; CV.to = b; CV.guards = false; CV.t = 0;
  game.events.emit('activity:start', { id: 'convoy', name: 'Convoy Ambush', from: a.name, to: b.name });
  game.events.emit('toast', { text: `Regime convoy moving: ${a.name} → ${b.name}. Ambush it!` });
}
function convoyEnd(ok) {
  for (const t of CV.trucks) if (!t.mv.pr.dead) killProp(t.mv.pr, true);
  CV.trucks = []; CV.cd = ok ? 120 : 90;
  if (ok) { game.events.emit('chaos', { amount: 2500, reason: 'Convoy ambushed' }); try { game.combat?.addAmmo?.('all'); } catch (e) { /* optional */ } }
  game.events.emit('activity:end', { id: 'convoy', ok });
  game.events.emit('toast', { text: ok ? 'Convoy destroyed — ammo resupplied from the wreckage' : 'The convoy reached its base', kind: ok ? 'ok' : 'warn' });
}
function convoyTick(dt) {
  if (!CV.trucks.length) {
    if (game.state !== 'play' || run || game.progress?.activeChallenge || M.convoyEnabled === false) return;
    if ((CV.cd -= dt) <= 0) convoyStart();
    return;
  }
  CV.t += dt; let arrived = false, alive = 0;
  for (const t of CV.trucks) {
    if (t.mv.pr.dead) continue; alive++;
    if (t.delay > 0) { t.delay -= dt; if (t.delay <= 0) t.mv.pr.obj.visible = true; continue; }
    if (t.mv.step(dt)) arrived = true;
  }
  const lead = convoyPos();
  if (!CV.guards && lead && d2(ppos(), lead) < 140) { CV.guards = true; spawnWave(lead, 3); }
  if (!alive) convoyEnd(true); else if (arrived || CV.t > 600) convoyEnd(false);
}
function convoyPos() { const t = CV.trucks.find(t => !t.mv.pr.dead && t.delay <= 0) || CV.trucks.find(t => !t.mv.pr.dead); return t ? t.mv.at() : null; }

export default {
  name: 'missions',
  init(g) {
    game = g; THREE = g.THREE;
    const sv = g.save?.get?.('missions'); if (sv) st = { done: sv.done || [], sideCount: sv.sideCount || 0, ended: !!sv.ended || (sv.done || []).includes('m12') };
    if (st.ended) for (const m of STORY) if (!st.done.includes(m.id)) st.done.push(m.id); // finished campaigns stay finished when new missions are inserted
    M = g.missions = { active: null, chainDelay: 4000, next: () => { const nx = STORY.find(m => !st.done.includes(m.id)); return nx ? nx.id : null; }, get list() { return list(); }, start, abort, skip: () => { if (!run) return; lines = []; lineT = 0; next(); }, CAST, STORY,
      get objectiveWaypoint() { const w = run?.obj?.waypoint?.(); if (w) return w; const c = g.progress?.activeChallenge; if (c?.waypoint) return c.waypoint; if (!run) { const cp = CV.trucks.length && convoyPos(); if (cp && d2(ppos(), cp) < 800) return cp; const m = markers[0]; return m ? m.pos : null; } return null; },
      get convoy() { if (!CV.trucks.length) return null; const p = convoyPos(); return p && { pos: { x: p.x, z: p.z }, alive: CV.trucks.filter(t => !t.mv.pr.dead).length, total: CV.trucks.length, from: CV.from?.name, to: CV.to?.name }; },
      startConvoy: () => { if (CV.trucks.length) return false; convoyStart(); return CV.trucks.length > 0; },
      get objectiveText() { return fill(run?.obj?.text || ''); }, get objectiveProgress() { return run?.obj?.progress || ''; }, get title() { return run?.def.title || ''; }, get step() { const s = run?.steps[run.i]; return s ? { do: s.do, i: run.i, n: run.steps.length, travel: !!s.travel, inner: s.step?.do } : null; }, get flags() { return run?.flags || null; }, get completed() { return st.done; }, get ended() { return st.ended; }, say, debugJump, BROADCASTS,
      fill, resolveLoc, get endCard() { return endCard ? { shown: true } : null; }, showEndCard, closeEndCard: () => endCard?.close?.() };
    g.events.on('explosion', d => { if (!d?.pos || d.combat) return; // combat.explode already damaged props through their colliders
      const r = (d.radius || 6) + 3; for (const pr of [...props]) if (pr.plant !== false && pr.obj.position.distanceTo(d.pos) < r + 3) damageProp(pr, 200); });
    g.events.on('destructible:destroyed', d => { const pr = d?.obj?.userData?.missionProp; if (pr && !pr.dead) { pr.dead = true; props.delete(pr); pr.onDeath?.(pr); } });
    // Death fails the mission that was running WHEN Sable died (never a later one the chain started meanwhile),
    // and never while she is still only travelling to the mission area (she hasn't engaged it yet).
    g.events.on('player:died', () => {
      const r = run; if (!r) return;
      if (!r.side && r.def.finale) return;
      if (r.steps[r.i]?.travel) return;
      setTimeout(() => { if (run === r) fail('You died', { retry: !r.side }); }, 1200);
    });
    g.events.on('save:reset', () => { st = { done: [], sideCount: 0, ended: false }; endCard?.close?.(); abort(true); refreshMarkers(); });
    g.events.on('ready', refreshMarkers);
    // Continue: resume the story where it stopped (an in-progress mission restarts from its first step)
    g.events.on('game:started', d => { if (d?.fresh || !st.done.length) return; setTimeout(() => { const nx = STORY.find(m => !st.done.includes(m.id)); if (nx && !run && g.state !== 'title') start(nx.id, { travel: true }); }, 3000); });
    g.events.on('game:started', () => { if (!st.done.length && !run) setTimeout(() => { if (!run && !st.done.length) say([['mira', 'Sable, it\'s Mira. Follow the golden beacon — the Undertow needs you.']]); }, 4000); });
  },
  update(dt, g) {
    dialogueTick(dt); syncProps(); try { convoyTick(dt); } catch (e) { console.warn('[missions] convoy', e); CV.trucks = []; CV.cd = 120; }
    if (!run) {
      if (g.state !== 'play') return;
      const m = markers[0]; const pp = ppos();
      if (m && d2(pp, m.pos) < 25) { const def = STORY.find(s => s.id === m.id); g.hud?.prompt?.(`Start mission: ${def.title}`, 'F'); if (g.input.pressed('interact') && g.player?.state !== 'vehicle') start(m.id); }
      propTick(dt); return;
    }
    if (g.state === 'play' || g.state === 'cutscene') {
      let r = null; try { r = run.obj.update(dt); } catch (e) { console.warn('[missions] objective error; skipping', e); r = 'done'; }
      if (r === 'done') next(); else if (r === 'fail') fail(run.obj?.reason || 'Objective failed');
    }
    propTick(dt);
  },
};
