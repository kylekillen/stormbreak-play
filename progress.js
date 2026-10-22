// STORMBREAK progress: liberation meta-game, chaos, rebel rank, gear mods, supply drops, challenges.
// game.progress = { liberatedSites:Set, chaos, rank, rankName, mods, sites, unlock(id), isLiberated(id),
//   regionStats(), supplyDrop(type,pos), challenges, activeChallenge, beacon(pos,color), sitePos(site), siteOf(id) }
let game, THREE, P;
const RANKS = [[0, 'Recruit'], [4000, 'Saboteur'], [15000, 'Insurgent'], [40000, 'Firebrand'], [90000, 'Stormcaller'], [180000, 'Liberator'], [320000, 'Legend of the Undertow']];
// Gear mods. req: liberations count | challenge medals | rank index. apply() runs defensively every second.
const MODS = [
  { id: 'tether4', name: 'Braided Line', desc: 'Tethers 3 → 4', req: { lib: 1 }, apply: g => setMax(g, 4) },
  { id: 'tether5', name: 'Twin Spool', desc: 'Tethers 4 → 5', req: { lib: 4, after: 'tether4' }, apply: g => setMax(g, 5) },
  { id: 'tether6', name: 'Storm Spool', desc: 'Tethers 5 → 6', req: { lib: 9, after: 'tether5' }, apply: g => setMax(g, 6) },
  { id: 'reel1', name: 'Geared Winch', desc: 'Reel strength +50%', req: { medals: 2 }, apply: g => setF(g.grapple, 'reelStrength', 1.5) },
  { id: 'reel2', name: 'Torque Winch', desc: 'Reel strength +120%', req: { medals: 6, after: 'reel1' }, apply: g => setF(g.grapple, 'reelStrength', 2.2) },
  { id: 'boost1', name: 'Ram-Air Vents', desc: 'Wingsuit boost +30%', req: { medals: 1 }, apply: g => setF(g.player, 'wingsuitBoost', 1.3) },
  { id: 'boost2', name: 'Thruster Wings', desc: 'Wingsuit boost +70%', req: { medals: 5, after: 'boost1' }, apply: g => setF(g.player, 'wingsuitBoost', 1.7) },
  { id: 'chute', name: 'Chute Thrusters', desc: 'Parachute forward thrust', req: { lib: 3 }, apply: g => { setF(g.player, 'parachuteThrust', 1); } },
  { id: 'boom1', name: 'Satchel Rig', desc: 'Explosive capacity +2', req: { rank: 2 }, apply: g => setF(g.combat, 'explosiveCapacity', 6, 'add') },
  { id: 'boom2', name: 'Demolition Vest', desc: 'Explosive capacity +4', req: { rank: 4, after: 'boom1' }, apply: g => setF(g.combat, 'explosiveCapacity', 8, 'add') },
  { id: 'hp1', name: 'Kevlar Weave', desc: 'Max health +25%', req: { lib: 2 }, apply: g => setHealth(g, 1.25) },
  { id: 'hp2', name: 'Undertow Plating', desc: 'Max health +60%', req: { lib: 7, after: 'hp1' }, apply: g => setHealth(g, 1.6) },
  { id: 'drop_tank', name: 'Heavy Drop', desc: 'Supply drop: tank (Alt+B)', req: { rank: 3 } },
  { id: 'drop_heli', name: 'Air Drop', desc: 'Supply drop: attack heli (Shift+B)', req: { rank: 5 } },
];
function setMax(g, n) { if (g.grapple && (g.grapple.maxTethers ?? 0) < n) g.grapple.maxTethers = n; }
function setF(o, k, v) { if (o && (o[k] ?? 0) < v) o[k] = v; }
function setHealth(g, m) {
  const p = g.player; if (!p) return;
  if (!p._baseMaxHealth) p._baseMaxHealth = p.maxHealth || 100;
  const want = p._baseMaxHealth * m;
  if ((p.maxHealth || 0) < want) { const r = (p.health ?? want) / (p.maxHealth || p._baseMaxHealth); p.maxHealth = want; if (p.health != null) p.health = Math.min(want, r * want); }
}

