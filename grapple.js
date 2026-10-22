// STORMBREAK grapple: E = fire & reel to point (chain into parachute/wingsuit), latch vehicles, pull enemies.
// Q = tether two things (max game.grapple.maxTethers), R = reel all tethers (Rapier impulses).
import * as THREE from 'three';
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const SEG = 20, RAD = 5;

// rope: a 5-sided tube whose radius scales with camera distance per segment (~3.5 px wide at any range), near-black
// matte cable: a metallic rope mirrored the sky and vanished against it, so it stays dark against sky, grass and rock;
// claw head at the tip; snap-taut wobble on hit; slack sag
const ROPE_MAT = () => new THREE.MeshStandardMaterial({ color: 0x1c1e21, emissive: 0x050607, roughness: 0.7, metalness: 0.15 });
const HEAD_MAT = () => new THREE.MeshStandardMaterial({ color: 0x8a9096, emissive: 0x1a1d20, roughness: 0.3, metalness: 0.85 });
const PX = 0.0032; // radius per metre of camera distance: ~3.5 px diameter at 720p / 65 deg FOV
function clawGeom() { // hub cone + 3 swept prongs, pointing +Z, ~0.32 m long; merged into one non-indexed geometry
  const parts = [], m = new THREE.Matrix4(), q = new THREE.Quaternion();
  const hub = new THREE.ConeGeometry(0.06, 0.2, 6); hub.rotateX(Math.PI / 2); hub.translate(0, 0, 0.06); parts.push(hub);
  const col = new THREE.CylinderGeometry(0.035, 0.035, 0.08, 6); col.rotateX(Math.PI / 2); col.translate(0, 0, -0.07); parts.push(col);
  for (let k = 0; k < 3; k++) {
    const pr = new THREE.BoxGeometry(0.03, 0.03, 0.2); pr.translate(0, 0, 0.1); // prong root at origin
    q.setFromEuler(new THREE.Euler(-0.75, 0, 0)); m.makeRotationFromQuaternion(q); pr.applyMatrix4(m);
    pr.translate(0, 0.04, -0.02); m.makeRotationZ(k * Math.PI * 2 / 3); pr.applyMatrix4(m);
    const tip = new THREE.BoxGeometry(0.028, 0.028, 0.09); tip.translate(0, 0, 0.045); q.setFromEuler(new THREE.Euler(0.9, 0, 0)); m.makeRotationFromQuaternion(q); tip.applyMatrix4(m);
    // tip hangs off the prong end, curling back toward the axis
    const e = new THREE.Vector3(0, 0, 0.2).applyEuler(new THREE.Euler(-0.75, 0, 0)).add(new THREE.Vector3(0, 0.04, -0.02)); tip.translate(e.x, e.y, e.z); tip.applyMatrix4(new THREE.Matrix4().makeRotationZ(k * Math.PI * 2 / 3));
    parts.push(pr, tip);
  }
  const ni = parts.map(g => g.index ? g.toNonIndexed() : g), n = ni.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3); let o = 0; for (const g of ni) { pos.set(g.attributes.position.array, o); o += g.attributes.position.array.length; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.computeVertexNormals(); return out;
}
let CLAW = null;
class Rope {
  constructor(scene, head = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * RAD * 3), 3));
    const idx = []; for (let i = 0; i < SEG; i++) for (let j = 0; j < RAD; j++) { const a = i * RAD + j, b = i * RAD + (j + 1) % RAD; idx.push(a, a + RAD, b, b, a + RAD, b + RAD); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, ROPE_MAT());
    this.mesh.frustumCulled = false; this.mesh.visible = false; scene.add(this.mesh);
    if (head) { this.head = new THREE.Mesh(CLAW ||= clawGeom(), HEAD_MAT()); this.head.frustumCulled = false; this.head.visible = false; scene.add(this.head); }
    this.snapT = 9; this._q = new THREE.Quaternion();
  }
  snap() { this.snapT = 0; } // taut "twang" on hit: standing-wave wobble that dies out in ~0.2 s
  // a -> b; sag = metres the midpoint droops; wave = travelling flight wobble; dt advances the snap
  set(a, b, sag, wave, t, cam, dt = 0) {
    const pos = this.mesh.geometry.attributes.position, dir = V().subVectors(b, a), L = dir.length() || 1e-3; dir.divideScalar(L);
    const side = V().crossVectors(dir, V(0, 1, 0)); if (side.lengthSq() < 1e-4) side.set(1, 0, 0); side.normalize();
    const up = V().crossVectors(side, dir);
    this.snapT += dt; const sk = this.snapT < 0.2 ? 1 - this.snapT / 0.2 : 0, snapA = sk * sk * Math.min(0.6, 0.12 + L * 0.012) * Math.cos(this.snapT * 70);
    const cp = cam?.position, c = V();
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG, env = Math.sin(Math.PI * u); c.lerpVectors(a, b, u); c.y -= sag * 4 * u * (1 - u);
      if (wave) c.addScaledVector(side, Math.sin(u * 14 - t * 30) * wave * env);
      if (snapA) c.addScaledVector(up, snapA * env).addScaledVector(side, snapA * 0.4 * Math.sin(2 * Math.PI * u));
      const r = Math.max(0.02, (cp ? cp.distanceTo(c) : 5) * PX);
      for (let j = 0; j < RAD; j++) { const an = j / RAD * Math.PI * 2, ca = Math.cos(an) * r, sa = Math.sin(an) * r; pos.setXYZ(i * RAD + j, c.x + side.x * ca + up.x * sa, c.y + side.y * ca + up.y * sa, c.z + side.z * ca + up.z * sa); }
    }
    pos.needsUpdate = true; this.mesh.geometry.computeVertexNormals(); this.mesh.visible = true; (this.b ||= V()).copy(b);
    if (this.head) { // claw at b, pointing along the last rope segment; never smaller than ~4 px
      const hd = this.head, tail = V(); tail.fromBufferAttribute(pos, (SEG - 1) * RAD).sub(V().fromBufferAttribute(pos, SEG * RAD)).negate();
      if (tail.lengthSq() < 1e-8) tail.copy(dir); tail.normalize();
      hd.position.copy(b); hd.quaternion.setFromUnitVectors(V(0, 0, 1), tail); hd.scale.setScalar(Math.max(1, (cp ? cp.distanceTo(b) : 5) * 0.022)); hd.visible = true;
    }
  }
  hide() { this.mesh.visible = false; if (this.head) this.head.visible = false; }
  dispose() { this.mesh.parent?.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); if (this.head) { this.head.parent?.remove(this.head); this.head.material.dispose(); } }
}
// slack rope sag (shallow-parabola catenary approximation): span L carrying slack s droops sqrt(3 L s / 8) at the middle
const slackSag = (L, s) => s > 0 ? Math.min(L * 0.45, Math.sqrt(3 * L * s / 8)) : 0;

