// STORMBREAK vehicles: every vehicle drivable, hijackable, destructible.
// Cars/trucks/tanks/planes use Rapier's DynamicRayCastVehicleController for suspension; helicopters
// and boats are arcade force models. Also runs civilian traffic and streams parked world spawns.
import * as THREE from 'three';
import { DEFS, PAINTS, REGIME, resolveType } from './vehicles/defs.js';
import { buildVisual, buildPerson, materials } from './vehicles/models.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _v = V(), _w = V(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const STEP = 1 / 60;
let game, R, scene;
const list = [];
const colliderOwner = new Map();
let nextId = 1;

// ---------------- particles (own pool: smoke / fire / flash) ----------------
const FX = {
  init() {
    const mk = (n, blending) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('pcol', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
      g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1));
      const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending,
        vertexShader: `attribute float size; attribute vec4 pcol; varying vec4 vC; void main(){ vC=pcol; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=size*600./-mv.z; gl_Position=projectionMatrix*mv; }`,
        fragmentShader: `varying vec4 vC; void main(){ vec2 p=gl_PointCoord-.5; float d=length(p); if(d>.5) discard; gl_FragColor=vec4(vC.rgb, vC.a*smoothstep(.5,.1,d)); }` });
      const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 5; scene.add(pts);
      return { pts, n, i: 0, p: Array.from({ length: n }, () => ({ life: 0 })) };
    };
    this.smoke = mk(1400, THREE.NormalBlending); this.fire = mk(900, THREE.AdditiveBlending);
  },
  emit(pool, pos, vel, life, size, grow, col) {
    const p = pool.p[pool.i = (pool.i + 1) % pool.n];
    Object.assign(p, { x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z, life, max: life, size, grow, col });
  },
  update(dt) {
    for (const pool of [this.smoke, this.fire]) {
      if (!pool) continue;
      const P = pool.pts.geometry.attributes;
      for (let i = 0; i < pool.n; i++) {
        const p = pool.p[i];
        if (p.life > 0) {
          p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vx *= 0.98; p.vz *= 0.98;
          const t = 1 - p.life / p.max;
          P.position.setXYZ(i, p.x, p.y, p.z); P.size.setX(i, p.size + p.grow * t);
          const a = p.col[3] * (t < 0.1 ? t * 10 : 1 - (t - 0.1) / 0.9);
          if (pool === this.fire) P.pcol.setXYZW(i, p.col[0], p.col[1] * (1 - t * 0.6), p.col[2] * (1 - t), a);
          else P.pcol.setXYZW(i, p.col[0], p.col[1], p.col[2], a);
        } else P.size.setX(i, 0);
      }
      P.position.needsUpdate = P.size.needsUpdate = P.pcol.needsUpdate = true;
    }
  },
  smokePuff(pos, dark = 0.3, size = 1.2) { this.emit(this.smoke, pos, V((Math.random() - .5) * 1.2, 2 + Math.random() * 1.5, (Math.random() - .5) * 1.2), 2.5 + Math.random(), size, size * 3, [dark, dark, dark * 1.02, 0.55]); },
  firePuff(pos, size = 1) { this.emit(this.fire, pos, V((Math.random() - .5), 2.5 + Math.random() * 2, (Math.random() - .5)), 0.5 + Math.random() * 0.4, size, -size * 0.6, [1, 0.6, 0.2, 0.9]); },
  explosion(pos, r = 8) {
    for (let i = 0; i < 60; i++) { _v.randomDirection().multiplyScalar(r * (0.8 + Math.random())); _v.y = Math.abs(_v.y); this.emit(this.fire, pos, _v, 0.5 + Math.random() * 0.5, r * 0.5, r * 0.4, [1, 0.7, 0.3, 1]); }
    for (let i = 0; i < 40; i++) { _v.randomDirection().multiplyScalar(r * 0.5); _v.y = Math.abs(_v.y) + 2; this.emit(this.smoke, pos, _v, 3 + Math.random() * 2, r * 0.5, r * 1.2, [0.12, 0.11, 0.1, 0.7]); }
  },
};

// ---------------- helpers ----------------
const fwdOf = (q, out = V()) => out.set(0, 0, 1).applyQuaternion(q);
const upOf = (q, out = V()) => out.set(0, 1, 0).applyQuaternion(q);
const rightOf = (q, out = V()) => out.set(-1, 0, 0).applyQuaternion(q);
const bodyQ = (b, out = new THREE.Quaternion()) => { const r = b.rotation(); return out.set(r.x, r.y, r.z, r.w); };
const toR = v => ({ x: v.x, y: v.y, z: v.z });
const toRQ = q => ({ x: q.x, y: q.y, z: q.z, w: q.w });
const waterAt = (x, z) => { const w = game.gfx?.waterHeightAt?.(x, z); return Number.isFinite(w) ? w : (game.world?.seaLevel ?? 0); };
const isNight = () => {
  const h = game.gfx?.hour ?? game.gfx?.timeOfDay ?? game.gfx?.time;
  if (typeof h === 'number') return h < 6.5 || h > 19.3;
  const s = game.gfx?.sun; return s?.position ? s.position.y < 0 : false;
};
function groundY(x, z, fromY) {
  const top = fromY ?? ((game.world?.heightAt?.(x, z) ?? 0) + 60);
  const hit = game.physics.castRay(new R.Ray({ x, y: top, z }, { x: 0, y: -1, z: 0 }), 400, true, undefined, undefined, undefined, undefined, c => !colliderOwner.has(c.handle));
  if (hit) return top - (hit.timeOfImpact ?? hit.toi);
  return game.world?.heightAt?.(x, z) ?? 0;
}
function registerCollider(c, v) {
  colliderOwner.set(c.handle, v);
  if (game.world) (game.world.colliderOwner ||= new Map()).set(c.handle, v);
}
function camYawPitch() {
  game.camera.getWorldDirection(_w);
  return { yaw: Math.atan2(_w.x, _w.z), pitch: Math.asin(clamp(_w.y, -1, 1)), dir: _w.clone() };
}

// ---------------- spawn ----------------
function spawn(type, pos, rotY = 0, opts = {}) {
  type = resolveType(type);
  const d = DEFS[type];
  if (opts.ai && typeof opts.ai !== 'object') opts = { ...opts, ai: { mode: String(opts.ai), panic: 0 } };
  else if (opts.ai && !opts.ai.mode) opts.ai.mode = opts.ai.traffic ? 'traffic' : 'idle';
  if (opts.ai?.mode === 'hunt') { opts.ai.weapons = !!d.weapon; opts.ai.target = opts.target || null; }
  const color = opts.color ?? (d.regime ? REGIME.olive : PAINTS[Math.floor(Math.random() * PAINTS.length)]);
  const vis = buildVisual(type, color);
  const v = {
    id: nextId++, type, def: d, kind: d.kind, isVehicle: true, label: d.label, health: d.health, maxHealth: d.health,
    obj: vis.root, vis, driver: null, occupied: false, dead: false, rpm: 0, throttle: 0, speed: 0, nitro: 1, boosting: false,
    camDistance: d.camDistance, camHeight: d.camHeight, regime: !!d.regime, faction: d.regime ? 'regime' : 'civilian',
    controls: { throttle: 0, steer: 0, brake: 0, handbrake: false, boost: false, up: 0, pitch: 0, roll: 0, yaw: 0, fire: false, alt: false, aimDir: null },
    yawTarget: rotY, engineOn: false, rotor: 0, gear: 1, stall: false, flipTimer: 0, burn: 0, wreckTimer: 0,
    prevVel: V(), aim: { yaw: 0, pitch: 0 }, cool: { a: 0, b: 0 }, rocketSide: 1, opts, ai: opts.ai || null, spawnRec: opts.spawnRec || null,
    lastTouched: game.simTime, touched: false, colliders: [],
    takeDamage: (amt, p, src) => damage(v, amt, p, src),
  };
  v.damage = v.takeDamage;
  const [W, H, L] = d.size;
  // physics frame origin = chassis collider centre, model offset below it
  const clr = d.kind === 'car' || d.kind === 'tank' ? (d.chunky ? 0.55 : 0.3) : 0;
  const hc = d.kind === 'heli' || d.kind === 'plane' ? 1.6 : d.kind === 'boat' ? H * 0.45 : clr + H * 0.5;
  v.hc = hc;
  vis.root.position.set(0, -hc, 0);
  const holder = new THREE.Group(); holder.add(vis.root); scene.add(holder); v.holder = holder;
  const y0 = (pos.y ?? groundY(pos.x, pos.z)) + hc + (d.kind === 'boat' ? 0 : 0.15);
  const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), rotY);
  const bd = R.RigidBodyDesc.dynamic().setTranslation(pos.x, y0, pos.z).setRotation(toRQ(q))
    .setLinearDamping(d.kind === 'boat' ? 0.4 : 0.05).setAngularDamping(d.kind === 'heli' ? 2 : d.kind === 'boat' ? 1.5 : 0.6).setCcdEnabled(d.kind === 'plane' || type === 'sports');
  const body = v.body = game.physics.createRigidBody(bd);
  const mass = d.mass, I = (a, b) => mass * (a * a + b * b) / 12;
  function massed(he, comY, comZ, tr) {
    const [hx, hy, hz] = he; let ty = 0, tz = 0; const mt = /setTranslation\(([^,]+), ([^,]+), ([^)]+)\)/.exec(tr || ''); if (mt) { ty = +mt[2]; tz = +mt[3]; }
    const vol = 8 * hx * hy * hz;
    add(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(0, ty, tz).setDensity(0.55 * mass / vol));
    const bh = [hx * 0.7, 0.05, hz * 0.7];
    const c = add(R.ColliderDesc.cuboid(...bh).setTranslation(0, comY, comZ).setSensor(true).setDensity(0.45 * mass / (8 * bh[0] * bh[1] * bh[2])));
    return c;
  }
  const add = (desc) => { const c = game.physics.createCollider(desc.setFriction(d.kind === 'boat' ? 0.3 : 0.6).setRestitution(0.1).setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS), body); registerCollider(c, v); v.colliders.push(c); return c; };
  if (d.kind === 'plane') {
    massed([W / 2, H / 2 * 0.8, L / 2], -0.2, 0.2, '.setTranslation(0, 0.1, 0)');
    add(R.ColliderDesc.cuboid(d.span / 2, 0.12, 1.0).setTranslation(0, type === 'jet' ? 0.1 : 0.45, type === 'jet' ? -2.5 : 0.6).setDensity(0));
  } else if (d.kind === 'heli') {
    massed([W / 2, H / 2 * 0.7, L / 2], -0.4, 0, '.setTranslation(0, 0.1, 0.2)');
    add(R.ColliderDesc.cuboid(0.25, 0.3, 2.4).setTranslation(0, 0.3, -L / 2 - 1.4).setDensity(0));
    add(R.ColliderDesc.cuboid(W / 2 + 0.1, 0.1, 1.4).setTranslation(0, -1.5, 0.2).setDensity(0));
  } else if (d.kind === 'boat') {
    massed([W / 2 * 0.85, H / 2, L / 2 * 0.95], -0.25, -0.3, '');
  } else {
    const hh = (H - clr) / 2 * 0.9;
    massed([W / 2 * 0.95, hh, L / 2 * 0.97], d.com, 0, '');
  }
  // suspension
  if (vis.wheels.length) {
    const vc = v.vc = game.physics.createVehicleController(body);
    vc.indexUpAxis = 1; vc.setIndexForwardAxis = 2;
    const rest = d.rest ?? 0.35, stiff = d.stiff ?? 30, n = vis.wheels.length;
    const sag = 9.81 / (n * stiff);
    vis.wheels.forEach((w, i) => {
      const r = d.wheelR;
      vc.addWheel({ x: w.def.x, y: r + rest - sag - hc, z: w.def.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, rest, r);
      vc.setWheelSuspensionStiffness(i, stiff);
      vc.setWheelSuspensionCompression(i, (d.damp ?? 4) * 0.8);
      vc.setWheelSuspensionRelaxation(i, d.damp ?? 4);
      vc.setWheelMaxSuspensionTravel(i, rest);
      vc.setWheelMaxSuspensionForce(i, mass * 9.81 * 3);
      vc.setWheelFrictionSlip(i, d.kind === 'plane' ? 3 : (d.grip ?? 2.2));
      vc.setWheelSideFrictionStiffness(i, d.kind === 'plane' ? 1.5 : 1);
      w.base = { x: w.def.x, z: w.def.z, r };
    });
  }
  // occupant visual
  if (opts.driver || (opts.ai && opts.driver !== false)) addDriver(v, opts.driverColor);
  v.headLight = null;
  if (v.ai?.mode === 'hunt') { v.engineOn = true; if (d.kind === 'heli') v.rotor = 1; }
  list.push(v);
  return v;
}

