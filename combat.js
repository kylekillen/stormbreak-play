// STORMBREAK combat: player weapons, hitscan + projectiles, damage routing, explosions.
//
// game.combat:
//   weapons {id: def}, slots [[ids]...], current (id), weapon (def), ammo {mag, reserve} of current,
//   sticky {count, max, active}, spread (deg), aiming, lock {target, progress, locked}, mods (upgrade multipliers)
//   damage(target, amount, src, info) -> bool     target: game.player | enemy | vehicle | destructible Object3D | anything with damage()
//   explode(pos, radius=6, power=1, opts{owner, silent, noFx}) radial damage + Rapier impulses + fx + shake + sound
//   fireProjectile({from, dir, type:'rocket'|'grenade'|'handGrenade'|'sticky'|'shell', owner, target, speed, radius, power})
//   hitscan({from, dir, range, damage, owner, spread, tracer, color}) -> hit|null   (used by enemies/vehicles too)
//   raycast(from, dir, max, exclude) -> {point, normal, dist, collider, owner, surface}|null
//   give(id, ammo), addAmmo(id|'all', n), select(id), hitstop(ms), detonate()
// Events: 'hitmarker' {kill, head, target}, 'combat:fire' {pos, dir, weapon, owner}, 'lockon' {target, progress, locked},
//   'explosion' {pos, radius, owner}, 'recoil' {pitch, yaw}, 'aim' {on, fov}, 'weapon:switch' {id}, 'reload' {id}
// Controls: LMB fire, RMB aim, T reload, 1/2/3 slot (press again to swap within slot), wheel cycles,
//   G throw sticky charge, hold G (0.35 s) or press V to detonate all charges.

let T, game;
const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const R = (a, b) => a + Math.random() * (b - a);
const deg = Math.PI / 180;

const WEAPONS = {
  rifle:   { id: 'rifle', name: 'K-17 Rifle', slot: 0, auto: true, dmg: 26, rpm: 620, mag: 30, reserve: 240, hip: 2.4, ads: 0.55, bloom: 0.45, maxSpread: 6, recoil: 0.011, range: 450, reload: 1.9, fov: 46, sound: 'rifle' },
  smg:     { id: 'smg', name: 'Viper SMG', slot: 0, auto: true, dmg: 15, rpm: 920, mag: 40, reserve: 320, hip: 3.4, ads: 1.3, bloom: 0.35, maxSpread: 7, recoil: 0.007, range: 200, reload: 1.6, fov: 52, sound: 'smg' },
  shotgun: { id: 'shotgun', name: 'Breaker 12', slot: 1, auto: false, dmg: 13, pellets: 10, rpm: 75, mag: 8, reserve: 48, hip: 6.5, ads: 4.5, bloom: 0, maxSpread: 7, recoil: 0.04, range: 70, reload: 2.4, fov: 54, sound: 'shotgun', perShell: 0.42 },
  sniper:  { id: 'sniper', name: 'Longreach .50', slot: 1, auto: false, dmg: 160, rpm: 42, mag: 5, reserve: 30, hip: 5, ads: 0.03, bloom: 3, maxSpread: 8, recoil: 0.06, range: 1500, reload: 2.6, fov: 18, sound: 'sniper', pierce: true },
  rocket:  { id: 'rocket', name: 'Hammerhead RL', slot: 2, auto: false, projectile: 'rocket', rpm: 40, mag: 1, reserve: 10, hip: 1.5, ads: 0.3, bloom: 0, maxSpread: 2, recoil: 0.05, range: 900, reload: 2.2, fov: 44, sound: 'rocket', lockOn: true },
  gl:      { id: 'gl', name: 'Thumper GL', slot: 2, auto: false, projectile: 'grenade', rpm: 95, mag: 6, reserve: 30, hip: 2, ads: 0.8, bloom: 0, maxSpread: 3, recoil: 0.03, range: 300, reload: 2.8, fov: 50, sound: 'gl' },
};
const PROJ = {
  rocket:      { speed: 80, grav: 0, radius: 7, power: 1.2, fuse: 8, trail: true, impact: true },
  shell:       { speed: 160, grav: 2, radius: 8, power: 1.5, fuse: 6, trail: true, impact: true },
  grenade:     { speed: 36, grav: 9.81, radius: 6, power: 1.0, fuse: 3, trail: true, impact: true },
  handGrenade: { speed: 18, grav: 9.81, radius: 6, power: 1.0, fuse: 2.6, bounce: true },
  sticky:      { speed: 24, grav: 9.81, radius: 7.5, power: 1.4, fuse: 600, stick: true },
};

const state = {
  current: 'rifle', slots: [['rifle', 'smg'], ['shotgun', 'sniper'], ['rocket', 'gl']],
  owned: new Set(['rifle', 'shotgun', 'rocket', 'smg', 'sniper', 'gl']),
  ammo: {}, cooldown: 0, reloading: 0, spread: 2, aiming: false, lastFire: -10,
  sticky: { count: 8, max: 8, active: [] }, throwHeld: 0, detonatedThisHold: false,
  lock: { target: null, progress: 0, locked: false },
  mods: { damage: 1, mag: 1, reload: 1, stickyMax: 8, explosive: 1, recoil: 1 },
};
const projectiles = [];
let models = {}, gunRoot, ui = {};

// ---------------------------------------------------------------- queries
function owners() { return game.world?.colliderOwner; }
function ownerOf(collider) {
  if (!collider) return null;
  const m = owners(); const o = m?.get?.(collider.handle);
  if (o) return o;
  // player.js doesn't register its capsule in world.colliderOwner: resolve it here so enemy fire + LOS see the player
  const pc = game.player?.collider; if (pc && pc.handle === collider.handle) return game.player;
  const ud = collider._owner; return ud || null;
}
function isPlayerThing(o) { const p = game.player; return !!p && !!o && (o === p || o === p.obj || o === p.body || o === p.controller || o === p.collider); }
function vehicleOf(o) {
  if (!o) return null;
  if (o.isVehicle) return o;
  const list = game.vehicles?.list; if (list?.includes?.(o)) return o;
  if (o.userData?.vehicle) return o.userData.vehicle;
  return null;
}
function destructibleOf(o) {
  let x = o?.isObject3D ? o : o?.obj;
  while (x) { if (x.userData?.destructible) return x; x = x.parent; }
  return null;
}
function surfaceOf(owner, point, collider) {
  if (owner?.isEnemy) return 'body';
  if (isPlayerThing(owner)) return 'body';
  if (vehicleOf(owner)) return 'metal';
  const s = owner?.userData?.surface || owner?.surface || owner?.obj?.userData?.surface;
  if (s) return s;
  const d = destructibleOf(owner);
  if (d) { const k = d.userData.destructible.kind || ''; return /tank|tower|dish|fuel|radar|silo|pipe|gen|antenna|metal|truck/.test(k) ? 'metal' : 'concrete'; }
  const ws = game.world?.surfaceAt?.(point.x, point.z); if (ws) return ws;
  if (!owner && point) {
    if (point.y > 900) return 'snow';
    if (point.y < 3) return 'sand';
    return 'dirt';
  }
  return 'concrete';
}

