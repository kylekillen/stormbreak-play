// STORMBREAK enemies: Vask regime soldiers + town police, behaviour FSM, heat & reinforcements.
//
// game.enemies:
//   list (active), heat (0..5 float), level (int), spawn(type, pos, opts) -> enemy, damage(e, amt, src, info),
//   blast(pos, reach, power, owner) -> kills, alert(pos, radius), clear(), stats()
// enemy: { isEnemy, type, pos, vel, hp, maxHp, state, dead, obj, body, collider, applyImpulse(vec), baseId }
//   types: rifleman, heavy (rockets), sniper (glint before firing), officer (buffs + calls reinforcements), police
// Events: 'heat' {level}, 'enemy:killed' {enemy, pos, type, by, head}, 'chaos' {amount, pos, reason:'kill'}
// Kinematic Rapier capsules are registered in game.world.colliderOwner (handle -> enemy) so grapple/tether
// can find them; call enemy.applyImpulse(vec) to fling one (they tumble, take landing damage, get up).

let T, game;
const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const R = (a, b) => a + Math.random() * (b - a);
const rs = () => Math.random() * 2 - 1;

const TYPES = {
  rifleman: { hp: 100, speed: 4.6, range: 85, rof: 0.11, burst: [3, 6], dmg: 7, acc: 0.85, color: 0x3d4228, weight: 6 },
  heavy:    { hp: 220, speed: 3.6, range: 140, rof: 4.5, burst: [1, 1], dmg: 0, acc: 0.8, color: 0x2e3220, weight: 2, rocket: true },
  sniper:   { hp: 80, speed: 4.2, range: 320, rof: 3.4, burst: [1, 1], dmg: 38, acc: 0.95, color: 0x464a30, weight: 1.2, sniper: true },
  officer:  { hp: 150, speed: 4.4, range: 60, rof: 0.35, burst: [2, 3], dmg: 9, acc: 0.8, color: 0x2a2c22, weight: 0.8, officer: true },
  police:   { hp: 70, speed: 4.8, range: 50, rof: 0.45, burst: [2, 3], dmg: 6, acc: 0.65, color: 0x2b3448, weight: 0, police: true },
};
const MAX_ACTIVE = 40, SPAWN_R = 300, DESPAWN_R = 460;

const list = [];
const heat = { value: 0, level: 0, lastSeen: -99, reinfT: 0, vehicles: [] };
const baseState = new Map();   // baseId -> {spawned:[], respawnT}
const townState = new Map();
let mats = null;

// ---------------------------------------------------------------- helpers
function groundY(x, z) { const h = game.world?.heightAt?.(x, z); return Number.isFinite(h) ? h : 0; }
function P3(p) { return p?.isVector3 ? p.clone() : V(p?.x || 0, p?.y ?? 0, p?.z || 0); }
function playerTarget() {
  const p = game.player; if (!p?.pos || p.state === 'dead') return null;
  if (p.state === 'vehicle' && p.vehicle) return { obj: p.vehicle, pos: (p.vehicle.pos || p.vehicle.obj?.position || p.pos).clone().add(V(0, 1, 0)), veh: true };
  return { obj: p, pos: p.pos.clone().add(V(0, 1.2, 0)), veh: false };
}
// world sites carry x/z directly (settlements.js); older stubs used pos/center/position
function siteCenter(s) {
  const p = s.pos || s.center || s.position; if (p) return P3(p);
  return Number.isFinite(s.x) && Number.isFinite(s.z) ? V(s.x, 0, s.z) : null;
}
function owners() {
  if (!game.world) return null;
  return game.world.colliderOwner ||= new Map();
}
function los(from, to, self) {
  const dir = to.clone().sub(from), d = dir.length(); dir.divideScalar(d);
  const hit = game.combat?.raycast?.(from, dir, d - 0.6, (o) => o?.isEnemy || o === game.player?.vehicle || (o && (o === game.player || o === game.player?.obj)));
  return !hit;
}