function addDriver(v, color) {
  const p = buildPerson(color ?? (v.regime ? 0x3d4530 : [0x3b4a5a, 0x7a4b2a, 0x2a3a2a, 0x8a2d2d, 0x444466][v.id % 5]));
  const s = seatPos(v); p.position.copy(s); p.position.y -= 0.35;
  v.vis.root.add(p); v.driver = { obj: p, faction: v.faction };
}
function seatPos(v) {
  const d = v.def;
  if (d.kind === 'car') return V(d.size[0] * 0.22, (d.chunky ? 1.25 : 0.85) + (v.type === 'truck' ? 0.9 : 0), v.type === 'sports' ? -0.3 : 0.1);
  if (v.kind === 'heli') return V(v.type === 'heli' ? 0.35 : 0, v.type === 'heli' ? 1.55 : 2.0, v.type === 'heli' ? 0.85 : 0.75);
  if (v.kind === 'plane') return V(0, v.type === 'jet' ? 2.2 : 1.85, v.type === 'jet' ? 3.6 : 0.85);
  if (v.kind === 'boat') return V(0, d.size[1] + 0.25, v.type === 'boat' ? -0.4 : -0.3);
  return V(0, 2.2, 0);
}

function despawn(v) {
  const i = list.indexOf(v); if (i < 0) return;
  if (api.current === v) exit({ force: true });
  list.splice(i, 1);
  for (const c of v.colliders) { colliderOwner.delete(c.handle); game.world?.colliderOwner?.delete(c.handle); }
  if (v.vc) game.physics.removeVehicleController(v.vc);
  game.physics.removeRigidBody(v.body);
  scene.remove(v.holder);
  if (v.headLight) { v.headLight.parent?.remove(v.headLight); }
  v.vis.inst.head.dispose(); v.vis.inst.tail.dispose();
  if (v.spawnRec) v.spawnRec.v = null;
  v.removed = true;
}

// ---------------- enter / exit / hijack ----------------
function canEnterState(s) { return !s || ['ground', 'swim', 'air', 'parachute', 'grapple', 'wingsuit'].includes(s); }
function enter(v) {
  const P = game.player;
  if (!v || v.dead || api.current) return false;
  if (v.driver) hijack(v);
  api.current = v; v.occupied = true; v.engineOn = true; v._enterT = game.simTime; v.touched = true; v.ai = null;
  v.yawTarget = Math.atan2(fwdOf(bodyQ(v.body)).x, fwdOf(bodyQ(v.body)).z);
  v.body.wakeUp();
  if (P) {
    P.state = 'vehicle'; P.vehicle = v;
    if (P.obj) { v._pObjVis = P.obj.visible; P.obj.visible = false; }
    try { P.collider?.setEnabled?.(false); } catch {}
  }
  game.events.emit('vehicle:entered', { v });
  game.audio?.play?.('door', { pos: v.holder.position });
  return true;
}
function hijack(v) {
  const dr = v.driver; v.driver = null;
  const wp = V(); dr.obj.getWorldPosition(wp); v.vis.root.remove(dr.obj);
  // toss the NPC out the driver's side; they scramble up and flee
  const side = rightOf(bodyQ(v.body)).multiplyScalar(-1);
  scene.add(dr.obj); dr.obj.position.copy(wp);
  ejected.push({ obj: dr.obj, vel: side.multiplyScalar(5).add(V(0, 4, 0)), t: 0, spin: (Math.random() - 0.5) * 8 });
  game.events.emit('vehicle:hijacked', { v, driver: dr, pos: wp, faction: dr.faction });
  if (v.regime) { game.events.emit('chaos', { amount: 50, pos: wp, reason: 'hijack' }); }
  game.audio?.play?.('hijack', { pos: wp });
}
const ejected = [];
function updateEjected(dt) {
  for (let i = ejected.length - 1; i >= 0; i--) {
    const e = ejected[i]; e.t += dt;
    const o = e.obj;
    if (e.t < 1.1) { e.vel.y -= 9.81 * dt; o.position.addScaledVector(e.vel, dt); o.rotation.z += e.spin * dt;
      const g = groundY(o.position.x, o.position.z, o.position.y + 1); if (o.position.y < g) { o.position.y = g; e.vel.multiplyScalar(0.3); } }
    else { o.rotation.z *= 0.8; const pp = game.player?.pos; if (pp) { _v.subVectors(o.position, pp).setY(0).normalize(); o.position.addScaledVector(_v, 5 * dt); o.rotation.y = Math.atan2(_v.x, _v.z); }
      o.position.y = groundY(o.position.x, o.position.z, o.position.y + 2) + 0.35 + Math.abs(Math.sin(e.t * 12)) * 0.08; }
    if (e.t > 7) { scene.remove(o); ejected.splice(i, 1); }
  }
}
function exit(opts = {}) {
  const v = api.current, P = game.player; if (!v) return false;
  api.current = null; v.occupied = false; v.lastTouched = game.simTime;
  const c = v.controls; c.throttle = c.steer = c.up = c.pitch = c.roll = c.yaw = 0; c.fire = c.boost = false;
  const q = bodyQ(v.body), t = v.body.translation(), lv = v.body.linvel();
  const vel = V(lv.x, lv.y, lv.z), speed = vel.length();
  const airborne = (v.kind === 'heli' || v.kind === 'plane') && (t.y - groundY(t.x, t.z, t.y - 0.5) > 4);
  const pos = V(t.x, t.y, t.z);
  if (airborne) pos.add(rightOf(q).multiplyScalar(-(v.def.size[0] / 2 + 1.6))).add(V(0, -1.2, 0)).addScaledVector(vel, 0.1);
  else { const side = rightOf(q).multiplyScalar(-(v.def.size[0] / 2 + 1.0)); pos.add(side); pos.y = Math.max(pos.y, groundY(pos.x, pos.z, pos.y + 2) + 1.0); }
  if (P) {
    P.vehicle = null;
    if (P.obj) P.obj.visible = v._pObjVis ?? true;
    try { P.collider?.setEnabled?.(true); } catch {}
    const st = airborne || speed > 3 ? 'air' : (v.kind === 'boat' ? 'swim' : 'ground');
    // P.respawn is used here as a teleport, but it also grants 2s spawn invuln; keep the player's real invuln instead
    if (P.respawn && !opts.noTeleport) { const inv0 = P.invuln; try { P.respawn(pos); } catch {} if (inv0 !== undefined) P.invuln = inv0; }
    P.pos?.copy?.(pos); P.vel?.copy?.(airborne || speed > 3 ? vel : V());
    P.state = P.state === 'dead' ? 'dead' : st;
    if (P.controller?.setTranslation) try { P.controller.setTranslation(toR(pos)); } catch {}
  }
  if (v.kind === 'car' || v.kind === 'tank') v.controls.brake = 1;
  game.events.emit('vehicle:exited', { v, bailed: airborne, speed });
  return true;
}
function nearest(pos, radius = 6, filter) {
  let best = null, bd = radius;
  for (const v of list) {
    if (v.dead || v.removed || (filter && !filter(v))) continue;
    const t = v.body.translation();
    const reach = Math.max(v.def.size[0], v.def.size[2]) / 2;
    const dd = Math.hypot(t.x - pos.x, (t.y - pos.y) * 0.7, t.z - pos.z) - reach;
    if (dd < bd) { bd = dd; best = v; }
  }
  return best;
}