const st = { lib: new Set(), chaos: 0, mods: new Set(), medals: {}, unlockedSeen: new Set(), regionsDone: new Set(), destroyedAt: {} };
let rng;
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- sites & regions (defensive over world's shapes) ----------
function posOf(o) {
  if (!o) return null;
  const p = o.pos || o.position || o.center || o.centre || o.origin || (o.x != null ? o : null);
  if (Array.isArray(p)) return { x: p[0], z: p.length > 2 ? p[2] : p[1] };
  if (p && p.x != null) return { x: p.x, z: p.z ?? p.y ?? 0 };
  return null;
}
let sites = [];
function buildSites() {
  const w = game.world || {};
  sites = [];
  (w.bases || []).forEach((b, i) => { const p = posOf(b); if (p) sites.push({ id: 'base:' + (b.id ?? i), rawId: b.id ?? i, kind: 'base', name: b.name || `Base ${i + 1}`, pos: p, src: b, region: null, radius: b.radius || 120, height: w.heightAt?.(p.x, p.z) ?? 0 }); });
  (w.settlements || []).forEach((s, i) => { if (s.military) return; /* world.settlements includes bases */ const p = posOf(s); if (p) sites.push({ id: 'set:' + (s.id ?? i), rawId: s.id ?? i, kind: 'settlement', name: s.name || `Village ${i + 1}`, pos: p, src: s, region: null, radius: s.radius || 90 }); });
  const regs = w.regions || [];
  for (const s of sites) {
    let r = s.src.region ?? s.src.regionId ?? s.src.province;
    if (r && typeof r === 'object') r = r.id ?? regs.indexOf(r);
    if (r == null && regs.length) {
      let best = Infinity;
      regs.forEach((rg, i) => { if (rg.contains?.(s.pos.x, s.pos.z)) { r = rg.id ?? i; best = -1; } else if (best >= 0) { const c = posOf(rg); if (c) { const d = (c.x - s.pos.x) ** 2 + (c.z - s.pos.z) ** 2; if (d < best) { best = d; r = rg.id ?? i; } } } });
    }
    s.region = r ?? 'corvana';
  }
}
function islandPct() { return sites.length ? sites.filter(s => st.lib.has(s.id)).length / sites.length : 0; }
function regionList() {
  const regs = game.world?.regions || [];
  const out = regs.map((r, i) => ({ id: r.id ?? i, name: r.name || `Province ${i + 1}`, center: posOf(r), src: r }));
  if (!out.length) out.push({ id: 'corvana', name: 'Corvana', center: { x: 0, z: 0 } });
  for (const r of out) {
    const ss = sites.filter(s => s.region === r.id);
    r.total = ss.length; r.done = ss.filter(s => st.lib.has(s.id)).length; r.pct = r.total ? r.done / r.total : 0; r.liberated = st.regionsDone.has(String(r.id));
    if (!r.center && ss.length) r.center = { x: ss.reduce((a, s) => a + s.pos.x, 0) / ss.length, z: ss.reduce((a, s) => a + s.pos.z, 0) / ss.length };
  }
  return out;
}
function liberate(siteId, silent) {
  if (st.lib.has(siteId)) return;
  st.lib.add(siteId);
  const s = sites.find(x => x.id === siteId);
  if (s) { s.src.liberated = true; s.src.owner = 'rebel'; }
  addChaos(s?.kind === 'base' ? 2500 : 1200, s?.pos, s?.kind === 'base' ? 'Base liberated' : 'Settlement liberated', true);
  // reward + progress line: every liberation pays out and tells you how far Corvana has come
  if (!silent) {
    const reg = s && regionList().find(r => r.id === s.region), pct = islandPct();
    let reward;
    if (s?.kind === 'base') { try { game.combat?.addAmmo?.('all'); } catch (e) { /* optional */ } dropCd = 0; reward = 'ammo + explosives refilled, supply drop ready'; }
    else { const p = game.player; if (p?.maxHealth) { p.health = p.maxHealth; if (p.maxArmor) p.armor = p.maxArmor; } reward = 'villagers patch you up — health restored'; }
    const line = `${s?.name || 'Site'} liberated · +${s?.kind === 'base' ? '2,500' : '1,200'} chaos · ${reward} · Corvana ${Math.round(pct * 100)}% free${reg ? ` · ${reg.name} ${reg.done}/${reg.total}` : ''}`;
    game.events.emit('toast', { text: line, kind: 'ok' });
    game.events.emit('liberation:progress', { id: siteId, pct, region: reg && { id: reg.id, name: reg.name, done: reg.done, total: reg.total }, text: line });
  }
  if (s) {
    const r = regionList().find(r => r.id === s.region);
    if (r && r.total && r.done >= r.total && !st.regionsDone.has(String(r.id))) {
      st.regionsDone.add(String(r.id));
      setTimeout(() => game.events.emit('region:liberated', { id: r.id, name: r.name }), 2500);
    }
  }
  checkUnlocks(); persist();
}

// ---------- chaos ----------
const pendingChaos = [];
let lastChaosEvt = [];
function addChaos(amount, pos, reason, emit) {
  amount = Math.round(amount || 0); if (!amount) return;
  if (emit) { game.events.emit('chaos', { amount, pos, reason, _p: 1 }); return; }
  st.chaos += amount; checkRank();
}
let rankIdx = 0;
function checkRank() {
  let r = 0; for (let i = 0; i < RANKS.length; i++) if (st.chaos + st.lib.size * 1500 >= RANKS[i][0]) r = i;
  if (r > rankIdx) { rankIdx = r; game.events.emit('rank:up', { rank: r, name: RANKS[r][1] }); game.audio?.play?.('rank_up'); checkUnlocks(); persist(); }
}
function medalCount() { return Object.values(st.medals).reduce((a, m) => a + m, 0); }
function checkUnlocks() {
  for (const m of MODS) {
    if (st.mods.has(m.id)) continue;
    const q = m.req; if (q.after && !st.mods.has(q.after)) continue;
    if ((q.lib == null || st.lib.size >= q.lib) && (q.medals == null || medalCount() >= q.medals) && (q.rank == null || rankIdx >= q.rank)) unlock(m.id);
  }
}
function unlock(id) {
  if (st.mods.has(id)) return false;
  const m = MODS.find(x => x.id === id); if (!m) return false;
  st.mods.add(id); applyMods();
  game.events.emit('mod:unlocked', { id, name: m.name, desc: m.desc });
  persist(); return true;
}
function applyMods() { for (const m of MODS) if (st.mods.has(m.id) && m.apply) { try { m.apply(game); } catch (e) { /* module absent */ } } }

function persist() {
  let destroyed; try { destroyed = game.world?.destroyedIds?.(); } catch (e) { /* optional */ }
  game.save?.set?.('progress', { lib: [...st.lib], chaos: st.chaos, mods: [...st.mods], medals: st.medals, regionsDone: [...st.regionsDone], destroyed: destroyed || st.destroyed || [] });
}
function restore() {
  const d = game.save?.get?.('progress'); if (!d) return;
  st.lib = new Set(d.lib || []); st.chaos = d.chaos || 0; st.mods = new Set(d.mods || []); st.medals = d.medals || {}; st.regionsDone = new Set(d.regionsDone || []);
  st.destroyed = d.destroyed || [];
  for (let i = 0; i < RANKS.length; i++) if (st.chaos + st.lib.size * 1500 >= RANKS[i][0]) rankIdx = i;
}

// push saved state back into the world (silent: no fx/events): wrecks, rebel flags, no garrison.
// Runs on Continue (game:started {fresh:false}), not at init, so New Game never inherits a stale world.
function applyToWorld() {
  const w = game.world;
  try { for (const id of st.destroyed || []) w?.destroyById?.(id, true); } catch (e) { console.warn('[progress] restore wrecks', e); }
  for (const s of sites) if (st.lib.has(s.id)) {
    try { if (!s.src.liberated && w?.setLiberated) w.setLiberated(s.rawId, true); } catch (e) { console.warn('[progress] restore liberation', e); }
    s.src.liberated = true; s.src.owner = 'rebel';
  }
}

// ---------- world beacons (light pillars for mission/challenge starts) ----------
let beaconGeo, beacons = new Set();
function beacon(pos, color = 0xffb340, h = 260) {
  if (!game.scene) return { remove() {}, set() {} };
  beaconGeo ||= new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { c: { value: new THREE.Color(color) }, t: { value: 0 }, a: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform vec3 c; uniform float t; uniform float a; varying vec2 vUv; void main(){ float f=pow(1.-vUv.y,2.2)*(0.55+0.45*sin(vUv.y*40.-t*4.)); gl_FragColor=vec4(c*1.6,f*0.6*a); }',
  });
  const m = new THREE.Mesh(beaconGeo, mat);
  const y = game.world?.heightAt?.(pos.x, pos.z) ?? 0;
  m.position.set(pos.x, y + h / 2 - 2, pos.z); m.scale.set(2.2, h, 2.2); m.frustumCulled = true; m.renderOrder = 5;
  game.scene.add(m);
  const b = { mesh: m, remove() { game.scene.remove(m); mat.dispose(); beacons.delete(b); }, set(o) { if (o.color != null) mat.uniforms.c.value.set(o.color); if (o.alpha != null) mat.uniforms.a.value = o.alpha; } };
  beacons.add(b); return b;
}

