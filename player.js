// STORMBREAK player: Sable Marrow. Rigged CC0 mannequin (Quaternius Universal Animation Library) recoloured
// into an outfit by bone region, AnimationMixer crossfades + upper-body aim layer + procedural air poses,
// Rapier KinematicCharacterController, freefall / parachute / wingsuit glide / swim / death & respawn.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { buildSable } from './sable.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const angLerp = (a, b, t) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
const G = 9.81, HALF = 0.55, RAD = 0.35, CENTER = HALF + RAD; // capsule; pos = feet

// ---- outfit palettes (by bone region) ----
export const PALETTES = {
  hero: { skin: 0xb98163, hair: 0x2a1c14, jacket: 0x7a2f1e, shirt: 0x2f3b40, pants: 0x3c3a33, boots: 0x2b2018, gloves: 0x1a1a1a },
  soldier: { skin: 0xa8795c, hair: 0x1d1a16, jacket: 0x4f5a3a, shirt: 0x4f5a3a, pants: 0x464f34, boots: 0x1f1d19, gloves: 0x23251f },
};
function region(n) {
  n = n.toLowerCase();
  if (/head|neck/.test(n)) return 'skin';
  if (/hand|f_|thumb|index|middle|ring|pinky/.test(n)) return 'gloves';
  if (/foot|toe|ball/.test(n)) return 'boots';
  if (/thigh|shin|calf/.test(n)) return 'pants';
  if (/hips|pelvis/.test(n)) return 'pants';
  if (/spine\.?001|spine_01/.test(n)) return 'shirt';
  return 'jacket';
}
const geoCache = new Map();
function paint(root, palette, key) {
  root.traverse(o => {
    if (!o.isSkinnedMesh) return;
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    const isJoint = /_2$/.test(o.name) || o.material?.name === 'M_Joints';
    const ck = key + o.geometry.uuid;
    let geo = geoCache.get(ck);
    if (!geo) {
      geo = o.geometry.clone();
      const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, n = si.count;
      const col = new Float32Array(n * 3), c = new THREE.Color();
      const bones = o.skeleton.bones;
      for (let i = 0; i < n; i++) {
        let best = 0, bw = -1;
        for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
        c.setHex(palette[region(bones[best]?.name || '')] ?? 0x888888);
        if (isJoint) c.multiplyScalar(0.72);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geoCache.set(ck, geo);
    }
    o.geometry = geo;
    o.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: isJoint ? 0.55 : 0.82, metalness: 0.02 });
  });
}
const ALIAS = {
  hand_r: 'DEF-hand.R', handr: 'DEF-hand.R', righthand: 'DEF-hand.R', hand_l: 'DEF-hand.L', handl: 'DEF-hand.L', lefthand: 'DEF-hand.L',
  head: 'DEF-head', neck: 'DEF-neck', spine: 'DEF-spine.002', chest: 'DEF-spine.003', hips: 'DEF-hips', pelvis: 'DEF-hips',
  forearm_l: 'DEF-forearm.L', forearm_r: 'DEF-forearm.R', foot_l: 'DEF-foot.L', foot_r: 'DEF-foot.R', thigh_r: 'DEF-thigh.R', thigh_l: 'DEF-thigh.L',
};
function findBone(root, name) {
  const want = [name, 'DEF-' + name, ALIAS[String(name).toLowerCase().replace(/[\s.-]/g, '_')] || ALIAS[String(name).toLowerCase()]];
  // GLTFLoader sanitizes node names (PropertyBinding strips '.'), so 'DEF-upper_arm.L' arrives as 'DEF-upper_armL'
  const norm = n => String(n || '').replace(/\./g, '');
  const wantN = want.filter(Boolean).map(norm);
  let found = null;
  root.traverse(o => { if (!found && o.isBone && (want.includes(o.name) || wantN.includes(norm(o.name)))) found = o; });
  return found;
}

// ---- tiny animation controller: crossfades on a base mixer + an upper-body overlay mixer
const UPPER = /spine\.?00[23]|neck|head|shoulder|upper_arm|forearm|hand|f_|thumb/;
class Animator {
  constructor(root, clips) {
    this.root = root; this.mixer = new THREE.AnimationMixer(root); this.aimMixer = new THREE.AnimationMixer(root);
    this.clips = {}; for (const c of clips) this.clips[c.name] = c;
    this.actions = {}; this.cur = null; this.curName = '';
    this.upperBones = []; root.traverse(o => { if (o.isBone && UPPER.test(o.name)) this.upperBones.push(o); });
    this.saved = this.upperBones.map(() => new THREE.Quaternion());
    const up = n => { const c = this.clips[n]; if (!c) return null; const t = c.clone(); t.tracks = t.tracks.filter(k => UPPER.test(k.name.split('.')[0]) && k.name.endsWith('quaternion')); return this.aimMixer.clipAction(t); };
    this.aim = { n: up('Pistol_Aim_Neutral'), u: up('Pistol_Aim_Up'), d: up('Pistol_Aim_Down'), s: up('Pistol_Shoot') };
    for (const a of [this.aim.n, this.aim.u, this.aim.d]) if (a) { a.play(); a.setEffectiveWeight(0); }
    if (this.aim.s) { this.aim.s.setLoop(THREE.LoopOnce); this.aim.s.clampWhenFinished = true; }
    this.aimW = 0; this.shootT = 0;
  }
  act(n) { if (!this.actions[n] && this.clips[n]) this.actions[n] = this.mixer.clipAction(this.clips[n]); return this.actions[n]; }
  play(n, { fade = 0.2, once = false, ts = 1, restart = false } = {}) {
    const a = this.act(n); if (!a) return;
    a.timeScale = ts;
    if (this.curName === n && !restart) return;
    a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat); a.clampWhenFinished = once; a.enabled = true; a.setEffectiveWeight(1); a.play();
    if (this.cur && this.cur !== a) this.cur.crossFadeTo(a, fade, false);
    this.cur = a; this.curName = n;
  }
  update(dt, aimTarget, aimPitch) {
    this.mixer.update(dt);
    this.aimW += (aimTarget - this.aimW) * damp(10, dt);
    if (this.aimW > 0.01 && this.aim.n) {
      for (let i = 0; i < this.upperBones.length; i++) this.saved[i].copy(this.upperBones[i].quaternion);
      const p = clamp(aimPitch / 0.9, -1, 1);
      this.aim.n.setEffectiveWeight(1 - Math.abs(p)); this.aim.u?.setEffectiveWeight(Math.max(0, p)); this.aim.d?.setEffectiveWeight(Math.max(0, -p));
      if (this.aim.s) this.aim.s.setEffectiveWeight(this.shootT > 0 ? 1.5 : 0);
      this.shootT -= dt;
      this.aimMixer.update(dt);
      for (let i = 0; i < this.upperBones.length; i++) this.upperBones[i].quaternion.copy(this.saved[i].slerp(this.upperBones[i].quaternion, this.aimW));
    }
  }
  shoot() { if (this.aim.s) { this.aim.s.reset().play(); this.shootT = 0.25; } }
}