const _ray = { origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 1 } };
// exclude: function(owner, collider) -> true to skip
function raycast(from, dir, max = 500, exclude) {
  let best = null;
  const P = game.physics, RAP = game.RAPIER;
  if (P && RAP) {
    const ray = new RAP.Ray({ x: from.x, y: from.y, z: from.z }, { x: dir.x, y: dir.y, z: dir.z });
    const pb = game.player?.body || game.player?.rigidBody;
    const pred = (c) => {
      if (c.isSensor?.()) return false;
      const o = ownerOf(c);
      if (exclude && exclude(o, c)) return false;
      if (o?.isEnemy && o.dead) return false;
      return true;
    };
    try {
      const hit = P.castRayAndGetNormal(ray, max, true, undefined, undefined, undefined, undefined, pred);
      if (hit) {
        const t = hit.timeOfImpact ?? hit.toi;
        best = { dist: t, point: V(from.x + dir.x * t, from.y + dir.y * t, from.z + dir.z * t), normal: V(hit.normal.x, hit.normal.y, hit.normal.z), collider: hit.collider, owner: ownerOf(hit.collider) };
      }
    } catch (e) { /* physics may be mid-step */ }
  }
  // terrain: world raycast if present, else march the heightfield
  let tHit = null;
  try {
    let w = game.world?.raycast?.(from, dir, best ? best.dist : max);
    // world.raycast casts against ALL colliders (incl. the player's capsule, enemies): re-apply our owner/exclude
    // rules, otherwise a muzzle ray starting inside the player's capsule 'hits' at distance 0 and every shot is eaten.
    if (w?.collider) { const wo = ownerOf(w.collider); if ((exclude && exclude(wo, w.collider)) || w.collider.isSensor?.() || (wo?.isEnemy && wo.dead)) w = null; else if (wo && !w.owner) w = { ...w, owner: wo }; }
    if (w) {
      const d = w.distance ?? w.dist ?? w.toi ?? (w.point ? from.distanceTo(w.point) : null);
      if (d != null && (!best || d < best.dist - 0.01)) tHit = { dist: d, point: w.point ? V(w.point.x, w.point.y, w.point.z) : from.clone().addScaledVector(dir, d), normal: w.normal ? V(w.normal.x, w.normal.y, w.normal.z) : V(0, 1, 0), collider: w.collider || null, owner: w.owner || w.object || null };
    }
  } catch { /* optional */ }
  if (!tHit && !game.world?.raycast) {
    const lim = best ? best.dist : max, hAt = (x, z) => game.world?.heightAt?.(x, z) ?? 0;
    let step = 2, prevT = 0;
    for (let t = step; t <= lim; t += step) {
      const x = from.x + dir.x * t, y = from.y + dir.y * t, z = from.z + dir.z * t;
      if (y < hAt(x, z)) {
        let a = prevT, b = t; for (let k = 0; k < 8; k++) { const m = (a + b) / 2; const yy = from.y + dir.y * m; if (yy < hAt(from.x + dir.x * m, from.z + dir.z * m)) b = m; else a = m; }
        const p = from.clone().addScaledVector(dir, b);
        const n = game.world?.normalAt?.(p.x, p.z); tHit = { dist: b, point: p, normal: n ? V(n.x, n.y, n.z) : V(0, 1, 0), collider: null, owner: null };
        break;
      }
      prevT = t; step = Math.min(10, step * 1.15);
    }
  }
  if (tHit) best = tHit;
  if (best) best.surface = surfaceOf(best.owner, best.point, best.collider);
  return best;
}
const excludePlayer = (o) => isPlayerThing(o) || (o && o === game.player?.vehicle);
function excludeFor(owner) {
  if (owner === 'player' || owner === game.player) return excludePlayer;
  return (o) => o === owner || (owner?.obj && o === owner.obj) || (o?.isEnemy && owner?.isEnemy && o === owner);
}

// ---------------------------------------------------------------- damage routing
function damage(target, amount, src, info = {}) {
  if (!target || !(amount > 0)) return false;
  const fromPlayer = src === 'player' || src === game.player;
  if (fromPlayer) amount *= state.mods.damage;
  const p = game.player;
  if (target === 'player' || target === p || isPlayerThing(target)) {
    if (!p || p.state === 'dead' || p.invulnerable || p.invuln > 0 || game.state !== 'play') return false;
    if (fromPlayer && !info.self) return false;
    if (p.damage) { p.damage(amount, src, info); return true; } // player.damage emits player:damaged itself (was double-emitted)
    else {
      let a = amount;
      if (p.armor > 0) { const ab = Math.min(p.armor, a * 0.6); p.armor -= ab; a -= ab; }
      const before = p.health ?? 100; p.health = Math.max(0, before - a);
      if (before > 0 && p.health <= 0 && !p.respawn) game.events.emit('player:died', { src });
    }
    game.events.emit('player:damaged', { amount, src, dir: info.dir, pos: info.pos });
    return true;
  }
  if (target.isEnemy) {
    const r = game.enemies?.damage?.(target, amount, src, info);
    if (fromPlayer && r) hitmarker(r === 'kill', info.head, target);
    return !!r;
  }
  const veh = vehicleOf(target);
  if (veh) {
    if (veh === p?.vehicle && fromPlayer) return false;
    if (game.vehicles?.damage) game.vehicles.damage(veh, amount, info.pos || null, src); // vehicles.damage(v, amt, pos, src)
    else if (veh.damage) veh.damage(amount, src, info);
    else if ('hp' in veh) veh.hp -= amount;
    if (fromPlayer) hitmarker(false, false, veh);
    return true;
  }
  const d = destructibleOf(target);
  if (d) {
    const ds = d.userData.destructible; if (ds.hp <= 0) return false;
    const pos = info.pos || d.getWorldPosition(V());
    if (typeof d.userData.onDamage === 'function') { // non-world destructibles (mission props) own their damage
      d.userData.onDamage(amount, src, info);
      if (fromPlayer) hitmarker(ds.hp <= 0, false, d);
      return true;
    }
    if (game.world?.damageDestructible) game.world.damageDestructible(d, amount, pos);
    else { ds.hp -= amount; if (ds.hp <= 0) { game.fx?.explosion(pos, 8); game.events.emit('destructible:destroyed', { obj: d, pos, kind: ds.kind, chaos: ds.chaos, baseId: ds.baseId }); } }
    if (fromPlayer) hitmarker(ds.hp <= 0, false, d);
    return true;
  }
  if (typeof target.damage === 'function') { target.damage(amount, src, info); return true; }
  return false;
}

function hitmarker(kill, head, target) {
  game.events.emit('hitmarker', { kill: !!kill, head: !!head, target });
  if (!ui.hit) return;
  ui.hitT = kill ? 0.35 : 0.16; ui.hit.style.opacity = 1;
  ui.hit.style.borderColor = kill ? '#ff4a2e' : head ? '#ffd24a' : '#fff';
  ui.hit.style.transform = `translate(-50%,-50%) rotate(45deg) scale(${kill ? 1.5 : 1})`;
  try { game.audio?.play?.(kill ? 'killmarker' : 'hitmarker', { volume: 0.5 }); } catch { /* optional */ }
}

let stopTimer = 0;
function hitstop(ms = 60) {
  if (game.state !== 'play' || game.paused || ms <= 0) return;
  game.paused = true; game._hitstop = true;
  clearTimeout(stopTimer);
  stopTimer = setTimeout(() => { if (game._hitstop) { game._hitstop = false; if (game.state === 'play') game.paused = false; } }, ms);
  game.events.emit('hitstop', { ms });
}