// ---------------- damage ----------------
function damage(v, amt, pos, src) {
  if (!v || v.dead || !(amt > 0)) return;
  v.health = Math.max(0, v.health - amt);
  if (src !== 'impact') v.lastHitBy = src;
  if (v.ai && amt > 5) v.ai.panic = 6;
  if (v.health <= 0) explode(v, src);
}
function explode(v, src) {
  if (v.dead) return;
  v.dead = true; v.health = 0; v.burn = 10; v.wreckTimer = 45;
  const t = v.body.translation(), pos = V(t.x, t.y, t.z);
  const big = v.kind === 'tank' || v.type === 'truck' || v.kind === 'plane' || v.kind === 'heli';
  const r = big ? 11 : 8;
  v.body.applyImpulse({ x: (Math.random() - 0.5) * 3 * v.def.mass, y: 7 * v.def.mass * (v.kind === 'tank' ? 0.4 : 1), z: (Math.random() - 0.5) * 3 * v.def.mass }, true);
  v.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * 2 * v.def.mass, y: (Math.random() - 0.5) * v.def.mass, z: (Math.random() - 0.5) * 3 * v.def.mass }, true);
  // char the model, kill lights and glass
  const M = materials();
  v.vis.root.traverse(o => { if (o.isMesh) { const k = o.userData.matKey; if (k === 'glass') o.visible = false; else if (k && k !== 'rubber') o.material = M.charred; } });
  v.vis.rotors.forEach(r2 => { if (r2.blur) r2.blur.visible = false; });
  if (v.vis.flame) v.vis.flame.visible = false;
  if (v.headLight) v.headLight.visible = false;
  if (v.driver) { v.vis.root.remove(v.driver.obj); v.driver = null; }
  if (game.fx?.explosion) { try { game.fx.explosion(pos, r); } catch { FX.explosion(pos, r); } } else FX.explosion(pos, r);
  FX.explosion(pos, r * 0.6);
  game.gfx?.shake?.(big ? 1.2 : 0.8, pos);
  game.audio?.play?.('explosion', { pos });
  // one owner for the blast: combat.explode damages enemies/vehicles/player/props once and emits the tagged
  // 'explosion' event (noVehicleDamage) that onExplosion turns into shoves only. Fallback when combat is absent.
  if (!blast(pos, r, big ? 2 : 1.3, 'vehicle', v)) game.events.emit('explosion', { pos, radius: r, src: v, fromVehicle: true });
  game.events.emit('chaos', { amount: v.regime ? (big ? 600 : 250) : 60, pos, reason: 'vehicle:' + v.type });
  game.events.emit('vehicle:destroyed', { v, pos, src });
  if (api.current === v) {
    const P = game.player; exit({ force: true });
    if (P && P.state !== 'dead') { P.vel?.set?.((Math.random() - .5) * 8, 10, (Math.random() - .5) * 8); P.state = 'air';
      // real damage through the health path (combat.damage -> player.damage honours invuln/dead/armor and emits player:damaged itself)
      if (game.combat?.damage) game.combat.damage(P, 35, 'vehicle-explosion', { pos, explosive: true });
      else if (P.damage) P.damage(35, 'vehicle-explosion');
    }
  }
}
function blast(pos, r, power, owner, srcV) {
  if (!game.combat?.explode) return false;
  try { game.combat.explode(pos, r, power, { owner, vehicle: srcV, noFx: true, silent: true }); return true; } catch (e) { console.warn('[vehicles] combat.explode', e); return false; }
}
function onExplosion(e) {
  if (!e?.pos) return;
  const p = e.pos, rad = e.radius ?? 8;
  for (const v of list) {
    if (v.removed || v === e.src) continue;
    const t = v.body.translation(); const d = Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z);
    if (d > rad * 1.6) continue;
    const f = 1 - d / (rad * 1.6);
    _v.set(t.x - p.x, t.y - p.y + 1.5, t.z - p.z).normalize().multiplyScalar(f * 9 * Math.min(v.def.mass, 4000));
    v.body.applyImpulseAtPoint(toR(_v), { x: t.x + (Math.random() - .5), y: t.y, z: t.z + (Math.random() - .5) }, true);
    if (!e.noVehicleDamage) damage(v, f * (e.power ?? (e.fromVehicle ? 220 : 300)) * (v.kind === 'tank' ? 0.35 : 1), p, e.src ?? 'explosion');
  }
}

// ---------------- weapons ----------------
const shots = [];
let tracerMat, rocketGeo, rocketMat;
function fire(v, type, from, dir) {
  const owner = v.occupied ? 'player' : v;
  const ok = game.combat?.fireProjectile?.({ from: from.clone(), dir: dir.clone(), type, owner, vehicle: v, ignore: v.colliders.map(c => c.handle) });
  if (game.fx?.muzzle) { try { game.fx.muzzle(from, dir); } catch {} } else FX.firePuff(from, type === 'bullet' ? 0.4 : 1.4);
  game.audio?.play?.(type === 'bullet' ? 'mg' : type === 'shell' ? 'cannon' : 'rocket', { pos: from });
  if (ok !== undefined && ok !== false) return;
  if (game.combat?.fireProjectile) return; // combat handled it (returned nothing)
  // fallback simulation
  if (type === 'bullet') {
    const hit = game.physics.castRay(new R.Ray(toR(from), toR(dir)), 600, true, undefined, undefined, undefined, undefined, c => !v.colliders.includes(c));
    const dist = hit ? (hit.timeOfImpact ?? hit.toi) : 600;
    const end = from.clone().addScaledVector(dir, dist);
    tracer(from, end);
    if (hit) { const tgt = colliderOwner.get(hit.collider.handle) || game.world?.colliderOwner?.get(hit.collider.handle);
      applyHit(tgt, 18, end, owner); if (!tgt) FX.smokePuff(end, 0.5, 0.3); }
  } else {
    tracerMat ||= new THREE.LineBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.9 });
    rocketGeo ||= new THREE.CylinderGeometry(0.08, 0.08, 0.9, 8).rotateX(Math.PI / 2);
    rocketMat ||= new THREE.MeshStandardMaterial({ color: 0x444444, emissive: 0xff8833, emissiveIntensity: 0.6 });
    const m = new THREE.Mesh(rocketGeo, rocketMat); m.position.copy(from); m.lookAt(from.clone().add(dir)); scene.add(m);
    shots.push({ m, pos: from.clone(), vel: dir.clone().multiplyScalar(type === 'shell' ? 260 : 120).add(v.body.linvel()), type, owner, v, life: 6 });
  }
}
function applyHit(tgt, amt, pos, owner) {
  if (!tgt) return;
  if (tgt.isVehicle) damage(tgt, amt, pos, owner);
  else if (game.combat?.damage) { try { game.combat.damage(tgt, amt, owner); } catch {} }
  else if (tgt.userData?.destructible) game.world?.damageDestructible?.(tgt, amt, pos);
}
const tracers = [];
function tracer(a, b) {
  if (game.fx?.tracer) { try { game.fx.tracer(a, b); return; } catch {} }
  tracerMat ||= new THREE.LineBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.9 });
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), tracerMat); scene.add(l); tracers.push({ l, t: 0.05 });
}
function updateShots(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) if ((tracers[i].t -= dt) <= 0) { scene.remove(tracers[i].l); tracers[i].l.geometry.dispose(); tracers.splice(i, 1); }
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i]; s.life -= dt;
    if (s.type === 'rocket') s.vel.y -= 2 * dt; else s.vel.y -= 4 * dt;
    const step = s.vel.length() * dt; _v.copy(s.vel).normalize();
    const hit = game.physics.castRay(new R.Ray(toR(s.pos), toR(_v)), step, true, undefined, undefined, undefined, undefined, c => !s.v.colliders.includes(c));
    if (s.type === 'rocket') FX.smokePuff(s.pos, 0.75, 0.4);
    if (hit || s.life <= 0 || s.pos.y < waterAt(s.pos.x, s.pos.z) - 0.5) {
      const p = hit ? s.pos.clone().addScaledVector(_v, hit.timeOfImpact ?? hit.toi) : s.pos.clone();
      const tgt = hit && (colliderOwner.get(hit.collider.handle) || game.world?.colliderOwner?.get(hit.collider.handle));
      const r = s.type === 'shell' ? 9 : 6;
      applyHit(tgt, s.type === 'shell' ? 400 : 160, p, s.owner);
      if (game.fx?.explosion) { try { game.fx.explosion(p, r); } catch { FX.explosion(p, r); } } else FX.explosion(p, r);
      game.gfx?.shake?.(0.5, p); game.audio?.play?.('explosion', { pos: p });
      if (!blast(p, r, s.type === 'shell' ? 1.5 : 1.1, s.owner === 'player' ? 'player' : 'vehicle', s.v)) game.events.emit('explosion', { pos: p, radius: r, src: s.owner });
      scene.remove(s.m); shots.splice(i, 1); continue;
    }
    s.pos.addScaledVector(s.vel, dt); s.m.position.copy(s.pos); s.m.lookAt(_w.copy(s.pos).add(s.vel));
  }
}
function vehicleWeapons(v, dt) {
  const c = v.controls; const w = v.def.weapon; if (!w || v.dead) return;
  v.cool.a -= dt; v.cool.b -= dt;
  const aimDir = c.aimDir || fwdOf(bodyQ(v.body));
  const muzzleWorld = (obj, len) => { const p = V(0, 0, len); obj.localToWorld(p); return p; };
  if (w === 'mg' || w === 'cannon') {
    const tg = v.vis.turret, bg = v.vis.barrel; if (!tg) return;
    // aim turret toward aim direction in vehicle-local space
    v.holder.updateMatrixWorld();
    _q.copy(v.holder.quaternion).invert(); _v.copy(aimDir).applyQuaternion(_q);
    const yaw = Math.atan2(_v.x, _v.z), pitch = Math.asin(clamp(_v.y, -1, 1));
    const rate = w === 'cannon' ? 1.2 : 6;
    let dy = yaw - tg.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    tg.rotation.y += clamp(dy, -rate * dt, rate * dt);
    bg.rotation.x = lerp(bg.rotation.x, -clamp(pitch, -0.15, 0.45), Math.min(1, dt * 6));
    if (c.fire && v.cool.a <= 0) {
      tg.updateMatrixWorld(true);
      const from = muzzleWorld(bg, v.vis.muzzle); const dir = V(0, 0, 1).transformDirection(bg.matrixWorld);
      if (w === 'mg') { v.cool.a = 0.08; dir.x += (Math.random() - .5) * 0.02; dir.y += (Math.random() - .5) * 0.02; fire(v, 'bullet', from, dir.normalize()); }
      else { v.cool.a = 2.4; fire(v, 'shell', from, dir); v.body.applyImpulseAtPoint(toR(dir.clone().multiplyScalar(-v.def.mass * 0.6)), toR(from), true); game.gfx?.shake?.(0.6, from); for (let i = 0; i < 8; i++) FX.smokePuff(from, 0.6, 1.2); }
    }
  } else if (w === 'heli' || w === 'jet') {
    const q = bodyQ(v.body), t = v.body.translation(); const base = V(t.x, t.y, t.z);
    if (c.fire && v.cool.a <= 0) {
      v.cool.a = w === 'jet' ? 0.05 : 0.06;
      const from = V(0, w === 'jet' ? 0.2 : -0.65, w === 'jet' ? 6 : 3.6).applyQuaternion(q).add(base);
      const dir = (w === 'jet' ? fwdOf(q) : aimDir.clone()).normalize(); dir.x += (Math.random() - .5) * 0.015; dir.y += (Math.random() - .5) * 0.015;
      fire(v, 'bullet', from, dir.normalize());
    }
    if (c.alt && v.cool.b <= 0) {
      v.cool.b = w === 'jet' ? 0.9 : 0.35; v.rocketSide *= -1;
      const from = V(v.rocketSide * (w === 'jet' ? 3.2 : 1.6), w === 'jet' ? -0.3 : -0.3, w === 'jet' ? 0 : 1.2).applyQuaternion(q).add(base);
      fire(v, 'rocket', from, w === 'jet' ? fwdOf(q) : aimDir.clone().normalize());
    }
  }
}