// ---------- supply drop ----------
let dropCd = 0, drops = [];
function supplyDrop(type, at) {
  if (dropCd > 0) { game.events.emit('toast', { text: `Supply drop ready in ${Math.ceil(dropCd)}s`, kind: 'warn' }); return false; }
  const allowed = ['jeep', 'car', 'boat', 'jetski', 'heli', 'truck'];
  if (st.mods.has('drop_tank')) allowed.push('tank'); if (st.mods.has('drop_heli')) allowed.push('attackHeli');
  type = allowed.includes(type) ? type : 'jeep';
  const pl = game.player?.pos || game.camera.position;
  let p = at;
  if (!p) { const d = new THREE.Vector3(); game.camera.getWorldDirection(d); d.y = 0; d.normalize(); p = { x: pl.x + d.x * 18, z: pl.z + d.z * 18 }; }
  if (game.world?.isWater?.(p.x, p.z) && !['boat', 'jetski'].includes(type)) type = 'boat';
  const gy = game.world?.heightAt?.(p.x, p.z) ?? 0;
  const crate = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 4.5), new THREE.MeshStandardMaterial({ color: 0x4b5a3a, roughness: 0.8 }));
  const chute = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), new THREE.MeshStandardMaterial({ color: 0xe8452c, side: THREE.DoubleSide, roughness: 0.9 }));
  chute.position.y = 9; crate.add(box, chute); box.castShadow = true;
  crate.position.set(p.x, Math.max(gy, 0) + 140, p.z); game.scene.add(crate);
  const flare = beacon({ x: p.x, z: p.z }, 0xff3b2a, 60);
  drops.push({ crate, flare, type, gy: Math.max(gy, game.world?.isWater?.(p.x, p.z) ? 0 : gy), p });
  dropCd = 75; game.audio?.play?.('radio'); game.events.emit('dialogue', { speaker: 'Dov Arrin', text: `${type === 'attackHeli' ? 'Gunship' : type[0].toUpperCase() + type.slice(1)} inbound. Mind your head.`, dur: 3 });
  game.events.emit('supply:called', { type, pos: p });
  return true;
}
function dropsTick(dt) {
  dropCd = Math.max(0, dropCd - dt);
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i]; d.crate.position.y -= dt * 14; d.crate.rotation.y += dt * 0.3;
    if (d.crate.position.y <= d.gy + 1) {
      game.scene.remove(d.crate); d.flare.remove(); drops.splice(i, 1);
      game.fx?.smoke?.(new THREE.Vector3(d.p.x, d.gy + 1, d.p.z)); game.audio?.play?.('thud', { pos: { x: d.p.x, y: d.gy, z: d.p.z } });
      try { game.vehicles?.spawn?.(d.type, new THREE.Vector3(d.p.x, d.gy + 2, d.p.z), 0); } catch (e) { console.warn('[progress] supply spawn failed', e); }
    }
  }
}