// ---------------------------------------------------------------- explosions
function explode(pos, radius = 6, power = 1, opts = {}) {
  pos = pos.isVector3 ? pos.clone() : V(pos.x, pos.y, pos.z);
  if (!Number.isFinite(pos.x + pos.y + pos.z)) return 0;
  // vehicles.js calls explode(pos, r, 30|60, { src }) and then emits its own 'explosion' event, which vehicles
  // turn into vehicle damage. So: callers passing `src` without `owner` are the vehicles module -> combat skips
  // vehicle damage for them (vehicles own it). Everyone else: combat damages vehicles once here and tags the
  // event noVehicleDamage (always: vehicles' own follow-up event carries their damage) so vehicles only shove. Power is clamped: vehicles pass 30-60 (other units).
  const fromVehicles = opts.owner === undefined && opts.src !== undefined;
  const owner = opts.owner ?? (opts.src === 'player' || opts.src === game.player ? 'player' : null), fromPlayer = owner === 'player' || owner === game.player;
  power = Math.min(Number.isFinite(power) ? power : 1, 4);
  if (fromPlayer) power *= state.mods.explosive;
  if (!opts.noFx) game.fx?.explosion?.(pos, radius * (opts.fxScale || 1), { silent: opts.silent });
  const reach = radius * 1.6, fall = (d) => Math.max(0, 1 - d / reach);
  let kills = 0;
  // enemies
  kills += game.enemies?.blast?.(pos, reach, power, owner) || 0;
  // vehicles
  if (!fromVehicles) for (const v of game.vehicles?.list || []) {
    const vp = v.pos || v.obj?.position || v.position; if (!vp) continue;
    const d = Math.max(0, vp.distanceTo(pos) - 2); if (d > reach) continue;
    damage(v, 220 * power * fall(d), owner, { pos, explosive: true });
  }
  // player
  const p = game.player;
  if (p?.pos && p.state !== 'vehicle') {
    const d = p.pos.distanceTo(pos);
    if (d < reach) {
      const k = fall(d);
      damage(p, 110 * power * k * (fromPlayer ? 0.5 : 1) * (opts.selfScale ?? 1), owner, { pos, dir: p.pos.clone().sub(pos).normalize(), self: true, explosive: true });
      const imp = p.pos.clone().sub(pos).setY(0).normalize().multiplyScalar(14 * k * power); imp.y = 7 * k * power;
      if (p.applyImpulse) p.applyImpulse(imp); else game.events.emit('player:knockback', { impulse: imp });
    }
  }
  // physics: destructibles + dynamic bodies inside the ball
  const P = game.physics, RAP = game.RAPIER, hitD = new Set(), hitB = new Set();
  if (P && RAP) {
    try {
      P.intersectionsWithShape({ x: pos.x, y: pos.y, z: pos.z }, { x: 0, y: 0, z: 0, w: 1 }, new RAP.Ball(reach), (c) => {
        const o = ownerOf(c), dd = destructibleOf(o);
        if (dd) hitD.add(dd); else if (o && !o.isEnemy && !isPlayerThing(o) && !vehicleOf(o) && typeof o.damage === 'function') hitD.add(o);
        const b = c.parent?.();
        if (b && b.isDynamic?.() && !hitB.has(b)) {
          hitB.add(b);
          const t = b.translation(), dx = t.x - pos.x, dy = t.y - pos.y, dz = t.z - pos.z, d = Math.hypot(dx, dy, dz) || 1;
          const k = fall(d) * power * (b.mass?.() || 100) * 16;
          b.applyImpulse({ x: dx / d * k, y: (dy / d + 0.9) * k, z: dz / d * k }, true);
          b.applyTorqueImpulse?.({ x: R(-1, 1) * k * 0.4, y: R(-1, 1) * k * 0.4, z: R(-1, 1) * k * 0.4 }, true);
        }
        return true;
      });
    } catch (e) { /* ignore */ }
  }
  for (const d of game.world?.destructibles || []) {
    if (hitD.has(d)) continue; const dp = d.getWorldPosition?.(V()); if (dp && dp.distanceTo(pos) < reach + 3) hitD.add(d);
  }
  for (const d of hitD) {
    const dp = d.getWorldPosition ? d.getWorldPosition(V()) : pos, dist = Math.max(0, dp.distanceTo(pos) - 3);
    damage(d, 320 * power * Math.max(0.25, fall(dist)), owner, { pos, explosive: true });
  }
  // detonate other stickies / nearby props caught in the blast (chain reactions)
  for (const s of state.sticky.active) if (!s.dead && s.pos.distanceTo(pos) < radius * 0.8) s.fuse = Math.min(s.fuse, R(0.08, 0.2));
  game.events.emit('explosion', { pos, radius, owner, power, combat: true, noVehicleDamage: true });
  if (fromPlayer) game.events.emit('chaos', { amount: Math.round(20 * power), pos, reason: 'explosion' });
  return kills;
}