// ---------------------------------------------------------------- visuals
function buildMats() {
  const S = (c, r = 0.85) => new T.MeshStandardMaterial({ color: c, roughness: r });
  mats = { skin: S(0xb98a68, 0.7), boot: S(0x161512), helmet: S(0x30331f, 0.55), red: S(0xa3161a, 0.7), gear: S(0x1f1f19), visor: S(0x101418, 0.2), cap: S(0x1a1c26) };
}
function procRig(type, color) {
  const g = new T.Group(), uni = new T.MeshStandardMaterial({ color, roughness: 0.9 });
  const B = (w, h, d, m) => new T.Mesh(new T.BoxGeometry(w, h, d), m);
  const pivot = (x, y, z) => { const o = new T.Group(); o.position.set(x, y, z); g.add(o); return o; };
  const hips = pivot(0, 0.95, 0);
  const torso = B(0.44, 0.58, 0.26, uni); torso.position.y = 0.32; hips.add(torso);
  const vest = B(0.47, 0.36, 0.3, mats.gear); vest.position.y = 0.32; hips.add(vest);
  const head = new T.Mesh(new T.SphereGeometry(0.13, 10, 8), mats.skin); head.position.y = 0.78; hips.add(head);
  if (type === 'police' || type === 'officer') { const cap = new T.Mesh(new T.CylinderGeometry(0.15, 0.14, 0.09, 12), type === 'police' ? mats.cap : mats.helmet); cap.position.y = 0.9; hips.add(cap); const brim = B(0.2, 0.02, 0.12, mats.gear); brim.position.set(0, 0.86, -0.13); hips.add(brim); }
  else { const hel = new T.Mesh(new T.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mats.helmet); hel.position.y = 0.8; hel.scale.set(1, 0.9, 1.1); hips.add(hel); }
  const limbs = {};
  for (const s of [-1, 1]) {
    const sh = new T.Group(); sh.position.set(0.28 * s, 0.56, 0); hips.add(sh);
    const ua = B(0.12, 0.32, 0.12, uni); ua.position.y = -0.15; sh.add(ua);
    if (s < 0) { const band = B(0.13, 0.07, 0.13, mats.red); band.position.y = -0.1; sh.add(band); }
    const fa = B(0.1, 0.3, 0.1, uni); fa.position.y = -0.44; sh.add(fa);
    const leg = new T.Group(); leg.position.set(0.12 * s, 0, 0); hips.add(leg);
    const th = B(0.16, 0.45, 0.17, uni); th.position.y = -0.22; leg.add(th);
    const sn = B(0.14, 0.42, 0.15, uni); sn.position.y = -0.64; leg.add(sn);
    const bt = B(0.15, 0.1, 0.26, mats.boot); bt.position.set(0, -0.89, -0.04); leg.add(bt);
    limbs[s < 0 ? 'armL' : 'armR'] = sh; limbs[s < 0 ? 'legL' : 'legR'] = leg;
  }
  const gun = B(0.06, 0.09, type === 'heavy' ? 1.0 : type === 'sniper' ? 1.1 : 0.7, mats.gear);
  gun.position.set(0, -0.42, -0.3); limbs.armR.add(gun);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.userData.rig = { hips, ...limbs, gun };
  return g;
}
function makeModel(type) {
  const def = TYPES[type];
  let m = null;
  try { m = game.player?.cloneModel?.(); } catch { m = null; }
  if (m?.scene) {
    const root = new T.Group(); root.add(m.scene);
    const tint = new T.Color(def.color);
    m.scene.traverse(o => {
      if (!o.isMesh) return; o.castShadow = true;
      const tw = (mat) => { const c = mat.clone(); const n = (mat.name || '').toLowerCase();
        if (!/skin|face|head|eye|hair|body_skin/.test(n)) { if (c.color) c.color.lerp(tint, 0.75); if (c.map && /cloth|shirt|pant|jacket|top|bottom|outfit/.test(n)) c.color.copy(tint); }
        return c; };
      o.material = Array.isArray(o.material) ? o.material.map(tw) : tw(o.material);
    });
    // helmet + armband on bones when present
    let head = null, arm = null;
    m.scene.traverse(o => { if (o.isBone) { const n = o.name.toLowerCase(); if (!head && /head$|head_|neck2|head/.test(n) && !/end|top/.test(n)) head = o; if (!arm && /(left.*arm|arm.*l|upperarm_l|l_upperarm)/.test(n) && !/fore|lower/.test(n)) arm = o; } });
    const comp = (bone) => { const s = bone.getWorldScale(V()); return 1 / (s.x || 1); };
    if (head && type !== 'police') { const hel = new T.Mesh(new T.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mats.helmet); hel.scale.setScalar(comp(head)); hel.position.y = 0.1 * comp(head); head.add(hel); }
    if (arm) { const band = new T.Mesh(new T.CylinderGeometry(0.075, 0.075, 0.08, 10), mats.red); band.scale.setScalar(comp(arm)); band.position.y = 0.12 * comp(arm); arm.add(band); }
    const mixer = new T.AnimationMixer(m.scene), clips = {};
    const find = (re) => m.animations?.find(a => re.test(a.name));
    for (const [k, re] of Object.entries({ idle: /idle/i, walk: /walk/i, run: /run|jog|sprint/i, aim: /aim|shoot|fire|rifle/i, fall: /fall|air|jump/i, die: /death|die|dying/i })) { const c = find(re); if (c) clips[k] = mixer.clipAction(c); }
    root.userData.anim = { mixer, clips, cur: null };
    return root;
  }
  return procRig(type, def.color);
}
function playAnim(e, name, fade = 0.2) {
  const a = e.obj.userData.anim; if (!a) return false;
  const act = a.clips[name] || (name === 'run' ? a.clips.walk : name === 'aim' ? a.clips.idle : null);
  if (!act || a.cur === act) return !!act;
  act.reset().fadeIn(fade).play(); if (name === 'die') { act.setLoop(T.LoopOnce); act.clampWhenFinished = true; }
  a.cur?.fadeOut(fade); a.cur = act; return true;
}
function animateRig(e, dt, speed) {
  const rig = e.obj.userData.rig;
  if (!rig) { e.obj.userData.anim?.mixer.update(dt); return; }
  e.walkT += dt * (2 + speed * 1.6);
  const sw = Math.sin(e.walkT) * Math.min(1, speed / 3) * 0.7;
  rig.legL.rotation.x = sw; rig.legR.rotation.x = -sw;
  const aiming = e.state === 'combat';
  rig.armR.rotation.x = aiming ? -1.45 + e.aimPitch : -sw * 0.6; rig.armL.rotation.x = aiming ? -1.3 + e.aimPitch : sw * 0.6;
  rig.armL.rotation.z = aiming ? -0.45 : 0; rig.armR.rotation.z = 0;
  rig.hips.position.y = 0.95 + Math.abs(Math.cos(e.walkT)) * 0.04 * Math.min(1, speed / 3) - (e.crouch ? 0.28 : 0);
  rig.legL.rotation.x += e.crouch ? -0.9 : 0; rig.legR.rotation.x += e.crouch ? -0.9 : 0;
}

