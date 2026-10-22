// Landmarks: three silhouettes that give Corvana an identity from the air and from far away.
//  * The Vask Colossus — a 45 m bronze General Vask on a stepped granite plinth on a sea headland (destructible chaos target)
//  * Faro di Sant'Orsola — a red/white lighthouse on another island's point, sweeping beam at night
//  * Monte Corvo relay mast — a 90 m red/white lattice radio mast on the highest peak, blinking aviation lights
// All merged geometry (a handful of draw calls each). Exposes game.world.landmarks [{id, name, x, y, z, view}].
import * as THREE from 'three';
import { Bag, Frame, G, getMaterials, MB } from './buildings/kit.js';

function coastal(T, x, z, r) { let wet = 0; for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; if (T.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r) < -1) wet++; } return wet; }
function seaward(T, x, z, r) { // yaw (THREE, local +z) facing the lowest ground direction
  let best = 0, bh = Infinity;
  for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2, h = T.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r); if (h < bh) { bh = h; best = a; } }
  const dx = Math.cos(best), dz = Math.sin(best); return Math.atan2(dx, dz);
}

// General Vask, ~8.3 units tall (x6 in the world): boots, flared greatcoat, belted tunic, epaulettes, peaked cap,
// right arm raised in a salute toward the sea, left hand resting on a sabre.
function colossusGeom() {
  const mb = new MB(), F = new Frame(0, 0, 0, 0), c = 0x8a6a3a, d = 0x6e5230, gold = 0xb08a40;
  const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
  for (const sx of [-1, 1]) { F.box(mb, sx * 0.38, 0.3, 0.12, 0.5, 0.6, 0.95, d); }
  F.geo(mb, cyl(0.78, 1.18, 3.6, 14), 0, 2.35, 0, 0, 1, 1, 0.78, c);            // greatcoat skirt, flared
  F.box(mb, 0, 2.3, 0.86, 0.12, 3.4, 0.1, d);                                 // coat split
  F.geo(mb, cyl(0.86, 0.84, 0.28, 14), 0, 4.15, 0, 0, 1, 1, 0.8, d);         // belt
  F.box(mb, 0, 4.15, 0.68, 0.3, 0.24, 0.1, gold);                             // buckle
  F.geo(mb, cyl(1.02, 0.82, 1.8, 14), 0, 5.15, 0, 0, 1, 1, 0.72, c);         // tunic / chest
  for (let k = 0; k < 6; k++) F.box(mb, -0.45 + (k % 3) * 0.16, 5.35 - Math.floor(k / 3) * 0.2, 0.74, 0.12, 0.16, 0.06, gold); // medals
  F.box(mb, 0, 6.08, 0, 2.3, 0.32, 1.05, c);                                  // shoulders
  for (const sx of [-1, 1]) F.box(mb, sx * 1.05, 6.28, 0, 0.5, 0.12, 0.62, gold); // epaulettes
  F.geo(mb, G.cyl12, 0, 6.38, 0, 0, 0.55, 0.42, 0.55, c);                    // collar
  F.geo(mb, G.sphere, 0, 6.95, 0.04, 0, 1.0, 1.15, 1.02, c);                 // head
  F.geo(mb, G.cyl12, 0, 7.5, 0.02, 0, 1.2, 0.34, 1.25, d);                   // cap band
  F.geo(mb, G.cyl12, 0, 7.72, -0.04, 0, 1.45, 0.14, 1.55, c, false, -0.12);  // cap crown
  F.box(mb, 0, 7.38, 0.62, 0.95, 0.06, 0.42, d, 0, 0.25);                     // visor
  F.box(mb, 0, 7.55, 0.64, 0.2, 0.2, 0.05, gold);                             // cap badge
  // right arm raised (salute toward the sea), left arm down to the sabre hilt
  F.beam(mb, [1.15, 5.95, 0], [1.75, 7.0, 0.25], 0.3, c, G.cyl12); F.geo(mb, G.sphere, 1.75, 7.0, 0.25, 0, 0.62, 0.62, 0.62, c);
  F.beam(mb, [1.75, 7.0, 0.25], [1.95, 8.25, 0.55], 0.25, c, G.cyl12); F.geo(mb, G.sphere, 1.97, 8.35, 0.58, 0, 0.62, 0.7, 0.55, c);
  F.beam(mb, [-1.15, 5.95, 0], [-1.38, 4.6, 0.1], 0.3, c, G.cyl12); F.geo(mb, G.sphere, -1.38, 4.6, 0.1, 0, 0.6, 0.6, 0.6, c);
  F.beam(mb, [-1.38, 4.6, 0.1], [-1.05, 3.85, 0.45], 0.25, c, G.cyl12); F.geo(mb, G.sphere, -1.03, 3.8, 0.47, 0, 0.55, 0.55, 0.55, c);
  F.beam(mb, [-1.0, 3.75, 0.5], [-1.35, 0.9, 0.75], 0.09, d, G.cyl8);        // sabre scabbard
  F.box(mb, 0, 0.0, 0, 2.6, 0.12, 2.2, d);                                    // footing
  return mb.geometry();
}