// rotate `bone` (in world space) so the bone->child segment points along `dir` (world), weighted
const _a = V(), _b = V(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qi = new THREE.Quaternion();
function aimBone(bone, child, dir, w) {
  if (!bone || !child || w <= 0.001) return;
  bone.getWorldPosition(_a); child.getWorldPosition(_b);
  const cur = _b.sub(_a).normalize();
  _q.setFromUnitVectors(cur, dir); if (w < 1) _q.slerp(_qi.identity(), 1 - w);
  bone.getWorldQuaternion(_q2); _q2.premultiply(_q);
  bone.parent.getWorldQuaternion(_qi); bone.quaternion.copy(_qi.invert().multiply(_q2));
  bone.updateMatrixWorld(true);
}

// two-bone IK: point upper (ua->fa) and lower (fa->h) segments so the hand lands on `target`, elbow toward `pole`
function ik(ua, fa, h, target, pole, w) {
  const S = V(), E0 = V(), H0 = V(); ua.getWorldPosition(S); fa.getWorldPosition(E0); h.getWorldPosition(H0);
  const L1 = S.distanceTo(E0), L2 = E0.distanceTo(H0), toT = target.clone().sub(S);
  const d = clamp(toT.length(), 0.08, (L1 + L2) * 0.995), n = toT.normalize();
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const p = pole.clone().addScaledVector(n, -pole.dot(n)).normalize();
  const E = S.clone().addScaledVector(n, a).addScaledVector(p, hh), Tt = S.clone().addScaledVector(n, d);
  aimBone(ua, fa, E.sub(S).normalize(), w);
  fa.getWorldPosition(E0); aimBone(fa, h, Tt.sub(E0).normalize(), w);
}

export default {
  name: 'player',
  async init(game) {
    const scene = game.scene, R = game.RAPIER;
    const P = game.player = {
      pos: V(0, 50, 0), vel: V(), state: 'air', health: 100, maxHealth: 100, armor: 0, maxArmor: 100,
      facing: 0, crouching: false, sprinting: false, aiming: false, grounded: false, proximity: 0, bank: 0,
      wingsuitBoost: 0, parachuteThrust: 0, regenDelay: 4, regenRate: 14, fallDamageScale: 1, invuln: 0,
      obj: new THREE.Group(), controller: null, collider: null, hanging: false, airTime: 0, sockets: {},
      ready: false,
    };
    P.obj.name = 'player';
    this.pivot = new THREE.Group(); this.pivot.position.y = 1.0; P.obj.add(this.pivot);
    scene.add(P.obj);
    this.lastHealth = P.health; this.sinceHurt = 99; this.lock = 0; this.deadT = 0;
    this.tt = { a: 0.56, cap: 11, dy: 0.45, min: 0.15, post: 1 }; this.pitch = 0; this.roll = 0; this.ws = { s: 0, th: 0, al: 0.27, t: 0 }; this.chute = 0; this.wing = 0; this.pulls = []; this.slingE = 0; this.popT = 0; this.tuck = 0;

    // ---- physics: standalone capsule collider moved by the kinematic controller
    if (game.physics && R) {
      const ctl = P.controller = game.physics.createCharacterController(0.04);
      ctl.setUp({ x: 0, y: 1, z: 0 });
      ctl.setMaxSlopeClimbAngle(52 * Math.PI / 180); ctl.setMinSlopeSlideAngle(42 * Math.PI / 180);
      ctl.enableAutostep(0.45, 0.25, false); ctl.enableSnapToGround(0.45);
      ctl.setApplyImpulsesToDynamicBodies(true); ctl.setCharacterMass(85);
      P.collider = game.physics.createCollider(R.ColliderDesc.capsule(HALF, RAD).setTranslation(0, 50, 0));
      P.collider.userData = { player: true, noCamera: true };
      // register the capsule so enemy bullets / LOS / blasts resolving world.colliderOwner find the player
      if (game.world) (game.world.colliderOwner ||= new Map()).set(P.collider.handle, P);
    }

    // ---- API
    P.setState = (s) => { if (s === P.state) return; const prev = P.state; P.state = s; this.onState(game, s, prev); game.events.emit('player:state', { state: s, prev }); };
    P.damage = (amt, src) => {
      if (P.state === 'dead' || P.invuln > 0 || !(amt > 0)) return;
      const absorbed = Math.min(P.armor, amt * 0.6); P.armor -= absorbed; P.health -= amt - absorbed; this.sinceHurt = 0;
      this.lastHealth = P.health;
      game.events.emit('player:damaged', { amount: amt, src });
      game.gfx?.shake?.(Math.min(0.5, amt / 60)) ?? game.cam?.shake?.(Math.min(0.5, amt / 60));
      if (P.health <= 0) this.die(game, src);
    };
    P.heal = (a) => { P.health = Math.min(P.maxHealth, P.health + a); this.lastHealth = P.health; };
    P.respawn = (pos, reason = 'teleport') => {
      const p = pos ? V(pos.x, pos.y ?? 0, pos.z) : this.spawnPos(game);
      const g = game.world?.heightAt?.(p.x, p.z); if (g != null && p.y < g + 0.5) p.y = g + 1;
      P.pos.copy(p); P.vel.set(0, 0, 0); P.hanging = false;
      if (P.state === 'dead') { P.health = P.maxHealth; this.lastHealth = P.health; }
      P.collider?.setEnabled(true); P.collider?.setTranslation({ x: p.x, y: p.y + CENTER, z: p.z });
      P.obj.visible = true; if (P.obj.parent !== scene) scene.add(P.obj);
      P.state = 'air'; this.onState(game, 'air', 'dead'); P.invuln = 2;
      game.cam?.snap?.();
      game.events.emit('player:respawn', { pos: p.clone(), reason });
    };
    // grapple-boost while gliding: +dv m/s along `dir` (unit, world) spread over ~0.3 s, slight lift, cap 80
    P.glidePull = (dir, dv = 12) => {
      if (P.state !== 'wingsuit' && P.state !== 'parachute') return false;
      if (P.state === 'parachute') { const h = Math.hypot(dir.x, dir.z) || 1; P.vel.x += dir.x / h * dv * 0.7; P.vel.z += dir.z / h * dv * 0.7; P.vel.y += dv * 0.15; this.slingE = Math.hypot(P.vel.x, P.vel.z); return true; }
      this.pulls.push({ dir: dir.clone().normalize(), rem: dv, rate: dv / 0.3 });
      if (dir.y > 0.2) this.zoomT = 0.9; // an upward boost: the suit holds the climb a moment instead of nosing straight back down
      game.cam?.fovKick?.(5); return true;
    };
    // grapple arrival launch: velocity in, airborne, chute/wingsuit available on the very next press, a float at the apex
    P.pop = (v) => {
      P.hanging = false; P.vel.copy(v); if (P.state !== 'air') P.setState('air');
      P.airTime = 1; this.popT = 1.6; this.popApex = 0.35; this.popped = true; this.tuck = 0.4; this.deployQ = null;
    };
    P.launch = (v) => { P.vel.copy(v); if (P.state === 'ground' || P.state === 'swim') P.setState('air'); };
    P.setPosition = (p) => { P.pos.copy(p); P.collider?.setTranslation({ x: p.x, y: p.y + CENTER, z: p.z }); };
    P.getBone = (n) => this.model ? findBone(this.model, n) : null;
    P.cloneModel = (opts = {}) => this.cloneModel(opts);
    P.center = (out = V()) => out.copy(P.pos).add({ x: 0, y: CENTER, z: 0 });

    game.events.on('vehicle:exited', () => { if (P.state === 'vehicle') { P.setState('air'); } });
    game.events.on('weapon:fired', () => this.anim?.shoot());

    // ---- model
    try {
      const gltf = await new GLTFLoader().loadAsync('./assets/player/hero.glb');
      this.base = gltf.scene; this.clips = gltf.animations;
      const model = this.model = SkeletonUtils.clone(gltf.scene);
      // Sable's own procedural body, skinned onto the mannequin skeleton; the mannequin meshes are hidden
      let sm = null; model.traverse(o => { if (o.isSkinnedMesh && !sm) sm = o; });
      try {
        const parts = buildSable(sm);
        model.traverse(o => { if (o.isSkinnedMesh) o.visible = false; });
        for (const m of parts) sm.parent.add(m);
        this.sable = parts;
      } catch (e) {
        console.warn('[player] sable body failed, using painted mannequin', e);
        paint(model, PALETTES.hero, 'hero'); this.sable = null;
      }
      this.pivot.add(model); model.position.y = -1.0;
      model.updateMatrixWorld(true);
      this.addGear(game, model);
      this.anim = new Animator(model, gltf.animations);
      this.anim.play('Idle_Loop', { fade: 0 });
      const b = n => findBone(model, n);
      this.B = { ual: b('DEF-upper_arm.L'), fal: b('DEF-forearm.L'), hl: b('DEF-hand.L'), uar: b('DEF-upper_arm.R'), far: b('DEF-forearm.R'), hr: b('DEF-hand.R'),
        tl: b('DEF-thigh.L'), sl: b('DEF-shin.L'), fl: b('DEF-foot.L'), tr: b('DEF-thigh.R'), sr: b('DEF-shin.R'), fr: b('DEF-foot.R'), neck: b('DEF-neck'), head: b('DEF-head'), sp3: b('DEF-spine.003') };
    } catch (e) {
      console.error('[player] model failed, using fallback rig', e);
      game.errors?.push?.({ system: 'player-model', error: String(e) });
      this.buildFallback();
    }
    this.buildChute(game); this.buildWings(game);

    P.respawn(this.spawnPos(game), 'spawn');
    P.ready = true;
  },

  spawnPos(game) {
    const sp = game.world?.spawnPoint;
    if (sp) return V(sp.x, sp.y ?? ((game.world.heightAt?.(sp.x, sp.z) ?? 0) + 2), sp.z);
    return V(0, (game.world?.heightAt?.(0, 0) ?? 0) + 2, 0);
  },

  // ---- gear: hair, goggles, chute pack, grapple gauntlet, holster (attached to bones, sized in world units)
  addGear(game, model) {
    const P = game.player;
    const mat = (c, r = 0.7, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    const wp = n => { const b = findBone(model, n); const p = V(); b?.getWorldPosition(p); return { b, p }; };
    const attach = (bone, mesh, pos, lookAt) => {
      mesh.position.copy(pos); if (lookAt) mesh.lookAt(lookAt);
      mesh.castShadow = true; this.pivot.add(mesh); mesh.updateMatrixWorld(true); bone.attach(mesh); return mesh;
    };
    model.updateMatrixWorld(true);
    const head = wp('DEF-head'), sp3 = wp('DEF-spine.003'), fal = wp('DEF-forearm.L'), hl = wp('DEF-hand.L'), hr = wp('DEF-hand.R'), thr = wp('DEF-thigh.R'), shr = wp('DEF-shin.R');
    const toPivot = p => this.pivot.worldToLocal(p.clone());
    const own = !!this.sable; // procedural body already has hair, pack, gauntlet, belt
    if (head.b && !own) {
      const hp = toPivot(head.p);
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.118, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(PALETTES.hero.hair, 0.95));
      hair.scale.set(1, 0.9, 1.08); attach(head.b, hair, hp.clone().add(V(0, 0.15, -0.022)));
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.018, 6, 24, Math.PI * 1.1), mat(0x161616, 0.3, 0.4));
      band.rotation.set(Math.PI / 2, 0, -Math.PI * 0.05 + Math.PI); band.scale.set(1, 1.12, 1);
      attach(head.b, band, hp.clone().add(V(0, 0.115, 0.012)));
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.035, 0.02), new THREE.MeshStandardMaterial({ color: 0x1a2228, roughness: 0.1, metalness: 0.9 }));
      attach(head.b, lens, hp.clone().add(V(0, 0.118, 0.112)));
    }
    if (sp3.b) {
      const pp = toPivot(sp3.p);
      if (!own) {
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.15, 2, 2, 2), mat(0x2c3236, 0.85));
      const pos = pack.geometry.attributes.position; // round the box a little
      for (let i = 0; i < pos.count; i++) { const v = V().fromBufferAttribute(pos, i); v.multiply(V(1 / 0.17, 1 / 0.21, 1 / 0.075)); const l = v.length(); v.multiplyScalar(Math.pow(l, -0.25)); v.multiply(V(0.17, 0.21, 0.075)); pos.setXYZ(i, v.x, v.y, v.z); }
      pack.geometry.computeVertexNormals();
      attach(sp3.b, pack, pp.clone().add(V(0, -0.02, -0.19)));
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.3), mat(0x15181a, 0.9));
      attach(sp3.b, strap, pp.clone().add(V(0, -0.12, -0.03)));
      }
      P.sockets.back = attach(sp3.b, new THREE.Object3D(), pp.clone().add(V(0, 0, -0.28)));
    }
    if (fal.b && hl.b) {
      const a = toPivot(fal.p), b = toPivot(hl.p);
      if (!own) {
        const g = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.046, 0.2, 10), mat(0x3a3f44, 0.35, 0.8));
        g.geometry.rotateX(Math.PI / 2);
        attach(fal.b, g, a.clone().lerp(b, 0.62), b);
      }
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(own ? 0.014 : 0.018, own ? 0.02 : 0.024, 0.07, 8), mat(0xc8a040, 0.3, 0.9));
      nozzle.geometry.rotateX(Math.PI / 2);
      const n = attach(fal.b, nozzle, a.clone().lerp(b, 0.9).add(V(0, own ? 0.06 : 0.045, 0)), b.clone().add(V(0, own ? 0.06 : 0.045, 0)));
      P.sockets.grapple = n;
    }
    if (hr.b) {
      const p = toPivot(hr.p);
      const s = new THREE.Object3D(); s.position.copy(p).add(V(-0.08, 0, 0.02)); this.pivot.add(s); s.lookAt(this.pivot.localToWorld(p.clone().add(V(-1, 0, 0))));
      s.updateMatrixWorld(true); hr.b.attach(s); P.sockets.handR = s;
    }
    if (hl.b) { const s = new THREE.Object3D(); s.position.copy(toPivot(hl.p)).add(V(0.08, 0, 0.02)); this.pivot.add(s); s.updateMatrixWorld(true); hl.b.attach(s); P.sockets.handL = s; }
    if (thr.b && shr.b) {
      const a = toPivot(thr.p), b = toPivot(shr.p);
      const hol = new THREE.Mesh(own ? new THREE.BoxGeometry(0.035, 0.16, 0.09) : new THREE.BoxGeometry(0.07, 0.2, 0.12), mat(0x1d1712, 0.8));
      attach(thr.b, hol, a.clone().lerp(b, 0.3).add(V(own ? -0.085 : -0.1, 0, 0)));
      P.sockets.hip = hol;
    }
    // belt
    const hips = wp('DEF-hips');
    if (hips.b && !own) {
      const belt = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.025, 6, 20), mat(0x241a12, 0.6));
      belt.rotation.x = Math.PI / 2; belt.scale.set(1, 0.78, 1);
      attach(hips.b, belt, toPivot(hips.p).add(V(0, 0.08, 0.01)));
    }
  },

  buildFallback() {
    const m = new THREE.MeshStandardMaterial({ color: 0x7a2f1e, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.9, 4, 10), m); body.position.y = 0.0;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), new THREE.MeshStandardMaterial({ color: 0xb98163 })); head.position.y = 0.72;
    this.pivot.add(body, head); body.castShadow = head.castShadow = true;
  },

  // ---- parachute canopy (ram-air, original colours) + suspension lines
  buildChute(game) {
    const grp = this.chuteObj = new THREE.Group();
    const W = 9, C = 3.2, cells = 9, segW = 36, segC = 10;
    const geo = new THREE.BufferGeometry(), pos = [], col = [], idx = [];
    const cA = new THREE.Color(0x1f6f78), cB = new THREE.Color(0xe8e2d0), cC = new THREE.Color(0xd4562a);
    const sh = (u, v, top) => { // u -1..1 span, v 0..1 chord
      const arc = 0.42 * Math.PI * u, r = 7.5;
      const th = (top ? 1 : -0.35) * 0.32 * Math.sin(Math.PI * Math.min(1, v * 1.2)) * (1 - Math.abs(u) * 0.3);
      const y = Math.cos(arc) * r - r + th, x = Math.sin(arc) * r * 0.82;
      const z = (v - 0.4) * C * (1 - 0.15 * u * u);
      return [x, y, -z];
    };
    for (const top of [1, 0]) {
      const base = pos.length / 3;
      for (let i = 0; i <= segW; i++) for (let j = 0; j <= segC; j++) {
        const u = i / segW * 2 - 1, v = j / segC; pos.push(...sh(u, v, top));
        const cell = Math.floor((u + 1) / 2 * cells - 1e-6); const c = cell === 4 ? cC : cell % 2 ? cB : cA;
        const shade = top ? 1 : 0.6; col.push(c.r * shade, c.g * shade, c.b * shade);
      }
      for (let i = 0; i < segW; i++) for (let j = 0; j < segC; j++) {
        const a = base + i * (segC + 1) + j, b = a + segC + 1;
        if (top) idx.push(a, b, a + 1, b, b + 1, a + 1); else idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const canopy = this.canopy = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide, transparent: true }));
    canopy.castShadow = true; canopy.position.y = 5.2; grp.add(canopy);
    // centre fade: where the canopy would cover the middle of the frame (the ground ahead), the fabric and lines thin out
    // (screen-space, by uChuteNear 0..0.6); the arch across the top and the drooping wingtips stay solid
    const uNear = this.chuteNear = { value: 0 };
    const edgeFade = mat => { mat.onBeforeCompile = sh0 => {
      sh0.uniforms.uChuteNear = uNear;
      sh0.vertexShader = sh0.vertexShader.replace('void main() {', 'varying vec4 vCF;\nvoid main() {').replace('#include <project_vertex>', '#include <project_vertex>\n  vCF = gl_Position;');
      sh0.fragmentShader = sh0.fragmentShader.replace('void main() {', 'uniform float uChuteNear; varying vec4 vCF;\nvoid main() {').replace('#include <dithering_fragment>',
        '#include <dithering_fragment>\n  { vec2 n = vCF.xy / max(vCF.w, 1e-3); float r = length(vec2(n.x * 1.4, n.y - 0.05));\n    gl_FragColor.a *= mix(1.0, smoothstep(0.2, 0.75, r), uChuteNear); }');
    }; };
    edgeFade(canopy.material);
    // lines from canopy underside to the shoulders
    const lp = [];
    for (let i = 0; i <= 8; i++) { const u = i / 8 * 2 - 1; for (const v of [0.1, 0.55]) { const p = sh(u, v, 0); lp.push(p[0], p[1] + 5.2, p[2], u * 0.18, 1.45, (v - 0.3) * 0.1); } }
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)),
      new THREE.LineBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.7 }));
    edgeFade(lines.material); grp.add(lines); grp.visible = false; game.scene.add(grp);
  },

  // ---- wingsuit membranes stretched between wrists, hips and ankles (rebuilt from bone positions each frame)
  buildWings(game) {
    // 4 bilinear panels (two arm wings, split tail wing), each an N x N grid so the membrane bends with the limbs
    const N = 4, R = N + 1, idx = [];
    for (let q = 0; q < 4; q++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = q * R * R + j * R + i, b = a + 1, c = a + R, d = c + 1; idx.push(a, b, d, a, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * R * R * 3), 3));
    geo.setIndex(idx); this.wingN = N;
    this.wingMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x7a1f18, roughness: 0.55, side: THREE.DoubleSide, emissive: 0x000000 }));
    this.wingMesh.frustumCulled = false; this.wingMesh.visible = false; this.wingMesh.castShadow = true;
    game.scene.add(this.wingMesh);
  },

  cloneModel({ palette = 'soldier' } = {}) {
    if (!this.base) return null;
    const obj = SkeletonUtils.clone(this.base);
    const pal = typeof palette === 'string' ? PALETTES[palette] || PALETTES.soldier : { ...PALETTES.soldier, ...palette };
    paint(obj, pal, typeof palette === 'string' ? palette : JSON.stringify(palette));
    const clips = {}; for (const c of this.clips) clips[c.name] = c;
    return { obj, animations: this.clips, clips, mixer: new THREE.AnimationMixer(obj), getBone: n => findBone(obj, n), height: 1.83 };
  },

  die(game, src) {
    const P = game.player; if (P.state === 'dead') return;
    P.health = 0; P.hanging = false;
    if (P.state === 'vehicle') { try { game.vehicles?.exit?.(); } catch (e) {} }
    P.setState('dead'); this.deadT = 0; this.deathPos = P.pos.clone();
    game.events.emit('player:died', { pos: P.pos.clone(), src });
  },

  onState(game, s, prev) {
    const P = game.player, a = this.anim;
    if (s === 'parachute') {
      this.chute = 0.01; this.slingE = 0; game.audio?.play?.('parachute', { pos: P.pos }); game.cam?.shake?.(0.25);
      const hs = Math.hypot(P.vel.x, P.vel.z), cap = prev === 'wingsuit' ? 22 : 26; // opening shock
      if (hs > cap) { P.vel.x *= cap / hs; P.vel.z *= cap / hs; }
      if (prev === 'wingsuit') { P.vel.y = Math.max(P.vel.y, 0) * 0.3 + 3.5; if (this.ws.t > 1) this.slingE = Math.min(hs, cap); } // small swap pop
      else P.vel.y = Math.max(P.vel.y, -14);
    }
    if (s === 'ground' || s === 'swim' || s === 'vehicle' || s === 'dead') { this.popped = false; this.popT = 0; this.deployQ = null; }
    if (s !== 'wingsuit') { this.pulls.length = 0; this.zoomT = 0; }
    if (s === 'wingsuit') { game.audio?.play?.('wingsuit', { pos: P.pos }); game.cam?.fovKick?.(6); }
    if (s === 'dead') a?.play('Death01', { once: true, fade: 0.15 });
    if (prev === 'vehicle') { P.collider?.setEnabled(true); P.obj.visible = true; if (P.obj.parent !== game.scene) game.scene.attach(P.obj); }
    if (s === 'vehicle') { P.collider?.setEnabled(false); this.chute = 0; this.wing = 0; }
    if (s !== 'grapple') P.hanging = false;
  },

  waterAt(game, x, z) { return game.gfx?.waterHeightAt?.(x, z) ?? (game.world ? (game.world.seaLevel ?? 0) : -1e9); },

  update(dt, game) {
    const P = game.player; if (!P?.ready || dt <= 0) return;
    const input = game.input, play = game.state === 'play';
    const I = {
      mx: play ? input.move.x : 0, my: play ? input.move.y : 0,
      jump: play && input.pressed('jump'), jumpHeld: play && input.down('jump'), sprint: play && input.down('sprint'), sprintP: play && input.pressed('sprint'),
      crouchP: play && input.pressed('crouch'), crouch: play && input.down('crouch'), aim: play && input.down('aim'), fire: play && input.down('fire'),
    };
    const cam = game.cam, yaw = cam?.yaw ?? Math.PI;
    const fwd = V(-Math.sin(yaw), 0, -Math.cos(yaw)), right = V(Math.cos(yaw), 0, -Math.sin(yaw));
    const wish = V().addScaledVector(fwd, I.my).addScaledVector(right, I.mx);
    const wishLen = Math.min(1, wish.length()); if (wishLen > 0.001) wish.divideScalar(wish.length());
    P.invuln = Math.max(0, P.invuln - dt);

    // health: regen + detect external damage (combat may write health directly)
    if (P.health < this.lastHealth - 0.01) { this.sinceHurt = 0; if (P.health <= 0) this.die(game, 'damage'); }
    this.sinceHurt += dt;
    if (P.state !== 'dead' && this.sinceHurt > P.regenDelay && P.health < P.maxHealth) P.health = Math.min(P.maxHealth, P.health + P.regenRate * dt);
    this.lastHealth = P.health;

    if (P.state === 'vehicle') { // vehicles module positions us; just animate the seated pose
      this.anim?.play('Driving_Loop', { fade: 0.3 });
      P.vel.set(0, 0, 0); this.chuteObj.visible = false; this.wingMesh.visible = false;
      this.animate(game, dt, I); this.updateWings(game); return;
    }
    if (P.state === 'dead') {
      this.deadT += dt; P.vel.multiplyScalar(1 - damp(3, dt)); P.vel.y -= G * dt;
      this.move(game, dt);
      if (this.deadT > 4) {
        const sh = game.world?.safehouses || [];
        let best = null, bd = Infinity;
        for (const e of sh) { const p = e.pos || e.position || e.spawn || e; if (p?.x == null) continue; const d = (p.x - this.deathPos.x) ** 2 + (p.z - this.deathPos.z) ** 2; if (d < bd) { bd = d; best = p; } }
        P.respawn(best ? V(best.x, best.y, best.z) : this.spawnPos(game), 'death');
      }
      this.animate(game, dt, I); return;
    }

    if (!play) { this.animate(game, dt, I); this.syncObj(game, dt); return; }

    const wh = this.waterAt(game, P.pos.x, P.pos.z);
    const ground = game.world?.heightAt?.(P.pos.x, P.pos.z) ?? -1e9;
    const hAbove = P.pos.y - Math.max(ground, wh);
    P.aiming = I.aim; P.crouching = false; P.sprinting = false;
    if (I.fire && this.anim && this.fireCD <= 0) { this.anim.shoot(); this.fireCD = 0.18; }
    this.fireCD = (this.fireCD || 0) - dt;
    const vy0 = P.vel.y;

    if (this.mantle) { this.mantleStep(game, dt); this.animate(game, dt, I); this.syncObj(game, dt); return; }
    switch (P.state) {
      case 'ground': {
        this.coyote = (this.coyote || 0);
        P.crouching = I.crouch && !I.sprint;
        P.sprinting = I.sprint && wishLen > 0.3 && !I.aim && !P.crouching;
        let top = P.crouching ? 2.4 : I.aim ? 3.6 : P.sprinting ? 9.6 : wishLen < 0.55 ? 2.4 : 6.0;
        if (this.lock > 0 && this.lockKind === 'roll') { wish.set(Math.sin(P.facing), 0, Math.cos(P.facing)); top = 6.5; }
        const target = wish.clone().multiplyScalar(top * Math.max(wishLen, this.lock > 0 && this.lockKind === 'roll' ? 1 : 0));
        if (this.lock > 0 && this.lockKind === 'land') target.multiplyScalar(0.3);
        // momentum: build speed a touch slower than you shed it; reversing bites hard
        const hs0 = Math.hypot(P.vel.x, P.vel.z), tl = target.length();
        const k = tl < 0.1 ? 13 : (hs0 > 0.5 && (target.x * P.vel.x + target.z * P.vel.z) / (tl * hs0) < 0.3) ? 12 : tl > hs0 ? (P.sprinting ? 5.5 : 8) : 10;
        P.vel.x += (target.x - P.vel.x) * damp(k, dt); P.vel.z += (target.z - P.vel.z) * damp(k, dt);
        P.vel.y = -3;
        if (wishLen > 0.4 && this.lock <= 0 && this.tryMantle(game, wish)) break;
        if (I.jump && this.lock <= 0.1) { P.vel.y = 7.4; P.setState('air'); this.anim?.play('Jump_Start', { once: true, fade: 0.08, ts: 1.6 }); this.jumpAnimT = 0.35; game.audio?.play?.('jump', { pos: P.pos }); }
        break;
      }
      case 'air': {
        P.airTime += dt;
        let gmul = P.vel.y > 0 && I.jumpHeld ? 1.25 : 1.6;
        if (this.popT > 0) { // grapple pop: honest gravity on the rise, then a short float at the apex to act from
          this.popT -= dt; gmul = 1.0;
          if (P.vel.y < 3 && this.popApex > 0) { this.popApex -= dt; gmul = 0.3; }
        }
        P.vel.y = Math.max(-58, P.vel.y - G * gmul * dt);
        const hs = Math.hypot(P.vel.x, P.vel.z), cap = Math.max(6.5, hs);
        P.vel.x += wish.x * wishLen * 7 * dt; P.vel.z += wish.z * wishLen * 7 * dt;
        const nh = Math.hypot(P.vel.x, P.vel.z); if (nh > cap) { P.vel.x *= cap / nh; P.vel.z *= cap / nh; }
        if (hs > 20) { P.vel.x *= 1 - 0.08 * dt; P.vel.z *= 1 - 0.08 * dt; } // air drag on launches
        if (wishLen > 0.4 && P.vel.y < 5 && this.tryMantle(game, wish)) break;
        // deploys: chute >= 1.8 m up (1.0 m off a grapple pop), wingsuit >= 5 m (3 m off a pop); an early press is buffered 0.4 s
        if (I.jump && P.airTime > 0.12) this.deployQ = { k: 'chute', t: 0.4 };
        else if (I.sprintP) this.deployQ = { k: 'ws', t: 0.4 };
        const q = this.deployQ;
        if (q) {
          if ((q.t -= dt) <= 0) this.deployQ = null;
          else if (q.k === 'chute' && hAbove > (this.popped ? 1.0 : 1.8)) { this.deployQ = null; P.setState('parachute'); }
          else if (q.k === 'ws' && hAbove > (this.popped ? 3 : 5)) { this.deployQ = null; this.enterWingsuit(game); }
        }
        break;
      }
      case 'parachute': {
        this.chute = Math.min(1, this.chute + dt * 3); // canopy full in ~0.33 s
        const turn = -I.mx * 1.6;
        this.turnRate = (this.turnRate || 0) + (turn - (this.turnRate || 0)) * damp(6, dt);
        P.facing += this.turnRate * dt;
        const brake = I.my < 0 ? -I.my : 0, push = I.my > 0 ? I.my : 0;
        const tow = P.chuteTow, hd = V(Math.sin(P.facing), 0, Math.cos(P.facing));
        const fspeed = 10 + push * 4 - brake * 5 + P.parachuteThrust;
        let sink = -(3.5 + push * 2 - brake * 1) - Math.abs(this.turnRate) * 0.6, lift = 0;
        const hs = Math.hypot(P.vel.x, P.vel.z);
        if (tow) {
          // tow: the line hauls the canopy toward the hook (~22 m/s^2 to 30 m/s); ram-air lift from the airspeed climbs
          const k = tow.k ?? 1, dh = Math.hypot(tow.dir.x, tow.dir.z) || 1, ux = tow.dir.x / dh, uz = tow.dir.z / dh;
          P.facing = angLerp(P.facing, Math.atan2(ux, uz), damp(5, dt));
          let along = P.vel.x * ux + P.vel.z * uz; const px = P.vel.x - along * ux, pz = P.vel.z - along * uz;
          if (along < 30) along = Math.min(30, along + 22 * k * dt);
          const pk = 1 - damp(3, dt);
          P.vel.x = ux * along + px * pk; P.vel.z = uz * along + pz * pk;
          // the line's angle decides what the speed buys: hooking level / up a slope or wall climbs well, the usual
          // 30-50 deg down-ahead hook climbs a few metres a cycle, hooking straight down below you sinks a little
          const T = this.tt, fk = clamp(1 + T.dy * tow.dir.y, T.min, 1.8);
          this.towK = (this.towK ?? fk) + (fk - (this.towK ?? fk)) * damp(4, dt);
          lift = clamp(T.a * (along - 10), 0, T.cap) * this.towK;
          this.slingE = Math.hypot(P.vel.x, P.vel.z); this.towT = 0.35; // C just after the tow ends still means 'let go of the line'
        } else {
          // carried speed bleeds off over ~1 s; whatever was earned (tow, boost, a real wingsuit swap) turns into climb
          let along = P.vel.x * hd.x + P.vel.z * hd.z; const px = P.vel.x - along * hd.x, pz = P.vel.z - along * hd.z;
          along += (fspeed - along) * damp(along > fspeed + 0.5 ? 1.1 : this.chute < 1 ? 4 : 2.5, dt);
          const pk = 1 - damp(3.2, dt);
          P.vel.x = hd.x * along + px * pk; P.vel.z = hd.z * along + pz * pk;
          lift = clamp(0.62 * (Math.min(hs, this.slingE) - fspeed), 0, 10) * (this.towK != null ? this.tt.post * this.towK : 1);
          if (hs < fspeed + 0.5) { this.slingE = 0; this.towK = null; }
          this.towT = Math.max(0, (this.towT || 0) - dt);
        }
        P.parachuteThrust = Math.max(0, (P.parachuteThrust || 0) - dt * 3);
        // a rising deploy keeps floating up; one opened straight off a grapple pop 'kites' and keeps most of the pop's climb
        if (this.popT > 0) this.popT = Math.max(0, this.popT - dt);
        P.vel.y += (sink + lift - P.vel.y) * damp(P.vel.y > 0 && !tow ? (this.popT > 0 ? 0.55 : 1.6) : this.chute < 1 ? 4 : 3, dt);
        // ridge lift: flying at speed into rising ground, the slope's updraft carries the canopy up it (~4.5 m clear) instead
        // of skidding it into the hillside. Flat or falling ground: no change; slow down (S) to land on a slope
        if (hs > 12) {
          const ux = P.vel.x / hs, uz = P.vel.z / hs, la = Math.min(hs, 30); let gA = -1e9;
          for (const u of [0.3, 0.6, 1, 1.4]) gA = Math.max(gA, game.world?.heightAt?.(P.pos.x + ux * la * u, P.pos.z + uz * la * u) ?? -1e9);
          if (gA > ground + 0.5) { const vMin = Math.min(Math.max(8, hs * 0.6), Math.max(gA + 4.5 - P.pos.y, (ground + 3 - P.pos.y) * 4)); if (P.vel.y < vMin) P.vel.y += (vMin - P.vel.y) * damp(6, dt); }
        }
        // crouch during a tow lets go of the line (grapple.js), not the canopy
        if (I.jump || (I.crouchP && !tow && !(this.towT > 0))) { P.setState('air'); P.airTime = 1; }
        else if (I.sprintP) this.enterWingsuit(game);
        break;
      }
      case 'wingsuit': this.wingsuit(game, dt, I); break;
      case 'swim': {
        const top = I.sprint ? 4.6 : 2.8; P.sprinting = I.sprint;
        P.vel.x += (wish.x * wishLen * top - P.vel.x) * damp(4, dt); P.vel.z += (wish.z * wishLen * top - P.vel.z) * damp(4, dt);
        const ty = wh - 1.32 + Math.sin(game.simTime * 2) * 0.04;
        P.vel.y = clamp((ty - P.pos.y) * 3, -4, 3);
        if (I.jump && wh - ground < 1.6) { P.vel.y = 6; P.setState('air'); }
        break;
      }
      case 'grapple': { // velocity is owned by grapple.js; hanging holds position
        if (P.hanging) P.vel.set(0, 0, 0);
        break;
      }
    }

    const res = this.move(game, dt);

    // ---- state transitions after the move
    const nwh = this.waterAt(game, P.pos.x, P.pos.z), nground = game.world?.heightAt?.(P.pos.x, P.pos.z) ?? -1e9;
    const submerged = P.pos.y + 1.15 < nwh && nwh - nground > 1.3;
    if (submerged && P.state !== 'swim' && P.state !== 'grapple') {
      if (P.state === 'air' || P.state === 'wingsuit' || P.state === 'parachute') game.fx?.splash?.(V(P.pos.x, nwh, P.pos.z), Math.min(3, -vy0 / 8));
      P.vel.y *= 0.2; P.setState('swim'); game.audio?.play?.('splash', { pos: P.pos });
    }
    if (P.state === 'swim' && nwh - nground < 1.2) P.setState('ground');
    if (P.state === 'ground') {
      if (!res.grounded) { this.coyote += dt; if (this.coyote > 0.14) { P.setState('air'); P.airTime = 0.14; } } else this.coyote = 0;
    } else if ((P.state === 'air' || P.state === 'parachute') && res.grounded && P.vel.y <= 0.5) {
      this.land(game, -vy0, P.state === 'parachute');
    } else if (P.state === 'wingsuit' && (res.grounded || res.blocked)) {
      this.crash(game, res);
    }
    if (P.state === 'ground' || P.state === 'swim') P.airTime = 0;
    if (P.pos.y < -300) P.respawn(null, 'void');
    if (this.lock > 0) this.lock -= dt;

    this.animate(game, dt, I);
    this.syncObj(game, dt);
  },

  enterWingsuit(game) {
    const P = game.player, v = P.vel, s = v.length(), ws = this.ws;
    // the suit 'bites' immediately: genre wingsuits glide from the first frame
    ws.s = Math.max(26, s * 0.96 + 2);
    ws.th = s > 4 ? clamp(Math.asin(clamp(v.y / s, -1, 1)), -1.0, 0.35) : -0.3;
    ws.t = 0; this.pulls.length = 0;
    if (Math.hypot(v.x, v.z) > 2) P.facing = Math.atan2(v.x, v.z);
    P.setState('wingsuit');
  },

  // wingsuit: speed s along path angle th (energy model). Gravity trades height for speed both ways; drag is lowest in a
  // tuck dive (terminal ~71 m/s), cruise trims at ~35 m/s on a ~3:1 glide; pull-up rate is limited by the lift the
  // airspeed can make, so a fast pull-up zooms high and a slow one mushes (flare/stall ~20 m/s).
  wingsuit(game, dt, I) {
    const P = game.player, ws = this.ws;
    this.wing = Math.min(1, this.wing + dt * 4); ws.t += dt;
    // stick: W tucks into a dive (thT -1.32), S pulls up to ~+0.93; below ~22 m/s the nose is forced down (floaty stall)
    let thT = I.my > 0 ? -0.32 - I.my * 1.0 : -0.32 - I.my * 1.25;
    if (this.zoomT > 0) { this.zoomT -= dt; thT = Math.max(thT, Math.min(ws.th, 0.45)); }
    if (ws.s < 22) thT = Math.min(thT, -0.32 - (22 - ws.s) / 22 * 1.5);
    // pitch rate is limited by the lift the airspeed can make: ~2.9 rad/s at 65 m/s (tight zoom), ~1.2 at 30, mush at 22
    const s0 = ws.s, liftMax = Math.min(0.05 * s0 * s0, 20 * G), up = (liftMax - G * Math.cos(ws.th)) / Math.max(s0, 1);
    const rate = clamp(4 * (thT - ws.th), -2.2, Math.max(-0.5, up));
    ws.th = clamp(ws.th + rate * dt, -1.35, 0.95);
    // ground effect / flare: low over the ground the suit won't fly itself in. The path angle is floored so the point
    // ~0.7 s ahead stays >= 1.8 m (+0.1 m per m/s) over the terrain (slope included); gravity charges the speed for it honestly. Fades out
    // in a stall (< ~19 m/s) so a slow belly-in still settles onto the ground and rolls out.
    {
      const W = game.world, fx = Math.sin(P.facing), fz = Math.cos(P.facing), look = ws.s * 0.7 * Math.max(Math.cos(ws.th), 0.3);
      const gH = W?.heightAt?.(P.pos.x, P.pos.z);
      if (gH != null) {
        let gA = gH; for (const u of [0.35, 0.7, 1]) gA = Math.max(gA, W.heightAt(P.pos.x + fx * look * u, P.pos.z + fz * look * u));
        const wl = this.waterAt(game, P.pos.x, P.pos.z), ag = P.pos.y - Math.max(gH, wl), k = clamp((ws.s - 18) / 6, 0, 1);
        const clear = 1.8 + ws.s * 0.1; // more room the faster you go: rocks, fences and hangars are not in the heightfield
        if (ag < 16 + clear && k > 0) {
          const vyMin = (Math.max(gA, wl) + clear - P.pos.y) / 0.7, thMin = Math.asin(clamp(vyMin / Math.max(ws.s, 1), -1, 0.8));
          if (ws.th < thMin) ws.th += (thMin - ws.th) * Math.min(1, dt * 10 * k);
        }
      }
    }
    const turn = -I.mx * (1.5 - clamp((s0 - 35) / 80, 0, 0.4)); // faster = a little wider
    this.turnRate = (this.turnRate || 0) + (turn - (this.turnRate || 0)) * damp(5, dt);
    P.facing += this.turnRate * dt; P.bank = this.turnRate / 1.5;
    // drag: belly posture quadratic (cruise ~34 m/s on 3:1), rising when nose-high (a zoom bleeds); tuck posture has a
    // dive 'scream' push and a quartic wall so a full dive hits ~70 in ~2.6 s and tops out ~74
    const c = Math.cos(ws.th), tuck = clamp((-ws.th - 0.55) / 0.6, 0, 1);
    const drag = ((1 - tuck) * 0.0023 * (1 + 1.5 * Math.max(0, ws.th)) * s0 * s0 + tuck * 4.4e-7 * s0 ** 4) * (1 + Math.abs(this.turnRate) * 0.08);
    const scream = tuck * 11 * clamp((78 - s0) / 10, 0, 1);
    ws.s += (-G * Math.sin(ws.th) - drag - 0.6 * rate * rate + scream + P.wingsuitBoost) * dt;
    this.tuckW2 = tuck;
    ws.al = clamp((thT - ws.th) * 0.6 + 0.27, 0, 0.7); // for the pose (flare)
    let v = V(Math.sin(P.facing) * c * ws.s, Math.sin(ws.th) * ws.s, Math.cos(P.facing) * c * ws.s);
    // grapple boost pulls: +dv along the line over ~0.3 s, a little lift, capped at 80
    for (let i = this.pulls.length - 1; i >= 0; i--) {
      const p = this.pulls[i], a = Math.min(p.rem, p.rate * dt); p.rem -= a; if (p.rem <= 1e-3) this.pulls.splice(i, 1);
      const before = v.length(); v.addScaledVector(p.dir, a); v.y += a * 0.25;
      const after = v.length(), cap = Math.max(80, before); if (after > cap) v.multiplyScalar(cap / after);
    }
    { const sp = v.length(); if (sp > 0.1) { ws.s = sp; ws.th = clamp(Math.asin(clamp(v.y / sp, -1, 1)), -1.35, 0.95); if (Math.hypot(v.x, v.z) > 0.5) P.facing = Math.atan2(v.x, v.z); } }
    ws.s = clamp(ws.s, 17, 95);
    // ground proximity: wind, buffet, a small speed bonus for skimming (< 15 m AGL)
    let prox = 0;
    const gh = game.world?.heightAt?.(P.pos.x + v.x * 0.3, P.pos.z + v.z * 0.3);
    const wh = this.waterAt(game, P.pos.x, P.pos.z);
    if (gh != null) { const h = P.pos.y - Math.max(gh, wh); prox = clamp(1 - (h - 2) / 13, 0, 1); }
    P.proximity += (prox - P.proximity) * damp(5, dt);
    if (P.proximity > 0.2) { ws.s += P.proximity * 2.2 * dt; if (Math.random() < P.proximity * 0.3) game.fx?.dust?.(V(P.pos.x, gh ?? P.pos.y - 3, P.pos.z)); }
    const cc = Math.cos(ws.th);
    P.vel.set(Math.sin(P.facing) * cc * ws.s, Math.sin(ws.th) * ws.s, Math.cos(P.facing) * cc * ws.s);
    if (I.jump) { P.setState('parachute'); P.proximity = 0; }
    else if (I.crouchP) { P.setState('air'); P.airTime = 1; P.proximity = 0; }
  },

  // wingsuit contact: slow + shallow = slide/roll out (no damage); faster = tumble with modest damage;
  // only a fast (> ~55 m/s) head-on hit is lethal
  crash(game, res) {
    const P = game.player, s = this.ws.s, th = this.ws.th;
    P.proximity = 0; P.bank = 0;
    if (th > 0.15) { // climbing into rising ground: most of the closing speed is already spent, so it scrapes, not smashes
      const dmg = Math.max(0, s - 60) * 0.8 * P.fallDamageScale;
      P.vel.multiplyScalar(0.4); P.vel.y = Math.max(P.vel.y, 4); P.setState('air'); P.airTime = 1;
      game.cam?.shake?.(0.3); game.audio?.play?.('impact', { pos: P.pos }); game.fx?.dust?.(P.pos.clone());
      this.anim?.play('Hit_Chest', { once: true, fade: 0.05 }); this.lock = 0.3; this.lockKind = 'hit';
      if (dmg > 0) P.damage(dmg, 'crash'); return;
    }
    const headOn = res.blocked || th < -0.75;
    if (res.grounded && !res.blocked && s < 28 && th > -0.6) {
      const h = Math.hypot(P.vel.x, P.vel.z), k = h > 9 ? 9 / h : 1; P.vel.x *= k; P.vel.z *= k;
      this.land(game, 6, true, true); this.anim?.play('Roll', { once: true, fade: 0.06, ts: 1.3 }); this.lock = 0.8; this.lockKind = 'roll';
      game.fx?.dust?.(P.pos.clone()); game.audio?.play?.('land', { pos: P.pos }); return;
    }
    let dmg = headOn ? Math.max(0, s - 24) * 1.5 + Math.max(0, s - 55) * 8 : Math.max(0, s - 28) * 0.9;
    if (!headOn) dmg = Math.min(dmg, 45); else if (s <= 55) dmg = Math.min(dmg, 60);
    dmg *= P.fallDamageScale;
    if (headOn) { P.vel.multiplyScalar(-0.15); P.vel.y = 3; }
    else { P.vel.x *= 0.35; P.vel.z *= 0.35; P.vel.y = 3.5; } // skip off the ground and keep tumbling forward
    game.cam?.shake?.(clamp(s / 60, 0.3, 0.8)); game.audio?.play?.('impact', { pos: P.pos });
    P.setState('air'); P.airTime = 1;
    this.anim?.play('Hit_Chest', { once: true, fade: 0.05 }); this.lock = 0.5; this.lockKind = 'hit';
    if (dmg > 0) P.damage(dmg, 'crash');
  },

  // ---- mantle: moving into a ledge whose top is 0.5..2 m above the feet climbs onto it (~0.35 s)
  ray(game, o, d, max) {
    const R = game.RAPIER, w = game.physics; if (!R || !w) return null;
    this._ray ||= new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    this._ray.origin = o; this._ray.dir = d;
    try { return w.castRayAndGetNormal(this._ray, max, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, game.player.collider, undefined, c => !c.userData?.noCharacter && !c.userData?.player); } catch (e) { return null; }
  },
  tryMantle(game, wish) {
    const P = game.player; if ((this.mantleCD || 0) > game.simTime || !P.collider) return false;
    const f = V(wish.x, 0, wish.z).normalize(), reach = RAD + 0.45;
    const o = V(P.pos.x, P.pos.y + 0.55, P.pos.z), h1 = this.ray(game, o, f, reach);
    if (!h1 || Math.abs(h1.normal.y) > 0.5) return false;
    const d1 = h1.timeOfImpact, top = V(P.pos.x + f.x * (d1 + 0.4), P.pos.y + 2.3, P.pos.z + f.z * (d1 + 0.4));
    const h2 = this.ray(game, top, V(0, -1, 0), 2.2);
    if (!h2 || h2.normal.y < 0.7) return false;
    const ty = top.y - h2.timeOfImpact, h = ty - P.pos.y;
    if (h < 0.5 || h > 2.05) return false;
    // room to stand: nothing over the ledge, nothing in the way at chest height above it
    if (this.ray(game, V(top.x, ty + 0.05, top.z), V(0, 1, 0), 1.75)) return false;
    if (this.ray(game, V(P.pos.x, ty + 0.9, P.pos.z), f, d1 + 0.7)) return false;
    this.mantle = { from: P.pos.clone(), h, fwd: f.clone().multiplyScalar(d1 + 0.45), t: 0, dur: 0.26 + 0.05 * h, hs: Math.min(6, Math.hypot(P.vel.x, P.vel.z)) };
    P.vel.set(0, 0, 0); this.mantleCD = game.simTime + 0.5; P.facing = Math.atan2(f.x, f.z); P.mantling = true;
    if (P.state !== 'ground') P.setState('ground');
    this.anim?.play('Jump_Start', { once: true, fade: 0.06, ts: 2.2, restart: true });
    game.audio?.play?.('jump', { pos: P.pos });
    return true;
  },
  mantleStep(game, dt) {
    const P = game.player, m = this.mantle; m.t += dt;
    const u = Math.min(1, m.t / m.dur), e = x => x * x * (3 - 2 * x);
    const up = e(Math.min(1, u / 0.65)), fw = e(clamp((u - 0.3) / 0.7, 0, 1));
    P.setPosition(m.from.clone().add(V(0, m.h * up + 0.04, 0)).addScaledVector(m.fwd, fw));
    P.vel.set(0, 0, 0); P.grounded = true;
    if (u >= 1) { this.mantle = null; P.mantling = false; const f = m.fwd.clone().normalize(); P.vel.set(f.x * m.hs, -1, f.z * m.hs); P.setState('ground'); this.coyote = 0; }
  },

  land(game, impact, soft = false, slide = false) {
    const P = game.player; const hs = Math.hypot(P.vel.x, P.vel.z);
    P.setState('ground'); this.coyote = 0;
    if (soft || impact < 9) {
      if (impact > 4 || soft) { this.anim?.play('Jump_Land', { once: true, fade: 0.08, ts: 1.5 }); this.lock = 0.35; this.lockKind = slide ? 'roll' : 'landsoft'; }
      if (impact > 6) game.fx?.dust?.(P.pos.clone());
      return;
    }
    game.audio?.play?.('land', { pos: P.pos }); game.fx?.dust?.(P.pos.clone());
    const roll = hs > 2.5 || game.input.down('crouch') || impact > 14;
    let dmg = Math.max(0, impact - 22) * 4.5 * P.fallDamageScale; if (roll) dmg *= 0.5;
    if (roll) { this.anim?.play('Roll', { once: true, fade: 0.06, ts: 1.25 }); this.lock = 0.95; this.lockKind = 'roll'; }
    else { this.anim?.play('Jump_Land', { once: true, fade: 0.05, ts: 1.1 }); this.lock = 0.55; this.lockKind = 'land'; }
    game.cam?.shake?.(Math.min(0.6, impact / 40));
    if (dmg > 0) P.damage(dmg, 'fall');
  },

  move(game, dt) {
    const P = game.player, ctl = P.controller, col = P.collider;
    const d = P.vel.clone().multiplyScalar(dt);
    let grounded = false, blocked = false;
    if (ctl && col && col.isEnabled()) {
      col.setTranslation({ x: P.pos.x, y: P.pos.y + CENTER, z: P.pos.z });
      try {
        ctl.computeColliderMovement(col, d, game.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, c => !c.userData?.noCharacter);
        const m = ctl.computedMovement(); grounded = ctl.computedGrounded();
        const dl = d.length(); const ml = Math.hypot(m.x, m.y, m.z);
        if (dl > 0.15 && ml < dl * 0.45) blocked = true;
        if (d.y > 0 && m.y < d.y * 0.3 && P.state !== 'grapple') P.vel.y = Math.min(P.vel.y, 0);
        P.pos.x += m.x; P.pos.y += m.y; P.pos.z += m.z;
      } catch (e) { P.pos.add(d); }
    } else P.pos.add(d);
    // safety floor: terrain height (works even if the world has no colliders yet)
    const g = game.world?.heightAt?.(P.pos.x, P.pos.z) ?? (game.world ? -1e9 : 0);
    if (P.pos.y <= g + 0.02) { P.pos.y = g; if (P.vel.y <= 0) grounded = true; }
    col?.setTranslation({ x: P.pos.x, y: P.pos.y + CENTER, z: P.pos.z });
    P.grounded = grounded;
    return { grounded, blocked };
  },

  animate(game, dt, I) {
    const P = game.player, a = this.anim;
    const hs = Math.hypot(P.vel.x, P.vel.z);
    if (a && P.state !== 'dead' && P.state !== 'vehicle') {
      const locked = this.lock > 0;
      switch (P.state) {
        case 'ground':
          if (!locked) {
            if (P.crouching) a.play(hs > 0.4 ? 'Crouch_Fwd_Loop' : 'Crouch_Idle_Loop', { ts: hs > 0.4 ? clamp(hs / 1.8, 0.6, 1.5) : 1 });
            else if (hs < 0.35) a.play('Idle_Loop', { fade: 0.25 });
            else if (hs < 3.2) a.play('Walk_Loop', { ts: clamp(hs / 1.7, 0.6, 1.9) });
            else if (hs < 7.6) a.play('Jog_Fwd_Loop', { ts: clamp(hs / 4.4, 0.75, 1.5) });
            else a.play('Sprint_Loop', { ts: clamp(hs / 7.6, 0.8, 1.4) });
          }
          break;
        case 'air': if (!locked) { if ((this.jumpAnimT -= dt) <= 0) a.play('Jump_Loop', { fade: 0.3 }); } break;
        case 'parachute': case 'wingsuit': case 'grapple': a.play('Jump_Loop', { fade: 0.3 }); break;
        case 'swim': a.play(hs > 0.6 ? 'Swim_Fwd_Loop' : 'Swim_Idle_Loop', { fade: 0.35 }); break;
      }
    }
    // facing
    const aimFace = (P.aiming || (I.fire && P.state !== 'wingsuit')) && P.state !== 'vehicle' && P.state !== 'dead';
    if (P.state === 'ground' || P.state === 'swim' || P.state === 'air') {
      if (aimFace && game.cam) P.facing = angLerp(P.facing, game.cam.yaw + Math.PI, damp(18, dt));
      else if (hs > 0.5 && !(this.lock > 0 && this.lockKind === 'roll')) P.facing = angLerp(P.facing, Math.atan2(P.vel.x, P.vel.z), damp(P.state === 'ground' ? 12 : 4, dt));
    }
    if (P.state === 'grapple' && hs > 1) P.facing = angLerp(P.facing, Math.atan2(P.vel.x, P.vel.z), damp(8, dt));
    const camPitch = game.cam ? -game.cam.pitch : 0;
    a?.update(dt, aimFace && (P.state === 'ground' || P.state === 'swim' || P.state === 'air' || P.state === 'parachute') ? 1 : 0, camPitch);
    this.procedural(game, dt);
  },

  // procedural poses layered after the mixer: skydive, wingsuit, parachute, grapple reach, body lean
  procedural(game, dt) {
    const P = game.player, B = this.B; if (!B || !this.model) return;
    let pitchT = 0, rollT = 0;
    const hs = Math.hypot(P.vel.x, P.vel.z);
    const st = P.state;
    const freefall = st === 'air' && P.airTime > 0.9 && P.vel.y < -9;
    this.sky = (this.sky || 0) + ((freefall ? 1 : 0) - (this.sky || 0)) * damp(st === 'ground' ? 16 : 3, dt);
    this.wing = st === 'wingsuit' ? this.wing : Math.max(0, (this.wing || 0) - dt * 4);
    this.chuteW = (this.chuteW || 0) + ((st === 'parachute' ? 1 : 0) - (this.chuteW || 0)) * damp(6, dt);
    if (st === 'ground') { rollT = clamp(-(this.turnRateG || 0) * hs * 0.012, -0.25, 0.25); }
    if (st === 'wingsuit') { pitchT = Math.PI / 2 - this.ws.th - 0.1 - ((this.ws.al ?? 0.27) - 0.27) * 0.9; rollT = -P.bank * 0.9; } // flare sits up
    else if (this.sky > 0.05) pitchT = 1.35 * this.sky;
    if (st === 'parachute') { rollT = -(this.turnRate || 0) * 0.3; pitchT = P.chuteTow ? 0.35 : clamp(-game.input.move.y, 0, 1) * -0.15 + 0.05; }
    if (st === 'grapple' && !P.hanging && P.vel.lengthSq() > 4) {
      const v = P.vel.clone().normalize(); pitchT = clamp(Math.acos(clamp(v.y, -1, 1)) - 0.25, 0, 1.3) * 0.8;
    }
    // ground turn-rate for lean
    this.turnRateG = ((P.facing - (this.prevFacing ?? P.facing) + Math.PI * 3) % (Math.PI * 2) - Math.PI) / Math.max(dt, 1e-3);
    this.prevFacing = P.facing;
    this.pitch += (pitchT - this.pitch) * damp(st === 'ground' ? 14 : 6, dt); this.roll += (rollT - this.roll) * damp(6, dt);
    this.pivot.rotation.set(this.pitch, 0, this.roll, 'YXZ');

    this.model.updateMatrixWorld(true);
    const q = new THREE.Quaternion(); this.model.getWorldQuaternion(q);
    const D = (x, y, z) => V(x, y, z).normalize().applyQuaternion(q); // model-local dir -> world (model faces +Z, +X = its left)
    const limb = (side, ua, fa, w) => { const s = side === 'L' ? 1 : -1; aimBone(B['ua' + side.toLowerCase()], B['fa' + side.toLowerCase()], D(ua[0] * s, ua[1], ua[2]), w); aimBone(B['fa' + side.toLowerCase()], B['h' + side.toLowerCase()], D(fa[0] * s, fa[1], fa[2]), w); };
    const leg = (side, th, sh, w) => { const s = side === 'L' ? 1 : -1, k = side.toLowerCase(); aimBone(B['t' + k], B['s' + k], D(th[0] * s, th[1], th[2]), w); aimBone(B['s' + k], B['f' + k], D(sh[0] * s, sh[1], sh[2]), w); };
    if (this.sky * (1 - this.wing) > 0.02) {
      const w = this.sky * (1 - this.wing);
      limb('L', [0.85, 0.35, -0.25], [0.25, 0.9, -0.35], w); limb('R', [0.85, 0.35, -0.25], [0.25, 0.9, -0.35], w);
      leg('L', [0.25, -0.9, -0.2], [0.15, -0.45, -0.85], w); leg('R', [0.25, -0.9, -0.2], [0.15, -0.45, -0.85], w);
    }
    if (this.wing > 0.02) {
      const w = this.wing * this.wing * (3 - 2 * this.wing), b = P.bank || 0;
      limb('L', [0.92, -0.3 + b * 0.2, -0.12], [0.9, -0.38, -0.08], w); limb('R', [0.92, -0.3 - b * 0.2, -0.12], [0.9, -0.38, -0.08], w);
      leg('L', [0.33, -0.95, -0.05], [0.36, -0.95, -0.05], w); leg('R', [0.33, -0.95, -0.05], [0.36, -0.95, -0.05], w);
      aimBone(B.neck, B.head, D(0, 0.75, 0.6), w * 0.8);
    }
    if (this.chuteW > 0.02) {
      const w = this.chuteW, t = this.turnRate || 0;
      const pullL = clamp(-t, 0, 1) * 0.6 + clamp(-game.input.move.y, 0, 1) * 0.5, pullR = clamp(t, 0, 1) * 0.6 + clamp(-game.input.move.y, 0, 1) * 0.5;
      limb('L', [0.45, 0.85 - pullL * 0.8, 0.1], [0.1, 0.95 - pullL * 1.2, 0.2 + pullL * 0.3], w);
      limb('R', [0.45, 0.85 - pullR * 0.8, 0.1], [0.1, 0.95 - pullR * 1.2, 0.2 + pullR * 0.3], w);
      leg('L', [0.08, -0.95, 0.25], [0.05, -0.97, 0.1], w); leg('R', [0.08, -0.95, 0.25], [0.05, -0.97, 0.1], w);
    }
    // reel: body streams along the line, legs trailing together, free arm swept back
    const reel = st === 'grapple' && !P.hanging && P.vel.lengthSq() > 9 ? 1 : 0;
    this.reelW = (this.reelW || 0) + (reel - (this.reelW || 0)) * damp(10, dt);
    if (this.reelW > 0.02) {
      const w = this.reelW;
      leg('L', [0.06, -0.95, -0.3], [0.04, -0.75, -0.65], w); leg('R', [0.1, -0.97, -0.15], [0.06, -0.9, -0.4], w);
      limb('R', [-0.35, -0.6, -0.7], [-0.2, -0.5, -0.85], w * 0.85);
    }
    // grapple pop: a quick knees-up tuck, arms in, then it opens out as you fall
    this.tuck = Math.max(0, (this.tuck || 0) - dt);
    const tk = st === 'air' ? Math.sin(Math.PI * clamp(1 - this.tuck / 0.4, 0, 1)) * (this.tuck > 0 ? 1 : 0) : 0;
    this.tuckW = (this.tuckW || 0) + (tk - (this.tuckW || 0)) * damp(18, dt);
    if (this.tuckW > 0.02) {
      const w = this.tuckW;
      leg('L', [0.12, 0.25, 0.95], [0.05, -0.95, 0.2], w); leg('R', [0.12, 0.25, 0.95], [0.05, -0.95, 0.2], w);
      limb('L', [0.25, -0.55, 0.75], [-0.3, 0.1, 0.9], w * 0.7); limb('R', [0.25, -0.55, 0.75], [-0.3, 0.1, 0.9], w * 0.7);
    }
    // mantle: hands planted on the ledge, knees up
    if (this.mantle) {
      const u = clamp(this.mantle.t / this.mantle.dur, 0, 1), w = Math.sin(Math.PI * u);
      limb('L', [0.2, 0.5, 0.85], [0.1, -0.4, 0.9], w); limb('R', [0.2, 0.5, 0.85], [0.1, -0.4, 0.9], w);
      leg('L', [0.1, -0.2, 0.95], [0.05, -0.95, 0.1], w * 0.8); leg('R', [0.1, -0.7, 0.6], [0.05, -0.95, -0.2], w * 0.8);
    }
    // aim: rifle shouldered — right hand to the cheek line along the camera ray, left hand on the foregrip (two-bone IK)
    const aw = (this.anim?.aimW || 0) * ((st === 'ground' || st === 'air') ? 1 : 0);
    if (aw > 0.05 && game.cam?.forward && B.ual && B.fal && B.hl && B.uar && B.far && B.hr) {
      const f = game.cam.forward(), sR = V(), T = V();
      B.uar.getWorldPosition(sR);
      const side = D(1, 0, 0); // model left
      T.copy(sR).addScaledVector(f, 0.36).addScaledVector(side, 0.1); T.y -= 0.07;
      ik(B.uar, B.far, B.hr, T, D(-0.45, -1, -0.15), aw);
      const T2 = T.clone().addScaledVector(f, 0.3); T2.y -= 0.02;
      ik(B.ual, B.fal, B.hl, T2, D(0.6, -1, -0.2), aw);
    }
    // grapple: left (gauntlet) arm reaches for the hook; when hanging both hands up
    const tgt = game.grapple?.armTarget;
    this.reachW = (this.reachW || 0) + ((tgt ? 1 : 0) - (this.reachW || 0)) * damp(14, dt);
    if (this.reachW > 0.02 && (tgt || this.lastReach)) {
      if (tgt) this.lastReach = tgt.clone();
      const sh = V(); B.ual.getWorldPosition(sh);
      const dir = this.lastReach.clone().sub(sh).normalize();
      aimBone(B.ual, B.fal, dir, this.reachW); aimBone(B.fal, B.hl, dir, this.reachW);
      if (P.hanging) { const sr = V(); B.uar.getWorldPosition(sr); const d2 = this.lastReach.clone().sub(sr).normalize(); aimBone(B.uar, B.far, d2, this.reachW); aimBone(B.far, B.hr, d2, this.reachW); }
    }
    // hard landing: absorb it in a deep three-point crouch (hips drop + lean, feet IK'd to where they were planted)
    const hard = st === 'ground' && this.lock > 0 && this.lockKind === 'land';
    if (hard && !this.wasHard) this.landDur = this.lock;
    this.wasHard = hard;
    const lk = hard ? Math.sin(Math.PI * clamp(1 - this.lock / (this.landDur || 0.55), 0, 1)) : 0;
    this.crouchK = (this.crouchK || 0) + (lk - (this.crouchK || 0)) * damp(18, dt);
    if (this.crouchK > 0.02 && B.tl && B.sl && B.fl && B.tr && B.sr && B.fr) {
      const k = this.crouchK, fL = V(), fR = V(); B.fl.getWorldPosition(fL); B.fr.getWorldPosition(fR);
      this.pivot.position.y = 1 - 0.36 * k; this.pivot.rotation.x += 0.3 * k; this.model.updateMatrixWorld(true);
      const knee = D(0, 0.2, 1);
      ik(B.tl, B.sl, B.fl, fL, knee, 1); ik(B.tr, B.sr, B.fr, fR, knee, 1);
      aimBone(B.neck, B.head, D(0, 0.25, 1), k * 0.6); // eyes up out of the crouch
      if (B.ual && B.fal) { aimBone(B.ual, B.fal, D(0.35, -0.9, 0.35), k * 0.8); aimBone(B.fal, B.hl, D(0.1, -1, 0.15), k * 0.8); } // off hand to the dirt
    } else if (this.pivot.position.y !== 1) this.pivot.position.y = 1;
    this.updateChute(game, dt);
  },

  updateChute(game, dt) {
    const _cv = this._cv || (this._cv = new THREE.Vector3());
    const P = game.player, g = this.chuteObj;
    const on = P.state === 'parachute';
    if (on) this.chuteS = Math.min(1, (this.chuteS || 0) + dt * 2.2); else this.chuteS = Math.max(0, (this.chuteS || 0) - dt * 3);
    g.visible = this.chuteS > 0.01;
    if (!g.visible) return;
    const s = this.chuteS, pop = s < 1 ? 1 - Math.pow(1 - s, 3) * Math.cos(s * 9) * 0.3 : 1; // elastic inflation
    g.position.copy(P.pos);
    g.rotation.set(-(on ? 0.12 : 0.6 * (1 - s)), P.facing, this.roll * 0.55, 'YXZ'); // a gentle bank: at 1.6x roll the 9 m canopy swung across the chase camera in every turn
    this.canopy.scale.set(Math.max(0.05, pop), Math.max(0.1, s), Math.max(0.05, pop * (0.6 + 0.4 * s)));
    this.canopy.position.y = 5.2 * (0.5 + 0.5 * s);
    // the chase lens rides just under the canopy: fade the fabric the closer the lens gets to it (opaque from ~13 m)
    const cm = this.canopy.material, cd = game.camera.position.distanceTo(_cv.copy(P.pos).setY(P.pos.y + this.canopy.position.y));
    const nk = Math.min(1, Math.max(0, (11 - cd) / 6)) * 0.6; this.chuteNear.value = nk; // > 0 = lens close behind the canopy
    cm.opacity = 1 - nk * 0.1; cm.depthWrite = nk < 0.02;
    g.children[1].material.opacity = 0.7 - nk * 0.3; // suspension lines thin out with it
    g.children[1].visible = s > 0.4;
  },

  updateWings(game) {
    const B = this.B, m = this.wingMesh, w = this.wing || 0;
    m.visible = w > 0.05 && game.player.state !== 'vehicle';
    if (!m.visible) return;
    const p = n => { const v = V(); B[n]?.getWorldPosition(v); return v; };
    const hl = p('hl'), hr = p('hr'), ul = p('ual'), ur = p('uar'), tl = p('tl'), tr = p('tr'), fl = p('fl'), fr = p('fr'), sl = p('sl'), sr = p('sr');
    const hip = tl.clone().lerp(tr, 0.5);
    // panels [c0, c1, c2, c3]: c0-c3 is the body edge, c1-c2 the free edge; the membrane unzips outward from the
    // body edge as the suit opens (smoothstep), so there are never long thin triangles spanning a half-posed limb
    const panels = [[ul, hl, sl, tl], [ur, hr, sr, tr], [tl, sl, fl, hip], [tr, sr, fr, hip]];
    const e = w * w * (3 - 2 * w), N = this.wingN, a = m.geometry.attributes.position, A = V(), Bv = V();
    let k = 0;
    for (const [c0, c1, c2, c3] of panels) for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const u = (i / N) * e, v = j / N;
      A.copy(c0).lerp(c1, u); Bv.copy(c3).lerp(c2, u); A.lerp(Bv, v);
      a.setXYZ(k++, A.x, A.y, A.z);
    }
    a.needsUpdate = true; m.geometry.computeVertexNormals(); m.geometry.computeBoundingSphere();
  },

  syncObj(game, dt) {
    const P = game.player;
    if (P.state === 'vehicle') { this.wingMesh.visible = false; return; }
    P.obj.position.copy(P.pos);
    P.obj.rotation.set(0, P.facing, 0);
    if (this.wing > 0.05) P.obj.updateMatrixWorld(true);
    this.updateWings(game);
  },
};