// ---------------------------------------------------------------- spawn / despawn
function spawn(type = 'rifleman', pos, opts = {}) {
  if (list.length >= MAX_ACTIVE && !opts.force) return null;
  const def = TYPES[type] || TYPES.rifleman;
  const p = P3(pos); p.y = groundY(p.x, p.z);
  const obj = makeModel(type); obj.position.copy(p); game.scene.add(obj);
  const e = {
    isEnemy: true, type, def, pos: p, vel: V(), hp: def.hp * (opts.hpMul || 1), maxHp: def.hp * (opts.hpMul || 1), obj,
    state: opts.state || 'patrol', dead: false, home: p.clone(), baseId: opts.baseId ?? null, townId: opts.townId ?? null,
    yaw: Math.random() * 6.28, goal: null, thinkT: R(0, 0.5), losT: R(0, 0.3), seen: false, lastKnown: null, alertT: 0,
    burst: 0, shotT: R(0.5, 1.5), grenadeT: R(6, 12), coverT: 0, crouch: false, walkT: Math.random() * 6, aimPitch: 0,
    fly: null, deadT: 0, glintT: 0, flank: Math.random() < 0.35 ? (Math.random() < 0.5 ? -1 : 1) : 0, stuckT: 0,
    applyImpulse(vec) { applyImpulse(e, vec); },
  };
  if (game.physics && game.RAPIER) {
    const RAP = game.RAPIER;
    e.body = game.physics.createRigidBody(RAP.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y + 0.9, p.z));
    e.collider = game.physics.createCollider(RAP.ColliderDesc.capsule(0.55, 0.32), e.body);
    owners()?.set(e.collider.handle, e);
  }
  list.push(e);
  return e;
}
function remove(e) {
  const i = list.indexOf(e); if (i >= 0) list.splice(i, 1);
  e.obj.removeFromParent();
  e.obj.traverse(o => { if (o.isMesh && o.geometry && !o.geometry._shared) o.geometry.dispose?.(); });
  if (e.collider) owners()?.delete(e.collider.handle);
  if (e.body) { try { game.physics.removeRigidBody(e.body); } catch { /* */ } }
  e.body = e.collider = null;
}

function pickType(w = TYPES) {
  const ents = Object.entries(w).filter(([, d]) => d.weight > 0), tot = ents.reduce((s, [, d]) => s + d.weight, 0);
  let r = Math.random() * tot; for (const [k, d] of ents) { r -= d.weight; if (r <= 0) return k; } return 'rifleman';
}
function updateSpawns(dt) {
  const pp = game.player?.pos; if (!pp) return;
  for (const b of game.world?.bases || []) {
    const id = b.id ?? b.name ?? game.world.bases.indexOf(b);
    const c = siteCenter(b) || P3(b.spawns?.[0] || { x: 0, z: 0 });
    let st = baseState.get(id); if (!st) baseState.set(id, st = { spawned: [], respawnT: 0, kills: 0 });
    st.spawned = st.spawned.filter(e => list.includes(e) && !e.dead);
    const d = Math.hypot(pp.x - c.x, pp.z - c.z);
    if (b.liberated || st.liberated) { continue; }
    const rr = Math.min(400, b.radius || 0);
    if (d < SPAWN_R + rr * 0.6) {
      st.respawnT -= dt;
      const spawns = b.spawns?.length ? b.spawns : Array.from({ length: 6 }, (_, i) => ({ x: c.x + Math.cos(i) * 20, z: c.z + Math.sin(i) * 20 }));
      const cap = Math.min(spawns.length, 14);
      if (st.spawned.length < cap && st.respawnT <= 0 && list.length < MAX_ACTIVE) {
        // spawn out of view if the player is close, so nobody pops in on screen
        const sp = spawns[(st.spawned.length + st.kills) % spawns.length];
        const e = spawn(pickType(), sp, { baseId: id });
        if (e) st.spawned.push(e);
        st.respawnT = st.spawned.length < cap * 0.6 && st.kills === 0 ? 0.05 : 8;
      }
    } else if (d > DESPAWN_R + rr) { for (const e of st.spawned) if (e.state !== 'combat') remove(e); st.spawned = []; }
  }
  for (const s of game.world?.settlements || []) {
    if (s.military) continue; // bases are handled above (world.settlements includes them)
    const id = s.id ?? s.name; const c = siteCenter(s); if (!c) continue;
    let st = townState.get(id); if (!st) townState.set(id, st = { spawned: [] });
    st.spawned = st.spawned.filter(e => list.includes(e) && !e.dead);
    const d = Math.hypot(pp.x - c.x, pp.z - c.z);
    if (s.liberated) continue;
    if (d < 220 && st.spawned.length < 3 && list.length < MAX_ACTIVE - 4 && !st.done) {
      for (let i = st.spawned.length; i < 3; i++) { const a = Math.random() * 6.28, r = R(10, 35); const e = spawn('police', { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r }, { townId: id }); if (e) st.spawned.push(e); }
      st.done = true;
    } else if (d > 380) { for (const e of st.spawned) if (e.state !== 'combat') remove(e); st.spawned = []; st.done = false; }
  }
}