export function buildLandmarks(game, T, sites) {
  const world = game.world, mats = getMaterials(), phys = game.physics, RAP = game.RAPIER;
  const root = new THREE.Group(); root.name = 'landmarks'; game.scene.add(root);
  const out = world.landmarks = [];
  const nearSite = (x, z, pad) => sites.some(s => Math.hypot(s.x - x, s.z - z) < (s.radius || 60) + pad);
  const nearRoad = (x, z, d) => (T.roadMaskAt?.(x, z) ?? 1e9) < d;
  const coll = (x, y, z, hx, hy, hz, rotY = 0) => {
    if (!phys || !RAP) return null;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0));
    return phys.createCollider(RAP.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
  };
  const sp = world.spawnPoint || new THREE.Vector3();
  const HALF = world.half || 4096;
  const search = (score) => { // coarse grid search over the map
    let best = null, bs = -Infinity;
    for (let z = -HALF + 100; z < HALF - 100; z += 40) for (let x = -HALF + 100; x < HALF - 100; x += 40) {
      const s = score(x, z); if (s > bs) { bs = s; best = { x, z }; }
    }
    return best;
  };
  const used = [];
  const farFromUsed = (x, z, d) => used.every(u => Math.hypot(u.x - x, u.z - z) > d);

  // ---------------- 1. Vask Colossus: headland 500-1600 m from the spawn beach, so it is on the horizon at start
  {
    const p = search((x, z) => {
      const d = Math.hypot(x - sp.x, z - sp.z); if (d < 450 || d > 1700) return -Infinity;
      const h = T.heightAt(x, z); if (h < 18 || h > 140 || T.slopeAt(x, z) > 0.22) return -Infinity;
      if (nearSite(x, z, 140) || nearRoad(x, z, 30)) return -Infinity;
      const wet = coastal(T, x, z, 160); if (wet < 3) return -Infinity;
      return h * 0.6 + wet * 6 - Math.abs(d - 900) * 0.05;
    });
    if (p) {
      used.push(p);
      const rot = seaward(T, p.x, p.z, 120), F0 = new Frame(p.x, 0, p.z, rot);
      let gy = Infinity; for (const [lx, lz] of [[-16, -16], [16, -16], [16, 16], [-16, 16], [0, 0]]) { const [x, z] = F0.w(lx, lz); gy = Math.min(gy, T.heightAt(x, z)); }
      const F = new Frame(p.x, gy - 2, p.z, rot), bag = new Bag(mats);
      const steps = [[34, 5, 0xb9b2a4], [26, 6, 0xc8c0b0], [18, 9, 0xd2cab9]]; let y = 0;
      for (const [w, h, c] of steps) { F.box(bag.get('stone'), 0, y + h / 2, 0, w, h, w, c); y += h; }
      F.box(bag.get('stone'), 0, y + 0.6, 0, 19.5, 1.2, 19.5, 0x9e9788); y += 1.2; // cornice
      F.box(bag.get('bronze'), 0, 12, 9.05, 10, 3, 0.3, 0x6a5230); // dedication plaque
      for (const s of [-1, 1]) F.geo(bag.get('bronze'), G.cyl12, s * 13, 6, 13.2, 0, 1.6, 12, 1.6, 0x5a4428); // flanking braziers
      bag.meshes(root);
      for (let i = 0, yy = 0; i < steps.length; i++) { const [w, h] = steps[i]; coll(p.x, gy - 2 + yy + h / 2, p.z, w / 2, h / 2, w / 2, rot); yy += h; }
      const topY = gy - 2 + y, S = 6;
      const obj = new THREE.Group(); obj.name = 'vaskColossus'; obj.position.set(p.x, topY, p.z); obj.rotation.y = rot; obj.scale.setScalar(S);
      const intact = new THREE.Group(); obj.add(intact);
      { const m = new THREE.Mesh(colossusGeom(), mats.bronze); m.castShadow = true; m.receiveShadow = true; intact.add(m); }
      root.add(obj); obj.updateMatrixWorld(true);
      const ud = obj.userData;
      ud.destructible = { hp: 2400, maxHp: 2400, kind: 'statue', chaos: 5000, counts: false, id: 'landmark:colossus' };
      ud.intact = intact;
      ud.collider = coll(p.x, topY + 4.5 * S, p.z, 1.6 * S, 4.5 * S, 1.6 * S, rot);
      world.registerDestructible?.(obj);
      game.events?.on?.('destructible:destroyed', e => {
        if (e?.obj !== obj) return;
        for (let k = 0; k < 5; k++) setTimeout(() => { try { game.fx?.explosion?.(new THREE.Vector3(p.x + (Math.random() - 0.5) * 14, topY + 4 + k * 8, p.z + (Math.random() - 0.5) * 14), 4); } catch (err) { /* optional */ } }, k * 180);
        try { game.gfx?.shakeAt?.(obj.position, 2, 1.2, 600); } catch (err) { /* optional */ }
      });
      const fx = Math.sin(rot), fz = Math.cos(rot);
      out.push({ id: 'colossus', name: 'The Vask Colossus', x: p.x, y: topY, z: p.z, obj, view: [fx * 110 + fz * 50, 45, fz * 110 - fx * 50, 30] });
    }
  }

  // ---------------- 2. Lighthouse on the most remote rocky point of another island
  {
    const isl = T.islands.slice(0, 3);
    const p = search((x, z) => {
      const h = T.heightAt(x, z); if (h < 4 || h > 45 || T.slopeAt(x, z) > 0.3) return -Infinity;
      if (nearSite(x, z, 120) || nearRoad(x, z, 15) || !farFromUsed(x, z, 1500)) return -Infinity;
      const wet = coastal(T, x, z, 90); if (wet < 5) return -Infinity;
      const ci = isl.reduce((b, is, i) => Math.hypot(is.x - x, is.z - z) < Math.hypot(isl[b].x - x, isl[b].z - z) ? i : b, 0);
      const home = isl.reduce((b, is, i) => Math.hypot(is.x - sp.x, is.z - sp.z) < Math.hypot(isl[b].x - sp.x, isl[b].z - sp.z) ? i : b, 0);
      return wet * 4 + Math.hypot(x - isl[ci].x, z - isl[ci].z) * 0.02 + (ci !== home ? 40 : 0) - Math.abs(Math.hypot(x - sp.x, z - sp.z) - 2200) * 0.01;
    });
    if (p) {
      used.push(p);
      const gy = Math.min(T.heightAt(p.x, p.z), T.heightAt(p.x + 4, p.z), T.heightAt(p.x - 4, p.z), T.heightAt(p.x, p.z + 4), T.heightAt(p.x, p.z - 4)) - 0.5;
      const rot = seaward(T, p.x, p.z, 60), F = new Frame(p.x, gy, p.z, rot), bag = new Bag(mats);
      F.geo(bag.get('stone'), G.cyl24, 0, 1.5, 0, 0, 11, 3, 11, 0xbdb6a6); // rock-cut base
      const H = 30, bands = 6;
      for (let i = 0; i < bands; i++) { // tapered banded tower
        const y0 = 3 + i * H / bands, r0 = 3.4 - 1.2 * (i / bands), r1 = 3.4 - 1.2 * ((i + 1) / bands);
        const g = new THREE.CylinderGeometry(r1, r0, H / bands, 20); F.geo(bag.get('plaster'), g, 0, y0 + H / bands / 2, 0, 0, 1, 1, 1, i % 2 ? 0xb3261e : 0xf2eee4);
      }
      const top = 3 + H;
      F.geo(bag.get('metal'), G.cyl24, 0, top + 0.2, 0, 0, 6.4, 0.4, 6.4, 0x2a2c2e); // gallery
      for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; F.box(bag.get('metal'), Math.cos(a) * 3.1, top + 0.9, Math.sin(a) * 3.1, 0.08, 1.1, 0.08, 0x2a2c2e); }
      F.geo(bag.get('metal'), G.cyl24, 0, top + 1.45, 0, 0, 6.3, 0.08, 6.3, 0x2a2c2e);
      F.geo(bag.get('glassLit'), G.cyl12, 0, top + 2.2, 0, 0, 3.4, 3.2, 3.4, 0xffffff);
      F.geo(bag.get('metal'), G.dome, 0, top + 3.8, 0, 0, 3.8, 2.4, 3.8, 0xa3221b);
      F.geo(bag.get('metal'), G.cone8, 0, top + 5.3, 0, 0, 0.3, 1.2, 0.3, 0x2a2c2e);
      // keeper's cottage
      F.box(bag.get('plaster'), 0, 3 + 2, -9, 9, 4, 6, 0xf2eee4); F.geo(bag.get('roof'), G.pyr4, 0, 3 + 5.2, -9, 0, 7.2, 2.4, 4.8, 0xffffff);
      bag.meshes(root);
      coll(p.x, gy + 1.5, p.z, 5.5, 1.5, 5.5, rot); coll(p.x, gy + 3 + H / 2, p.z, 2.6, H / 2, 2.6, rot);
      // night beam: two additive cones rotating around the lantern
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
      const bg = new THREE.CylinderGeometry(0.4, 14, 260, 16, 1, true); bg.translate(0, 130, 0); bg.rotateZ(-Math.PI / 2 + 0.03);
      const beam = new THREE.Group(); beam.position.set(p.x, gy + top + 2.2, p.z);
      for (const s of [0, Math.PI]) { const m = new THREE.Mesh(bg, beamMat); m.rotation.y = s; m.renderOrder = 6; beam.add(m); }
      beam.visible = false; root.add(beam);
      out.push({ id: 'lighthouse', name: "Faro di Sant'Orsola", x: p.x, y: gy + top, z: p.z, beam, beamMat, view: [Math.sin(rot) * 70 + 30, 25, Math.cos(rot) * 70 - 20, 18] });
    }
  }

  // ---------------- 3. Relay mast on the highest summit
  {
    const p = search((x, z) => {
      if (nearSite(x, z, 80) || !farFromUsed(x, z, 800)) return -Infinity;
      return T.heightAt(x, z) - T.slopeAt(x, z) * 200;
    });
    if (p) {
      // settle on the actual local max
      let bx = p.x, bz = p.z, bh = T.heightAt(p.x, p.z);
      for (let k = 0; k < 64; k++) { const a = k * 2.399, r = Math.sqrt(k) * 6, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r, h = T.heightAt(x, z); if (h > bh) { bh = h; bx = x; bz = z; } }
      used.push({ x: bx, z: bz });
      let gy = Infinity; for (const [ox, oz] of [[-5, -5], [5, -5], [5, 5], [-5, 5]]) gy = Math.min(gy, T.heightAt(bx + ox, bz + oz));
      const F = new Frame(bx, gy - 0.5, bz, 0.3), mb = new MB(), bag = new Bag(mats), H = 90, segs = 15;
      for (let i = 0; i < segs; i++) {
        const y0 = i * H / segs, y1 = y0 + H / segs, k0 = 4.5 * (1 - 0.75 * y0 / H), k1 = 4.5 * (1 - 0.75 * y1 / H), c = i % 2 ? 0xc8231c : 0xf0ece4;
        const P = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        for (let j = 0; j < 4; j++) {
          const [ax, az] = P[j], [cx, cz] = P[(j + 1) % 4];
          F.beam(mb, [ax * k0, y0, az * k0], [ax * k1, y1, az * k1], 0.22, c);
          F.beam(mb, [ax * k0, y0, az * k0], [cx * k1, y1, cz * k1], 0.08, c);
          F.beam(mb, [ax * k1, y1, az * k1], [cx * k1, y1, cz * k1], 0.1, c);
        }
      }
      const metal = new THREE.Mesh(mb.geometry(), mats.paint); metal.castShadow = true; metal.receiveShadow = true; metal.matrixAutoUpdate = false; root.add(metal);
      F.geo(bag.get('metal'), G.cyl8, 0, H + 6, 0, 0, 0.35, 12, 0.35, 0xf0ece4); // whip antenna
      for (const [y, s] of [[H * 0.35, 1], [H * 0.68, 1], [H + 12, 1.4]]) F.geo(bag.get('redLight'), G.sphere, 0, y, 0, 0, s, s, s, 0xffffff);
      for (const a of [0, 2.1, 4.2]) { const r = 1.6; F.geo(bag.get('metal'), G.cyl12, Math.cos(a) * r, H * 0.55, Math.sin(a) * r, -a, 2.2, 0.5, 2.2, 0xdcdcdc, false, Math.PI / 2); }
      F.box(bag.get('concrete'), 9, 2, 0, 7, 4, 5, 0xc8c2b4); F.box(bag.get('metal'), 9, 4.2, 0, 7.6, 0.3, 5.6, 0x5a5f3c);
      F.box(bag.get('concrete'), 0, 0.3, 0, 12, 0.6, 12, 0xa8a49a);
      bag.meshes(root);
      coll(bx, gy + H / 2, bz, 2.5, H / 2, 2.5, 0.3);
      out.push({ id: 'mast', name: 'Monte Corvo relay mast', x: bx, y: gy, z: bz, view: [140, 60, 90, 45] });
    }
  }

  // per-frame: lighthouse beam at night
  const lh = out.find(l => l.id === 'lighthouse');
  return {
    root,
    update(dt) {
      if (!lh) return;
      const sd = game.gfx?.sunDir, night = sd ? THREE.MathUtils.clamp(0.15 - sd.y * 4, 0, 1) : 0;
      lh.beam.visible = night > 0.02; lh.beamMat.opacity = night * 0.22;
      if (lh.beam.visible) lh.beam.rotation.y += dt * 0.9;
    },
  };
}
