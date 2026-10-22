// STORMBREAK camera: third-person orbit with collision avoidance, speed FOV, over-shoulder aim,
// wingsuit/parachute chase, vehicle follow, cinematic title orbit, wind streaks and trauma shake.
// Exposes game.cam {yaw, pitch, aimRay, aimPoint, aimHit, mode, shake(amount), addRecoil(p, y), fovKick(deg)}.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _t3 = new THREE.Vector3();
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const angLerp = (a, b, t) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

// cheap smooth noise for shake
const noise = (t, s) => Math.sin(t * 1.7 + s) * 0.5 + Math.sin(t * 3.1 + s * 2.3) * 0.3 + Math.sin(t * 7.3 + s * 5.1) * 0.2;

export default {
  name: 'camera',
  init(game) {
    const camera = game.camera;
    const cam = game.cam = {
      yaw: Math.PI, pitch: 0.25, // yaw: camera looks along (-sin yaw, -cos yaw); pitch>0 = camera above looking down
      dist: 4.5, fov: 65, baseFov: 65, mode: 'title',
      aimRay: new THREE.Ray(camera.position.clone(), new THREE.Vector3(0, 0, -1)),
      aimPoint: new THREE.Vector3(), aimHit: null,
      pivot: new THREE.Vector3(), trauma: 0, recoil: { p: 0, y: 0 }, fovExtra: 0, sensitivity: 1,
      lookIdle: 99, collideDist: 99,
      shake(a) { cam.trauma = Math.min(1, cam.trauma + a); },
      addRecoil(p, y = 0) { cam.recoil.p += p; cam.recoil.y += y; },
      fovKick(d) { cam.fovExtra += d; },
      forward(out = new THREE.Vector3()) { return out.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw)); },
      right(out = new THREE.Vector3()) { return out.set(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)); },
      snap() { cam._snap = true; },
      // combat.js calls this on RMB: weapon zoom FOV (sniper 18, rifle 46...) for the over-shoulder aim camera
      aimOn: false, aimFov: 50,
      setAim(on, fov) { cam.aimOn = !!on; if (Number.isFinite(fov)) cam.aimFov = clamp(fov, 15, 65); },
    };
    this.titleT = 0;
    this.pivotInit = false;

    // wind streaks: thin additive quads flowing past the lens at speed; per-instance colour fades them out
    // near screen centre so they live at the frame edges and never cross the hero
    const N = 160;
    const geo = new THREE.PlaneGeometry(0.022, 1.4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xdfe8f2, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const streaks = this.streaks = new THREE.InstancedMesh(geo, mat, N);
    streaks.frustumCulled = false; streaks.renderOrder = 10; streaks.visible = false;
    for (let i = 0; i < N; i++) streaks.setColorAt(i, new THREE.Color(0, 0, 0));
    this.sp = Array.from({ length: N }, () => ({ p: new THREE.Vector3(), life: 0, w: 1 }));
    game.scene.add(streaks);
    // speed overlay: one clip-space quad (no post pass needed, gfx.js owns post): thin radial lines rushing out
    // at the frame edge + a soft dark vignette, both scaled by uI (0 below ~45 m/s, full by ~75 or when skimming)
    const omat = this.overlayMat = new THREE.ShaderMaterial({
      uniforms: { uI: { value: 0 }, uT: { value: 0 }, uAspect: { value: 16 / 9 }, uOn: { value: 1 }, uTint: { value: new THREE.Color(0xe8eef5) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform float uI, uT, uAspect, uOn; uniform vec3 uTint; varying vec2 vUv;
        float h1(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
        void main(){
          vec2 p = (vUv - 0.5) * 2.0; float r = length(vec2(p.x * 0.92, p.y * 1.08));
          float I = uI * uOn; if (I < 0.002) discard;
          float a = atan(p.y * 1.0, p.x * uAspect) / 6.2831853 + 0.5;
          float bins = 150.0, x = a * bins, b = floor(x), hb = h1(b), hb2 = h1(b + 91.7);
          float keep = step(1.0 - (0.08 + 0.14 * I), hb);                // a few more lines the faster you go (sparse)
          float d = abs(fract(x) - 0.5) * 2.0, fw = fwidth(x) * 2.0;
          float lw = 1.0 - smoothstep(0.10 + 0.08 * hb2, 0.10 + 0.08 * hb2 + fw * 1.5, d);
          float s = fract(r * (0.9 + hb2) - uT * (1.6 + 1.4 * hb) - hb * 7.0);  // segments travelling outward
          float seg = smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(0.35, 0.75, s));
          float edge = smoothstep(0.8 - 0.08 * I, 1.35, r);
          float line = keep * lw * seg * edge * I * 0.32;
          float vig = smoothstep(0.85, 1.6, r) * I * 0.3;
          float al = max(line, vig);
          gl_FragColor = vec4(uTint * (line / max(al, 1e-4)), al);
        }`,
      transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
    });
    const ov = this.overlay = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), omat);
    ov.frustumCulled = false; ov.renderOrder = 999; ov.visible = false; ov.castShadow = false; ov.receiveShadow = false;
    ov.onBeforeRender = (r, sc, c) => { const on = c === game.camera ? 1 : 0; if (omat.uniforms.uOn.value !== on) { omat.uniforms.uOn.value = on; omat.uniformsNeedUpdate = true; } };
    game.scene.add(ov);
    this.overI = 0; this.reelPunch = 0; this.frameOff = 0;
    // traversal juice driven by grapple events (grapple.js emits; they are optional)
    this.kickY = 0; this.kickV = 0; this.boostT = 0; this.reelK = 0; this.crane = 0; this.bankS = 0; this.lead = new THREE.Vector3();
    const E = game.events;
    if (E?.on) {
      E.on('grapple:hit', () => { cam.shake(0.05); });
      E.on('grapple:pop', () => { this.kickV += 2.4; cam.shake(0.15); cam.fovKick(3); });
      E.on('grapple:boost', () => { this.boostT = 0.55; cam.shake(0.1); cam.fovKick(6); });
      E.on('grapple:tow', () => { cam.shake(0.06); });
      // reel start: the camera gets yanked back and the lens widens, then settles as the hero rockets ahead
      E.on('grapple:reel', () => { this.reelPunch = 1; cam.shake(0.08); });
    }
    this.ray = game.RAPIER ? new game.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }) : null;
  },

  cast(game, origin, dir, max, excludeVehicleBody) {
    const ray = this.ray; if (!ray || !game.physics) return null;
    ray.origin = { x: origin.x, y: origin.y, z: origin.z }; ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const pc = game.player?.collider;
    const vb = excludeVehicleBody;
    let hit = null;
    try {
      hit = game.physics.castRayAndGetNormal(ray, max, true, game.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, pc || undefined, vb || undefined,
        c => !c.userData?.noCamera);
    } catch (e) { hit = null; }
    return hit;
  },

  // 'spherecast' for the boom: centre ray + 4 rays offset by r around it; returns the shortest free distance
  castThick(game, origin, dir, max, vb, r = 0.28) {
    let best = null;
    const side = _t1.set(-dir.z, 0, dir.x); if (side.lengthSq() < 1e-6) side.set(1, 0, 0); side.normalize();
    const upv = _t2.crossVectors(side, dir).normalize();
    for (let i = 0; i < 5; i++) {
      const o = _t3.copy(origin);
      if (i === 1) o.addScaledVector(side, r); else if (i === 2) o.addScaledVector(side, -r); else if (i === 3) o.addScaledVector(upv, r); else if (i === 4) o.addScaledVector(upv, -r);
      const h = this.cast(game, o, dir, max, vb);
      if (h && (!best || h.timeOfImpact < best)) best = h.timeOfImpact;
    }
    return best;
  },

  update(dt, game) {},

  lateUpdate(dt, game) {
    const cam = game.cam, camera = game.camera, input = game.input, P = game.player;
    const world = game.world;
    const hAt = (x, z) => world?.heightAt?.(x, z) ?? -1e9;
    const rdt = Math.min(game.dt || dt || 0.016, 0.05) || 0.016;

    if (game.state === 'title' || !P || !P.pos) {
      this.titleOrbit(game, rdt); this.pivotInit = false; return;
    }

    // ---- look input
    const look = input?.look || { x: 0, y: 0 };
    const active = game.state === 'play' && !game.paused;
    const lx = active ? look.x * cam.sensitivity : 0, ly = active ? look.y * cam.sensitivity : 0;
    if (Math.abs(lx) + Math.abs(ly) > 0.0005) cam.lookIdle = 0; else cam.lookIdle += rdt;
    cam.yaw -= lx; cam.pitch += ly;
    // recoil settles back
    cam.pitch -= cam.recoil.p * damp(14, rdt); cam.yaw -= cam.recoil.y * damp(14, rdt);
    cam.recoil.p *= 1 - damp(14, rdt); cam.recoil.y *= 1 - damp(14, rdt);

    // ---- mode
    const v = game.vehicles?.current;
    const st = P.state;
    const G = game.grapple;
    let mode = 'ground';
    if (v && st === 'vehicle') mode = 'vehicle';
    else if (st === 'wingsuit') mode = 'wingsuit';
    else if (st === 'parachute') mode = 'parachute';
    else if (st === 'grapple') mode = P.hanging ? 'hang' : 'reel';
    else if (st === 'air') mode = 'air';
    else if (st === 'swim') mode = 'swim';
    else if (st === 'dead') mode = 'dead';
    const aiming = active && (P.aiming || input?.down?.('aim')) && mode !== 'vehicle' && mode !== 'dead';
    if (aiming) mode = mode === 'ground' || mode === 'swim' || mode === 'hang' ? 'aim' : mode === 'vehicle' ? mode : 'airAim';
    cam.mode = mode;
    const reeling = st === 'grapple' && !P.hanging && (!G || G.state === 'reeling');
    this.reelK += ((reeling ? 1 : 0) - this.reelK) * damp(reeling ? 6 : 3, rdt);
    this.boostT = Math.max(0, this.boostT - rdt);
    this.reelPunch *= 1 - damp(reeling ? 2.2 : 6, rdt); if (!reeling && this.reelK < 0.05) this.reelPunch = 0;

    // ---- target pivot
    const pv = _v;
    let speed = 0, vel = _v3.set(0, 0, 0);
    let vObj = null;
    if (mode === 'vehicle') {
      vObj = v.obj || v.mesh || v.group || v.root;
      if (vObj) { vObj.getWorldPosition(pv); pv.y += v.camHeight ?? 1.8; } else pv.copy(P.pos).add({ x: 0, y: 1.6, z: 0 });
      const lv = v.body?.linvel?.(); if (lv) vel.set(lv.x, lv.y, lv.z); else if (v.vel) vel.copy(v.vel);
    } else {
      pv.copy(P.pos); pv.y += st === 'swim' ? 1.25 : (P.crouching ? 1.15 : 1.55);
      if (P.vel) vel.copy(P.vel);
    }
    speed = vel.length();
    // sprint lead: the framing drifts a touch ahead of a running hero (horizontal only, so no bob)
    const leadOn = mode === 'ground' && P.sprinting ? 0.45 : 0;
    const hvv = Math.hypot(vel.x, vel.z);
    _t1.set(hvv > 0.5 ? vel.x / hvv : 0, 0, hvv > 0.5 ? vel.z / hvv : 0).multiplyScalar(leadOn);
    this.lead.lerp(_t1, damp(3, rdt)); pv.add(this.lead);

    if (!this.pivotInit || cam._snap) { cam.pivot.copy(pv); this.pivotInit = true; cam._snap = false; cam.collideDist = 99; }
    // follow: velocity feed-forward (no steady-state lag at 60 m/s: the hero holds the frame) + damped error
    // (absorbs steps / landings / sudden accelerations, which is where the sense of weight comes from)
    // reel: only 80 % feed-forward, so the camera trails ~1 m behind at full pull and the hero leads the frame
    if (mode !== 'vehicle' && mode !== 'ground' && mode !== 'aim' && speed > 2 && speed < 200) cam.pivot.addScaledVector(vel, rdt * (mode === 'reel' ? 0.8 : 1));
    const kh = mode === 'vehicle' ? 9 : mode === 'wingsuit' || mode === 'reel' ? 10 : 22, kv = mode === 'ground' || mode === 'aim' ? 11 : mode === 'vehicle' ? 10 : mode === 'wingsuit' ? 8 : 18;
    cam.pivot.x += (pv.x - cam.pivot.x) * damp(kh, rdt);
    cam.pivot.z += (pv.z - cam.pivot.z) * damp(kh, rdt);
    cam.pivot.y += (pv.y - cam.pivot.y) * damp(kv, rdt);
    // never let the pivot lag far behind
    const lag = _v2.subVectors(pv, cam.pivot); const lagMax = mode === 'vehicle' ? 0.6 + speed * 0.03 : mode === 'reel' ? 1.2 + speed * 0.03 : 1.2 + speed * 0.01;
    if (lag.length() > lagMax) cam.pivot.addScaledVector(lag, 1 - lagMax / lag.length());

    // ---- auto chase: align behind travel only once the player has let go of the look stick, and ease in
    // (genre complaint: cameras that yank back too hard; never fight look input)
    const hv = Math.hypot(vel.x, vel.z);
    // the chute re-centres sooner and firmer than the suit: a 9 m canopy seen side-on from a lagging camera walls off the view
    const idleK = mode === 'parachute' ? clamp((cam.lookIdle - 0.35) / 0.5, 0, 1) : clamp((cam.lookIdle - 0.9) / 1.2, 0, 1);
    if ((mode === 'wingsuit' || mode === 'parachute') && idleK > 0 && hv > 3) {
      // chute: sit behind where the canopy points (its heading leads the velocity through a turn), not behind travel
      const want = mode === 'parachute' ? P.facing + Math.PI : Math.atan2(-vel.x, -vel.z);
      cam.yaw = angLerp(cam.yaw, want, damp((mode === 'wingsuit' ? 1.7 : 2.4) * idleK, rdt));
      // chute: tilt the view so the crosshair rests on the ground ~95 m ahead (inside tow range) at any height
      const agl = P.pos.y - Math.max(hAt(P.pos.x, P.pos.z), world?.seaLevel ?? -1e9);
      const wantP = mode === 'wingsuit' ? clamp(0.2 - Math.atan2(vel.y, hv) * 0.55, -0.3, 0.85) : clamp(Math.atan2(agl + 3.5, 95), 0.22, 0.55);
      cam.pitch += (wantP - cam.pitch) * damp(1.2 * idleK, rdt);
    } else if (mode === 'reel' && G?.armTarget && cam.lookIdle > 0.25) {
      // look-ahead toward the hook while being pulled (gentle; aim was already near it when fired)
      const dx = G.armTarget.x - cam.pivot.x, dy = G.armTarget.y - cam.pivot.y, dz = G.armTarget.z - cam.pivot.z, dh = Math.hypot(dx, dz);
      if (dh > 4) {
        cam.yaw = angLerp(cam.yaw, Math.atan2(-dx, -dz), damp(1.6, rdt));
        const wantP = clamp(0.12 - Math.atan2(dy, dh) * 0.5, -0.45, 0.6);
        cam.pitch += (wantP - cam.pitch) * damp(1.2, rdt);
      }
    } else if (mode === 'vehicle' && cam.lookIdle > 1.3 && vObj) {
      vObj.getWorldDirection(_v2); // object +Z in world
      const fwdSign = v.camForwardSign ?? 1;
      const want = Math.atan2(-_v2.x * fwdSign, -_v2.z * fwdSign);
      cam.yaw = angLerp(cam.yaw, want, damp(hv > 1 ? 2.5 : 0.8, rdt));
      cam.pitch += ((v.camPitch ?? (v.kind === 'car' ? 0.21 : 0.22)) - cam.pitch) * damp(1.2, rdt);
    }
    cam.pitch = clamp(cam.pitch, -1.15, 1.35);

    // ---- distance / shoulder / fov per mode
    let dist = 4.3, shoulder = 0.55, up = 0.15, fov = cam.baseFov;
    const diveT = mode === 'wingsuit' ? clamp((-Math.atan2(vel.y, Math.hypot(vel.x, vel.z)) - 0.35) / 0.78, 0, 1) : 0;
    this.dive = (this.dive || 0) + (diveT - (this.dive || 0)) * damp(2.5, rdt);
    const spd = (a, b) => clamp((speed - a) / (b - a), 0, 1);
    switch (mode) {
      case 'aim': dist = 1.55; shoulder = 0.68; up = 0.18; fov = cam.aimOn ? cam.aimFov : 50; break;
      case 'airAim': dist = 2.6; shoulder = 0.75; fov = cam.aimOn ? Math.max(cam.aimFov, 40) : 56; break;
      case 'air': dist = 5.5; shoulder = 0.35; up = 0.3; fov += spd(7, 62) * 14; break;
      // reel: the boom rides off her right shoulder and a little high, so the line from her hand to the hook (dead ahead,
      // under the crosshair) runs diagonally across the frame instead of hiding behind her body
      case 'reel': dist = 5.5; shoulder = 1.7; up = 1.0; fov += spd(7, 62) * 10; break;
      case 'hang': dist = 4.6; shoulder = 0.5; up = 0.45; break;
      // chute: a long boom at about canopy height behind her, so the canopy reads as a thin arch over Sable across the
      // top third and the ground ahead fills the rest (Kyle: "canopy reads but the ground dominates"); player.js thins
      // the fabric only where it would cover the centre of the frame
      case 'parachute': dist = 9.4; shoulder = 0; up = 0.5; fov += 3 + spd(8, 30) * 6; break;
      // wingsuit: boom 5.5 -> 7.5 m and FOV 68 -> 85 across 20..70 m/s; a steep dive (dive 0..1 over 20..65 deg nose-down)
      // pulls the boom in to ~4.8 m and drops the high offset so she stays as big on screen as in level flight
      case 'wingsuit': { const k = spd(20, 70); dist = (5.5 + k * 2.0) * (1 - this.dive * 0.36); shoulder = 0; up = 0.55 - this.dive * 0.45; fov = cam.baseFov + 3 + k * (17 - this.dive * 5); break; }
      case 'swim': dist = 4.6; shoulder = 0.4; break;
      case 'dead': dist = 6.5; shoulder = 0; up = 0.6; break;
      case 'vehicle': {
        const car = v.kind === 'car' || v.kind === 'tank';
        dist = (v.camDistance ?? v.def?.camDistance ?? 8.5) + (car ? clamp(speed / 30, 0, 1) * 0.6 : 0); shoulder = 0;
        up = v.camUp ?? (car ? 1.0 : 0.6);
        if (car) fov += clamp((speed - 8) / 30, 0, 1) * 9; // speed FOV on top of the generic punch
        fov += spd(7, 62) * 14;
        break;
      }
      default: if (P.sprinting) { dist = 4.9; shoulder = 0.45; } fov += spd(7, 62) * 8;
    }
    if (mode !== 'aim' && mode !== 'airAim') {
      fov += this.reelK * 8 + this.reelPunch * 9;              // reel FOV punch (+ a spike at reel start)
      dist += this.reelPunch * 2.4;                            // yank the camera back as the line bites
      if (this.boostT > 0) fov += 4 * Math.min(1, this.boostT / 0.25);
      dist += this.reelK * (mode === 'reel' ? 0 : 0.6);       // reel -> next state eases instead of snapping in
    }
    if (P.proximity) fov += P.proximity * 6;
    fov += cam.fovExtra; cam.fovExtra *= 1 - damp(6, rdt);
    cam.dist += (dist - cam.dist) * damp(mode === 'aim' ? 12 : this.reelPunch > 0.3 ? 9 : mode === 'wingsuit' || mode === 'parachute' ? 2.2 : 4, rdt);
    this.shoulder = (this.shoulder ?? shoulder) + (shoulder - (this.shoulder ?? shoulder)) * damp(mode === 'aim' ? 12 : 5, rdt);
    this.up = (this.up ?? up) + (up - (this.up ?? up)) * damp(mode === 'aim' ? 8 : 3, rdt);
    cam.fov += (fov - cam.fov) * damp(fov > cam.fov ? (this.reelPunch > 0.2 ? 12 : 5) : mode === 'aim' || mode === 'airAim' ? 8 : 2.5, rdt);
    // vertical framing offset: orbit at pitch+frameOff, look at pitch -> the hero sits frameOff below the crosshair
    const frameT = mode === 'parachute' ? 0.06 : mode === 'wingsuit' ? 0.09 * (1 - this.dive * 0.7) : mode === 'reel' ? 0.05 : 0;
    this.frameOff += (frameT - this.frameOff) * damp(3, rdt);
    // pop kick: a small damped spring that lifts the camera on arrival
    this.kickV += (-70 * this.kickY - 11 * this.kickV) * rdt; this.kickY += this.kickV * rdt;

    // ---- desired position
    const opch = clamp(cam.pitch + this.frameOff, -1.3, 1.45);
    const cp = Math.cos(opch), sp = Math.sin(opch);
    const fwd = _v2.set(-Math.sin(cam.yaw) * cp, -sp, -Math.cos(cam.yaw) * cp); // orbit direction (= look when frameOff 0)
    const lookDir = new THREE.Vector3(-Math.sin(cam.yaw) * Math.cos(cam.pitch), -Math.sin(cam.pitch), -Math.cos(cam.yaw) * Math.cos(cam.pitch));
    const right = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
    const pivot = cam.pivot.clone().addScaledVector(right, this.shoulder); pivot.y += this.up;
    // collision: cast from the true pivot toward the shoulder pivot and the camera
    const toShoulder = pivot.clone().sub(cam.pivot);
    let pl = toShoulder.length();
    if (pl > 0.01) {
      const h = this.cast(game, cam.pivot, toShoulder.clone().divideScalar(pl), pl + 0.2, v?.body);
      if (h && h.timeOfImpact < pl + 0.2) pivot.copy(cam.pivot).addScaledVector(toShoulder, Math.max(0, (h.timeOfImpact - 0.2) / pl));
    }
    const back = fwd.clone().negate();
    let want = cam.dist;
    const fastR = mode === 'vehicle' ? 0.4 : mode === 'wingsuit' || mode === 'reel' ? 0.28 + clamp(speed / 70, 0, 1) * 0.17 : 0.28;
    const hitT = this.castThick(game, pivot, back, cam.dist + 0.3 + (mode === 'wingsuit' ? speed * 0.02 : 0), v?.body, fastR);
    // hanging and looking away from the wall: there is no room behind the hero, so the boom may go NEGATIVE (camera
    // slips past the head, out from the wall) rather than sitting inside the rock; the crane below lifts it over her
    if (hitT != null) want = mode === 'hang' ? Math.max(-0.7, hitT - 0.3 - fastR * 0.5) : Math.max(0.35, hitT - 0.25 - fastR * 0.5);
    // snap in fast, ease out slowly (no popping)
    if (want < cam.collideDist) cam.collideDist += (want - cam.collideDist) * (want < cam.collideDist - 1.2 ? 1 : damp(30, rdt)); else cam.collideDist += (want - cam.collideDist) * damp(3, rdt);
    const d = Math.min(cam.dist, cam.collideDist);
    const pos = pivot.clone().addScaledVector(back, d);
    const pos0 = pos.clone(); // pre-crane/terrain position: the look target hangs off this, so lifts tilt the view down
    // crane: when a wall/cliff squeezes the boom in (back to a wall, hanging on a wall while looking away)
    // the camera rises over the hero's head instead of ending up inside the body
    let craneW = 0;
    if (mode !== 'aim' && mode !== 'airAim' && mode !== 'vehicle') craneW = clamp((Math.min(2.2, cam.dist * 0.6) - d) / 1.6, 0, 1);
    this.crane += (craneW - this.crane) * damp(craneW > this.crane ? 10 : 3, rdt);
    let lift = this.crane * 1.5 + this.kickY;
    if (lift > 0.02) {
      const hu = this.cast(game, pos, _t1.set(0, 1, 0), lift + 0.3, v?.body);
      if (hu) lift = Math.max(0, Math.min(lift, hu.timeOfImpact - 0.3));
      pos.y += lift;
    } else if (lift < 0) pos.y += lift;
    // line of sight from the hero to the lens: the boom may have started from an offset pivot (shoulder, crane) or
    // gone negative; whatever it did, the lens must be reachable from the hero without crossing geometry
    {
      const los = _t1.subVectors(pos, cam.pivot), L = los.length();
      if (L > 0.05) {
        los.divideScalar(L);
        const h = this.cast(game, cam.pivot, los, L + 0.3, v?.body);
        if (h && h.timeOfImpact < L + 0.3) pos.copy(cam.pivot).addScaledVector(los, Math.max(0, h.timeOfImpact - 0.3));
      }
    }
    // lateral clearance: the boom casts only look along the boom, so a cliff face running ALONGSIDE it (wingsuiting a
    // mountain face, hanging with the camera swung along the wall) can still graze the lens. Probe sideways/up/down
    // in the camera frame and push the lens off anything closer than 0.45 m.
    if (mode !== 'vehicle') {
      const upc = _t2.crossVectors(right, fwd).normalize();
      for (let k = 0; k < 4; k++) {
        const dir = _t3.copy(k < 2 ? right : upc).multiplyScalar(k % 2 ? -1 : 1);
        const h = this.cast(game, pos, dir, 0.45, v?.body);
        if (h && h.timeOfImpact > 1e-3 && h.timeOfImpact < 0.45) pos.addScaledVector(dir, -(0.45 - h.timeOfImpact));
      }
    }
    // terrain clamp: never below ground (+0.5), measured along the slope normal so a steep face can't sit 5 cm
    // from the lens while the camera is "0.5 m above" the ground straight down
    let g = hAt(pos.x, pos.z);
    if (pos.y < g + 4) {
      const gx = (hAt(pos.x + 0.75, pos.z) - hAt(pos.x - 0.75, pos.z)) / 1.5, gz = (hAt(pos.x, pos.z + 0.75) - hAt(pos.x, pos.z - 0.75)) / 1.5;
      const nl = Math.hypot(gx, 1, gz), ny = 1 / nl, perp = (pos.y - g) * ny;
      if (perp < 0.55) { const k = 0.55 - perp; pos.x += -gx / nl * k; pos.y += ny * k; pos.z += -gz / nl * k; g = hAt(pos.x, pos.z); }
    }
    if (pos.y < g + 0.5) pos.y = g + 0.5;
    const wh = game.gfx?.waterHeightAt?.(pos.x, pos.z) ?? (world ? (world.seaLevel ?? 0) : -1e9);
    if (mode !== 'swim' && pos.y < wh + 0.25 && pivot.y > wh) pos.y = wh + 0.25;

    camera.position.copy(pos);
    const target = pos0.addScaledVector(lookDir, 10 + d);
    target.y += this.kickY * 0.6 - this.crane * 0.4; // craned: tilt a little down over the shoulder onto the hero
    camera.lookAt(target);

    // ---- shake (trauma^2) + speed buffeting (wingsuit, reel)
    const buffet = mode === 'wingsuit' ? spd(30, 72) ** 1.5 * 0.3 + (P.proximity || 0) * 0.3 : this.reelK * spd(20, 45) * 0.1 + this.reelPunch * 0.15;
    cam.trauma = Math.max(0, cam.trauma - rdt * 1.3);
    const s = cam.trauma * cam.trauma;
    const t = game.simTime;
    if (s > 0.0001) {
      camera.rotateX(noise(t * 9, 1) * 0.06 * s); camera.rotateY(noise(t * 9, 7) * 0.06 * s); camera.rotateZ(noise(t * 9, 13) * 0.08 * s);
    }
    if (buffet > 0.001) { // higher-frequency, smaller: air hammering the lens, not a hand-held wobble
      const b = buffet * 0.035;
      camera.rotateX(noise(t * 23, 3) * b); camera.rotateY(noise(t * 19, 11) * b * 0.7); camera.rotateZ(noise(t * 15, 17) * b * 0.6);
    }
    this.bankS += (((mode === 'wingsuit' ? P.bank : 0) || 0) - this.bankS) * damp(4, rdt);
    if (Math.abs(this.bankS) > 0.001) camera.rotateZ(-this.bankS * 0.16);

    if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();

    // ---- aim ray through the crosshair (screen centre) + first hit
    camera.getWorldDirection(cam.aimRay.direction);
    cam.aimRay.origin.copy(camera.position);
    // start the query at the player's depth so walls behind the hero never steal the aim
    const skip = Math.max(0, d - 0.2);
    const o = cam.aimRay.origin.clone().addScaledVector(cam.aimRay.direction, skip);
    const ah = this.cast(game, o, cam.aimRay.direction, 1500, mode === 'vehicle' ? v?.body : undefined);
    if (ah) {
      cam.aimPoint.copy(o).addScaledVector(cam.aimRay.direction, ah.timeOfImpact);
      cam.aimHit = { point: cam.aimPoint.clone(), normal: new THREE.Vector3(ah.normal.x, ah.normal.y, ah.normal.z), collider: ah.collider, distance: ah.timeOfImpact + skip };
    } else {
      // heightfield fallback (world without colliders yet): march the terrain
      let found = false;
      if (world?.heightAt) {
        for (let t = 2; t < 900; t *= 1.08) {
          const px = o.x + cam.aimRay.direction.x * t, py = o.y + cam.aimRay.direction.y * t, pz = o.z + cam.aimRay.direction.z * t;
          if (py < world.heightAt(px, pz)) { cam.aimPoint.set(px, world.heightAt(px, pz), pz); found = true; break; }
        }
      }
      if (!found) cam.aimPoint.copy(o).addScaledVector(cam.aimRay.direction, 600);
      cam.aimHit = found ? { point: cam.aimPoint.clone(), normal: new THREE.Vector3(0, 1, 0), collider: null, distance: o.distanceTo(cam.aimPoint) + skip } : null;
    }

    this.updateStreaks(game, rdt, vel, speed, mode);
  },

  updateStreaks(game, dt, vel, speed, mode) {
    const st = this.streaks, camera = game.camera, P = game.player, prox = P?.proximity || 0;
    const fly = mode === 'wingsuit' || mode === 'air' || mode === 'reel' || mode === 'parachute';
    // streak strength: faint at 35 m/s, busy at 55, screaming by 70; plus reel pull, glide boost and terrain skimming
    let strength = clamp((speed - 30) / 40, 0, 1) * (mode === 'vehicle' ? 0.45 : 1);
    strength = Math.max(strength, this.reelK * clamp((speed - 12) / 20, 0, 1) * 0.95, this.boostT > 0 ? 1 : 0);
    strength = Math.min(1.3, strength + prox * 0.5);
    if (mode === 'aim' || mode === 'airAim' || speed < 8) strength = 0;
    // edge overlay (radial lines + vignette): only for real speed in the air, never on foot / in vehicles / aiming
    let oi = fly ? clamp((speed - 45) / 27, 0, 1) + prox * 0.55 + (this.boostT > 0 ? 0.35 : 0) + this.reelPunch * 0.35 : 0;
    oi = clamp(oi, 0, 1.15);
    this.overI += (oi - this.overI) * damp(oi > this.overI ? 5 : 2.5, dt);
    const om = this.overlayMat.uniforms;
    om.uI.value = this.overI * 0.35; om.uT.value = (om.uT.value + dt * (0.5 + speed / 45)) % 1000; om.uAspect.value = camera.aspect || 16 / 9;
    this.overlay.visible = this.overI > 0.01;
    game.cam.fxDebug = { streaks: +strength.toFixed(2), overlay: +this.overI.toFixed(2), punch: +this.reelPunch.toFixed(2), frameOff: +this.frameOff.toFixed(3) };
    const op = Math.min(1, strength) * 0.11; // a faint hint of rushing air at the edges, never an overlay
    st.material.opacity += (op - st.material.opacity) * damp(op > st.material.opacity ? 6 : 3, dt);
    st.visible = st.material.opacity > 0.01;
    if (!st.visible) return;
    const m = this._m || (this._m = new THREE.Matrix4()), q = this._q || (this._q = new THREE.Quaternion()), sc = _t2.set(1, 1, 1);
    const dir = _t3.copy(vel).normalize();
    q.setFromUnitVectors(_t1.set(0, 1, 0), dir);
    // two axes perpendicular to travel for the hollow spawn cylinder
    const ax = this._ax || (this._ax = new THREE.Vector3()), ay = this._ay || (this._ay = new THREE.Vector3());
    ax.set(0, 1, 0).cross(dir); if (ax.lengthSq() < 1e-4) ax.set(1, 0, 0); ax.normalize(); ay.crossVectors(dir, ax).normalize();
    const col = this._c || (this._c = new THREE.Color()), ndc = this._ndc || (this._ndc = new THREE.Vector3());
    const sk = Math.min(1, strength);
    const len = 0.5 + Math.min(speed, 90) * (0.016 + sk * 0.01);
    const live = Math.round(this.sp.length * clamp(0.15 + 0.35 * sk, 0, 1)); // density climbs with speed (half the pool at most)
    for (let i = 0; i < this.sp.length; i++) {
      const p = this.sp[i];
      p.life -= dt;
      const rel = _v.subVectors(p.p, camera.position);
      if (p.life <= 0 || rel.dot(dir) < -4 || rel.lengthSq() > 900) {
        // respawn ahead of the camera in a hollow cylinder around the travel line; skimming the ground packs
        // extra streaks into the lower (ground) side so the rush reads from below
        let a = Math.random() * Math.PI * 2;
        if (prox > 0.15 && Math.random() < prox * 0.6) a = Math.PI + Math.random() * Math.PI;
        const r = 3.2 + Math.random() * (5.5 - sk * 1.0);
        p.p.copy(camera.position).addScaledVector(dir, 6 + Math.random() * 16).addScaledVector(ax, Math.cos(a) * r).addScaledVector(ay, Math.sin(a) * r);
        p.life = 0.45 + Math.random() * 0.55; p.w = 0.5 + Math.random() * 0.8; p.age = 0;
      }
      p.age = (p.age || 0) + dt;
      p.p.addScaledVector(vel, -dt * (0.4 + sk * 0.25)); // streaks move relative to the (already moving) camera
      sc.set(p.w * (1 + sk * 0.9), len * (0.7 + p.w * 0.5), 1);
      m.compose(p.p, q, sc); st.setMatrixAt(i, m);
      // screen-space mask: nothing in the middle of the frame, fade in/out over life
      ndc.copy(p.p).project(camera);
      const rr = Math.hypot(ndc.x * 0.9, ndc.y * 1.1);
      const edge = ndc.z > 1 ? 0 : clamp((rr - (0.44 - sk * 0.06)) / 0.36, 0, 1);
      const lifeK = Math.min(1, p.age * 6) * Math.min(1, p.life * 4);
      const k = i < live ? edge * lifeK * p.w : 0;
      st.setColorAt(i, col.setRGB(k, k, k));
    }
    st.instanceMatrix.needsUpdate = true;
    if (st.instanceColor) st.instanceColor.needsUpdate = true;
  },

  // pick a scenic town once: near the coast, with high ground behind it; camera sits over the water side
  scenic(game) {
    const world = game.world; if (!world?.heightAt) return null;
    const hAt = (x, z) => world.heightAt(x, z), wet = (x, z) => (world.isWater ? world.isWater(x, z) : hAt(x, z) < (world.seaLevel ?? 0));
    let best = null;
    for (const st of world.settlements || []) {
      const p = st.pos || st.center || st.position || st; const x = p.x, z = p.z ?? p.y; if (!Number.isFinite(x + z)) continue;
      if (st.military) continue;
      let sea = null, seaD = 1e9, peak = -1e9, peakA = 0;
      for (let k = 0; k < 24; k++) {
        const a = k / 24 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        for (let r = 80; r <= 900; r += 60) if (wet(x + ca * r, z + sa * r)) { if (r < seaD) { seaD = r; sea = a; } break; }
        for (let r = 300; r <= 1500; r += 300) { const hh = hAt(x + ca * r, z + sa * r); if (hh > peak) { peak = hh; peakA = a; } }
      }
      if (sea == null) continue;
      const opp = Math.abs(Math.cos(peakA - sea - Math.PI)); // mountains roughly behind the town, seen from the sea
      const score = peak - hAt(x, z) - seaD * 0.3 + opp * 120 + (st.size || st.radius || 0) * 0.2;
      if (!best || score > best.score) best = { x, z, sea, peak, peakA, score, y: hAt(x, z), name: st.name };
    }
    return best;
  },

  titleOrbit(game, dt) {
    const camera = game.camera, world = game.world, cam = game.cam;
    this.titleT += dt;
    if (!this.spot && world?.settlements?.length) {
      this.spot = this.scenic(game) || { x: 0, z: 0, sea: 0, y: world.heightAt?.(0, 0) ?? 0 };
      cam.titleSpot = this.spot;
      // golden hour for the title shot (gfx owns the clock; this only sets it once)
      if (!this.goldenSet && game.gfx?.setTimeOfDay) { this.goldenSet = true; try { game.gfx.setTimeOfDay(17.4); } catch {} }
    }
    const S = this.spot;
    let x, y, z, lx, ly, lz;
    if (S && !this.shot) {
      // key-art framing, chosen once: camera out over the water looking back at the shore town with the peaks behind;
      // prefer a side-lit angle (sun to one side of the view) and a camera spot that is open sea
      const wet = (px, pz) => (world.isWater ? world.isWater(px, pz) : world.heightAt(px, pz) < (world.seaLevel ?? 0));
      const sd = game.gfx?.sunDir; const sunAz = sd ? Math.atan2(sd.z, sd.x) : 0;
      let best = null;
      for (let k = -8; k <= 8; k++) {
        const a = S.sea + k * 0.1;
        for (const R of [620, 760, 900]) {
          const cx = S.x + Math.cos(a) * R, cz = S.z + Math.sin(a) * R;
          let open = 0; for (let q = 0; q < 6; q++) { const qa = a + (q - 2.5) * 0.25; if (wet(cx + Math.cos(qa) * 120, cz + Math.sin(qa) * 120)) open++; }
          if (!wet(cx, cz)) continue;
          const view = a + Math.PI; // view direction (camera -> town)
          const side = Math.abs(Math.sin(view - sunAz)), front = Math.cos(view - sunAz); // front>0: looking into the sun
          const score = open * 2 + side * 4 - Math.max(0, front) * 5 - Math.abs(k) * 0.15 - Math.abs(R - 760) * 0.004;
          if (!best || score > best.score) best = { a, R, score };
        }
      }
      this.shot = best || { a: S.sea, R: 700 };
    }
    if (S) {
      // slow lateral drift + gentle push-in; horizon sits in the upper third, peaks behind the town
      const t = this.titleT, sh = this.shot;
      const a = sh.a + Math.sin(t * 0.03) * 0.2;
      const R = sh.R - 60 + Math.cos(t * 0.045) * 60;
      x = S.x + Math.cos(a) * R; z = S.z + Math.sin(a) * R;
      const g = world.heightAt?.(x, z) ?? 0;
      y = Math.max(g + 50, (world.seaLevel ?? 0) + 135 + Math.sin(t * 0.06) * 18);
      lx = S.x - Math.cos(a) * 140; lz = S.z - Math.sin(a) * 140; ly = S.y + 105; // aim above the town so it sits under the logo, not behind it
    } else {
      const size = world?.size || 4000, R = size * 0.28, a = this.titleT * 0.025 + 0.6;
      x = Math.cos(a) * R; z = Math.sin(a) * R;
      y = Math.max((world?.heightAt?.(x, z) ?? 0) + 140, 300);
      lx = Math.cos(a + 0.9) * R * 0.25; lz = Math.sin(a + 0.9) * R * 0.25; ly = (world?.heightAt?.(lx, lz) ?? 0) + 30;
    }
    camera.position.set(x, y, z);
    camera.lookAt(lx, ly, lz);
    if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
    cam.fov = 55;
    cam.aimRay.origin.copy(camera.position); camera.getWorldDirection(cam.aimRay.direction);
    // keep yaw such that play starts looking the way the player faces
    if (game.player?.facing != null) cam.yaw = game.player.facing + Math.PI;
    this.streaks.visible = false; if (this.overlay) { this.overlay.visible = false; this.overI = 0; }
  },
};