// ---------- challenges ----------
const challenges = [];
let active = null, ringGeo, ringMat;
function genChallenges() {
  const w = game.world; if (!w?.heightAt) return;
  const half = (w.size || 8000) / 2 * 0.85;
  const peaks = [];
  for (let i = 0; i < 1600; i++) { const x = (rng() * 2 - 1) * half, z = (rng() * 2 - 1) * half, h = w.heightAt(x, z); if (h > 150) peaks.push({ x, z, h }); }
  peaks.sort((a, b) => b.h - a.h);
  const used = [];
  const far = (p, d) => used.every(u => (u.x - p.x) ** 2 + (u.z - p.z) ** 2 > d * d);
  let n = 0;
  for (const pk of peaks) { // wingsuit ring courses dive from peaks toward the sea
    if (n >= 5) break; if (!far(pk, 900)) continue; used.push(pk);
    const dir = Math.atan2(-pk.z, -pk.x) + (rng() - 0.5) * 1.2, rings = [];
    let x = pk.x, z = pk.z, y = pk.h + 10;
    for (let k = 0; k < 10; k++) {
      const step = 110 + rng() * 40, a = dir + Math.sin(k * 0.9 + n) * 0.5;
      x += Math.cos(a) * step; z += Math.sin(a) * step; y -= 14 + rng() * 10;
      const g = w.heightAt(x, z); y = Math.max(y, g + 25, 25); rings.push({ x, y, z });
    }
    challenges.push({ id: `wing${n}`, type: 'wingsuit', name: `Skyline Run ${'ABCDE'[n]}`, start: { x: pk.x, z: pk.z, y: pk.h }, rings, medals: [70, 52, 40], desc: 'Wingsuit through every ring' });
    n++;
  }
  (w.bases || []).slice(0, 6).forEach((b, i) => { // destruction frenzies near bases
    const p = posOf(b); if (!p) return;
    const sp = { x: p.x + 160, z: p.z + 40 };
    challenges.push({ id: `frenzy${i}`, type: 'frenzy', name: `Demolition Frenzy ${i + 1}`, start: sp, target: p, medals: [6000, 10000, 16000], time: 90, desc: 'Cause as much chaos as you can in 90 s' });
  });
  for (let i = 0, made = 0; i < 400 && made < 5; i++) { // land races over drivable ground
    const sx = (rng() * 2 - 1) * half * 0.8, sz = (rng() * 2 - 1) * half * 0.8;
    if (w.isWater?.(sx, sz) || w.heightAt(sx, sz) > 220) continue;
    const cps = []; let x = sx, z = sz, a = rng() * 6.28, ok = true;
    for (let k = 0; k < 8; k++) {
      let tries = 0, nx, nz;
      do { a += (rng() - 0.5) * 1.4; nx = x + Math.cos(a) * 170; nz = z + Math.sin(a) * 170; tries++; } while ((w.isWater?.(nx, nz) || Math.abs(w.heightAt(nx, nz) - w.heightAt(x, z)) > 45) && tries < 12);
      if (tries >= 12) { ok = false; break; } x = nx; z = nz; cps.push({ x, z, y: w.heightAt(x, z) });
    }
    if (!ok || !far({ x: sx, z: sz }, 600)) continue; used.push({ x: sx, z: sz });
    challenges.push({ id: `race${made}`, type: 'race', name: `Back-Road Sprint ${made + 1}`, start: { x: sx, z: sz }, cps, medals: [95, 75, 60], desc: 'Drive through every checkpoint (vehicle required)' });
    made++;
  }
  for (const c of challenges) c.beacon = beacon(c.start, c.type === 'wingsuit' ? 0x66d9ff : c.type === 'race' ? 0xb6ff5a : 0xff6b2a, 180);
}
function startChallenge(c) {
  if (active || game.missions?.active) return;
  active = { c, t: 0, idx: 0, chaos0: st.chaos, objs: [] };
  ringGeo ||= new THREE.TorusGeometry(9, 0.7, 8, 32); ringMat ||= new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.85 });
  const pts = c.type === 'wingsuit' ? c.rings : c.type === 'race' ? c.cps : [];
  for (const p of pts) {
    const m = new THREE.Mesh(ringGeo, ringMat.clone());
    m.position.set(p.x, c.type === 'race' ? p.y + 6 : p.y, p.z); game.scene.add(m); active.objs.push(m);
  }
  pts.forEach((p, i) => { const nx = pts[i + 1] || p; active.objs[i].lookAt(nx.x, active.objs[i].position.y, nx.z); });
  if (c.type === 'wingsuit') game.teleport?.(c.start.x, c.start.z);
  game.events.emit('challenge:start', { id: c.id, name: c.name, desc: c.desc });
  game.audio?.play?.('mission_start');
}
function endChallenge(ok, score) {
  const c = active.c; for (const o of active.objs) game.scene.remove(o);
  let medal = 0;
  if (ok) { const m = c.medals; medal = c.type === 'frenzy' ? (score >= m[2] ? 3 : score >= m[1] ? 2 : score >= m[0] ? 1 : 0) : (score <= m[2] ? 3 : score <= m[1] ? 2 : score <= m[0] ? 1 : 0); }
  const prev = st.medals[c.id] || 0; if (medal > prev) st.medals[c.id] = medal;
  game.events.emit('challenge:end', { id: c.id, name: c.name, ok, medal, score, best: Math.max(prev, medal) });
  game.audio?.play?.(ok && medal ? 'mission_complete' : 'mission_fail');
  if (medal > prev) addChaos((medal - prev) * 1500, null, `${c.name} — ${['', 'Bronze', 'Silver', 'Gold'][medal]}`, true);
  active = null; checkUnlocks(); persist();
}
function challengeTick(dt) {
  const pp = game.player?.pos; if (!pp) return;
  if (!active) {
    if (game.state !== 'play') return;
    for (const c of challenges) {
      const d = Math.hypot(pp.x - c.start.x, pp.z - c.start.z);
      c.beacon.set({ alpha: d < 60 ? 0.35 : 1 });
      if (d < 14 && !game.missions?.active) {
        game.hud?.prompt?.(`Start ${c.name}${st.medals[c.id] ? ' ' + '★'.repeat(st.medals[c.id]) : ''}`, 'F');
        if (game.input.pressed('interact') && game.player.state !== 'vehicle' || (c.type === 'race' && game.player.state === 'vehicle' && game.input.pressed('interact'))) startChallenge(c);
      }
    }
    return;
  }
  const a = active, c = a.c; a.t += dt;
  if (c.type === 'frenzy') {
    const sc = st.chaos - a.chaos0; a.score = sc;
    a.status = `${Math.max(0, c.time - a.t).toFixed(1)}s · ${sc.toLocaleString()} chaos`;
    if (a.t >= c.time) endChallenge(true, sc);
    if (Math.hypot(pp.x - c.target.x, pp.z - c.target.z) > 1200) endChallenge(false, 0);
    return;
  }
  const pts = c.type === 'wingsuit' ? c.rings : c.cps, tgt = a.objs[a.idx];
  a.status = `${a.t.toFixed(1)}s · ${a.idx}/${pts.length}`;
  a.waypoint = tgt?.position;
  a.objs.forEach((o, i) => { o.visible = i >= a.idx && i < a.idx + 3; o.material.opacity = i === a.idx ? 0.95 : 0.35; o.rotation.z += dt * (i === a.idx ? 1 : 0.2); });
  if (tgt && pp.distanceTo ? pp.distanceTo(tgt.position) < (c.type === 'race' ? 14 : 11) : Math.hypot(pp.x - tgt.position.x, pp.y - tgt.position.y, pp.z - tgt.position.z) < 11) {
    if (c.type === 'race' && game.player.state !== 'vehicle') { game.hud?.prompt?.('Vehicle required'); }
    else { a.idx++; game.audio?.play?.('objective', { volume: 0.6 }); if (a.idx >= pts.length) return endChallenge(true, a.t); }
  }
  const failW = c.type === 'wingsuit' && a.t > 3 && ['ground', 'swim', 'dead'].includes(game.player.state);
  if (failW || a.t > c.medals[0] * 2.5 || game.player.state === 'dead') endChallenge(false, 0);
}