// ---------------- driving models (per physics step) ----------------
function stepCar(v, h) {
  const d = v.def, c = v.controls, b = v.body, vc = v.vc;
  const q = bodyQ(b), f = fwdOf(q), up = upOf(q);
  const lv = b.linvel(); const vel = V(lv.x, lv.y, lv.z);
  const vf = vel.dot(f); v.speed = vel.length(); v.fwdSpeed = vf;
  let grounded = 0; const n = vc.numWheels();
  for (let i = 0; i < n; i++) if (vc.wheelIsInContact(i)) grounded++;
  v.grounded = grounded;
  // throttle/brake/reverse
  let engine = 0, brake = c.brake * d.brake;
  if (c.throttle > 0.05) engine = c.throttle * d.engine * (vf < d.top ? 1 : 0);
  else if (c.throttle < -0.05) { if (vf > 1.5) brake = Math.max(brake, -c.throttle * d.brake); else engine = c.throttle * d.engine * 0.55 * (vf > -12 ? 1 : 0); }
  else if (!v.occupied && !v.ai) brake = Math.max(brake, d.brake * 0.4); else brake = Math.max(brake, 0.6);
  v.boosting = false;
  if (c.boost && d.nitro && v.nitro > 0 && c.throttle > 0) { v.boosting = true; v.nitro = Math.max(0, v.nitro - h * 0.28); engine *= 1.8; if (grounded) b.applyImpulse(toR(f.clone().multiplyScalar(d.mass * 6 * h)), true); }
  else v.nitro = Math.min(1, v.nitro + h * 0.06);
  // steering: less lock at speed
  // speed-sensitive: full feel below ~25 km/h, ~0.7 rad/s yaw at 65 km/h (handbrake drift sets yaw itself below)
  const lock = d.steer * (d.kind === 'tank' ? 0 : 1) / (1 + Math.abs(vf) / 24) / (1 + Math.max(0, Math.abs(vf) - 7) / 11);
  v.steer = lerp(v.steer || 0, c.steer * lock, Math.min(1, h * 8));
  for (let i = 0; i < n; i++) {
    const w = v.vis.wheels[i].def;
    vc.setWheelSteering(i, w.steer ? v.steer : 0);
    let e = w.drive === false ? 0 : engine / n;
    if (d.kind === 'tank') e = (engine + c.steer * d.engine * 0.6 * (w.side > 0 ? 1 : -1)) / n;
    vc.setWheelEngineForce(i, e);
    // Rapier's wheel brake is a per-step friction impulse cap, so scale by mass*dt: full brake ≈ 11 m/s² (arcade-strong)
    const bf = brake / d.brake + (w.rear && c.handbrake ? (Math.abs(vf) > 8 ? 0.02 : 0.6) : 0);
    vc.setWheelBrake(i, bf * d.mass * 11 * h / n);
    vc.setWheelFrictionSlip(i, w.rear && c.handbrake ? d.grip * 0.62 : d.grip);
  }
  vc.updateVehicle(h, undefined, undefined, coll => !v.colliders.includes(coll));
  const av = b.angvel();
  if (grounded) {
    b.applyImpulse(toR(up.clone().multiplyScalar(-d.mass * Math.min(30, 0.012 * v.speed * v.speed) * h)), true); // downforce
    if (d.kind === 'tank') b.setAngvel({ x: av.x, y: lerp(av.y, c.steer * -0.9 * (vf < -1 ? -1 : 1), 0.12), z: av.z }, true);
    else if (c.handbrake && Math.abs(vf) > 6) {
      // controllable powerslide: rear grip drops, yaw rate is driven by steer (countersteer reverses it) instead of
      // spinning out, and horizontal speed decays gently instead of being scrubbed off by the sideways tyres.
      const hs = Math.hypot(vel.x, vel.z), vs = vel.dot(rightOf(q)), slip = Math.atan2(vs, Math.abs(vf));
      if (!v.drift) v.drift = { s: hs };
      v.drift.s = Math.min(hs + 0.5, v.drift.s - h * (c.throttle > 0.1 ? 1.4 : 2.6));
      // yaw: ~0.8 rad/s at full lock; past ~45 deg of slide only allow yaw that reduces the slide
      let wT = c.steer * 0.55 * clamp(hs / 12, 0.4, 1);
      if (Math.abs(slip) > 0.8 && Math.sign(wT) === -Math.sign(slip)) wT *= 0.2;
      b.setAngvel({ x: av.x, y: lerp(av.y, wT, Math.min(1, h * 30)), z: av.z }, true);
      if (hs < v.drift.s && hs > 0.1) { const k = v.drift.s / hs; b.setLinvel({ x: vel.x * k, y: vel.y, z: vel.z * k }, true); }
    }
    if (!(c.handbrake && Math.abs(vf) > 6)) v.drift = null;
    // anti-roll assist (kid-on-keyboard friendly): while wheels are down, damp roll rate and nudge back toward level
    // so mild bumps/kerbs don't tip cars over. Past ~45 deg of lean it lets go (flip recovery owns real rollovers).
    if (d.kind !== 'tank') {
      const tilt = rightOf(q).y; // rightOf is local -x: +omega about f lowers it, so omega += tilt*k levels the car
      if (Math.abs(tilt) < 0.7) {
        const a2 = b.angvel(), rr = a2.x * f.x + a2.y * f.y + a2.z * f.z, dw = (tilt * 7 - rr * 5) * h;
        b.setAngvel({ x: a2.x + f.x * dw, y: a2.y + f.y * dw, z: a2.z + f.z * dw }, true);
      }
    }
  } else if (v.occupied) {
    // air control
    const r = rightOf(q);
    const tq = r.multiplyScalar(c.throttle * 2.2).add(f.clone().multiplyScalar(c.steer * 2.2)).add(up.clone().multiplyScalar(-c.steer * 1.2 * 0));
    _v.set(av.x, av.y, av.z).lerp(_w.copy(tq).add(V(av.x, av.y, av.z).multiplyScalar(0.0)), 0.04);
    b.setAngvel(toR(_v.set(av.x, av.y, av.z).multiplyScalar(0.97).addScaledVector(tq, 0.06)), true);
  }
  // flip recovery
  if (up.y < 0.25 && v.speed < 3) v.flipTimer += h; else v.flipTimer = 0;
  if (v.flipTimer > (v.occupied ? 1.2 : 1e9) || (v.occupied && up.y < 0.3 && v.speed < 4 && c.flip)) {
    v.flipTimer = 0; const t = b.translation(); const yaw = Math.atan2(f.x, f.z);
    b.setTranslation({ x: t.x, y: t.y + 1.6, z: t.z }, true); b.setRotation(toRQ(_q.setFromAxisAngle(V(0, 1, 0), yaw)), true); b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  // engine sim fields for audio
  const target = clamp(Math.abs(vf) / (d.top || 40), 0, 1);
  v.gear = 1 + Math.floor(target * 5);
  const inGear = (target * 5) % 1;
  v.rpm = lerp(v.rpm, grounded ? 0.2 + 0.8 * (0.35 + inGear * 0.65) * Math.max(0.3, Math.abs(c.throttle)) : 0.2 + Math.abs(c.throttle) * 0.8, 0.15);
  v.throttle = Math.abs(c.throttle);
  // wheel water: cars sink and stall
  const t = b.translation();
  if (t.y < waterAt(t.x, t.z) - 0.2) { b.applyImpulse({ x: -lv.x * d.mass * 0.6 * h, y: d.mass * 6 * h, z: -lv.z * d.mass * 0.6 * h }, true); if (!v.dead && v.occupied && t.y < waterAt(t.x, t.z) - 1.2) damage(v, 30 * h * 60 * h, null, 'water'); }
}

function stepHeli(v, h) {
  const d = v.def, c = v.controls, b = v.body, m = d.mass;
  v.rotor = clamp(v.rotor + (v.engineOn && !v.dead ? h * 0.5 : -h * 0.25), 0, 1);
  const q = bodyQ(b), up = upOf(q), lv = b.linvel();
  v.speed = Math.hypot(lv.x, lv.y, lv.z);
  const t = b.translation();
  const alt = t.y - groundY(t.x, t.z, t.y - 1.0);
  v.grounded = alt < 1.7;
  if (v.rotor > 0.05) {
    const eff = clamp((v.rotor - 0.4) / 0.5, 0, 1);
    // vertical: collective; hold altitude when centred
    const wantVy = c.up * 12;
    const liftAcc = 9.81 + (wantVy - lv.y) * 2.2;
    const lift = Math.max(0, liftAcc) / Math.max(0.55, up.y) * eff;
    b.applyImpulse(toR(up.clone().multiplyScalar(lift * m * h)), true);
    // drag (more vertical than horizontal) + speed cap
    const hs = Math.hypot(lv.x, lv.z), cap = hs > d.maxSpeed ? (hs - d.maxSpeed) * 2 : 0;
    b.applyImpulse({ x: -lv.x * (0.08 + cap / Math.max(1, hs)) * m * h, y: -lv.y * 0.3 * m * h, z: -lv.z * (0.08 + cap / Math.max(1, hs)) * m * h }, true);
    // arcade cyclic: tilt also pushes along the stick (the genre's helis accelerate hard), brake when stick centred
    if (v.occupied || v.ai) {
      const fh = fwdOf(q).setY(0), rh = rightOf(q).setY(0); fh.normalize(); rh.normalize();
      const acc = fh.multiplyScalar(c.pitch * 9).addScaledVector(rh, c.roll * 6);
      if (Math.abs(c.pitch) + Math.abs(c.roll) < 0.1) acc.set(-lv.x * 0.6, 0, -lv.z * 0.6);
      b.applyImpulse(toR(acc.multiplyScalar(m * h * eff)), true);
    }
    // attitude: target pitch/roll from stick, yaw from look
    if (v.occupied || v.ai) {
      const air = v.grounded && c.up <= 0 ? 0 : 1;
      v.yawTarget += (c.yaw - c.roll * 1.1 * air) * h; // banking turns the nose (A/D steer without a mouse)
      const pitch = c.pitch * 0.38 * air, roll = c.roll * 0.4 * air;
      const tq = _q2.setFromEuler(new THREE.Euler(pitch, v.yawTarget, roll, 'YXZ'));
      const err = tq.clone().multiply(q.clone().invert()); if (err.w < 0) { err.x *= -1; err.y *= -1; err.z *= -1; err.w *= -1; }
      const ang = 2 * Math.acos(clamp(err.w, -1, 1)), s = Math.sqrt(1 - err.w * err.w) || 1;
      const k = 5 * eff;
      b.setAngvel({ x: err.x / s * ang * k, y: err.y / s * ang * k, z: err.z / s * ang * k }, true);
    }
  }
  v.throttle = clamp(0.5 + c.up * 0.5 + Math.abs(c.pitch) * 0.3, 0, 1) * v.rotor;
  v.rpm = v.rotor;
}

function stepPlane(v, h) {
  const d = v.def, c = v.controls, b = v.body, m = d.mass, vc = v.vc;
  if (v.occupied || v.ai) v.throttle = clamp((v.throttle || 0) + c.up * h * 0.6, 0, 1); else v.throttle = Math.max(0, (v.throttle || 0) - h * 0.3);
  if (v.dead) v.throttle = 0;
  const q = bodyQ(b), f = fwdOf(q), up = upOf(q), r = rightOf(q);
  const lv = b.linvel(), vel = V(lv.x, lv.y, lv.z);
  const vf = vel.dot(f); v.speed = vel.length(); v.fwdSpeed = vf;
  let grounded = 0;
  for (let i = 0; i < vc.numWheels(); i++) {
    const w = v.vis.wheels[i].def; vc.setWheelSteering(i, w.steer ? c.steer * 0.4 / (1 + vf / 15) : 0); vc.setWheelEngineForce(i, 0);
    vc.setWheelBrake(i, c.brake > 0 || (v.throttle < 0.02 && !v.occupied) ? m * 0.02 : 0.05);
  }
  vc.updateVehicle(h, undefined, undefined, coll => !v.colliders.includes(coll));
  for (let i = 0; i < vc.numWheels(); i++) if (vc.wheelIsInContact(i)) grounded++;
  v.grounded = grounded;
  const ab = d.afterburner && c.boost && v.throttle > 0.95;
  v.boosting = ab;
  const thrust = v.throttle * d.thrust * (ab ? 1.6 : 1);
  b.applyImpulse(toR(f.clone().multiplyScalar(thrust * h)), true);
  // aero: lift, drag, velocity alignment
  const ratio = Math.max(0, vf) / d.vTakeoff;
  // angle of attack (nose above flight path = +): lift is linear to ~13 deg then falls off -> a low-speed pull-up
  // bleeds energy and stalls instead of hanging on a 40 deg climb
  const vu0 = vel.dot(up), aoa = Math.atan2(-vu0, Math.max(2, vf));
  const cl = Math.abs(aoa) < 0.23 ? 1 : Math.max(0.25, 1 - (Math.abs(aoa) - 0.23) * 3.5);
  v.aoa = aoa;
  v.stall = !grounded && (vf < d.vStall || cl < 0.7);
  const liftK = (v.stall ? 0.35 * ratio * ratio : Math.min(1.6, ratio * ratio)) * cl;
  b.applyImpulse(toR(up.clone().multiplyScalar(liftK * m * 9.81 * h * (0.4 + 0.6 * Math.max(0, up.y)))), true);
  const drag = 0.5 * m * 9.81 / (d.maxSpeed * d.maxSpeed) * (d.thrust / (m * 9.81)) * 2;
  b.applyImpulse(toR(f.clone().multiplyScalar(-Math.sign(vf) * vf * vf * drag * h)), true);
  const vs = vel.dot(r), vu = vel.dot(up), align = Math.min(1, ratio) * (grounded ? 0.2 : 1);
  // the 'up' alignment is effectively extra lift: scale it with dynamic pressure + the AoA curve, and charge
  // induced drag for it so turning the flight path upward costs airspeed
  const alignU = grounded ? align : Math.min(1, ratio * ratio) * cl;
  b.applyImpulse(toR(r.clone().multiplyScalar(-vs * m * 1.5 * align * h).addScaledVector(up, -vu * m * 1.2 * alignU * h)), true);
  if (!grounded) b.applyImpulse(toR(f.clone().multiplyScalar(-Math.abs(vu) * m * 0.2 * alignU * h)), true);
  // steep climb at low airspeed: nose wants to drop (energy-limited climb angle)
  const maxClimb = clamp(0.36 + (ratio - 1) * 0.6, 0.3, 0.8);
  // control rates (local), authority with airspeed
  const auth = clamp(ratio, 0, 1.2) * (v.stall ? 0.35 : 1), jet = v.type === 'jet' ? 1.4 : 1;
  const av = b.angvel(); const avL = V(av.x, av.y, av.z).applyQuaternion(q.clone().invert());
  let tp = c.pitch * 1.1 * jet * auth, tr = c.roll * 1.7 * jet * auth, ty = c.yaw * 0.6 * auth;
  if (!grounded) {
    ty += r.y * 1.4 * auth; // banked → nose follows the bank (coordinated turn)
    if (Math.abs(c.roll) < 0.1) tr += r.y * 1.6 * auth; // wings self-level when roll is released
    if (Math.abs(c.pitch) < 0.1 && Math.abs(f.y) < 0.9 && up.y > 0) tp += f.y * 0.6 * auth; // gentle pitch hold toward level
  }
  if (v.stall) tp += 0.6; // nose drops
  else if (!grounded && f.y > maxClimb && up.y > 0) tp += (f.y - maxClimb) * 2.5 * auth;
  if (grounded) { tr = 0; tp = clamp(tp, -0.5 * auth, 0.15); }
  const k = grounded ? 0.08 : 0.15;
  const want = V(lerp(avL.x, tp, k), lerp(avL.y, ty + (grounded ? 0 : -r.y * 0.6 * auth * 0), k), lerp(avL.z, tr, k));
  if (grounded && ratio <= 0.6) { // taxi / takeoff roll: hold the heading, A/D steer
    want.set(avL.x, lerp(avL.y, c.steer * 0.7, 0.2), avL.z);
    const vs2 = vel.dot(r); b.applyImpulse(toR(r.clone().multiplyScalar(-vs2 * m * 4 * h)), true);
  }
  b.setAngvel(toR(want.applyQuaternion(q)), true);
  // flipped on the ground: right it after a moment
  if (up.y < 0.3 && v.speed < 4) v.flipTimer += h; else v.flipTimer = 0;
  if (v.flipTimer > (v.occupied ? 1.5 : 1e9)) { v.flipTimer = 0; const t = b.translation(); const yaw = Math.atan2(f.x, f.z);
    b.setTranslation({ x: t.x, y: t.y + 2, z: t.z }, true); b.setRotation(toRQ(_q.setFromAxisAngle(V(0, 1, 0), yaw)), true); b.setAngvel({ x: 0, y: 0, z: 0 }, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true); }
  v.rpm = 0.25 + v.throttle * 0.75; v.altitude = b.translation().y - groundY(b.translation().x, b.translation().z, b.translation().y - 1);
}

function stepBoat(v, h) {
  const d = v.def, c = v.controls, b = v.body, m = d.mass;
  const q = bodyQ(b), f = fwdOf(q), up = upOf(q), r = rightOf(q);
  const t = b.translation(), lv = b.linvel(), av = b.angvel();
  const [W, H, L] = d.size;
  const pts = [[W * 0.35, -L * 0.4], [-W * 0.35, -L * 0.4], [W * 0.3, L * 0.3], [-W * 0.3, L * 0.3], [0, L * 0.45]];
  let sub = 0;
  for (const [x, z] of pts) {
    const p = V(x, -H * 0.5, z).applyQuaternion(q).add(V(t.x, t.y, t.z));
    const depth = waterAt(p.x, p.z) - p.y;
    if (depth > 0) {
      sub++;
      const pv = V(av.x, av.y, av.z).cross(_w.set(p.x - t.x, p.y - t.y, p.z - t.z)).add(V(lv.x, lv.y, lv.z));
      const fUp = (Math.min(depth, H) * 9.81 * 2.4 - pv.y * 2.5) * m / pts.length;
      b.applyImpulseAtPoint({ x: 0, y: fUp * h, z: 0 }, toR(p), true);
    }
  }
  v.grounded = sub > 0;
  if (sub) {
    const vel = V(lv.x, lv.y, lv.z), vf = vel.dot(f), vs = vel.dot(r);
    v.speed = vel.length(); v.fwdSpeed = vf;
    b.applyImpulse(toR(r.clone().multiplyScalar(-vs * m * 2.2 * h).addScaledVector(f, -vf * m * 0.12 * h)), true);
    const boost = c.boost && v.nitro > 0 && c.throttle > 0; v.boosting = boost;
    if (boost) v.nitro = Math.max(0, v.nitro - h * 0.25); else v.nitro = Math.min(1, v.nitro + h * 0.05);
    const fh = f.clone().setY(0).normalize();
    if (Math.abs(vf) < d.maxSpeed * (boost ? 1.4 : 1)) b.applyImpulse(toR(fh.multiplyScalar(c.throttle * d.thrust * (c.throttle < 0 ? 0.4 : 1) * (boost ? 1.6 : 1) * h)), true);
    const turn = c.steer * d.turn * clamp(Math.abs(vf) / 6, 0.25, 1) * Math.sign(vf || 1);
    b.setAngvel({ x: av.x * 0.95, y: lerp(av.y, turn, 0.06), z: av.z * 0.95 }, true);
    // bank into turns, bow lift at speed
    const avL = V(av.x, av.y, av.z).applyQuaternion(q.clone().invert());
    const rollErr = r.y; // <0: right side low → roll back; lean slightly into turns
    b.applyTorqueImpulse(toR(f.clone().multiplyScalar((-c.steer * 0.25 * clamp(vf / 10, 0, 1) + rollErr * 3 - avL.z * 0.8) * m * h * 2)
      .addScaledVector(r, (0.25 * clamp(vf / d.maxSpeed, 0, 1)) * m * h)), true);
    if (Math.abs(vf) > 4 && Math.random() < 0.5) {
      const sp = V(0, -H * 0.4, -L * 0.5).applyQuaternion(q).add(V(t.x, t.y, t.z));
      FX.emit(FX.smoke, sp, V((Math.random() - .5) * 2, 1 + Math.random(), (Math.random() - .5) * 2).addScaledVector(f, -2), 0.8, 0.5, 1.5, [0.95, 0.97, 1, 0.45]);
    }
  }
  v.throttle = Math.abs(c.throttle); v.rpm = lerp(v.rpm, 0.2 + v.throttle * 0.8 * (sub ? 1 : 1.2), 0.1);
}

function physicsStep(h) {
  for (const v of list) {
    if (v.removed) continue;
    const b = v.body;
    if (!v.occupied && !v.ai && !v.dead && b.isSleeping()) continue;
    if (v.kind === 'car' || v.kind === 'tank') stepCar(v, h);
    else if (v.kind === 'heli') stepHeli(v, h);
    else if (v.kind === 'plane') stepPlane(v, h);
    else stepBoat(v, h);
    // impact damage from abrupt velocity change
    const lv = b.linvel(); _v.set(lv.x, lv.y, lv.z);
    const dv = _v.distanceTo(v.prevVel); v.prevVel.copy(_v);
    const thr = v.kind === 'tank' ? 25 : v.kind === 'heli' || v.kind === 'plane' ? 9 : 11;
    if (dv > thr && !v.justSpawned) {
      damage(v, (dv - thr) * (v.def.health / 30), null, 'impact');
      game.gfx?.shake?.(Math.min(1, (dv - thr) / 15), b.translation());
      game.audio?.play?.('crash', { pos: b.translation(), volume: Math.min(1, dv / 25) });
      if (v.ai) v.ai.panic = 4;
    }
    v.justSpawned = false;
  }
}

// ---------------- player controls ----------------
function playerControls(v, dt) {
  const I = game.input, c = v.controls;
  const mv = I.move;
  c.throttle = mv.y; c.steer = -mv.x * (v.kind === 'tank' ? 1 : 1); c.steer = mv.x; c.brake = 0;
  c.handbrake = I.down('jump'); c.boost = I.down('sprint'); c.flip = I.pressed('jump');
  c.fire = I.down('fire'); c.alt = I.down('aim') || I.down('throw');
  c.aimDir = null;
  if (v.def.weapon) {
    // aim at whatever the camera centre points at
    const cam = game.camera; cam.getWorldDirection(_w);
    const o = cam.position;
    const hit = game.physics.castRay(new R.Ray(toR(o), toR(_w)), 1200, true, undefined, undefined, undefined, undefined, cc => !v.colliders.includes(cc));
    const tgt = o.clone().addScaledVector(_w, hit ? (hit.timeOfImpact ?? hit.toi) : 1200);
    const t = v.body.translation(); c.aimDir = tgt.sub(V(t.x, t.y + 1, t.z)).normalize();
  }
  if (v.kind === 'heli') {
    c.up = (I.down('jump') ? 1 : 0) - (I.down('crouch') ? 1 : 0); c.handbrake = false;
    c.pitch = mv.y; c.roll = mv.x; c.yaw = -(I.look.x / Math.max(dt, 1e-3)) * 0.35 - (v.type ? 0 : 0);
    c.yaw = clamp(c.yaw, -2.2, 2.2);
  } else if (v.kind === 'plane') {
    c.up = (I.down('sprint') ? 1 : 0) - (I.down('crouch') ? 1 : 0); c.boost = I.down('sprint') && I.down('jump') || (I.down('sprint') && (v.throttle > 0.98));
    c.pitch = mv.y; c.roll = mv.x; c.yaw = clamp(-(I.look.x / Math.max(dt, 1e-3)) * 0.15, -1, 1); c.steer = mv.x; c.brake = I.down('crouch') && v.throttle < 0.05 ? 1 : 0;
    c.handbrake = false;
  }
  // our model faces +Z with +X to the left, so steer right = negative steering angle
  if (v.kind === 'car' || v.kind === 'tank' || v.kind === 'boat') c.steer = -mv.x;
  if (v.kind === 'plane') c.steer = -mv.x;
}

// ---------------- traffic & parked spawns ----------------
let roads = null, roadsSrc = null;
function getRoads() {
  const src = game.world?.roads; if (src === roadsSrc) return roads;
  roadsSrc = src; roads = [];
  const pt = p => Array.isArray(p) ? (p.length >= 3 ? V(p[0], p[1], p[2]) : V(p[0], 0, p[1])) : V(p.x, p.y ?? 0, p.z ?? p.y);
  const arr = !src ? [] : Array.isArray(src) ? src : (src.list || src.segments || src.edges || src.roads || src.paths || []);
  for (const r of arr) {
    const ptsRaw = Array.isArray(r) ? r : (r.points || r.pts || r.path || r.nodes || (r.a && r.b ? [r.a, r.b] : null));
    if (!ptsRaw || ptsRaw.length < 2) continue;
    const pts = ptsRaw.map(pt).filter(p => isFinite(p.x) && isFinite(p.z));
    if (pts.length < 2) continue;
    const width = r.width ?? 8;
    if (r.traffic === false || r.type === 'trail' || r.kind === 'path') continue;
    roads.push({ pts, lane: Math.max(1.6, width / 4), width });
  }
  return roads;
}
function roadPointNear(pos, minD, maxD) {
  const rs = getRoads(); if (!rs.length) return null;
  for (let tries = 0; tries < 30; tries++) {
    const r = rs[Math.floor(Math.random() * rs.length)];
    const i = Math.floor(Math.random() * (r.pts.length - 1));
    const p = r.pts[i].clone().lerp(r.pts[i + 1], Math.random());
    const dd = Math.hypot(p.x - pos.x, p.z - pos.z);
    if (dd > minD && dd < maxD) return { r, i, p };
  }
  return null;
}
const TRAFFIC_TYPES = ['sedan', 'sedan', 'sedan', 'sports', 'pickup', 'pickup', 'jeep'];
let trafficTimer = 0;
function updateTraffic(dt, ppos) {
  trafficTimer -= dt; if (trafficTimer > 0) return; trafficTimer = 0.5;
  const traffic = list.filter(v => v.ai && v.ai.traffic);
  for (const v of traffic) { const t = v.body.translation(); if (Math.hypot(t.x - ppos.x, t.z - ppos.z) > 340 || (v.dead && v.wreckTimer <= 0)) despawn(v); }
  if (api.trafficDensity <= 0) return;
  if (traffic.length < api.trafficDensity) {
    const s = roadPointNear(ppos, 110, 240); if (!s) return;
    const a = s.r.pts[s.i], b = s.r.pts[s.i + 1]; const dir = Math.random() < 0.5 ? 1 : -1;
    const dx = (b.x - a.x) * dir, dz = (b.z - a.z) * dir; const yaw = Math.atan2(dx, dz);
    const rightX = -Math.cos(yaw), rightZ = Math.sin(yaw); // model -X is right
    const p = V(s.p.x - rightX * -s.r.lane, 0, s.p.z - rightZ * -s.r.lane);
    if (waterAt(p.x, p.z) > (game.world?.heightAt?.(p.x, p.z) ?? 1)) return;
    if (nearest(p, 6)) return;
    p.y = groundY(p.x, p.z);
    const type = TRAFFIC_TYPES[Math.floor(Math.random() * TRAFFIC_TYPES.length)];
    const v = spawn(type, p, yaw, { ai: { traffic: true, road: s.r, i: dir > 0 ? s.i + 1 : s.i, dir, cruise: 11 + Math.random() * 6, panic: 0 } });
    const sp = v.ai.cruise * 0.8; v.body.setLinvel({ x: Math.sin(yaw) * sp, y: 0, z: Math.cos(yaw) * sp }, true);
    v.justSpawned = true;
  }
}
// regime pursuit: cars/tanks chase & ram, helis circle at altitude; all shoot if armed
function driveHunt(v, dt) {
  const ai = v.ai, c = v.controls, b = v.body;
  if (v.dead) { c.throttle = 0; c.brake = 1; c.fire = c.alt = false; c.up = 0; return; }
  const P = game.player, tv = api.current;
  const tgtObj = v.aiTarget || ai.target || P;
  let tp = tgtObj?.pos || tgtObj?.position; if (tv) { const tt = tv.body.translation(); tp = V(tt.x, tt.y, tt.z); }
  if (!tp || P?.state === 'dead') { c.throttle = 0; c.brake = 1; c.fire = c.alt = false; c.up = 0; c.pitch = c.roll = c.yaw = 0; return; }
  const t = b.translation(), q = bodyQ(b), f = fwdOf(q);
  const dx = tp.x - t.x, dz = tp.z - t.z, dist = Math.hypot(dx, dz);
  const yawTo = Math.atan2(dx, dz), yaw = Math.atan2(f.x, f.z);
  let dy = yawTo - yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  // weapons: aim at the target's chest, fire in bursts when in range
  ai.burst = (ai.burst ?? 0) - dt;
  if (ai.burst < -1.6) ai.burst = 1.1 + Math.random();
  c.aimDir = V(tp.x - t.x, tp.y + 1.2 - t.y, tp.z - t.z).normalize();
  const range = v.kind === 'heli' ? 160 : 110;
  c.fire = !!v.def.weapon && dist < range && ai.burst > 0 && game.state === 'play';
  c.alt = v.kind === 'heli' && c.fire && Math.random() < 0.02;
  if (v.kind === 'heli') {
    const ground = groundY(t.x, t.z, t.y - 1.0), wantAlt = Math.max(ground, groundY(tp.x, tp.z, tp.y + 5)) + 32;
    c.up = clamp((wantAlt - t.y) * 0.25, -1, 1);
    const wantDist = 70;
    c.pitch = clamp((dist - wantDist) / 60, -0.6, 1) * (Math.abs(dy) < 0.8 ? 1 : 0.2);
    c.roll = 0; c.yaw = clamp(dy * 1.8, -1.5, 1.5);
    return;
  }
  const vf = v.fwdSpeed ?? 0;
  const close = !tv && dist < 22;
  const want = close ? 6 : clamp(dist * 0.6, 8, Math.min(26, v.def.top || 26)) * (1 - Math.min(0.55, Math.abs(dy) * 0.5));
  c.steer = clamp(dy * 2.0, -1, 1) * (vf < -0.5 ? -1 : 1);
  c.throttle = clamp((want - vf) * 0.35, -1, 1); c.brake = 0; c.handbrake = Math.abs(dy) > 1.2 && vf > 10; c.boost = false;
  // stuck: back up with opposite lock
  if (vf < 1 && c.throttle > 0.5) ai.stuck = (ai.stuck || 0) + dt; else if (vf > 3) ai.stuck = 0;
  if (ai.stuck > 2.5) { c.throttle = -0.8; c.steer = -c.steer; if (ai.stuck > 4.5) ai.stuck = 0; }
}
function driveAI(v, dt) {
  const ai = v.ai, c = v.controls, b = v.body;
  if (v.dead) { c.throttle = 0; c.brake = 1; return; }
  const t = b.translation(), q = bodyQ(b), f = fwdOf(q);
  const r = ai.road;
  // advance target index
  let tgt = r.pts[ai.i];
  const lane = (p, n) => { const dx = n.x - p.x, dz = n.z - p.z, L = Math.hypot(dx, dz) || 1; return V(p.x + dz / L * -r.lane * 1, 0, p.z - dx / L * -r.lane * 1); };
  const prev = r.pts[ai.i - ai.dir] || r.pts[ai.i];
  let aim = lane(prev, tgt).add(V(tgt.x - prev.x, 0, tgt.z - prev.z));
  if (Math.hypot(aim.x - t.x, aim.z - t.z) < 9) {
    ai.i += ai.dir;
    if (ai.i < 0 || ai.i >= r.pts.length) {
      // find a connecting road near this end, else turn around
      const end = r.pts[ai.i < 0 ? 0 : r.pts.length - 1];
      const rs = getRoads().filter(o => o !== r && (o.pts[0].distanceTo(end) < 18 || o.pts[o.pts.length - 1].distanceTo(end) < 18));
      if (rs.length) { const o = rs[Math.floor(Math.random() * rs.length)]; ai.road = o; const atStart = o.pts[0].distanceTo(end) < 18; ai.dir = atStart ? 1 : -1; ai.i = atStart ? 1 : o.pts.length - 2; }
      else { ai.dir *= -1; ai.i = clamp(ai.i + ai.dir * 2, 0, r.pts.length - 1); }
    }
    return;
  }
  const yawTo = Math.atan2(aim.x - t.x, aim.z - t.z), yaw = Math.atan2(f.x, f.z);
  let dy = yawTo - yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  c.steer = clamp(dy * 2.2, -1, 1);
  // obstacle check
  ai.scan = (ai.scan || 0) - dt;
  if (ai.scan <= 0) {
    ai.scan = 0.2;
    const from = { x: t.x + f.x * (v.def.size[2] / 2 + 0.5), y: t.y + 0.2, z: t.z + f.z * (v.def.size[2] / 2 + 0.5) };
    const look = 8 + v.speed * 1.3;
    const hit = game.physics.castRay(new R.Ray(from, toR(V(f.x, 0, f.z).normalize())), look, true, undefined, undefined, undefined, undefined, cc => !v.colliders.includes(cc));
    ai.block = hit ? (hit.timeOfImpact ?? hit.toi) / look : 1;
    const pp = game.player?.pos;
    if (pp && !api.current) { const rel = V(pp.x - t.x, 0, pp.z - t.z); const ahead = rel.dot(V(f.x, 0, f.z)); if (ahead > 0 && ahead < look && Math.abs(rel.cross(V(f.x, 0, f.z)).y) < 2) ai.block = Math.min(ai.block, ahead / look); }
  }
  const panic = ai.panic > 0; ai.panic -= dt;
  const cruise = (panic ? ai.cruise * 1.8 : ai.cruise) * (1 - Math.min(0.6, Math.abs(dy)));
  const want = cruise * clamp((ai.block - 0.25) / 0.6, 0, 1);
  const vf = v.fwdSpeed ?? 0;
  c.throttle = clamp((want - vf) * 0.4, -1, 1); c.brake = want < 0.5 && vf < 1 ? 1 : 0; c.handbrake = false; c.boost = false;
  if (ai.block < 0.3 && vf < 0.5) { ai.stuck = (ai.stuck || 0) + dt; if (ai.stuck > 4) { c.throttle = -0.6; c.steer = -c.steer; if (ai.stuck > 6) ai.stuck = 0; } } else ai.stuck = 0;
}
let parkTimer = 0;
function updateParked(dt, ppos) {
  parkTimer -= dt; if (parkTimer > 0) return; parkTimer = 0.7;
  const spawns = game.world?.vehicleSpawns; if (!spawns?.length) return;
  for (const s of spawns) {
    const p = s.pos || s.position || s;
    const x = p.x, z = p.z ?? p.y; if (!isFinite(x) || !isFinite(z)) continue;
    const dd = Math.hypot(x - ppos.x, z - ppos.z);
    if (!s.v && dd < api.streamRadius && !(s._cool > game.simTime)) {
      s.v = spawn(s.type || 'sedan', { x, y: p.y !== undefined && s.pos ? p.y : undefined, z }, s.rotY ?? s.rot ?? s.yaw ?? 0, { spawnRec: s, driver: !!s.driver, color: s.color });
      s.v.faction = s.faction || s.v.faction; s.v.baseId = s.baseId;
      s.v.justSpawned = true;
    } else if (s.v && dd > api.streamRadius + 80 && api.current !== s.v) {
      const v = s.v; if (v.dead) s._cool = game.simTime + 300; despawn(v); s.v = null;
    }
  }
}

// ---------------- per-frame visuals ----------------
function syncVisual(v, dt) {
  const b = v.body, t = b.translation(), r = b.rotation();
  v.holder.position.set(t.x, t.y, t.z); v.holder.quaternion.set(r.x, r.y, r.z, r.w);
  v.pos = v.holder.position; v.quat = v.holder.quaternion;
  const vis = v.vis;
  if (v.vc) {
    const vc = v.vc;
    for (let i = 0; i < vis.wheels.length; i++) {
      const w = vis.wheels[i];
      const cp = vc.wheelChassisConnectionPointCs(i), sl = vc.wheelSuspensionLength(i) ?? v.def.rest;
      if (cp) w.group.position.set(cp.x, cp.y - sl + v.hc, cp.z);
      w.group.rotation.y = vc.wheelSteering(i) || 0;
      if (w.group.userData.spin) w.group.userData.spin.rotation.x = vc.wheelRotation(i) || 0;
    }
  }
  for (const ro of vis.rotors) {
    const rate = v.kind === 'plane' ? (v.throttle || 0) * ro.rate + (v.engineOn ? 6 : 0) : v.rotor * ro.rate;
    ro.angle += rate * dt;
    if (ro.axis === 'y') ro.spin.rotation.y = ro.angle; else if (ro.axis === 'x') ro.spin.rotation.x = ro.angle; else ro.spin.rotation.z = ro.angle;
    if (ro.blur) { ro.blur.visible = rate > 18 && !v.dead; ro.blur.material.opacity = 0.12; }
  }
  if (vis.flame) { const on = v.boosting || (v.type === 'jet' && v.throttle > 0.2); vis.flame.visible = on && !v.dead;
    if (on) { const s = v.type === 'jet' ? (v.boosting ? 1.3 : 0.4 + v.throttle * 0.5) : 0.8 + Math.random() * 0.4; vis.flame.scale.set(1, s, 1); vis.flame.material.color.setHex(v.boosting && v.type !== 'jet' ? 0x66aaff : 0xff9a40); } }
  // lights
  if (!v.dead) {
    const night = api._night;
    const on = v.occupied || v.ai || v.engineOn;
    vis.inst.head.emissiveIntensity = on ? (night ? 6 : 0.6) : 0.05;
    const braking = (v.controls.brake > 0.5 || (v.controls.throttle < -0.1 && (v.fwdSpeed ?? 0) > 1)) && on;
    vis.inst.tail.emissiveIntensity = braking ? 5 : on ? (night ? 2 : 0.3) : 0.05;
  }
  // damage smoke / fire
  const hp = v.health / v.maxHealth;
  if (v.dead || hp < 0.5) {
    const enginePos = _w.set(0, v.def.size[1] * 0.4, v.kind === 'car' ? v.def.size[2] * 0.3 : 0).applyQuaternion(v.holder.quaternion).add(v.holder.position);
    v._smokeAcc = (v._smokeAcc || 0) + dt * (v.dead ? 14 : hp < 0.25 ? 10 : 5);
    while (v._smokeAcc > 1) { v._smokeAcc--; FX.smokePuff(enginePos, v.dead || hp < 0.25 ? 0.08 : 0.45, v.dead ? 2 : 1.2); }
    if ((hp < 0.25 && !v.dead) || (v.dead && v.burn > 0)) { for (let i = 0; i < 2; i++) FX.firePuff(_v.copy(enginePos).add(V((Math.random() - .5) * 1.4, 0, (Math.random() - .5) * 1.4)), v.dead ? 1.6 : 0.9); }
    if (hp < 0.25 && !v.dead) { v._fireT = (v._fireT || 0) + dt; if (v._fireT > 5) damage(v, v.maxHealth, null, v.lastHitBy || 'fire'); }
  }
}
function updateHeadlight(v) {
  const night = api._night;
  if (!v || v.dead || !night) { if (api._spot) api._spot.visible = false; return; }
  if (!api._spot) {
    const s = api._spot = new THREE.SpotLight(0xfff1d8, 60, 90, 0.55, 0.5, 1.2); s.castShadow = false;
    s.target = new THREE.Object3D(); scene.add(s, s.target);
  }
  const s = api._spot; s.visible = v.kind === 'car' || v.kind === 'tank' || v.kind === 'heli';
  const q = v.holder.quaternion; s.position.copy(V(0, 0.3, v.def.size[2] / 2).applyQuaternion(q).add(v.holder.position));
  s.target.position.copy(V(0, -3, 30).applyQuaternion(q).add(v.holder.position));
}

// ---------------- system ----------------
const api = {
  list, current: null, colliderOwner, defs: DEFS, trafficDensity: 10, streamRadius: 400, prompt: null,
  spawn, enter, exit, nearest, damage, despawn, explode,
  types: Object.keys(DEFS),
  fire: (v, type, from, dir) => fire(v, type, from, dir),
};

export default {
  name: 'vehicles',
  async init(g) {
    game = g; R = g.RAPIER; scene = g.scene;
    g.vehicles = api;
    if (g.world) g.world.colliderOwner ||= colliderOwner;
    FX.init();
    g.events.on('physicsStep', h => { try { physicsStep(h); } catch (e) { if (!api._perr) { api._perr = 1; console.error('[vehicles] physics', e); } } });
    g.events.on('explosion', e => onExplosion(e));
    g.events.on('player:died', () => { if (api.current) exit({ force: true }); });
    if (g.params?.get('traffic') === '0') api.trafficDensity = 0;
  },
  update(dt, g) {
    if (!dt) return;
    api._night = isNight();
    const P = g.player, ppos = P?.pos || g.camera.position;
    const cur = api.current;
    // enter / exit
    api.prompt = null;
    if (cur) {
      if (cur.removed) api.current = null;
      else {
        playerControls(cur, dt);
        if (g.input.pressed('interact') && g.simTime - (cur._enterT ?? -1) > 0.25) exit();
        else if (P) { // keep the player glued to the seat
          const s = seatPos(cur).add(V(0, -cur.hc, 0)).applyQuaternion(cur.holder.quaternion).add(cur.holder.position);
          P.pos?.copy?.(s); const lv = cur.body.linvel(); P.vel?.set?.(lv.x, lv.y, lv.z); P.state = 'vehicle'; P.vehicle = cur;
        }
      }
    } else if (P && canEnterState(P.state) && P.pos) {
      const v = nearest(P.pos, P.state === 'ground' || P.state === 'swim' ? 2.8 : 4.5);
      if (v) {
        api.prompt = { v, text: (v.driver ? 'Hijack ' : 'Enter ') + v.label, key: 'F' };
        if (g.input.pressed('interact')) enter(v);
      }
    }
    if (g.state === 'play' || g.state === undefined || !cur) {
      updateTraffic(dt, ppos); updateParked(dt, ppos);
    }
    for (const v of list.slice()) {
      if (v.removed) continue;
      if (v.ai && !v.occupied) { if (v.ai.mode === 'hunt') driveHunt(v, dt); else if (v.ai.road) driveAI(v, dt); else { v.controls.throttle = 0; v.controls.brake = 1; } }
      if (v.occupied) vehicleWeapons(v, dt);
      else if (v.ai?.weapons) vehicleWeapons(v, dt);
      syncVisual(v, dt);
      if (v.dead) { v.burn -= dt; v.wreckTimer -= dt; if (v.wreckTimer <= 0 && !v.spawnRec) despawn(v); else if (v.wreckTimer < 3) v.holder.position.y -= (3 - v.wreckTimer) * 0.3; }
      if (v.occupied || (v.engineOn && v.speed > 0.5) || v.ai) { try { g.audio?.engine?.(v); } catch {} }
    }
    updateHeadlight(api.current);
    updateEjected(dt); updateShots(dt); FX.update(dt);
  },
};