// ---------------------------------------------------------------- damage / death / fling
function damage(e, amount, src, info = {}) {
  if (!e || e.dead) return false;
  e.hp -= amount;
  if (src === 'player' || src === game.player) { e.state = 'combat'; e.lastKnown = game.player?.pos?.clone(); alertNear(e.pos, 25); }
  e.hitT = 0.15;
  if (e.hp <= 0) { kill(e, src, info); return 'kill'; }
  // hit flinch: lean away from the shot for ~0.25 s (bigger hits flinch harder), brief stagger
  const hd = info.dir ? P3(info.dir) : (info.pos ? e.pos.clone().sub(P3(info.pos)) : null);
  if (hd && !info.explosive) { hd.y = 0; if (hd.lengthSq() > 1e-6) { hd.normalize(); e.flinch = { t: 0, dur: 0.28, dir: hd, amt: Math.min(0.55, 0.18 + amount / 90) }; e.shotT = Math.max(e.shotT, 0.2); } }
  try { game.audio?.play?.('enemyHurt', { pos: e.pos, volume: 0.5 }); } catch { /* */ }
  return true;
}
function kill(e, src, info = {}) {
  if (e.dead) return;
  e.dead = true; e.state = 'dead'; e.deadT = 0;
  const byPlayer = src === 'player' || src === game.player;
  const dir = info.dir ? info.dir.clone() : (info.pos ? e.pos.clone().sub(info.pos).normalize() : V(rs(), 0, rs()).normalize());
  const hasDie = !!e.obj.userData.anim?.clips?.die;
  if (!info.explosive && !e.fly && !hasDie) {
    // bullet death: topple over like a felled tree (pivot at the feet) away from the shot, small slide, dust on landing
    const hd = dir.clone().setY(0); if (hd.lengthSq() < 1e-6) hd.set(rs(), 0, rs()); hd.normalize();
    e.topple = { t: 0, dur: R(0.55, 0.8), dir: hd, axis: V(0, 1, 0).cross(hd).normalize(), slide: R(0.3, 0.8), base: e.pos.clone(), yaw: e.yaw, side: rs() * 0.35, q: e.obj.quaternion.clone() };
    e.flinch = null;
  } else if (!e.fly) e.fly = { v: dir.clone().setY(0).normalize().multiplyScalar(info.explosive ? 9 : 2.5).add(V(0, info.explosive ? 8 : 1.5, 0)), spin: V(rs() * 6, rs() * 3, rs() * 6), rot: V() };
  if (e.collider) owners()?.delete(e.collider.handle);
  if (e.body) { try { game.physics.removeRigidBody(e.body); } catch { /* */ } e.body = e.collider = null; }
  const usedAnim = playAnim(e, 'die', 0.1);
  if (usedAnim && e.fly) e.fly.noTumble = !info.explosive;
  game.fx?.sparks?.(e.pos.clone().add(V(0, 1.2, 0)), dir.clone().negate(), 8);
  try { game.audio?.play?.('enemyDie', { pos: e.pos, volume: 0.7 }); } catch { /* */ }
  if (byPlayer) {
    heatAdd(e.type === 'officer' ? 0.5 : 0.22);
    game.events.emit('chaos', { amount: e.type === 'officer' ? 150 : 50, pos: e.pos.clone(), reason: 'kill' });
    game.combat?.hitstop?.(info.explosive ? 40 : 55);
  }
  const st = baseState.get(e.baseId); if (st) st.kills++;
  game.events.emit('enemy:killed', { enemy: e, pos: e.pos.clone(), type: e.type, by: src, head: !!info.head, baseId: e.baseId });
}
function applyImpulse(e, vec) {
  if (e.dead) { if (e.fly) e.fly.v.add(vec); return; }
  const v = P3(vec);
  if (v.length() < 3) { e.pos.addScaledVector(v.setY(0), 0.05); return; }   // small nudge (bullets)
  e.fly = { v: v.clone(), spin: V(rs() * 8, rs() * 4, rs() * 8), rot: V() };
  e.state = 'flung';
}
function blast(pos, reach, power, owner) {
  let kills = 0;
  for (const e of list.slice()) {
    const d = e.pos.clone().add(V(0, 1, 0)).distanceTo(pos); if (d > reach) continue;
    const k = 1 - d / reach, dir = e.pos.clone().sub(pos); dir.y = 0; dir.normalize();
    if (e.dead) { if (e.fly) e.fly.v.add(dir.multiplyScalar(10 * k)).add(V(0, 8 * k, 0)); continue; }
    const r = damage(e, 260 * power * k, owner, { pos, dir, explosive: true });
    const imp = dir.multiplyScalar(14 * k * power + 3).add(V(0, 9 * k * power + 2, 0));
    if (r === 'kill') { kills++; e.fly.v.copy(imp); } else applyImpulse(e, imp);
  }
  alertNear(pos, 160);
  return kills;
}