// ---------- fallback liberation: if nobody emits base/settlement liberated, infer it ----------
function onDestroyed(d) {
  const pos = d?.pos; let site = null;
  if (d?.baseId != null) site = sites.find(s => s.kind === 'base' && String(s.rawId) === String(d.baseId));
  if (!site && pos) site = sites.find(s => Math.hypot(s.pos.x - pos.x, s.pos.z - pos.z) < s.radius);
  if (!site) return;
  persist();
  if (typeof site.src.remaining === 'number') return; // world-managed site: settlements.js emits the liberation itself
  const k = site.id; st.destroyedAt[k] = (st.destroyedAt[k] || 0) + 1;
  const need = site.src.destructibleCount ?? site.src.targets?.length ?? site.src.destructibles?.length ?? (site.kind === 'base' ? 0 : 6);
  if (need && st.destroyedAt[k] >= need && !st.lib.has(k)) setTimeout(() => {
    if (st.lib.has(k)) return;
    game.events.emit(site.kind === 'base' ? 'base:liberated' : 'settlement:liberated', site.kind === 'base' ? { baseId: site.rawId, _p: 1 } : { id: site.rawId, _p: 1 });
  }, 1500);
}

export default {
  name: 'progress',
  init(g) {
    game = g; THREE = g.THREE; rng = mulberry((g.seed || 1337) * 7 + 3);
    buildSites(); restore();
    P = g.progress = {
      get liberatedSites() { return st.lib; }, get chaos() { return st.chaos; }, get rank() { return rankIdx; }, get rankName() { return RANKS[rankIdx][1]; },
      get nextRank() { return RANKS[rankIdx + 1] || null; }, get mods() { return st.mods; }, get medals() { return st.medals; },
      MODS, RANKS, get sites() { return sites; }, regionStats: regionList, unlock, liberate, isLiberated: id => st.lib.has(id) || st.lib.has('base:' + id) || st.lib.has('set:' + id),
      siteOf: (kind, id) => sites.find(s => s.kind === kind && String(s.rawId) === String(id)), sitePos: posOf,
      addChaos: (a, pos, reason) => addChaos(a, pos, reason, true), supplyDrop, applyToWorld, get supplyCooldown() { return dropCd; },
      get islandPct() { return islandPct(); }, challenges, get activeChallenge() { return active; }, startChallenge, beacon, refreshSites: () => { buildSites(); restore(); },
    };
    const E = g.events;
    E.on('chaos', d => { const amt = +d?.amount || 0; if (!d?._p) lastChaosEvt.push({ t: g.simTime, pos: d?.pos }); addChaos(amt, d?.pos, d?.reason, false); });
    E.on('destructible:destroyed', d => { if (d?.chaos) pendingChaos.push({ t: g.simTime, amount: d.chaos, pos: d.pos, reason: d.kind || 'Regime property' }); onDestroyed(d); });
    E.on('enemy:killed', d => pendingChaos.push({ t: g.simTime, amount: 100, pos: d?.pos, reason: 'Soldier down' }));
    E.on('base:liberated', d => { const s = P.siteOf('base', d?.baseId); liberate(s ? s.id : 'base:' + d?.baseId); });
    E.on('settlement:liberated', d => { const s = P.siteOf('settlement', d?.id); liberate(s ? s.id : 'set:' + d?.id); });
    E.on('mission:complete', () => checkUnlocks());
    E.on('game:started', d => { if (!d?.fresh) applyToWorld(); });
    E.on('save:reset', () => { st.lib.clear(); st.chaos = 0; st.mods.clear(); st.medals = {}; st.regionsDone.clear(); st.destroyed = []; rankIdx = 0; for (const s of sites) { s.src.liberated = false; s.src.owner = 'regime'; } });
    // B jeep · Shift+B heli (gunship once Air Drop is unlocked) · Alt+B tank once Heavy Drop is unlocked
    addEventListener('keydown', e => { if (e.code === 'KeyB' && g.state === 'play' && !g.paused) supplyDrop(e.altKey ? (st.mods.has('drop_tank') ? 'tank' : 'jeep') : e.shiftKey ? (st.mods.has('drop_heli') ? 'attackHeli' : 'heli') : 'jeep'); });
    // world may finish populating sites late: retry once things are ready
    E.on('ready', () => { if (!sites.length) { buildSites(); restore(); } genChallenges(); applyMods(); });
  },
  update(dt, g) {
    // chaos dedupe: destructible/kill chaos only counts if no explicit 'chaos' event covered it
    if (pendingChaos.length) {
      for (let i = pendingChaos.length - 1; i >= 0; i--) {
        const p = pendingChaos[i]; if (g.simTime - p.t < 0.15) continue;
        const covered = lastChaosEvt.some(c => Math.abs(c.t - p.t) < 0.2 && (!c.pos || !p.pos || Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z) < 8));
        if (!covered) addChaos(p.amount, p.pos, p.reason, true);
        pendingChaos.splice(i, 1);
      }
      lastChaosEvt = lastChaosEvt.filter(c => g.simTime - c.t < 1);
    }
    if ((this._m = (this._m || 0) + dt) > 1) { this._m = 0; applyMods(); if (g.state !== 'title' && ((this._ps = (this._ps || 0) + 1) % 5 === 0)) persist(); }
    for (const b of beacons) b.mesh.material.uniforms.t.value = g.simTime;
    dropsTick(dt);
    if (g.state === 'play' || active) challengeTick(dt);
  },
};