// ---------------------------------------------------------------- projectiles
const PMAT = {};
function projMesh(type) {
  const g = new T.Group();
  if (type === 'rocket' || type === 'shell') {
    const body = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 0.7, 8).rotateX(Math.PI / 2), PMAT.olive); g.add(body);
    const nose = new T.Mesh(new T.ConeGeometry(0.06, 0.2, 8).rotateX(-Math.PI / 2), PMAT.dark); nose.position.z = -0.45; g.add(nose);
    for (let i = 0; i < 4; i++) { const f = new T.Mesh(new T.BoxGeometry(0.01, 0.12, 0.14), PMAT.dark); f.rotation.z = i * Math.PI / 2; f.position.z = 0.3; f.translateY(0.08); g.add(f); }
  } else if (type === 'sticky') {
    const b = new T.Mesh(new T.BoxGeometry(0.18, 0.08, 0.12), PMAT.olive); g.add(b);
    const led = new T.Mesh(new T.SphereGeometry(0.022, 6, 4), PMAT.led); led.position.y = 0.05; g.add(led); g.userData.led = led;
  } else {
    g.add(new T.Mesh(new T.SphereGeometry(0.07, 8, 6), PMAT.olive));
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function fireProjectile({ from, dir, type = 'rocket', owner = null, target = null, speed, radius, power, vel }) {
  const def = PROJ[type] || PROJ.rocket;
  const d = (dir.isVector3 ? dir.clone() : V(dir.x, dir.y, dir.z)).normalize();
  const p = {
    type, def, owner, target, pos: (from.isVector3 ? from.clone() : V(from.x, from.y, from.z)),
    vel: d.clone().multiplyScalar(speed ?? def.speed), age: 0, fuse: def.fuse, bounces: 0,
    radius: radius ?? def.radius, power: power ?? def.power, mesh: projMesh(type), dead: false, stuck: null,
  };
  if (vel) p.vel.add(vel);
  p.mesh.position.copy(p.pos); game.scene.add(p.mesh);
  if (def.trail) p.trail = game.fx?.trail?.(p.mesh, { size: type === 'grenade' ? 0.25 : 0.55, flame: type !== 'grenade', life: type === 'grenade' ? 1.2 : 2.8 });
  if (type === 'sticky') { state.sticky.active.push(p); }
  projectiles.push(p);
  return p;
}

function detonate() {
  const list = state.sticky.active.filter(s => !s.dead);
  list.forEach((s, i) => { s.fuse = 0.06 + i * 0.09; s.armed = true; });
  if (list.length) try { game.audio?.play?.('detonator', { volume: 0.6 }); } catch { /* optional */ }
  return list.length;
}

function killProjectile(p, explodeIt = true) {
  if (p.dead) return; p.dead = true;
  p.trail?.stop?.();
  p.mesh.removeFromParent();
  if (explodeIt) explode(p.pos, p.radius, p.power, { owner: p.owner });
  const i = state.sticky.active.indexOf(p); if (i >= 0) state.sticky.active.splice(i, 1);
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    if (p.dead) { projectiles.splice(i, 1); continue; }
    p.age += dt; p.fuse -= dt;
    if (p.stuck) {
      const s = p.stuck;
      if (s.obj?.isObject3D) { s.obj.updateWorldMatrix(true, false); p.pos.copy(s.local).applyMatrix4(s.obj.matrixWorld); }
      else if (s.enemy) { if (s.enemy.obj) { s.enemy.obj.updateWorldMatrix(true, false); p.pos.copy(s.local).applyMatrix4(s.enemy.obj.matrixWorld); } }
      p.mesh.position.copy(p.pos);
      const led = p.mesh.userData.led; if (led) led.visible = (p.age * (p.armed ? 12 : 2)) % 1 < 0.5;
      if (p.fuse <= 0) killProjectile(p);
      continue;
    }
    if (p.fuse <= 0) { killProjectile(p, p.type !== 'sticky'); continue; }
    // homing
    if (p.target && p.type === 'rocket' && p.age > 0.12) {
      const tp = targetPos(p.target);
      if (tp) {
        const want = tp.clone().sub(p.pos).normalize(), cur = p.vel.clone().normalize(), sp = p.vel.length();
        const ang = cur.angleTo(want), maxTurn = 2.4 * dt;
        if (ang > 1e-3) cur.lerp(want, Math.min(1, maxTurn / ang)).normalize();
        p.vel.copy(cur.multiplyScalar(Math.min(sp + 40 * dt, 120)));
      }
    } else if (p.type === 'rocket') p.vel.multiplyScalar(1 + 0.25 * dt);
    p.vel.y -= p.def.grav * dt;
    const step = p.vel.clone().multiplyScalar(dt), len = step.length();
    if (len > 1e-5) {
      const dir = step.clone().divideScalar(len);
      const hit = raycast(p.pos, dir, len + 0.05, excludeFor(p.owner));
      if (hit) {
        if (p.def.stick) {
          p.pos.copy(hit.point).addScaledVector(hit.normal, 0.04);
          const o = hit.owner, holder = o?.isEnemy ? o.obj : (vehicleOf(o)?.obj || (o?.isObject3D ? o : null));
          if (holder) { holder.updateWorldMatrix(true, false); p.stuck = { obj: holder, local: p.pos.clone().applyMatrix4(holder.matrixWorld.clone().invert()) }; }
          else p.stuck = { obj: null };
          p.mesh.position.copy(p.pos); p.mesh.quaternion.setFromUnitVectors(V(0, 1, 0), hit.normal);
          try { game.audio?.play?.('stick', { pos: p.pos, volume: 0.5 }); } catch { /* optional */ }
          continue;
        }
        const directHit = hit.owner?.isEnemy || vehicleOf(hit.owner);
        if (p.def.impact && (p.type !== 'grenade' || directHit || p.age > 0.12)) {
          p.pos.copy(hit.point).addScaledVector(hit.normal, 0.3);
          if (directHit) damage(hit.owner, p.type === 'rocket' || p.type === 'shell' ? 180 : 80, p.owner, { pos: hit.point });
          killProjectile(p); continue;
        }
        // bounce
        p.pos.copy(hit.point).addScaledVector(hit.normal, 0.08);
        const vn = hit.normal.clone().multiplyScalar(p.vel.dot(hit.normal));
        p.vel.sub(vn.multiplyScalar(1.45)).multiplyScalar(0.55);
        if (p.bounces++ < 3) game.fx?.dust?.(p.pos, { count: 2, size: 0.4 });
        continue;
      }
      p.pos.add(step);
    }
    if (game.world?.isWater?.(p.pos.x, p.pos.z) && p.pos.y < (game.world.seaLevel ?? 0)) {
      game.fx?.splash?.(p.pos, 0.6);
      if (p.def.impact) { killProjectile(p); continue; }
      p.vel.multiplyScalar(0.2);
    }
    p.mesh.position.copy(p.pos);
    if (p.vel.lengthSq() > 0.01) p.mesh.lookAt(p.pos.clone().sub(p.vel));
    if (p.age > 20) killProjectile(p, false);
  }
}

function targetPos(t) {
  if (!t) return null;
  if (t.isVector3) return t;
  const v = t.pos || t.obj?.position || t.position;
  if (!v) return null;
  if (t.dead || t.destroyed || t.hp <= 0) return null;
  return v;
}

// ---------------------------------------------------------------- hitscan
function hitscan({ from, dir, range = 300, damage: dmg = 20, owner = null, tracer = true, color, pierce = false, impactSize = 1 }) {
  const hit = raycast(from, dir, range, excludeFor(owner));
  const end = hit ? hit.point : from.clone().addScaledVector(dir, range);
  if (tracer) game.fx?.tracer?.(from, end, { color });
  if (hit) {
    const o = hit.owner;
    const head = o?.isEnemy && hit.point.y > (o.pos?.y ?? 0) + 1.42;
    const target = o?.isEnemy ? o : (isPlayerThing(o) ? game.player : (vehicleOf(o) || destructibleOf(o) || (typeof o?.damage === 'function' ? o : null)));
    game.fx?.impact?.(hit.point, hit.normal, hit.surface, { size: isPlayerThing(o) ? 0.5 : impactSize, decal: !o || (!o.isEnemy && !vehicleOf(o) && !isPlayerThing(o)) });
    // grab the body BEFORE damage: a kill removes the enemy's rigid body and the stale collider handle panics Rapier
    let b = null; try { b = !o?.isEnemy ? hit.collider?.parent?.() : null; } catch { b = null; }
    if (target) damage(target, head ? dmg * 2.5 : dmg, owner, { pos: hit.point, dir, head, normal: hit.normal });
    else if (isPlayerThing(o)) damage(game.player, dmg, owner, { pos: hit.point, dir });
    if (o?.isEnemy && o.applyImpulse) o.applyImpulse(dir.clone().multiplyScalar(dmg * 0.04), true);
    // knock dynamic props
    if (b && game.physics.getRigidBody?.(b.handle) && b.isDynamic()) b.applyImpulseAtPoint({ x: dir.x * dmg * 0.6, y: dir.y * dmg * 0.6, z: dir.z * dmg * 0.6 }, hit.point, true);
    if (pierce && o?.isEnemy && range - hit.dist > 2) return hitscan({ from: hit.point.clone().addScaledVector(dir, 0.6), dir, range: range - hit.dist, damage: dmg * 0.6, owner, tracer: false });
  }
  return hit;
}

// ---------------------------------------------------------------- player weapons
function curDef() { return WEAPONS[state.current]; }
function magSize(w) { return Math.max(1, Math.round(w.mag * (w.projectile ? 1 : state.mods.mag))); }
function select(id) {
  if (!WEAPONS[id] || !state.owned.has(id) || id === state.current) return;
  state.current = id; state.reloading = 0; state.cooldown = Math.max(state.cooldown, 0.35);
  state.lock = { target: null, progress: 0, locked: false };
  for (const [k, m] of Object.entries(models)) m.visible = k === id;
  game.events.emit('weapon:switch', { id });
  try { game.audio?.play?.('weaponSwitch', { volume: 0.4 }); } catch { /* optional */ }
}
function give(id, ammo) {
  if (!WEAPONS[id]) return;
  state.owned.add(id);
  const a = state.ammo[id] ||= { mag: magSize(WEAPONS[id]), reserve: WEAPONS[id].reserve };
  if (ammo) a.reserve += ammo;
}
function addAmmo(id = 'all', n) {
  const ids = id === 'all' ? Object.keys(WEAPONS) : [id];
  for (const k of ids) { const a = state.ammo[k]; if (a) a.reserve = Math.min(WEAPONS[k].reserve * 2, a.reserve + (n ?? WEAPONS[k].reserve * 0.5) | 0); }
  if (id === 'all' || id === 'sticky') state.sticky.count = state.mods.stickyMax;
}
function startReload() {
  const w = curDef(), a = state.ammo[w.id];
  if (state.reloading > 0 || a.mag >= magSize(w) || a.reserve <= 0) return;
  state.reloading = w.reload / state.mods.reload;
  game.events.emit('reload', { id: w.id });
  try { game.audio?.play?.('reload', { volume: 0.5 }); } catch { /* optional */ }
}