const TREE_H = { pine: 12, olive: 4.5, cypress: 10, palm: 9 }; // grappleable trunk height (m) per vegetation type
const DEG = Math.PI / 180, HOOK = 450, CONE = [[1.5, 6], [3, 8]]; // hook m/s; assist rings [deg, rays]
const _v = V(), _s = V(), _u = V(), _d = V();
const hz = (v) => { const h = V(v.x, 0, v.z), l = h.length(); return l > 1e-4 ? h.divideScalar(l) : h; };

export default {
  name: 'grapple',
  init(game) {
    const G = game.grapple = { maxTethers: 3, reelStrength: 1, footRange: 100, airRange: 160, range: 100, reelSpeed: 40, state: 'idle', tethers: [], pending: null, armTarget: null,
      preview: { ok: false, inRange: false, point: null, dist: 0, kind: 'none', snap: false, range: 100 },
      cancel: () => this.release(game) };
    this.rope = new Rope(game.scene); this.shot = null; this.anchor = null; this.t = 0; this.frame = 0;
    this.world = game.physics;
    this.ray = new game.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    game.events.on('physicsStep', (h) => this.stepTethers(game, h));
    game.events.on('player:died', () => { this.release(game); this.ret = null; this.rope.hide(); });
    game.events.on('player:respawn', () => { this.release(game); this.ret = null; this.rope.hide(); });
  },

  // the line whips back to the gauntlet with slack instead of vanishing (0.16 s)
  stow() { if (this.rope.mesh.visible && this.rope.b && !this.ret) this.ret = { p: this.rope.b.clone(), t: 0 }; else if (!this.ret) this.rope.hide(); },
  hand(game) { const v = V(); const s = game.player?.sockets?.grapple; if (s) s.getWorldPosition(v); else v.copy(game.player.pos).add(V(0, 1.4, 0)); return v; },
  airborne(P) { return P.state === 'air' || P.state === 'parachute' || P.state === 'wingsuit' || (P.state === 'grapple' && !P.hanging); },
  cast(game, o, dir, max) {
    this.ray.origin = { x: o.x, y: o.y, z: o.z }; this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    try { return game.physics.castRayAndGetNormal(this.ray, max, true, game.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, game.player.collider || undefined, undefined, c => !c.userData?.noCamera); } catch (e) { return null; }
  },

  // aim assist: ~3 deg cone of rays around the crosshair; the innermost ring with an in-range hit wins (never a wall at the cone edge
  // when something sits nearer the centre), nearest along that ring
  coneSearch(game, ro, rd, range, c0) {
    const skip = Math.max(0, ro.distanceTo(c0) - 0.5), o = V().copy(ro).addScaledVector(rd, skip);
    _s.set(-rd.z, 0, rd.x); if (_s.lengthSq() < 1e-6) _s.set(1, 0, 0); _s.normalize(); _u.crossVectors(_s, rd).normalize();
    for (const [deg, n] of CONE) {
      const a = deg * DEG, ca = Math.cos(a), sa = Math.sin(a); let best = null;
      for (let i = 0; i < n; i++) {
        const ph = (i / n) * Math.PI * 2 + deg; _d.copy(rd).multiplyScalar(ca).addScaledVector(_s, Math.cos(ph) * sa).addScaledVector(_u, Math.sin(ph) * sa);
        const h = this.cast(game, o, _d, range + skip + 20); if (!h) continue;
        const p = o.clone().addScaledVector(_d, h.timeOfImpact), dist = p.distanceTo(c0);
        if (dist <= range && (!best || dist < best.dist)) best = { point: p, normal: V(h.normal.x, h.normal.y, h.normal.z), collider: h.collider, dist };
      }
      if (best) return best;
    }
    return null;
  },

  // what the hook would hit right now: crosshair hit in range > enemy/vehicle near the ray > cone search. Updates game.grapple.preview.
  aim(game, full) {
    const cam = game.cam, P = game.player, G = game.grapple, pv = G.preview; if (!cam?.aimRay) return null;
    const range = G.range = pv.range = (this.airborne(P) ? G.airRange : G.footRange) * (G.rangeMul || 1);
    const c0 = P.center(), ray = cam.aimRay, ro = ray.origin, rd = ray.direction, tc = Math.tan(3 * DEG), ah = cam.aimHit;
    const inR = (p) => p.distanceTo(c0) <= range, VO = game.vehicles?.colliderOwner;
    let h = ah && inR(ah.point) ? { point: ah.point.clone(), normal: ah.normal.clone(), collider: ah.collider } : null, snap = false;
    const hd = h ? h.point.distanceTo(ro) : Infinity;
    // snap to enemies / vehicles (cars, boats, helis, planes): close to the ray, or anywhere in the cone when the crosshair has nothing
    let best = null, bs = Infinity;
    const cand = (c, r, extra) => {
      const along = _v.copy(c).sub(ro).dot(rd); if (along <= 0 || !inR(c)) return;
      const perp = Math.sqrt(ray.distanceSqToPoint(c)), ang = perp / along;
      if ((perp < r || (!h && ang < tc)) && along < hd + r && ang < bs) { bs = ang; best = { point: c.clone(), normal: V(0, 1, 0), ...extra }; }
    };
    for (const e of game.enemies?.list || []) { if (e.dead) continue; const p = e.pos || e.obj?.position; if (p) cand(V(p.x, p.y + 1, p.z), 0.9, { collider: e.collider || null, enemy: e }); }
    if (!(h?.collider && VO?.has?.(h.collider.handle))) for (const v of game.vehicles?.list || []) {
      if (v.dead || v.removed || v.occupied || !v.body) continue; const t = v.body.translation();
      cand(V(t.x, t.y + 0.4, t.z), 1.6 + (v.def?.size?.[0] || 2) * 0.3, { collider: v.colliders?.[0] || null, vehicleAssist: v });
    }
    // trees: trunk colliders only exist within ~70 m of the player (vegetation.js pool), so beyond that (or when the crosshair is a
    // near miss) test the scatter analytically as vertical trunks; the hook bites the bark on the side facing you
    if (!best) { const tr = this.treeAim(game, ro, rd, range, c0, h ? hd : Infinity, tc); if (tr) { h = tr.h; snap = tr.ang > 0.004; } }
    if (best) { h = best; snap = bs > 0.004; }
    if (!h) {
      if (full || this.frame - (this.coneF ?? -9) >= 2) { this.coneF = this.frame; this.coneHit = this.coneSearch(game, ro, rd, range, c0); }
      if (this.coneHit) { h = { ...this.coneHit, point: this.coneHit.point.clone() }; snap = true; }
    }
    // chute tow assist (the lazy line): under the canopy, a hook on the ground just ahead/below would be a plain reel + hop,
    // so slide it out along the aim line to a tow-length point; holding the crosshair ahead-down always tows
    if (h && P.state === 'parachute' && !h.enemy && !h.vehicleAssist && !h.tree && !(h.collider && VO?.has?.(h.collider.handle))) { const t = this.towAssist(game, h, c0, rd, range); if (t) { h = t; snap = true; } }
    if (h) { // line of sight from the hand: the hook stops at whatever is in the way
      const hand = this.hand(game), dir = h.point.clone().sub(hand), L = dir.length(); dir.normalize();
      const los = L > 0.3 ? this.cast(game, hand, dir, L - 0.15) : null;
      if (los && !h.enemy) {
        h.point = hand.clone().addScaledVector(dir, los.timeOfImpact); h.normal = V(los.normal.x, los.normal.y, los.normal.z); h.collider = los.collider;
        if (h.vehicleAssist && !h.vehicleAssist.colliders?.some(c => c.handle === los.collider.handle)) h.vehicleAssist = null;
      }
      h.kind = h.enemy ? 'enemy' : h.vehicleAssist || (h.collider && VO?.has?.(h.collider.handle)) ? 'vehicle' : 'surface';
    }
    const pt = h ? h.point : ah ? ah.point : null;
    pv.ok = !!pt; pv.inRange = !!h; pv.point = pt; pv.dist = pt ? pt.distanceTo(c0) : 0; pv.kind = h ? h.kind : 'none'; pv.snap = snap;
    return h;
  },
  treeAim(game, ro, rd, range, c0, hd, tc) {
    const veg = game.world?.vegetation; if (!veg?.treesNear) return null;
    const lh = Math.hypot(rd.x, rd.z); if (lh < 0.08) return null;
    if (this.frame - (this.treeF ?? -9) >= 3 || !this.trees) { // re-gather the candidate list every 3 frames
      this.treeF = this.frame; const L = range + 10, mx = ro.x + rd.x / lh * L * 0.5, mz = ro.z + rd.z / lh * L * 0.5;
      this.trees = veg.treesNear(mx, mz, L * 0.5 + 8).filter(t => TREE_H[t.type]);
    }
    let best = null;
    for (const t of this.trees) {
      const dx = t.x - ro.x, dz = t.z - ro.z, s = (dx * rd.x + dz * rd.z) / (lh * lh); if (s <= 0) continue; // ray param at closest horizontal approach
      const px = ro.x + rd.x * s, pz = ro.z + rd.z * s, py = ro.y + rd.y * s, perp = Math.hypot(px - t.x, pz - t.z), H = TREE_H[t.type];
      if (py < t.y + 0.3 || py > t.y + H) continue;
      const tr = H > 6 ? 0.35 : 0.3, ang = Math.max(0, perp - tr) / s;
      if (s > hd + 0.5 || (perp > tr + 0.15 && ang > tc * 0.5)) continue; // behind the crosshair hit / outside half the assist cone
      const p = V(t.x, Math.min(t.y + H * 0.8, Math.max(t.y + 1.2, py)), t.z); if (p.distanceTo(c0) > range) continue;
      const sc = ang + s * 1e-5; if (!best || sc < best.sc) best = { ang, sc, p, t };
    }
    if (!best) return null;
    const n = V(ro.x - best.t.x, 0, ro.z - best.t.z).normalize(), tr = TREE_H[best.t.type] > 6 ? 0.35 : 0.3;
    return { ang: best.ang, h: { point: best.p.addScaledVector(n, tr), normal: n, collider: null, tree: best.t } };
  },
  towAssist(game, h, c0, rd, range) {
    const n = h.normal; if (!n || n.y < 0.55 || rd.y < -0.88 || h.point.y > c0.y - 0.5) return null;
    if (Math.hypot(h.point.x - c0.x, h.point.z - c0.z) >= 18) return null;
    const f = hz(rd); if (f.lengthSq() < 0.5) { const P = game.player; f.set(Math.sin(P.facing), 0, Math.cos(P.facing)); }
    for (const D of [30, 24, 20]) {
      const x = c0.x + f.x * D, z = c0.z + f.z * D, gy = game.world?.heightAt?.(x, z); if (gy == null) continue;
      const dir = V(x - c0.x, gy - c0.y, z - c0.z), L = dir.length(); dir.divideScalar(L);
      const hit = this.cast(game, c0, dir, Math.min(range, L + 4)); if (!hit) continue;
      const p = c0.clone().addScaledVector(dir, hit.timeOfImpact); if (Math.hypot(p.x - c0.x, p.z - c0.z) < 16) continue;
      return { point: p, normal: V(hit.normal.x, hit.normal.y, hit.normal.z), collider: hit.collider, towAssist: true };
    }
    return null;
  },
  // first drop-off (> 2.5 m below `p`) along horizontal `f` within `max` m: a roof / wall-top edge. Infinity on open ground
  edgeAhead(game, p, f, max = 26) {
    for (let d = 2; d <= max; d += 2) {
      const x = p.x + f.x * d, z = p.z + f.z * d; if ((game.world?.heightAt?.(x, z) ?? -1e9) > p.y - 2.5) continue; // terrain carries on
      const o = V(x, p.y + 2.5, z), h = this.cast(game, o, V(0, -1, 0), 5);
      if (!h || h.timeOfImpact > 5) return d;
    }
    return Infinity;
  },
  // a rooftop the player means to land on: a flat top with an edge beyond it, or a wall bitten within 2.5 m of its top
  roofTarget(game, a, tgt, c0) {
    if (a.vehicle || a.body || a.enemy) return false;
    const n = a.normal || V(0, 1, 0), f = hz(V(tgt.x - c0.x, 0, tgt.z - c0.z));
    if (n.y > 0.85) return tgt.y > c0.y - 20 && this.edgeAhead(game, tgt, f) < 26;
    if (Math.abs(n.y) > 0.5) return false;
    const nh = hz(n), o = tgt.clone().addScaledVector(nh, -0.6).add(V(0, 2.6, 0)), h = this.cast(game, o, V(0, -1, 0), 3.2);
    return !!(h && h.timeOfImpact > 0.02 && h.normal.y > 0.7);
  },
  pick(game) { const h = this.aim(game, true); return h ? this.resolve(game, h) : null; },

  resolve(game, h) {
    const col = h.collider, body = col?.parent?.() || null;
    let obj = col ? game.world?.colliderOwner?.get?.(col.handle) : null;
    if (!obj && body?.userData) obj = body.userData.obj || body.userData.object || (body.userData.isObject3D ? body.userData : null);
    let vehicle = null, enemy = h.enemy || null;
    for (const v of game.vehicles?.list || []) if ((col && v.collider?.handle === col.handle) || (body && v.body?.handle === body.handle) || (obj && (v.obj === obj || v.mesh === obj))) vehicle = v;
    if (!enemy) for (const e of game.enemies?.list || []) if ((col && e.collider?.handle === col.handle) || (body && e.body?.handle === body.handle)) enemy = e;
    vehicle = vehicle || obj?.userData?.vehicle || null; enemy = enemy || obj?.userData?.enemy || null;
    const a = { point: h.point, normal: h.normal, obj, vehicle, enemy, body: body && body.isDynamic() ? body : null, local: null };
    if (a.body) { a.bodyHandle = a.body.handle; const t = a.body.translation(), r = a.body.rotation(); const qi = new THREE.Quaternion(r.x, r.y, r.z, r.w).invert(); a.local = h.point.clone().sub(V(t.x, t.y, t.z)).applyQuaternion(qi); a.nLocal = (h.normal || V(0, 1, 0)).clone().applyQuaternion(qi); }
    else if (obj && !enemy) { obj.updateMatrixWorld(); a.objLocal = obj.worldToLocal(h.point.clone()); }
    else if (enemy) { const p = enemy.pos || enemy.obj?.position; a.enemyOff = h.point.clone().sub(p); }
    return a;
  },
  // a body can be removed under us (vehicle despawned / wreck cleared / debris culled): touching it would panic Rapier
  alive(a) {
    if (a?.body && (this.world.bodies.get(a.bodyHandle) !== a.body || a.vehicle?.removed)) { a.body = null; a.lost = true; if (a.lastPoint) a.point = a.lastPoint; }
    return !a?.lost;
  },
  where(a) {
    if (a.body && !this.alive(a)) return a.point;
    if (a.body) { const t = a.body.translation(), r = a.body.rotation(); return (a.lastPoint = a.local.clone().applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w)).add(V(t.x, t.y, t.z))); }
    if (a.enemy) { const p = a.enemy.pos || a.enemy.obj?.position; return p ? V(p.x, p.y, p.z).add(a.enemyOff || V(0, 1, 0)) : a.point; }
    if (a.objLocal && a.obj) { a.obj.updateMatrixWorld(); return a.obj.localToWorld(a.objLocal.clone()); }
    return a.point;
  },

  endTow(game, why = 'cancel') {
    const tw = this.tow; this.tow = null; if (game.player) game.player.chuteTow = null;
    if (tw) game.events.emit('grapple:towEnd', { reason: why, t: tw.t });
    if (!this.anchor && !this.shot) { this.stow(); game.grapple.state = 'idle'; game.grapple.armTarget = null; }
  },
  colOn(game) { const P = game.player; if (this.colOff) { this.colOff = false; if (P?.state !== 'vehicle') P?.collider?.setEnabled?.(true); } },
  release(game) { const P = game.player; if (this.tow) this.endTow(game, 'release');
    this.colOn(game);
    const ride = P?.hanging && this.anchor?.vehicle ? this.rideVel : null; this.rideVel = null;
    if (ride && P?.state === 'grapple') { P.hanging = false; P.setState('air'); P.airTime = 1; P.vel.copy(ride); }
    this.anchor = null; this.shot = null; this.boostT = 0; this.boostA = null; game.grapple.state = 'idle'; game.grapple.armTarget = null; this.stow(); if (P?.state === 'grapple') { P.hanging = false; P.setState('air'); P.airTime = 1; } },
  // velocity hand-off to the player: P.pop (state air, chute/suit instantly available) when the player module has it
  launchP(game, v) { const P = game.player; if (P.pop) P.pop(v); else { P.vel.copy(v); P.setState('air'); P.airTime = 1; } },
  pop(game, v, point, sling = false) { this.release(game); this.launchP(game, v); game.events.emit('grapple:pop', { point: point.clone(), vel: v.clone(), slingshot: sling }); game.audio?.play?.('grapple_pop', { pos: point }); },

  // hook landed: decide what it does from the player's state and what was hit
  arrive(game, a, tgt) {
    const P = game.player, G = game.grapple, kind = a.enemy ? 'enemy' : a.vehicle ? 'vehicle' : 'surface';
    game.fx?.sparks?.(tgt.clone()); game.audio?.play?.('grapple_hit', { pos: tgt }); this.rope.snap(); game.events.emit('grapple:hit', { point: tgt.clone(), kind });
    if (a.enemy) { this.pullEnemy(game, a); if (!this.anchor && !this.tow) { this.stow(); G.armTarget = null; G.state = 'idle'; } return; }
    const to = tgt.clone().sub(P.center());
    if (P.state === 'wingsuit' && !a.vehicle) { // grapple boost: snap of speed toward the hook, stay in the suit
      // low over the ground the boost lifts as well as pulls (a lazy hook at the ground ahead re-energises upward)
      // the pull aims a little off the surface (up its normal) so a hook on a slope flies you over it, not into it
      const n = a.normal, off = n ? Math.min(12, to.length() * 0.3) : 0; if (off) to.addScaledVector(n, off);
      const dir = to.normalize(), agl = P.pos.y - (game.world?.heightAt?.(P.pos.x, P.pos.z) ?? -1e9), low = Math.min(1, Math.max(0, 1 - agl / 30));
      if (low > 0) { dir.y = Math.max(dir.y, 0.5 * low); dir.normalize(); }
      const ok = P.glidePull?.(dir, 18 + 6 * low); this.boostT = 0.3; this.boostA = a; G.state = 'boost';
      game.events.emit('grapple:boost', { point: tgt.clone(), dir: dir.clone(), ok: !!ok }); return;
    }
    const roof = (P.state === 'parachute' || P.state === 'air') && this.roofTarget(game, a, tgt, P.center());
    if (P.state === 'parachute' && !a.vehicle && !roof) {
      if (Math.hypot(to.x, to.z) > 14) { // chute tow: the canopy is dragged toward the hook
        this.anchor = null; this.tow = { a, t: 0 }; G.state = 'tow'; game.cam?.fovKick?.(3);
        game.events.emit('grapple:tow', { point: tgt.clone(), dist: to.length() }); return;
      }
      if (to.y < 0) { // short hook below the canopy (assist found nothing further out): a yank forward + up, chute stays open
        const f = hz(to); if (f.lengthSq() < 0.5) f.set(Math.sin(P.facing), 0, Math.cos(P.facing));
        P.glidePull?.(f, 20); P.vel.y = Math.max(P.vel.y, 5); this.boostT = 0.25; this.boostA = a; G.state = 'boost'; game.cam?.fovKick?.(3);
        game.events.emit('grapple:tow', { point: tgt.clone(), dist: to.length(), short: true }); return;
      }
    }
    if (this.tow) this.endTow(game, 'rehook');
    this.colOn(game); this.rideVel = null;
    const d0 = to.length(), dir = to.clone().divideScalar(Math.max(d0, 1e-3));
    this.roof = roof; this.reelDir = hz(dir); this.anchor = a; G.state = 'reeling'; this.d0 = d0; this.speed = Math.max(0, P.vel.dot(dir)); // keep the momentum already going that way
    this.top = Math.min(60, Math.max(G.reelSpeed, 36 + d0 * 0.33)) * (1 + ((G.reelStrength || 1) - 1) * 0.3);
    P.hanging = false; P.setState('grapple'); this.stuck = 0; this.lastPos = null; this.ledge = null;
    game.cam?.fovKick?.(4); game.events.emit('grapple:reel', { speed: this.top, dist: d0, point: tgt.clone() });
  },

  // E still held from the press that fired this hook (>= 0.18 s) = slingshot: up 15 + forward 18 instead of up 11 + <=14
  slinging() { return this.holdT >= 0.18; },
  popDir(game) { const f = this.reelDir && this.reelDir.lengthSq() > 0.04 ? this.reelDir.clone() : null; if (f) return f.normalize(); const y = game.cam?.yaw ?? 0; return V(-Math.sin(y), 0, -Math.cos(y)); },
  arrivePop(game, tgt) {
    const sling = this.slinging(), f = this.popDir(game), v = f.clone().multiplyScalar(sling ? 18 : Math.min(14, this.speed * 0.4)); v.y = sling ? 15 : 11;
    if (!sling) { // a flat top with an edge ahead (a roof): small hop, forward speed scaled so the ~1.3 s hop lands on it
      const e = this.edgeAhead(game, tgt, f);
      if (e < 26) { v.copy(f).multiplyScalar(Math.max(0.5, Math.min(14, (e - 3) / 1.3))); v.y = 5.5; }
    }
    this.pop(game, v, tgt, sling);
    if (sling) { game.cam?.fovKick?.(7); game.cam?.shake?.(0.25); game.events.emit('grapple:slingshot', { point: tgt.clone(), vel: v.clone() }); }
  },
  // arrived at a wall (or a vehicle): hang; look for a ledge top within 2.5 m above the hook for a mantle
  hang(game, tgt) {
    const P = game.player, n = this.anchor.normal || V(0, 0, 1), nh = hz(n); P.hanging = true; P.vel.set(0, 0, 0); this.ledge = null;
    game.events.emit('grapple:hang', { point: tgt.clone() });
    if (this.anchor.vehicle || this.anchor.body || nh.lengthSq() < 0.5) return;
    const o = tgt.clone().addScaledVector(nh, -0.6).add(V(0, 2.6, 0)), h = this.cast(game, o, V(0, -1, 0), 3.2);
    if (h && h.timeOfImpact > 0.02 && h.normal.y > 0.7) {
      const p = o.clone().add(V(0, -h.timeOfImpact, 0));
      if (p.y <= tgt.y + 2.5 && !this.cast(game, p.clone().add(V(0, 0.15, 0)), V(0, 1, 0), 1.7)) this.ledge = p;
    }
    // hook bit within 1.6 m of the top (a roof edge / wall top): go straight over onto it. E held = slingshot off the edge
    if (this.ledge && this.ledge.y - tgt.y < (this.roof ? 2.6 : 1.6)) {
      if (this.slinging()) { this.arrivePop(game, this.ledge.clone()); return 'popped'; }
      this.mantle(game, nh); return 'mantled';
    }
  },

  mantle(game, nh) { const P = game.player, p = this.ledge.clone().addScaledVector(nh, -0.3).add(V(0, 0.05, 0)); this.release(game); P.setPosition(p); P.vel.set(0, 0, 0); P.setState('ground'); game.events.emit('grapple:mantle', { point: p.clone() }); },
  update(dt, game) {
    const G = game.grapple, P = game.player, I = game.input; if (!P?.ready) return;
    this.t += dt; this.frame++;
    const play = game.state === 'play' && P.state !== 'dead' && P.state !== 'vehicle';
    const fire = play && I.pressed('grapple');
    const h = play ? this.aim(game, fire || I.pressed('tether')) : null;
    if (!play) { const pv = G.preview; pv.ok = pv.inRange = pv.snap = false; pv.kind = 'none'; pv.point = null; }
    const hand = this.hand(game);
    if (I.down('grapple')) this.holdT = (this.holdT || 0) + dt; else this.holdT = -1; // -1: released since the last fire
    if (fire) { // E fires; E again mid-reel / mid-tow re-hooks to the new point (no cooldown)
      const a = h && this.resolve(game, h);
      const to = a ? a.point.clone() : hand.clone().addScaledVector(game.cam.aimRay.direction, G.range);
      this.shot = a ? { a, d: 0 } : { a: { point: to }, miss: true, d: 0 }; this.ret = null; this.holdT = 0;
      if (G.state === 'idle') G.state = 'firing';
      game.audio?.play?.('grapple_fire', { pos: P.pos }); game.events.emit('grapple:fire', { from: hand.clone(), to: to.clone(), hit: !!a, kind: h?.kind || 'none' });
    }
    if (play && I.pressed('tether')) {
      const a = h && this.resolve(game, h);
      if (!G.pending) { if (a) { G.pending = a; G.pendingT = 0; game.audio?.play?.('grapple_fire', { pos: P.pos }); } }
      else { if (a && !(a.body && a.body === G.pending.body)) this.addTether(game, G.pending, a); G.pending = null; }
    }
    if (G.pending && (G.pendingT += dt) > 10) G.pending = null;
    if (play && I.pressed('reel')) { for (const t of G.tethers) t.reel = true; game.audio?.play?.('reel', { pos: P.pos }); }
    if (play && I.down('reel') && (this.reelHold = (this.reelHold || 0) + dt) > 0.8) { for (const t of G.tethers) t.rope.dispose(); G.tethers.length = 0; this.reelHold = -99; }
    if (!I.down('reel')) this.reelHold = 0;

    // hook flight (~450 m/s: reads as instant but you see the line zip out)
    if (this.shot) {
      const s = this.shot, tgt = this.where(s.a), L = Math.max(0.01, hand.distanceTo(tgt));
      s.d += HOOK * dt; G.armTarget = tgt;
      this.rope.set(hand, hand.clone().lerp(tgt, Math.min(1, s.d / L)), slackSag(L, L * 0.03) * Math.min(1, s.d / L), 0.25 * Math.max(0, 1 - s.d / L), this.t, game.camera, dt);
      if (s.d >= L) {
        this.shot = null;
        if (!s.miss && this.alive(s.a)) this.arrive(game, s.a, tgt);
        else if (!this.anchor && !this.tow) { this.stow(); G.armTarget = null; G.state = 'idle'; }
      }
    }
    // reeling the player
    if (this.anchor?.lost) this.release(game);
    if (this.anchor && P.state === 'grapple') {
      const tgt = this.where(this.anchor); G.armTarget = tgt;
      const veh = this.anchor.vehicle, n0 = this.anchor.normal || V(0, 1, 0), top = n0.y > 0.6 && !veh;
      const c = P.center(), to = (top ? tgt.clone().add(V(0, 1.1, 0)) : tgt.clone()).sub(c), d = to.length();
      if (!P.hanging) {
        // 0 -> 40 m/s in ~0.12 s, then on to a distance-scaled top speed (60 m arrives in ~1.3 s from the press)
        this.speed = Math.min(this.top, this.speed + (this.speed < 40 ? 340 : 90) * dt);
        const prog = Math.min(1, Math.max(0, 1 - d / (this.d0 || d)));
        P.vel.copy(to).multiplyScalar(this.speed / Math.max(d, 1e-3));
        if ((this.d0 || 0) > 8 && !veh) P.vel.y += this.speed * 0.1 * Math.max(0, 1 - prog * 1.7); // slight early arc
        if (veh && this.anchor.body) { const lv = this.anchor.body.linvel(); P.vel.x += lv.x; P.vel.y += lv.y; P.vel.z += lv.z; } // chase a moving car
        const moved = this.lastPos ? this.lastPos.distanceTo(P.pos) : 1; this.lastPos = P.pos.clone();
        const blocked = this.speed * dt * 0.3 > moved; this.stuck = blocked ? this.stuck + dt : 0;
        const arr = Math.max(veh ? 2.4 : top ? 1.8 : 1.4, this.speed * dt * 1.5);
        if (top && (d < arr || (this.stuck > 0.05 && d < 5))) { // arrival pop: up + 40 % of the reel speed forward; E held = slingshot
          this.arrivePop(game, tgt); return this.tail(dt, game, hand);
        }
        if (d < arr || (this.stuck > 0.3 && d < 3.5)) { if (this.hang(game, tgt)) return this.tail(dt, game, hand); }
        else if (this.stuck > 0.3) this.release(game);
      }
      if (this.anchor && P.hanging) {
        let n = n0;
        if (this.anchor.body && this.anchor.nLocal && this.alive(this.anchor)) { const r = this.anchor.body.rotation(); n = this.anchor.nLocal.clone().applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w)); }
        if (veh) { // riding a vehicle: stand on the roof or cling to the side; collider off so we don't shove it
          if (P.collider?.isEnabled?.()) { P.collider.setEnabled(false); this.colOff = true; }
          const lv = this.anchor.body?.linvel?.(); this.rideVel = lv ? V(lv.x, lv.y, lv.z) : null;
        }
        const hp = veh && n.y > 0.6 ? tgt.clone().add(V(0, 0.05, 0)) : tgt.clone().addScaledVector(n, 0.45).add(V(0, -1.75, 0));
        P.setPosition(hp); P.facing = n.y > 0.6 && veh ? P.facing : Math.atan2(-n.x, -n.z);
        if (I.pressed('interact') && veh) { this.release(game); game.vehicles?.enter?.(veh); return this.tail(dt, game, hand); }
        this.hn = hz(n);
      }
      if (this.anchor && !this.shot) { const L = hand.distanceTo(tgt); this.rope.set(hand, tgt, P.hanging ? slackSag(L, Math.min(0.4, L * 0.2)) : 0, Math.max(0, 0.08 - this.speed * 0.002), this.t, game.camera, dt); }
      if (this.anchor && game.state === 'play') {
        if (P.hanging) {
          const nh = this.hn || V(), agl = P.pos.y - (game.world?.heightAt?.(P.pos.x, P.pos.z) ?? -1e9);
          if (I.pressed('jump')) {
            if (this.ledge) this.mantle(game, nh);
            else this.pop(game, V(0, 11, 0).addScaledVector(nh, 3).add(this.rideVel || V()), tgt);
          } else if (I.pressed('sprint') && agl >= 8) {
            const v = nh.clone().multiplyScalar(14).add(V(0, 2, 0)).add(this.rideVel || V()); this.release(game); P.vel.copy(v);
            game.systems.find(s => s.name === 'player')?.enterWingsuit?.(game);
          } else if (I.pressed('crouch')) this.release(game);
        } else if (I.pressed('jump') || I.pressed('sprint')) { // let go mid-reel with the full momentum vector + 6 up: the genre's swing-up
          const v = P.vel.clone().add(V(0, 6, 0)), suit = !I.pressed('jump'); this.release(game); P.vel.copy(v);
          if (suit) game.systems.find(s => s.name === 'player')?.enterWingsuit?.(game); else P.setState('parachute');
          game.events.emit('grapple:letgo', { vel: v.clone(), to: suit ? 'wingsuit' : 'parachute' });
        } else if (I.pressed('crouch')) this.release(game);
      }
    } else if (this.anchor) this.release(game);
    this.tail(dt, game, hand);
  },

  tail(dt, game, hand) {
    const G = game.grapple, P = game.player, I = game.input;
    if (this.tow) { // chute tow: rope taut; let go ~12 m (horizontal) from the hook, after 4 s, on C, or if the chute closes
      const tw = this.tow, tgt = this.where(tw.a), to = tgt.clone().sub(P.center()), d = Math.max(1e-3, to.length()), hd = Math.hypot(to.x, to.z);
      tw.t += dt;
      const why = P.state !== 'parachute' ? 'state' : !this.alive(tw.a) ? 'lost' : hd < 12 || d < 6 ? 'near' : tw.t > 4 ? 'time' : I.pressed('crouch') ? 'cancel' : null;
      if (why) this.endTow(game, why);
      else { P.chuteTow = { dir: to.divideScalar(d), dist: d, k: Math.min(1, tw.t * 5), t: tw.t }; if (!this.shot) { this.rope.set(hand, tgt, slackSag(d, d * 0.05 * (1 - P.chuteTow.k)), 0, this.t, game.camera, dt); G.armTarget = tgt; } }
    }
    if (this.boostT > 0) { // brief taut rope after a glide boost
      this.boostT -= dt; const tgt = this.where(this.boostA); if (!this.shot) this.rope.set(hand, tgt, 0, 0, this.t, game.camera, dt); G.armTarget = tgt;
      if (this.boostT <= 0) { this.boostA = null; if (!this.shot && !this.anchor && !this.tow) { this.stow(); G.state = 'idle'; } }
    } else if (!this.shot && !this.anchor && !this.tow) G.armTarget = G.pending ? this.where(G.pending) : null;

    if (this.ret && !this.shot && !this.anchor && !this.tow && !(this.boostT > 0)) { // retract: tip whips back to the hand with slack
      const r = this.ret; r.t += dt; const k = Math.min(1, r.t / 0.16), tip = r.p.clone().lerp(hand, k * k), L = hand.distanceTo(tip);
      if (k >= 1 || L < 0.3) { this.ret = null; this.rope.hide(); } else this.rope.set(hand, tip, slackSag(L, L * 0.12 * (1 - k)), 0, this.t, game.camera, dt);
    } else if (this.ret && (this.shot || this.anchor || this.tow)) this.ret = null;
    // tether visuals (+ pending tether from the hand)
    for (const t of G.tethers) {
      const a = this.where(t.a), b = this.where(t.b), d = a.distanceTo(b);
      t.rope.set(a, b, slackSag(d, t.rest - d), 0, this.t, game.camera, dt);
      if (t.done && (t.life -= dt) < 0) t.dead = true;
    }
    for (let i = G.tethers.length - 1; i >= 0; i--) if (G.tethers[i].dead) { G.tethers[i].rope.dispose(); G.tethers.splice(i, 1); }
    if (G.pending) { { const pp = this.where(G.pending); (this.prope ||= new Rope(game.scene)).set(hand, pp, slackSag(hand.distanceTo(pp), 1.5), 0, this.t, game.camera, dt); } } else this.prope?.hide();
  },

  addTether(game, a, b) {
    const G = game.grapple;
    const t = { a, b, rest: this.where(a).distanceTo(this.where(b)), reel: false, rope: new Rope(game.scene), life: 6, done: false, strain: 0 }; t.rope.snap();
    G.tethers.push(t);
    while (G.tethers.length > G.maxTethers) G.tethers.shift().rope.dispose();
    game.audio?.play?.('grapple_hit', { pos: this.where(b) });
  },

  fling(e, vel) { if (e.applyImpulse) e.applyImpulse(vel); else if (e.fling) e.fling(vel); else if (e.ragdoll) e.ragdoll(vel); else if (e.body?.isDynamic?.()) e.body.applyImpulse(vel.clone().multiplyScalar(e.body.mass()), true); },
  pullEnemy(game, a) {
    const P = game.player, e = a.enemy, p = this.where(a), to = P.pos.clone().sub(p); to.y = 0;
    const d = to.length(), dir = d > 1e-3 ? to.divideScalar(d) : V(0, 0, 1), vy = 6.5, air = 2 * vy / 9.81; // off their feet: ~1.3 s hang time
    const vel = dir.multiplyScalar(Math.min(26, Math.max(6, (d - 3) / air))).add(V(0, vy, 0));
    this.fling(e, vel);
    game.events.emit('grapple:pull', { enemy: e, obj: e.obj, vel });
  },

  // tether physics at fixed 60 Hz: spring impulses toward rest length; reel contracts rest length
  stepTethers(game, h) {
    const G = game.grapple; if (!G?.tethers.length) return;
    for (const t of G.tethers) {
      if (t.dead) continue;
      if ((t.a.body && !this.alive(t.a)) || (t.b.body && !this.alive(t.b))) { t.dead = true; continue; }
      if (t.reel) { t.rest = Math.max(0.6, t.rest - 16 * G.reelStrength * h); if (t.rest <= 0.6 && !t.done) { t.done = true; t.life = 4; } }
      const pa = this.where(t.a), pb = this.where(t.b), dir = pb.clone().sub(pa), d = dir.length(); if (d < 1e-3) continue; dir.divideScalar(d);
      const stretch = d - t.rest; if (stretch <= 0) continue;
      const ma = t.a.body ? t.a.body.mass() : Infinity, mb = t.b.body ? t.b.body.mass() : Infinity;
      for (const [an, s, pt, m, mo] of [[t.a, 1, pa, ma, mb], [t.b, -1, pb, mb, ma]]) {
        if (an.body) {
          const meff = isFinite(mo) ? (m * mo) / (m + mo) : m;
          const lv = an.body.linvel(); const rel = (lv.x * dir.x + lv.y * dir.y + lv.z * dir.z) * s;
          let J = meff * (Math.min(stretch, 8) * 9 - rel * 1.5) * h * (t.reel ? 2.2 : 1);
          J = Math.max(0, Math.min(J, 900 * G.reelStrength * h * 60));
          an.body.applyImpulseAtPoint({ x: dir.x * J * s, y: dir.y * J * s, z: dir.z * J * s }, pt, true);
          const sp = Math.hypot(lv.x, lv.y, lv.z);
          if (an.lastSp != null && an.lastSp - sp > 10 && an.obj?.userData?.destructible) game.world?.damageDestructible?.(an.obj, (an.lastSp - sp) * 10, pt);
          an.lastSp = sp;
        } else if (an.enemy && t.reel) {
          const vel = dir.clone().multiplyScalar(18 * s).add(V(0, 3, 0));
          if (!an.flung) { an.flung = true; this.fling(an.enemy, vel); game.events.emit('grapple:pull', { enemy: an.enemy, obj: an.enemy.obj, vel }); }
        } else if (an.obj?.userData?.destructible && t.reel && stretch > 0.3) {
          // static destructible (statue, tower, dish): tilt under strain, topple past ~35 degrees
          const o = an.obj; t.strain += h * 0.35 * G.reelStrength;
          const axis = V(0, 1, 0).cross(dir.clone().multiplyScalar(s)).normalize();
          if (axis.lengthSq() > 0.5) o.rotateOnWorldAxis(axis, h * 0.35 * G.reelStrength);
          if (t.strain > 0.6) { game.world?.damageDestructible?.(o, (o.userData.destructible.maxHp || 1000) * 3, pt); t.dead = true; game.gfx?.shake?.(0.4); }
        }
      }
    }
  },
};