let _ax = null;
function updateTopple(e, dt) {
  const tp = e.topple; tp.t += dt;
  const u = Math.min(1, tp.t / tp.dur);
  // falls slowly at first then slams (ease-in), with a tiny settle bounce at the end
  let ang = (Math.PI / 2 - 0.06) * u * u; if (u >= 1) { const b = tp.t - tp.dur; ang -= Math.max(0, Math.sin(Math.min(1, b / 0.18) * Math.PI)) * 0.08; }
  const qa = new T.Quaternion().setFromAxisAngle(tp.axis, ang), qy = new T.Quaternion().setFromEuler(new T.Euler(0, tp.yaw + tp.side * u, 0));
  tp.q = qa.multiply(qy);
  e.pos.copy(tp.base).addScaledVector(tp.dir, tp.slide * Math.min(1, u * 1.3)); e.pos.y = groundY(e.pos.x, e.pos.z) - 0.12 * u;
  if (u >= 1 && !tp.dusted) { tp.dusted = true; game.fx?.dust?.(e.pos.clone().addScaledVector(tp.dir, 1.2), { count: 4, size: 0.7 }); }
}
function updateFlying(e, dt) {
  const f = e.fly; f.v.y -= 9.81 * dt; e.pos.addScaledVector(f.v, dt);
  if (!f.noTumble) { f.rot.addScaledVector(f.spin, dt); e.obj.rotation.set(f.rot.x, e.yaw + f.rot.y, f.rot.z); }
  const gy = groundY(e.pos.x, e.pos.z);
  if (e.pos.y <= gy) {
    e.pos.y = gy;
    if (f.v.y < -3) { game.fx?.dust?.(e.pos, { count: 5, size: 0.9 }); }
    const impactSpd = -f.v.y;
    f.v.y = Math.abs(f.v.y) * 0.25; f.v.x *= 0.5; f.v.z *= 0.5; f.spin.multiplyScalar(0.5);
    if (!e.dead && impactSpd > 9) damage(e, (impactSpd - 9) * 14, 'player', { pos: e.pos });
    if (Math.hypot(f.v.x, f.v.z) < 0.6 && f.v.y < 1) {
      if (e.dead) { f.v.set(0, 0, 0); f.spin.set(0, 0, 0); if (!f.noTumble) { e.obj.rotation.set(-Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1), e.yaw, rs() * 0.4); f.noTumble = true; } }
      else { e.fly = null; e.obj.rotation.set(0, e.yaw, 0); e.state = 'combat'; e.lastKnown = game.player?.pos?.clone(); }
    }
  }
  if (game.world?.isWater?.(e.pos.x, e.pos.z) && e.pos.y < (game.world.seaLevel ?? 0) - 0.3 && !e.splashed) { e.splashed = true; game.fx?.splash?.(e.pos, 0.8); }
}

// ---------------------------------------------------------------- alert / heat
function alertNear(pos, radius) {
  for (const e of list) if (!e.dead && e.state === 'patrol' && e.pos.distanceTo(pos) < radius) { e.state = 'alert'; e.alertT = R(6, 10); e.lastKnown = P3(pos); }
}
function heatAdd(v) {
  heat.value = Math.max(0, Math.min(5.99, heat.value + v));
  const lvl = Math.min(5, Math.floor(heat.value));
  if (lvl !== heat.level) { heat.level = lvl; game.events.emit('heat', { level: lvl }); try { if (v > 0) game.audio?.play?.('heatUp', { volume: 0.6 }); } catch { /* */ } }
}
function updateHeat(dt, seenNow) {
  if (seenNow) { heat.lastSeen = game.simTime; if (heat.value < 1) heatAdd(1.05 - heat.value); } // being fought = at least 1 star
  const unseen = game.simTime - heat.lastSeen;
  if (unseen > 12 && heat.value > 0) heatAdd(-dt * (0.15 + 0.05 * heat.level));
  // reinforcements
  heat.reinfT -= dt;
  heat.vehicles = heat.vehicles.filter(v => v && !v.dead && !v.destroyed && (v.hp ?? 1) > 0);
  if (heat.level >= 1 && heat.reinfT <= 0 && unseen < 20 && game.player?.pos) {
    heat.reinfT = Math.max(12, 40 - heat.level * 6);
    const pp = game.player.pos, a = Math.random() * 6.28, r = R(140, 220);
    const at = V(pp.x + Math.cos(a) * r, 0, pp.z + Math.sin(a) * r); at.y = groundY(at.x, at.z);
    const wants = heat.level >= 5 ? ['attackHeli', 'tank', 'jeep'] : heat.level >= 4 ? ['tank', 'attackHeli'] : heat.level >= 3 ? ['attackHeli', 'jeep'] : heat.level >= 2 ? ['jeep'] : [];
    const maxVeh = heat.level + (heat.level >= 4 ? 2 : 0);
    for (const t of wants) {
      if (heat.vehicles.length >= maxVeh || !game.vehicles?.spawn) break;
      const spot = at.clone(); if (t === 'attackHeli') spot.y += 80;
      let v = null; try { v = game.vehicles.spawn(t, spot, Math.atan2(pp.x - at.x, pp.z - at.z), { ai: 'hunt', faction: 'regime', target: game.player }); } catch (e) { console.warn('[enemies] vehicle spawn', e); }
      if (v) { v.faction = 'regime'; v.ai ||= 'hunt'; v.aiTarget = game.player; heat.vehicles.push(v); }
    }
    // foot squad always comes
    const n = Math.min(MAX_ACTIVE - list.length, 1 + heat.level);
    for (let i = 0; i < n; i++) {
      const e = spawn(heat.level >= 3 && i === 0 ? 'heavy' : pickType({ rifleman: TYPES.rifleman, heavy: { weight: heat.level * 0.4 }, officer: { weight: 0.3 } }), { x: at.x + rs() * 6, z: at.z + rs() * 6 }, { state: 'combat' });
      if (e) { e.lastKnown = pp.clone(); e.reinforcement = true; }
    }
  }
}

// ---------------------------------------------------------------- AI
const EYE = 1.55;
function moveToward(e, goal, speed, dt) {
  const to = V(goal.x - e.pos.x, 0, goal.z - e.pos.z), d = to.length();
  if (d < 0.6) { e.vel.set(0, 0, 0); return true; }
  to.divideScalar(d);
  // obstacle probe
  const probe = game.combat?.raycast?.(e.pos.clone().add(V(0, 0.7, 0)), to, 1.6, (o) => o?.isEnemy);
  if (probe && probe.owner) { const side = V(-to.z, 0, to.x).multiplyScalar(e.flank || 1); to.lerp(side, 0.85).normalize(); e.stuckT += dt; if (e.stuckT > 2) { e.goal = null; e.stuckT = 0; } }
  e.vel.lerp(to.multiplyScalar(speed), Math.min(1, dt * 6));
  e.pos.addScaledVector(e.vel, dt);
  const gy = groundY(e.pos.x, e.pos.z);
  if (game.world?.isWater?.(e.pos.x, e.pos.z) && gy < (game.world.seaLevel ?? 0) - 0.8) { e.pos.addScaledVector(e.vel, -dt * 1.5); e.goal = null; }
  e.pos.y = groundY(e.pos.x, e.pos.z);
  e.yaw = lerpAngle(e.yaw, Math.atan2(e.vel.x, e.vel.z) + Math.PI, Math.min(1, dt * 8));
  return false;
}
function lerpAngle(a, b, t) { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; }