const camFwd = () => game.camera.getWorldDirection(V());
function muzzlePos() {
  const m = models[state.current];
  if (m?.visible && m.userData.muzzle) return m.userData.muzzle.getWorldPosition(V());
  const p = game.player?.pos || game.camera.position;
  return p.clone().add(V(0, 1.4, 0)).addScaledVector(camFwd(), 0.8);
}

function aimPoint(spreadDeg) {
  const cam = game.camera, f = camFwd();
  if (spreadDeg > 0) {
    const up = V(0, 1, 0).applyQuaternion(cam.quaternion), right = V(1, 0, 0).applyQuaternion(cam.quaternion);
    const r = Math.tan(spreadDeg * deg) * Math.sqrt(Math.random()), a = Math.random() * 6.283;
    f.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
  }
  // start past the player so we don't hit ourselves
  const pp = game.player?.pos, o = cam.position.clone();
  const skip = pp ? Math.max(0, pp.clone().sub(o).dot(f)) : 0;
  o.addScaledVector(f, skip * 0.9);
  const hit = raycast(o, f, curDef().range, excludePlayer);
  return hit ? hit.point : o.clone().addScaledVector(f, curDef().range);
}

// ADS aim assist ("bullet magnetism", standard for pad-friendly shooters): when aiming down sights and an enemy's
// VISIBLE part sits within a small cone of the crosshair, the shot goes to that part. Fixes the common case of a
// soldier whose chest is behind a low wall while his head shows over it (crosshair on chest = every round in the wall).
function magnet(from, w) {
  const list = game.enemies?.list; if (!list?.length) return null;
  const cam = game.camera.position, f = camFwd(), cone = Math.cos(2.5 * deg);
  let best = null, bestDot = cone;
  for (const e of list) {
    if (e.dead || !e.pos) continue;
    for (const hgt of [1.25, 1.62, 0.9]) {
      const p = V(e.pos.x, e.pos.y + hgt, e.pos.z), to = p.clone().sub(cam), dist = to.length();
      if (dist > w.range || dist < 1) continue;
      const dot = to.divideScalar(dist).dot(f); if (dot <= bestDot) continue;
      const o = camLineStart(p), d = p.clone().sub(o), dl = d.length(); d.divideScalar(dl);
      const h = raycast(o, d, dl + 1, excludePlayer);
      if (h?.owner === e) { best = p; bestDot = dot; break; }
    }
  }
  return best;
}
// a point on the camera->target line just past the player's body (what the player actually sees from)
function camLineStart(tp) {
  const cam = game.camera.position, f = tp.clone().sub(cam).normalize(), pp = game.player?.pos;
  const skip = pp ? Math.max(0, pp.clone().add(V(0, 1.2, 0)).sub(cam).dot(f)) : 0;
  return cam.clone().addScaledVector(f, skip + 0.7);
}
// third-person parallax: the camera sees over a low wall the gun is behind. If the muzzle->target line is blocked
// right in front of the gun, fire along the camera line instead (standard TPS fix; otherwise every round hits the wall).
function shotOrigin(from, tp) {
  const d = tp.clone().sub(from), L = d.length(); if (L < 2) return from; d.divideScalar(L);
  const h = raycast(from, d, L - 0.6, excludePlayer);
  if (!h || h.dist > 6 || h.owner?.isEnemy) return from;
  return camLineStart(tp);
}
function fire() {
  const w = curDef(), a = state.ammo[w.id];
  if (a.mag <= 0) { if (a.reserve > 0) startReload(); else try { game.audio?.play?.('dryfire', { volume: 0.5 }); } catch { /* */ } state.cooldown = 0.25; return; }
  a.mag--; state.cooldown = 60 / w.rpm; state.lastFire = game.simTime;
  const spread = state.spread, from = muzzlePos();
  if (w.projectile) {
    const tp = aimPoint(spread * 0.3), dir = tp.sub(from).normalize();
    fireProjectile({ from: from.clone().addScaledVector(dir, 0.5), dir, type: w.projectile, owner: 'player', target: w.lockOn && state.lock.locked ? state.lock.target : null, vel: game.player?.vel });
    if (w.projectile === 'rocket') game.fx?.smoke?.(from.clone().addScaledVector(dir, -1.2), { count: 6, size: 0.8, life: 1.5, color: [0.8, 0.78, 0.75], rise: 0.5 });
    state.lock = { target: null, progress: 0, locked: false };
  } else {
    const n = w.pellets || 1, mag = state.aiming && n === 1 ? magnet(from, w) : null;
    for (let i = 0; i < n; i++) {
      const tp = mag ? mag.clone().add(V(R(-0.12, 0.12), R(-0.12, 0.12), R(-0.12, 0.12))) : aimPoint(spread), o = shotOrigin(from, tp), dir = tp.sub(o).normalize();
      hitscan({ from: o, dir, range: w.range, damage: w.dmg, owner: 'player', tracer: n === 1 || i < 3, pierce: w.pierce, impactSize: w.id === 'sniper' ? 2 : 1 });
    }
  }
  game.fx?.muzzle?.(from, camFwd(), { size: w.id === 'shotgun' || w.id === 'sniper' ? 1.6 : w.projectile ? 1.3 : 1 });
  state.spread = Math.min(w.maxSpread, state.spread + w.bloom);
  const rp = w.recoil * state.mods.recoil * (state.aiming ? 0.6 : 1), ry = rp * R(-0.4, 0.4);
  if (game.cam?.addRecoil) game.cam.addRecoil(rp, ry); else game.cam?.kick?.(rp, ry);
  game.events.emit('recoil', { pitch: rp, yaw: ry });
  if (w.id === 'shotgun' || w.id === 'sniper' || w.projectile) game.gfx?.shake?.(w.projectile ? 0.25 : 0.15, 0.15);
  // punch: tiny camera trauma per shot (trauma^2 -> rifles barely shimmer, shotgun/sniper/rocket thump) + fov kick
  const punch = { rifle: 0.12, smg: 0.09, shotgun: 0.34, sniper: 0.4, rocket: 0.42, gl: 0.26 }[w.id] ?? 0.1;
  const c = game.cam; if (c) { const k = punch * (state.aiming ? 0.7 : 1); if (Number.isFinite(c.trauma)) c.trauma = Math.max(c.trauma, k); else c.shake?.(k * 0.3); if (punch > 0.2) c.fovKick?.(punch * 4); }
  try { game.audio?.play?.('shot_' + w.sound, { pos: from, volume: 0.8 }); } catch { /* optional */ }
  game.events.emit('combat:fire', { pos: from, dir: camFwd(), weapon: w.id, owner: 'player', loud: w.id === 'sniper' || !!w.projectile ? 2 : 1 });
  if (w.id === 'shotgun' || w.id === 'sniper') state.pumpT = 0.25;
  if (a.mag <= 0 && a.reserve > 0) setTimeout(startReload, 200);
}

function throwSticky() {
  if (state.sticky.count <= 0) { try { game.audio?.play?.('dryfire', { volume: 0.4 }); } catch { /* */ } return; }
  if (state.sticky.active.length >= state.mods.stickyMax) { killProjectile(state.sticky.active[0]); }
  state.sticky.count--;
  const p = game.player, from = (p?.pos || game.camera.position).clone().add(V(0, 1.5, 0));
  const tp = aimPoint(0); const dir = tp.sub(from).normalize(); dir.y += 0.12; dir.normalize();
  fireProjectile({ from, dir, type: 'sticky', owner: 'player', vel: p?.vel });
  try { game.audio?.play?.('throw', { pos: from, volume: 0.5 }); } catch { /* optional */ }
}

function updateLock(dt) {
  const w = curDef();
  if (!w.lockOn || !state.aiming) { if (state.lock.target) state.lock = { target: null, progress: 0, locked: false }; return; }
  const f = camFwd(), c = game.camera.position;
  let best = null, bestA = 9 * deg;
  for (const v of game.vehicles?.list || []) {
    if (v === game.player?.vehicle || v.dead || v.destroyed) continue;
    const vp = targetPos(v); if (!vp) continue;
    const to = vp.clone().sub(c), d = to.length(); if (d > 800 || d < 8) continue;
    const ang = to.normalize().angleTo(f); if (ang < bestA) { bestA = ang; best = v; }
  }
  if (best !== state.lock.target) state.lock = { target: best, progress: 0, locked: false };
  if (best) {
    const before = state.lock.locked;
    state.lock.progress = Math.min(1, state.lock.progress + dt / 0.8);
    state.lock.locked = state.lock.progress >= 1;
    if (state.lock.locked && !before) try { game.audio?.play?.('lockon', { volume: 0.5 }); } catch { /* */ }
    game.events.emit('lockon', { ...state.lock });
  }
}

// ---------------------------------------------------------------- weapon models
function buildModels() {
  const metal = new T.MeshStandardMaterial({ color: 0x23262a, roughness: 0.45, metalness: 0.8 });
  const poly = new T.MeshStandardMaterial({ color: 0x1a1b1c, roughness: 0.8, metalness: 0.1 });
  const olive = PMAT.olive, tan = new T.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.8 });
  const glass = new T.MeshStandardMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.9, emissive: 0x112233 });
  const B = (w, h, d, m, x, y, z) => { const o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
  const C = (r, l, m, x, y, z, seg = 10) => { const o = new T.Mesh(new T.CylinderGeometry(r, r, l, seg).rotateX(Math.PI / 2), m); o.position.set(x, y, z); return o; };
  const mk = (parts, muzzleZ, muzzleY = 0.03) => {
    const g = new T.Group(); parts.forEach(p => g.add(p));
    const mz = new T.Object3D(); mz.position.set(0, muzzleY, muzzleZ); g.add(mz); g.userData.muzzle = mz;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; } }); g.visible = false; return g;
  };
  // -Z is forward
  models.rifle = mk([B(0.07, 0.1, 0.42, metal, 0, 0.02, -0.05), C(0.017, 0.38, metal, 0, 0.035, -0.45), B(0.06, 0.07, 0.22, olive, 0, 0.02, -0.33),
    B(0.04, 0.16, 0.08, poly, 0, -0.1, -0.06), B(0.05, 0.12, 0.05, poly, 0, -0.07, 0.08), B(0.05, 0.09, 0.26, olive, 0, -0.01, 0.3),
    B(0.03, 0.04, 0.16, metal, 0, 0.1, -0.05), C(0.025, 0.08, glass, 0, 0.12, -0.06, 8), C(0.022, 0.06, metal, 0, 0.035, -0.67)], -0.7);
  models.smg = mk([B(0.06, 0.1, 0.3, metal, 0, 0.02, -0.02), C(0.016, 0.16, metal, 0, 0.03, -0.25), C(0.026, 0.14, poly, 0, 0.03, -0.38),
    B(0.04, 0.2, 0.05, poly, 0, -0.12, -0.08), B(0.045, 0.11, 0.05, poly, 0, -0.06, 0.07), B(0.02, 0.02, 0.22, metal, 0, 0.02, 0.22)], -0.46);
  models.shotgun = mk([B(0.07, 0.1, 0.36, metal, 0, 0.02, -0.02), C(0.022, 0.52, metal, 0, 0.05, -0.45), C(0.02, 0.4, metal, 0, 0.0, -0.38),
    B(0.06, 0.06, 0.2, tan, 0, 0.0, -0.42), B(0.05, 0.12, 0.05, poly, 0, -0.07, 0.1), B(0.055, 0.1, 0.3, tan, 0, -0.01, 0.3)], -0.72, 0.05);
  models.sniper = mk([B(0.07, 0.1, 0.5, olive, 0, 0.02, -0.02), C(0.02, 0.7, metal, 0, 0.04, -0.6), C(0.035, 0.12, metal, 0, 0.04, -0.97),
    C(0.035, 0.34, poly, 0, 0.14, -0.05), C(0.045, 0.04, glass, 0, 0.14, -0.23), B(0.05, 0.12, 0.05, poly, 0, -0.08, 0.12), B(0.06, 0.12, 0.32, olive, 0, 0.0, 0.38),
    B(0.01, 0.2, 0.01, metal, 0.03, -0.1, -0.45), B(0.01, 0.2, 0.01, metal, -0.03, -0.1, -0.45)], -1.03, 0.04);
  models.rocket = mk([C(0.075, 1.1, olive, 0, 0.08, -0.1, 12), C(0.09, 0.08, metal, 0, 0.08, -0.66, 12), C(0.09, 0.1, metal, 0, 0.08, 0.45, 12),
    B(0.04, 0.14, 0.05, poly, 0, -0.04, -0.05), B(0.04, 0.14, 0.05, poly, 0, -0.04, 0.15), B(0.1, 0.08, 0.14, metal, 0.11, 0.12, -0.15)], -0.72, 0.08);
  models.gl = mk([C(0.05, 0.36, metal, 0, 0.04, -0.3, 12), C(0.085, 0.16, olive, 0, 0.0, -0.05, 6), B(0.06, 0.1, 0.3, poly, 0, 0.04, 0.05),
    B(0.045, 0.13, 0.05, poly, 0, -0.07, 0.08), B(0.05, 0.1, 0.24, poly, 0, 0.0, 0.3)], -0.5, 0.04);
  gunRoot = new T.Group(); gunRoot.name = 'weapon-root';
  for (const m of Object.values(models)) gunRoot.add(m);
  game.scene.add(gunRoot);
}