function findCover(e, tp) {
  let best = null, bestScore = -1e9;
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * 6.28, r = R(4, 13), c = V(e.pos.x + Math.cos(a) * r, 0, e.pos.z + Math.sin(a) * r); c.y = groundY(c.x, c.z);
    const dPl = c.distanceTo(tp); if (dPl < 12 || dPl > e.def.range * 1.1) continue;
    const low = !los(c.clone().add(V(0, 0.8, 0)), tp, e), high = los(c.clone().add(V(0, EYE, 0)), tp, e);
    const score = (low ? 10 : 0) + (high ? 3 : 0) - r * 0.3 + (e.flank ? -Math.abs(dPl - e.def.range * 0.5) * 0.05 : 0);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

// sample a ring around the player (10-25 m) for the nearest point that sees the player and that
// this enemy can walk toward without a wall straight in the way
function findFlank(e, tp) {
  let best = null, bestScore = 1e9;
  const a0 = Math.random() * 6.28, N = 10, eyeE = e.pos.clone().add(V(0, 0.9, 0));
  for (let i = 0; i < N; i++) {
    const a = a0 + i * 6.28 / N, r = R(10, Math.min(25, e.def.range * 0.8));
    const c = V(tp.x + Math.cos(a) * r, 0, tp.z + Math.sin(a) * r); c.y = groundY(c.x, c.z);
    if (game.world?.isWater?.(c.x, c.z) && c.y < (game.world.seaLevel ?? 0) - 0.5) continue;
    if (Math.abs(c.y - e.pos.y) > 12) continue;
    const de = c.distanceTo(e.pos); if (de > 70) continue;
    if (!los(c.clone().add(V(0, EYE, 0)), tp, e)) continue;
    const blocked = !los(eyeE, c.clone().add(V(0, 0.9, 0)), e);
    const score = de + (blocked ? 25 : 0);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}

function shoot(e, tgt) {
  const def = e.def, from = e.pos.clone().add(V(0, EYE - 0.1, 0)).add(V(-Math.sin(e.yaw) * 0.5, 0, -Math.cos(e.yaw) * 0.5));
  const d = from.distanceTo(tgt.pos);
  if (def.rocket) {
    const dir = tgt.pos.clone().sub(from).normalize(); dir.x += rs() * 0.03; dir.y += rs() * 0.02 + 0.01; dir.z += rs() * 0.03;
    game.combat?.fireProjectile?.({ from, dir, type: 'rocket', owner: e, target: tgt.veh ? tgt.obj : null, speed: 45 });
    game.fx?.muzzle?.(from, dir, { size: 1.4 });
    try { game.audio?.play?.('shot_rocket', { pos: from, volume: 0.8 }); } catch { /* */ }
    return;
  }
  // accuracy falloff: distance, target speed, vehicle, officer buff, heat
  const pv = game.player?.vel ? Math.hypot(game.player.vel.x, game.player.vel.z) : 0;
  const buff = list.some(o => o.type === 'officer' && !o.dead && o !== e && o.pos.distanceTo(e.pos) < 25) ? 1.25 : 1;
  let pHit = def.acc * buff * Math.max(0.12, 1 - d / (def.range * 1.4)) * (1 / (1 + pv * 0.09)) * (e.crouch ? 0.9 : 1) * (0.8 + heat.level * 0.06);
  if (game.player?.state === 'grapple' || game.player?.state === 'wingsuit') pHit *= 0.4;
  pHit = Math.min(0.85, pHit);
  const hits = Math.random() < pHit;
  const aim = tgt.pos.clone();
  if (!hits) aim.add(V(rs(), rs() * 0.6, rs()).normalize().multiplyScalar(R(0.9, 2.5) + d * 0.02));
  const dir = aim.sub(from).normalize();
  game.fx?.muzzle?.(from, dir, { size: def.sniper ? 1.4 : 0.9, light: list.length < 16 });
  try { game.audio?.play?.(def.sniper ? 'shot_sniper' : 'shot_enemy', { pos: from, volume: 0.7 }); } catch { /* */ }
  game.combat?.hitscan?.({ from, dir, range: def.range * 1.5, damage: def.dmg * (tgt.veh ? 1.6 : 1), owner: e, color: [5, 1.6, 0.8], tracer: true });
}

function throwGrenade(e, tgt) {
  const from = e.pos.clone().add(V(0, 1.8, 0)), to = tgt.pos.clone().add(V(rs() * 3, 0, rs() * 3));
  const flat = V(to.x - from.x, 0, to.z - from.z), dist = flat.length(); if (dist > 32 || dist < 8) return false;
  const tFlight = 1.3 + dist * 0.02, vy = (to.y - from.y + 0.5 * 9.81 * tFlight * tFlight) / tFlight;
  const vel = flat.divideScalar(tFlight); vel.y = vy;
  const sp = vel.length();
  game.combat?.fireProjectile?.({ from, dir: vel.clone().normalize(), speed: sp, type: 'handGrenade', owner: e });
  try { game.audio?.play?.('throw', { pos: from, volume: 0.6 }); } catch { /* */ }
  return true;
}

function think(e, dt, tgt) {
  const def = e.def;
  // perception (throttled LOS)
  e.losT -= dt;
  if (e.losT <= 0 && tgt) {
    e.losT = 0.25 + Math.random() * 0.15;
    const eye = e.pos.clone().add(V(0, EYE, 0)), d = eye.distanceTo(tgt.pos);
    const fwd = V(-Math.sin(e.yaw), 0, -Math.cos(e.yaw)), to = tgt.pos.clone().sub(eye).setY(0).normalize();
    const fovOk = e.state !== 'patrol' || fwd.dot(to) > 0.2 || d < 12;
    const range = e.state === 'patrol' ? Math.min(def.range, 70) : def.range * 1.3;
    e.seen = d < range && fovOk && los(eye, tgt.pos, e);
    if (e.seen) { e.lastKnown = tgt.pos.clone(); if (e.state !== 'combat') { if (!def.police && heat.value < 1.05) heatAdd(1.05 - heat.value); /* spotted by regime troops = 1 star */ e.state = 'combat'; e.burst = 0; e.shotT = R(0.4, 0.9); alertNear(e.pos, 40); try { game.audio?.play?.('enemyAlert', { pos: e.pos, volume: 0.6 }); } catch { /* */ } } }
  }
  if (!tgt && e.state === 'combat') { e.state = 'alert'; e.alertT = 5; }

  if (e.state === 'patrol') {
    e.thinkT -= dt;
    if (!e.goal || e.thinkT <= 0) { e.thinkT = R(4, 9); e.goal = Math.random() < 0.35 ? null : V(e.home.x + rs() * 16, 0, e.home.z + rs() * 16); }
    if (e.goal) { if (moveToward(e, e.goal, 1.4, dt)) e.goal = null; } else e.vel.multiplyScalar(0.8);
    e.crouch = false;
  } else if (e.state === 'alert') {
    e.alertT -= dt; e.crouch = false;
    if (e.lastKnown && !moveToward(e, e.lastKnown, def.speed * 0.6, dt)) { /* searching */ } else if (e.lastKnown) { e.lastKnown = null; e.goal = V(e.pos.x + rs() * 12, 0, e.pos.z + rs() * 12); }
    else if (e.goal) moveToward(e, e.goal, 1.6, dt);
    if (e.alertT <= 0) { e.state = 'patrol'; e.goal = null; }
  } else if (e.state === 'combat' && tgt) {
    const d = e.pos.distanceTo(tgt.pos);
    e.coverT -= dt;
    // flanking: no LOS for ~2 s -> pick a ring point around the player that has LOS, go there
    e.noLosT = e.seen ? 0 : (e.noLosT || 0) + dt;
    if (e.flankGoal && !e.goal) e.flankGoal = false; // arrived or gave up (stuck)
    if (e.seen && e.flankGoal) { e.flankGoal = false; e.goal = null; }
    if (e.flankGoal && (e.flankT -= dt) <= 0) { e.flankGoal = false; e.goal = null; }
    if (!def.sniper && !e.flankGoal && e.noLosT > 2 + (e.flankFail || 0)) {
      const c = findFlank(e, tgt.pos);
      if (c) { e.goal = c; e.flankGoal = true; e.flankT = 9; e.flankFail = 0; e.coverT = 9; e.crouch = false; }
      else e.flankFail = Math.min(6, (e.flankFail || 0) + 1.5);
      e.noLosT = 0;
    }
    if (e.coverT <= 0 && !e.flankGoal) {
      e.coverT = R(3, 6);
      if (def.sniper) e.goal = d < 60 ? e.pos.clone().add(e.pos.clone().sub(tgt.pos).setY(0).normalize().multiplyScalar(20)) : null;
      else if (e.flank) { const side = V(-(tgt.pos.z - e.pos.z), 0, tgt.pos.x - e.pos.x).normalize().multiplyScalar(e.flank * R(12, 22)); e.goal = tgt.pos.clone().add(side).add(e.pos.clone().sub(tgt.pos).setY(0).normalize().multiplyScalar(def.range * 0.35)); }
      else e.goal = (d > def.range * 0.9 || !e.seen) ? tgt.pos.clone().lerp(e.pos, 0.55) : findCover(e, tgt.pos);
      e.crouch = false;
    }
    const firing = e.seen && d < def.range * 1.3;
    if (e.goal) { if (moveToward(e, e.goal, firing ? def.speed * 0.55 : def.speed, dt)) { e.goal = null; e.crouch = Math.random() < 0.6; } }
    else e.vel.multiplyScalar(0.7);
    if (firing) {
      const to = tgt.pos.clone().sub(e.pos);
      e.yaw = lerpAngle(e.yaw, Math.atan2(to.x, to.z) + Math.PI, Math.min(1, dt * 10));
      e.aimPitch = Math.atan2(to.y - EYE, Math.hypot(to.x, to.z)) * 0.8;
      e.shotT -= dt;
      if (def.sniper && e.shotT < 1 && e.shotT > 0) {
        e.glintT -= dt;
        if (e.glintT <= 0) { e.glintT = 0.25; game.fx?.flash && game.fx.muzzle?.(e.pos.clone().add(V(0, EYE, 0)), to.normalize(), { size: 0.5, light: false }); }
      }
      if (e.shotT <= 0) {
        shoot(e, tgt);
        if (e.burst <= 0) e.burst = Math.round(R(def.burst[0], def.burst[1]));
        e.burst--;
        e.shotT = e.burst > 0 ? def.rof * R(0.9, 1.3) : R(0.9, 2.2) + (def.rof > 1 ? def.rof : 0);
        if (e.burst <= 0) {
          e.crouch = !e.crouch && Math.random() < 0.5;
          // between bursts, sometimes duck to nearby low cover
          if (!def.sniper && !e.goal && Math.random() < 0.3) { const c = findCover(e, tgt.pos); if (c && c.distanceTo(e.pos) < 9) { e.goal = c; e.coverT = Math.max(e.coverT, 3); } }
        }
      }
      e.grenadeT -= dt;
      if (e.grenadeT <= 0 && !def.sniper && !def.police) { e.grenadeT = R(9, 16); if (pvSlow() && throwGrenade(e, tgt)) e.shotT += 0.8; }
    } else if (!e.seen && e.lastKnown && !e.goal) e.goal = e.lastKnown.clone();
    if (def.officer && e.seen) { e.callT = (e.callT ?? 4) - dt; if (e.callT <= 0) { e.callT = 12; heatAdd(0.35); } }
  }
}
function pvSlow() { const v = game.player?.vel; return !v || Math.hypot(v.x, v.z) < 4; }

// ---------------------------------------------------------------- module
export default {
  name: 'enemies',
  init(g) {
    game = g; T = g.THREE; buildMats(); _ax = new T.Vector3();
    g.events.on('combat:fire', ({ pos, owner, loud }) => { if (owner === 'player' && pos) { alertNear(pos, 70 * (loud || 1)); heatAdd(0.01); } });
    g.events.on('explosion', ({ pos }) => pos && alertNear(pos, 160));
    g.events.on('fx:explosion', ({ pos }) => pos && alertNear(pos, 120));
    g.events.on('chaos', ({ amount, reason }) => { if (reason !== 'kill' && amount > 0) heatAdd(Math.min(0.6, amount / 900)); });
    g.events.on('destructible:destroyed', ({ baseId }) => { if (baseId != null) heatAdd(0.25); });
    g.events.on('base:liberated', ({ baseId }) => { const st = baseState.get(baseId); if (st) { st.liberated = true; for (const e of st.spawned) if (!e.dead) kill(e, null, {}); } });
    g.events.on('player:respawn', (d) => { if (d?.reason === 'teleport') return; heat.value = 0; heatAdd(0); for (const e of list) if (!e.dead) { e.state = 'patrol'; e.lastKnown = null; } });
    g.events.on('player:died', () => { for (const e of list) if (!e.dead && e.state === 'combat') { e.state = 'alert'; e.alertT = 4; } });
    g.enemies = {
      list, types: TYPES,
      get heat() { return heat.value; }, get level() { return heat.level; },
      setHeat(v) { heat.value = 0; heat.level = -1; heatAdd(Math.max(0, v)); }, addHeat: heatAdd,
      spawn, damage, blast, alert: alertNear, kill: (e) => kill(e, null, {}),
      clear() { for (const e of list.slice()) remove(e); },
      stats: () => ({ active: list.length, alive: list.filter(e => !e.dead).length, heat: heat.value, combat: list.filter(e => e.state === 'combat').length }),
    };
  },
  update(dt) {
    if (!game.enemies || dt <= 0) return;
    const playing = game.state === 'play';
    if (playing) updateSpawns(dt);
    const tgt = playing ? playerTarget() : null;
    let seenNow = false;
    const pp = game.player?.pos;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (e.dead) {
        e.deadT += dt;
        if (e.fly) updateFlying(e, dt);
        else if (e.topple) updateTopple(e, dt);
        e.obj.userData.anim?.mixer.update(dt);
        if (e.deadT > 9) { e.obj.position.y -= dt * 0.5; }
        if (e.deadT > 11) { remove(e); continue; }
        e.obj.position.copy(e.pos); if (e.deadT > 9) e.obj.position.y -= (e.deadT - 9) * 0.5;
        if (e.topple && !e.fly) e.obj.quaternion.copy(e.topple.q);
        continue;
      }
      // far-away enemies tick slowly
      const far = pp ? e.pos.distanceTo(pp) > 180 : true;
      if (e.state === 'flung' && e.fly) updateFlying(e, dt);
      else if (playing && (!far || (e._acc = (e._acc || 0) + dt) > 0.25)) { const sdt = far ? e._acc : dt; e._acc = 0; think(e, sdt, tgt); }
      if (e.seen && e.state === 'combat') seenNow = true;
      e.obj.position.copy(e.pos);
      if (!e.fly) e.obj.rotation.set(0, e.yaw, 0);
      if (e.flinch && !e.fly) {
        const f = e.flinch; f.t += dt; const u = f.t / f.dur;
        if (u >= 1) e.flinch = null;
        else { const a = Math.sin(Math.min(1, u * 2.2) * Math.PI * 0.5) * (1 - u) * f.amt * 1.6; e.obj.rotateOnWorldAxis(_ax.set(0, 1, 0).cross(f.dir).normalize(), a); e.pos.addScaledVector(f.dir, dt * 0.8 * (1 - u)); }
      }
      const speed = Math.hypot(e.vel.x, e.vel.z);
      if (e.obj.userData.anim) playAnim(e, e.fly ? 'fall' : speed > 3 ? 'run' : speed > 0.4 ? 'walk' : e.state === 'combat' ? 'aim' : 'idle');
      animateRig(e, dt, speed);
      if (e.body) e.body.setNextKinematicTranslation({ x: e.pos.x, y: e.pos.y + 0.9 - (e.crouch ? 0.3 : 0), z: e.pos.z });
    }
    if (playing) updateHeat(dt, seenNow);
  },
};