const _q = { a: null };
function updateModel(dt) {
  const p = game.player, m = models[state.current];
  if (!gunRoot) return;
  const show = !!p && (p.obj || p.pos) && !['vehicle', 'swim', 'dead', 'wingsuit', 'parachute'].includes(p.state) && game.state !== 'title';
  gunRoot.visible = show;
  if (!show) return;
  for (const [k, mm] of Object.entries(models)) mm.visible = k === state.current;
  const hand = p.getBone?.('hand_r');
  let pos;
  const fwd = camFwd();
  const yaw = Math.atan2(-fwd.x, -fwd.z);
  const active = state.aiming || game.simTime - state.lastFire < 1.2 || state.throwHeld > 0;
  if (hand) pos = hand.getWorldPosition(V());
  else {
    const base = (p.obj?.position || p.pos).clone();
    const fy = active ? yaw : (p.obj ? new T.Euler().setFromQuaternion(p.obj.quaternion, 'YXZ').y + Math.PI : yaw);
    const right = V(Math.cos(fy), 0, -Math.sin(fy)), fw = V(-Math.sin(fy), 0, -Math.cos(fy));
    pos = base.add(V(0, active ? 1.38 : 1.05, 0)).addScaledVector(right, active ? 0.22 : 0.26).addScaledVector(fw, active ? 0.32 : 0.12);
  }
  gunRoot.position.lerp(pos, Math.min(1, dt * 30) || 1);
  if (gunRoot.position.distanceTo(pos) > 2) gunRoot.position.copy(pos);
  let q;
  // Matrix4.lookAt(eye, target) aims local +Z at (eye - target); the models' barrels are -Z, so target = +fwd
  if (active) { q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(V(), fwd, V(0, 1, 0))); }
  else {
    const fy = p.obj ? new T.Euler().setFromQuaternion(p.obj.quaternion, 'YXZ').y + Math.PI : yaw;
    q = new T.Quaternion().setFromEuler(new T.Euler(-0.65, fy, 0.2, 'YXZ'));
  }
  // recoil kick + reload dip on the model
  const since = game.simTime - state.lastFire, kick = Math.max(0, 1 - since * 12) * (curDef().recoil * 6);
  const rel = state.reloading > 0 ? Math.sin(Math.min(1, 1 - state.reloading / (curDef().reload / state.mods.reload)) * Math.PI) : 0;
  const local = new T.Quaternion().setFromEuler(new T.Euler(kick + rel * 0.8, 0, rel * 0.5));
  gunRoot.quaternion.slerp(q.multiply(local), Math.min(1, dt * 22) || 1);
  if (m) m.position.z = kick * 0.4;
}

// ---------------------------------------------------------------- crosshair UI
function buildUI() {
  const hud = document.getElementById('hud') || document.body;
  const el = document.createElement('div'); el.id = 'combat-ui';
  el.innerHTML = `<style>
  #combat-ui{position:fixed;inset:0;pointer-events:none;z-index:6}
  #ch{position:absolute;left:50%;top:50%;width:0;height:0;transition:opacity .15s}
  #ch i{position:absolute;background:#fff;box-shadow:0 0 2px #000a;border-radius:1px}
  #ch .d{width:3px;height:3px;left:-1.5px;top:-1.5px;border-radius:50%}
  #ch-hit{position:absolute;left:50%;top:50%;width:18px;height:18px;border:2px solid #fff;border-width:0 2px;opacity:0;transform:translate(-50%,-50%) rotate(45deg);transition:opacity .08s}
  #ch-lock{position:absolute;width:56px;height:56px;border:2px solid #ffb02e;transform:translate(-50%,-50%) rotate(45deg);opacity:0;box-shadow:0 0 8px #ff8a00}
  #ch-rel{position:absolute;left:50%;top:50%;width:34px;height:34px;transform:translate(-50%,-50%);opacity:0}
  #ch-scope{position:absolute;inset:0;opacity:0;transition:opacity .2s;background:radial-gradient(circle at 50% 50%,transparent 0 34vh,#000 34.3vh)}
  #ch-scope:before,#ch-scope:after{content:'';position:absolute;background:#000c}#ch-scope:before{left:0;right:0;top:50%;height:1px}#ch-scope:after{top:0;bottom:0;left:50%;width:1px}
  </style><div id="ch-scope"></div><div id="ch"><i class="d"></i><i class="u"></i><i class="b"></i><i class="l"></i><i class="r"></i></div><div id="ch-hit"></div><div id="ch-lock"></div>
  <svg id="ch-rel" viewBox="0 0 34 34"><circle cx="17" cy="17" r="14" fill="none" stroke="#fff4" stroke-width="3"/><circle id="ch-relc" cx="17" cy="17" r="14" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="88" stroke-dashoffset="88" transform="rotate(-90 17 17)"/></svg>`;
  hud.appendChild(el);
  ui = { root: el, ch: el.querySelector('#ch'), hit: el.querySelector('#ch-hit'), lock: el.querySelector('#ch-lock'), rel: el.querySelector('#ch-rel'), relc: el.querySelector('#ch-relc'), scope: el.querySelector('#ch-scope'), hitT: 0,
    u: el.querySelector('#ch .u'), b: el.querySelector('#ch .b'), l: el.querySelector('#ch .l'), r: el.querySelector('#ch .r') };
}
function updateUI(dt) {
  if (!ui.root) return;
  const show = game.state === 'play' && game.combat.ownCrosshair !== false && game.player && game.player.state !== 'vehicle';
  ui.root.style.display = show ? '' : 'none';
  if (!show) return;
  const px = Math.tan(state.spread * deg) / Math.tan(game.camera.fov * deg / 2) * innerHeight / 2 + 4;
  game.combat.spreadPx = px;
  const L = 8, W = 2;
  Object.assign(ui.u.style, { width: W + 'px', height: L + 'px', left: -W / 2 + 'px', top: -px - L + 'px' });
  Object.assign(ui.b.style, { width: W + 'px', height: L + 'px', left: -W / 2 + 'px', top: px + 'px' });
  Object.assign(ui.l.style, { width: L + 'px', height: W + 'px', top: -W / 2 + 'px', left: -px - L + 'px' });
  Object.assign(ui.r.style, { width: L + 'px', height: W + 'px', top: -W / 2 + 'px', left: px + 'px' });
  const scoped = state.aiming && state.current === 'sniper';
  ui.scope.style.opacity = scoped ? 1 : 0; ui.ch.style.opacity = scoped ? 0 : 1;
  if (ui.hitT > 0) { ui.hitT -= dt; if (ui.hitT <= 0) ui.hit.style.opacity = 0; }
  const lk = state.lock;
  if (lk.target && targetPos(lk.target)) {
    const sp = targetPos(lk.target).clone().project(game.camera);
    ui.lock.style.opacity = sp.z < 1 ? 1 : 0;
    ui.lock.style.left = (sp.x * 0.5 + 0.5) * innerWidth + 'px'; ui.lock.style.top = (-sp.y * 0.5 + 0.5) * innerHeight + 'px';
    const s = 1.8 - lk.progress * 0.8; ui.lock.style.transform = `translate(-50%,-50%) rotate(45deg) scale(${s})`;
    ui.lock.style.borderColor = lk.locked ? '#ff3b2e' : '#ffb02e';
  } else ui.lock.style.opacity = 0;
  if (state.reloading > 0) { ui.rel.style.opacity = 1; const tot = curDef().reload / state.mods.reload; ui.relc.setAttribute('stroke-dashoffset', 88 * (state.reloading / tot)); }
  else ui.rel.style.opacity = 0;
}

// ---------------------------------------------------------------- module
// Big props (fuel, silos, radar, SAM, towers) go off a beat after the world swaps them for wreckage: a delayed
// secondary blast that hurts enemies/player/vehicles and damages OTHER destructibles in reach (via
// world.damageDestructible inside damage()), so a row of fuel tanks cooks off one after another.
// kind: [blast radius (people/vehicles), power, cook-off reach for OTHER volatile props (fuel/silos/barrels/generators)]
const CHAIN = { fuelTank: [9, 1.1, 36], gasSilo: [11, 1.3, 36], radar: [6, 0.8, 0], sam: [7, 1, 14], commAntenna: [5, 0.7, 0], satUplink: [5, 0.7, 0],
  generator: [4.5, 0.6, 12], transformer: [4.5, 0.6, 10], barrel: [5, 0.8, 12], mission_fuel: [9, 1.1, 36], mission_generator: [5, 0.7, 12], mission_tower: [5, 0.7, 0] };
const VOLATILE = /fuel|silo|barrel|generator|transformer|sam/i;
const chainQ = [], chainHits = [];
function onDestroyed(d) {
  const c = CHAIN[d?.kind]; if (!c || !d.pos) return;
  if (chainQ.length > 24) return;
  const pos = d.pos.isVector3 ? d.pos.clone() : V(d.pos.x, d.pos.y, d.pos.z);
  chainQ.push({ t: R(0.18, 0.45), pos, radius: c[0], power: c[1], reach: c[2], kind: d.kind, obj: d.obj });
}
function updateChain(dt) {
  for (let i = chainQ.length - 1; i >= 0; i--) {
    const q = chainQ[i]; q.t -= dt; if (q.t > 0) continue;
    chainQ.splice(i, 1);
    // fx: the signature blast already happened at destroy time; add the secondary cook-off pops only
    // owner 'player': the player lit the first one, so chain kills/chaos are theirs and self-damage is halved
    explode(q.pos, q.radius, q.power, { owner: 'player', noFx: true, selfScale: 0.5 });
    game.fx?.secondary?.(q.pos, q.radius);
    // long-range cook-off: burning fuel sets off other volatile props further out than the blast itself, each a beat later
    if (q.reach > 0) for (const o of game.world?.destructibles || []) {
      const ud = o.userData; if (!ud?.alive || o === q.obj || !VOLATILE.test(ud.destructible?.kind || '')) continue;
      const op = o.getWorldPosition(V()), dd = op.distanceTo(q.pos); if (dd > q.reach) continue;
      const amt = (ud.destructible.maxHp || ud.destructible.hp || 100) * (dd < q.reach * 0.85 ? 1.2 : 0.6) + 5;
      chainHits.push({ t: 0.15 + dd * 0.025 + R(0, 0.2), obj: o, amt, pos: op });
    }
  }
  for (let i = chainHits.length - 1; i >= 0; i--) {
    const h = chainHits[i]; h.t -= dt; if (h.t > 0) continue;
    chainHits.splice(i, 1);
    if (h.obj.userData?.alive) damage(h.obj, h.amt, 'chain', { pos: h.pos, explosive: true });
  }
}

function onKey(e) { if (e.code === 'KeyV' && game.state === 'play') detonate(); }

export default {
  name: 'combat',
  init(g) {
    game = g; T = g.THREE;
    PMAT.olive = new T.MeshStandardMaterial({ color: 0x4a4d34, roughness: 0.7, metalness: 0.2 });
    PMAT.dark = new T.MeshStandardMaterial({ color: 0x202020, roughness: 0.6, metalness: 0.5 });
    PMAT.led = new T.MeshBasicMaterial({ color: 0xff2a1a });
    for (const w of Object.values(WEAPONS)) state.ammo[w.id] = { mag: magSize(w), reserve: w.reserve };
    buildModels(); buildUI();
    addEventListener('keydown', onKey);
    g.events.on('destructible:destroyed', d => { try { onDestroyed(d); } catch (e) { console.warn('[combat] chain', e); } });
    g.combat = {
      weapons: WEAPONS, projectileTypes: PROJ, state,
      get slots() { return state.slots; }, get owned() { return state.owned; },
      get current() { return state.current; }, get weapon() { return WEAPONS[state.current]; },
      get ammo() { return state.ammo[state.current]; }, ammoOf: (id) => state.ammo[id],
      get magSize() { return magSize(WEAPONS[state.current]); },
      get reloading() { return state.reloading > 0; }, get reloadT() { return state.reloading; },
      get sticky() { return state.sticky; }, get spread() { return state.spread; }, get aiming() { return state.aiming; },
      get lock() { return state.lock; }, get mods() { return state.mods; },
      get projectiles() { return projectiles; },
      ownCrosshair: true, spreadPx: 0,
      damage, explode, fireProjectile, hitscan, raycast, give, addAmmo, select, hitstop, detonate, ownerOf,
    };
  },
  update(dt) {
    if (!game.combat) return;
    updateProjectiles(dt);
    if (dt > 0) updateChain(dt);
    const inp = game.input, p = game.player, w = curDef();
    const canAct = game.state === 'play' && !game.paused && p && p.state !== 'dead' && p.state !== 'vehicle';
    state.cooldown -= dt;
    if (state.reloading > 0) {
      state.reloading -= dt;
      if (state.reloading <= 0) {
        const a = state.ammo[w.id], need = magSize(w) - a.mag;
        if (w.perShell) { const n = Math.min(1, need, a.reserve); a.mag += n; a.reserve -= n; if (a.mag < magSize(w) && a.reserve > 0 && !(inp.down('fire') && a.mag > 0)) state.reloading = w.perShell / state.mods.reload; }
        else { const n = Math.min(need, a.reserve); a.mag += n; a.reserve -= n; }
      }
    }
    const wasAim = state.aiming;
    state.aiming = canAct && inp.down('aim') && !['parachute', 'wingsuit', 'grapple'].includes(p.state);
    if (state.aiming !== wasAim) { game.events.emit('aim', { on: state.aiming, fov: w.fov }); game.cam?.setAim?.(state.aiming, w.fov); }
    // spread recovery: tighter when aiming / still / crouched
    const moving = p?.vel ? Math.hypot(p.vel.x, p.vel.z) : 0;
    const base = (state.aiming ? w.ads : w.hip) * (1 + Math.min(1.2, moving / 6)) * (p?.state === 'air' ? 1.8 : 1) * (inp.down('crouch') ? 0.75 : 1);
    state.spread += (base - state.spread) * Math.min(1, dt * (state.spread > base ? 5 : 12));
    if (canAct) {
      for (let s = 0; s < 3; s++) if (inp.pressed('weapon' + (s + 1))) {
        const opts = state.slots[s].filter(id => state.owned.has(id));
        if (opts.length) select(WEAPONS[state.current].slot === s ? opts[(opts.indexOf(state.current) + 1) % opts.length] : opts[0]);
      }
      if (inp.wheel) {
        const all = state.slots.flat().filter(id => state.owned.has(id));
        const i = all.indexOf(state.current); select(all[(i + Math.sign(inp.wheel) + all.length) % all.length]);
      }
      if (inp.pressed('reload')) startReload();
      const want = w.auto ? inp.down('fire') : inp.pressed('fire');
      if (want && state.cooldown <= 0) {
        if (state.reloading > 0 && w.perShell && state.ammo[w.id].mag > 0) state.reloading = 0;
        if (state.reloading <= 0) fire();
      }
      // sticky: tap G throws, hold G detonates
      if (inp.down('throw')) {
        state.throwHeld += dt;
        if (state.throwHeld > 0.35 && !state.detonatedThisHold) { state.detonatedThisHold = true; detonate(); }
      } else if (state.throwHeld > 0) {
        if (!state.detonatedThisHold) throwSticky();
        state.throwHeld = 0; state.detonatedThisHold = false;
      }
      updateLock(dt);
    } else { state.throwHeld = 0; state.detonatedThisHold = false; }
  },
  lateUpdate(dt) { if (!game.combat) return; updateModel(dt); updateUI(dt); },
};
