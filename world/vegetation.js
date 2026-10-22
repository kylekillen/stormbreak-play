// Vegetation: deterministic scatter (pines, olives incl. orchards, cypresses, palms, bushes, rocks),
// near full-detail instanced meshes (wind-swayed, shadowed) rebuilt as the camera moves, far low-poly
// LOD instanced over the whole map (hidden inside the near radius in the vertex shader),
// GPU grass field around the camera, and pooled Rapier trunk colliders near the player.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, makeNoise, smoothstep } from './noise.js';

const NEAR = 340, CELLV = 128;

export function createVegetation(game, terrain, sites) {
  const THREE = game.THREE, HALF = 4096;
  const rnd = mulberry32(game.seed * 97 + 3), nz = makeNoise(game.seed + 404);
  const time = { value: 0 }, camU = { value: new THREE.Vector3() };
  // quality tier is read once at build time (gfx initialises before world); 'low' thins grass and far pines
  const LOW = game.gfx?.quality === 'low';

  // ---------- geometry builders ----------
  const col = (g, c, jit = 0.08, r = rnd) => {
    g = g.index ? g.toNonIndexed() : g;
    const n = g.attributes.position.count, a = new Float32Array(n * 3), cc = new THREE.Color(c);
    for (let i = 0; i < n; i += 3) { const k = 1 - jit + r() * jit * 2; for (let v = 0; v < 3; v++) { a[(i + v) * 3] = cc.r * k; a[(i + v) * 3 + 1] = cc.g * k; a[(i + v) * 3 + 2] = cc.b * k; } }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g;
  };
  const lumpy = (g, amt, f = 1.3) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const d = 1 + nz.n2(x * f + y * 0.7, z * f - y * 0.5) * amt; p.setXYZ(i, x * d, y * (1 + (d - 1) * 0.5), z * d); } g.computeVertexNormals(); return g; };
  const at = (g, x, y, z, s = [1, 1, 1], ry = 0, rx = 0) => { g.scale(...s); g.rotateX(rx); g.rotateY(ry); g.translate(x, y, z); return g; };
  const bark = 0x5a4632;
  function pine(lo) {
    const parts = [col(at(new THREE.CylinderGeometry(0.18, 0.38, 9, lo ? 4 : 7), 0, 4.5, 0), bark)];
    const tiers = lo ? 2 : 6;
    for (let t = 0; t < tiers; t++) {
      const f = t / tiers, r = 3.2 * (1 - f) + 0.6, y = 3.2 + f * 9;
      let c = new THREE.ConeGeometry(r, 4.2 - f * 1.5, lo ? 5 : 9, 1, !lo);
      if (!lo) lumpy(c, 0.18, 0.8);
      parts.push(col(at(c, 0, y + 1.8, 0, [1, 1, 1], t * 1.3), new THREE.Color(0x2c4a2a).offsetHSL(0, 0, f * 0.05), 0.12));
    }
    return mergeGeometries(parts);
  }
  function olive(lo) {
    const parts = [];
    const tr = new THREE.CylinderGeometry(0.22, 0.42, 2.6, lo ? 4 : 7, lo ? 1 : 4); if (!lo) lumpy(tr, 0.25, 2.5);
    parts.push(col(at(tr, 0, 1.3, 0, [1, 1, 1], 0, 0.12), 0x6a5a48));
    const blobs = lo ? [[0, 3.4, 0, 2.6]] : [[0, 3.3, 0, 2.0], [1.3, 3.0, 0.4, 1.5], [-1.2, 3.2, -0.5, 1.6], [0.2, 3.9, -1.0, 1.4], [-0.3, 3.0, 1.2, 1.4]];
    for (const [x, y, z, r] of blobs) { const g = lumpy(new THREE.IcosahedronGeometry(r, lo ? 0 : 1), 0.3, 1.1); parts.push(col(at(g, x, y, z, [1, 0.72, 1]), 0x6b7a4a, 0.14)); }
    return mergeGeometries(parts);
  }
  function cypress(lo) {
    // Was a plain sphere stretched 5x, albedo 0x23391f: from the air every cypress read as a black "leaf" speck on the
    // pale hillsides. Now a flame shape (widest low, tapering to a point), normals bent upward so the crown catches sky
    // light from above, and a vertical colour gradient (darker base -> lighter tip) so from altitude it reads as a green
    // crown. The far LOD is a little fatter and shorter so the thin silhouette doesn't alias into a sliver at distance.
    const s = new THREE.SphereGeometry(1, lo ? 6 : 10, lo ? 5 : 10); if (!lo) lumpy(s, 0.12, 2.5);
    const p = s.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y <= 0) continue; const h = Math.hypot(p.getX(i), p.getZ(i)); if (h < 1e-4) continue; const k = (1 - y) / h * Math.min(1, h + 0.15); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
    const [sx, sy] = lo ? [1.3, 4.4] : [1.1, 5];
    at(s, 0, 1.2 + sy, 0, [sx, sy, sx]); s.computeVertexNormals();
    const nn = s.attributes.normal, up = new THREE.Vector3(); for (let i = 0; i < nn.count; i++) { up.set(nn.getX(i), nn.getY(i) + 0.6, nn.getZ(i)).normalize(); nn.setXYZ(i, up.x, up.y, up.z); }
    const g = col(s, 0x3f6234, 0.12), gc = g.attributes.color, gp = g.attributes.position, tip = new THREE.Color(0x7a9a52), base = new THREE.Color(0x3a5a30);
    for (let i = 0; i < gc.count; i++) { const t = Math.min(1, Math.max(0, (gp.getY(i) - 1.2) / (2 * sy))); const j = gc.getX(i) / new THREE.Color(0x3f6234).r; gc.setXYZ(i, (base.r + (tip.r - base.r) * t * t) * j, (base.g + (tip.g - base.g) * t * t) * j, (base.b + (tip.b - base.b) * t * t) * j); }
    return mergeGeometries([col(at(new THREE.CylinderGeometry(0.12, 0.2, 1.6, 5), 0, 0.8, 0), bark), g]);
  }
  function palm(lo) {
    const parts = [];
    const segs = lo ? 2 : 6;
    for (let i = 0; i < segs; i++) { const y = i * 9 / segs, b = Math.pow(i / segs, 2) * 1.2; parts.push(col(at(new THREE.CylinderGeometry(0.2, 0.26, 9 / segs + 0.05, 6), b, y + 4.5 / segs, 0, [1, 1, 1], 0, 0), 0x8a7458)); }
    const top = [1.2, 9, 0];
    const fronds = lo ? 4 : 9;
    for (let f = 0; f < fronds; f++) {
      const g = new THREE.PlaneGeometry(4.6, 0.9, 6, 1); const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i) + 2.3; p.setXYZ(i, x, -0.09 * x * x + Math.abs(p.getY(i)) * 0.3, p.getY(i)); }
      g.computeVertexNormals();
      parts.push(col(at(g, ...top, [1, 1, 1], f / fronds * Math.PI * 2 + rnd() * 0.3), 0x4f7a2e, 0.15));
    }
    return mergeGeometries(parts);
  }
  function bush(lo) {
    // The "black specks over the land while flying" (Kyle, 2026-10-22) were these: a 1.5 m dark-olive blob whose lower
    // half faces away from the sun renders as a 2-4 px near-black dot from the air (isolated by test/specks.py: only the
    // bush layer reproduces them). Normals bent upward so the whole crown takes sky + sun like the grass around it, a
    // lighter scrub green, and the far LOD shrinks away with distance (mkMat fade) instead of aliasing into dots.
    const parts = []; const k = lo ? 1 : 3;
    for (let i = 0; i < k; i++) parts.push(col(at(lumpy(new THREE.IcosahedronGeometry(0.9 + rnd() * 0.4, lo ? 0 : 1), 0.35), (rnd() - 0.5) * 1.4, 0.6, (rnd() - 0.5) * 1.4, [1, 0.7, 1]), 0x62723c, 0.14));
    const g = mergeGeometries(parts), nn = g.attributes.normal, up = new THREE.Vector3();
    for (let i = 0; i < nn.count; i++) { up.set(nn.getX(i), nn.getY(i) + 0.9, nn.getZ(i)).normalize(); nn.setXYZ(i, up.x, up.y, up.z); }
    return g;
  }
  function rock(lo) { return col(lumpy(new THREE.IcosahedronGeometry(1, lo ? 0 : 2), 0.35, 0.9).translate(0, 0.2, 0).scale(1, 0.7, 1), 0x8a857c, 0.1); }

  const TYPES = [
    { name: 'pine', make: pine, trunk: 0.35, h: 14 },
    { name: 'olive', make: olive, trunk: 0.35, h: 5 },
    { name: 'cypress', make: cypress, trunk: 0.3, h: 11 },
    { name: 'palm', make: palm, trunk: 0.28, h: 10 },
    { name: 'bush', make: bush, trunk: 0, h: 1.5 },
    { name: 'rock', make: rock, trunk: 0, h: 1, rock: true },
  ];

  // ---------- scatter ----------
  const inst = TYPES.map(() => []); // [x,y,z,scale,rotY]
  const cells = new Map();          // cell key -> [{t, i}]
  const nearSite = (x, z, k) => { for (const s of sites) { const d = Math.hypot(x - s.x, z - s.z); if (d < s.radius * k) return d / s.radius; } return 99; };
  const add = (t, x, z, s) => {
    const y = terrain.heightAt(x, z);
    const list = inst[t]; list.push(x, y, z, s, rnd() * Math.PI * 2);
    const ck = (Math.floor((z + HALF) / CELLV) << 8) | Math.floor((x + HALF) / CELLV);
    (cells.get(ck) || cells.set(ck, []).get(ck)).push(t, list.length / 5 - 1);
  };
  const STEP = 11;
  for (let z = -HALF + 6; z < HALF; z += STEP) for (let x = -HALF + 6; x < HALF; x += STEP) {
    const px = x + (rnd() - 0.5) * STEP * 0.9, pz = z + (rnd() - 0.5) * STEP * 0.9;
    const r = rnd();
    const h = terrain.heightAt(px, pz); if (h < 0.8) continue;
    const sl = terrain.slopeAt(px, pz); if (sl > 0.45) { if (r < 0.04) add(5, px, pz, 1 + rnd() * 3); continue; }
    if (terrain.roadMaskAt(px, pz) < 7) continue;
    const ns = nearSite(px, pz, 1.1); if (ns < 1.1) continue;
    const [farm, dry, forest] = terrain.splatAt(px, pz);
    const fo = terrain.biome.forest(px, pz);
    if (h < 9 && sl < 0.12) { if (r < 0.05) add(3, px, pz, 0.8 + rnd() * 0.5); continue; }      // coastal palms
    if (farm > 0.5) { // olive orchards in some fields: regular rows
      if (nz.n2(px / 260, pz / 260) > 0.35 && ((Math.round(px / STEP) + Math.round(pz / STEP)) & 1) === 0 && r < 0.9) add(1, Math.round(px / STEP) * STEP, Math.round(pz / STEP) * STEP, 0.8 + rnd() * 0.3);
      continue;
    }
    if (h > 690) { if (r < 0.03) add(5, px, pz, 0.8 + rnd() * 2); continue; }
    const dens = smoothstep(0.1, 0.3, fo);
    if (r < dens * 0.75) { add(h > 120 || rnd() < 0.5 ? 0 : 1, px, pz, 0.7 + rnd() * 0.6); continue; }
    const r2 = rnd();
    if (r2 < 0.035 * (1 - dry * 0.5) && h < 420) add(1, px, pz, 0.7 + rnd() * 0.6);
    else if (r2 < 0.05 && ns < 3) add(2, px, pz, 0.8 + rnd() * 0.5);
    else if (r2 < 0.058) add(2, px, pz, 0.7 + rnd() * 0.5);
    else if (r2 < 0.14 + dens * 0.1) add(4, px, pz, 0.6 + rnd() * 0.8);
    else if (r2 < 0.155) add(5, px, pz, 0.5 + rnd() * 1.6);
  }

  // ---------- materials ----------
  const windVS = (sh, far, fade = 0) => { // fade: far LOD shrinks to nothing between fade and fade+220 m
    sh.uniforms.uTime = time; sh.uniforms.uCam = camU;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
uniform float uTime; uniform vec3 uCam;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
float sway = sin(uTime * 1.3 + ip.x * 0.05 + ip.z * 0.07) * 0.5 + sin(uTime * 2.7 + ip.x * 0.11) * 0.25;
transformed.x += sway * 0.035 * max(0.0, transformed.y - 1.5) * (1.0 + 0.3 * sin(uTime * 4.0 + position.y));
transformed.z += sway * 0.02 * max(0.0, transformed.y - 1.5);
${far ? `float dcam = distance(ip.xz, uCam.xz); if (dcam < ${NEAR - 25}.0) transformed *= 0.0;` : ''}
${far && fade ? `transformed *= 1.0 - smoothstep(${fade}.0, ${fade + 220}.0, dcam);` : ''}`);
  };
  const mkMat = (far, isRock, fade = 0) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: isRock ? 0.85 : 0.9, flatShading: !!isRock, side: far ? THREE.FrontSide : THREE.DoubleSide });
    if (!isRock) m.onBeforeCompile = (sh) => windVS(sh, far, fade);
    else if (far) m.onBeforeCompile = (sh) => { sh.uniforms.uCam = camU; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec3 uCam;').replace('#include <begin_vertex>', `#include <begin_vertex>\nif (distance(vec2(instanceMatrix[3][0], instanceMatrix[3][2]), uCam.xz) < ${NEAR - 25}.0) transformed *= 0.0;`); };
    m.customProgramCacheKey = () => `veg-${far}-${isRock}-${fade}`;
    return m;
  };

  const root = new THREE.Group(); root.name = 'vegetation';
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), sc = new THREE.Vector3();
  const setM = (mesh, slot, L, i) => {
    e.set(0, L[i * 5 + 4], 0); q.setFromEuler(e); const s = L[i * 5 + 3];
    sc.set(s, s * (TYPES.indexOf(mesh.userData.type) === 5 ? 0.8 : 1), s);
    m4.compose(v3.set(L[i * 5], L[i * 5 + 1] - 0.15, L[i * 5 + 2]), q, sc); mesh.setMatrixAt(slot, m4);
  };
  const near = [], far = [];
  // far LOD: instances pre-sorted by 256 m cell; each update copies only the cells that are inside the
  // view frustum and within the type's max draw distance (fog hides the rest) into the instance buffer.
  const FCELL = 256, FN = (2 * HALF) / FCELL;
  const FAR_MAX = LOW ? [1800, 1700, 1700, 1600, 600, 700] : [3200, 2400, 2400, 2200, 750, 900];
  const cellBox = []; // per cell: [minY, maxY]
  for (let c = 0; c < FN * FN; c++) cellBox.push([1e9, -1e9]);
  const farData = TYPES.map((T, t) => {
    const L = inst[t], byCell = new Map(), stride = LOW && T.name === 'pine' ? 2 : 1; // low: far pines every other instance
    const n = Math.ceil(L.length / 5 / stride);
    for (let i = 0; i < L.length / 5; i += stride) {
      const cx = Math.min(FN - 1, Math.max(0, Math.floor((L[i * 5] + HALF) / FCELL))), cz = Math.min(FN - 1, Math.max(0, Math.floor((L[i * 5 + 2] + HALF) / FCELL)));
      const k = cz * FN + cx; (byCell.get(k) || byCell.set(k, []).get(k)).push(i);
      const b = cellBox[k]; const y = L[i * 5 + 1]; if (y < b[0]) b[0] = y; if (y + T.h * 1.6 > b[1]) b[1] = y + T.h * 1.6;
    }
    const mats = new Float32Array(Math.max(1, n) * 16), ranges = new Map(); let o = 0;
    const tmp = new THREE.InstancedMesh(new THREE.BufferGeometry(), undefined, 1); tmp.userData.type = T;
    for (const [k, list] of byCell) {
      ranges.set(k, [o, list.length]);
      for (const i of list) { setM(tmp, 0, L, i); mats.set(tmp.instanceMatrix.array.subarray(0, 16), o * 16); o++; }
    }
    tmp.dispose();
    return { mats, ranges, n };
  });
  TYPES.forEach((T, t) => {
    const n = farData[t].n;
    const fm = new THREE.InstancedMesh(T.make(true), mkMat(true, T.rock, T.name === 'bush' ? 360 : 0), Math.max(1, n));
    fm.userData.type = T; fm.frustumCulled = false; fm.castShadow = false; fm.receiveShadow = true;
    fm.count = 0; fm.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(fm); far.push(fm);
    const nm = new THREE.InstancedMesh(T.make(false), mkMat(false, T.rock), 6000);
    nm.userData.type = T; nm.castShadow = t !== 4; nm.receiveShadow = true; nm.count = 0; nm.frustumCulled = false;
    root.add(nm); near.push(nm);
  });
  const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _box = new THREE.Box3(), _lastFarPos = new THREE.Vector3(1e9, 0, 0), _lastFarDir = new THREE.Vector3(), _dir = new THREE.Vector3();
  let lastFarProj = 0;
  function updateFar(camera, c) {
    camera.getWorldDirection(_dir);
    const projKey = camera.projectionMatrix.elements[0] + camera.projectionMatrix.elements[5];
    if (c.distanceToSquared(_lastFarPos) < 15 * 15 && _dir.dot(_lastFarDir) > 0.995 && projKey === lastFarProj) return;
    _lastFarPos.copy(c); _lastFarDir.copy(_dir); lastFarProj = projKey;
    // widen the frustum a little (render a slightly bigger fov) so quick turns don't pop
    const fov = camera.fov; camera.fov = Math.min(150, fov * 1.35); camera.updateProjectionMatrix();
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm);
    camera.fov = fov; camera.updateProjectionMatrix();
    const counts = TYPES.map(() => 0);
    const maxD = Math.max(...FAR_MAX);
    const c0x = Math.max(0, Math.floor((c.x - maxD + HALF) / FCELL)), c1x = Math.min(FN - 1, Math.floor((c.x + maxD + HALF) / FCELL));
    const c0z = Math.max(0, Math.floor((c.z - maxD + HALF) / FCELL)), c1z = Math.min(FN - 1, Math.floor((c.z + maxD + HALF) / FCELL));
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      const k = cz * FN + cx, b = cellBox[k]; if (b[0] > b[1]) continue;
      const x0 = -HALF + cx * FCELL, z0 = -HALF + cz * FCELL;
      const dx = Math.max(x0 - c.x, 0, c.x - x0 - FCELL), dz = Math.max(z0 - c.z, 0, c.z - z0 - FCELL), d = Math.hypot(dx, dz);
      // cells fully inside the near ring are drawn by the near meshes only
      const fx = Math.max(Math.abs(x0 - c.x), Math.abs(x0 + FCELL - c.x)), fz = Math.max(Math.abs(z0 - c.z), Math.abs(z0 + FCELL - c.z));
      if (Math.hypot(fx, fz) < NEAR - 25) continue;
      _box.min.set(x0, b[0] - 2, z0); _box.max.set(x0 + FCELL, b[1], z0 + FCELL);
      if (!_fr.intersectsBox(_box)) continue;
      for (let t = 0; t < TYPES.length; t++) {
        if (d > FAR_MAX[t]) continue;
        const r = farData[t].ranges.get(k); if (!r) continue;
        far[t].instanceMatrix.array.set(farData[t].mats.subarray(r[0] * 16, (r[0] + r[1]) * 16), counts[t] * 16);
        counts[t] += r[1];
      }
    }
    far.forEach((m, t) => { m.count = counts[t]; m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, Math.max(16, counts[t] * 16)); m.instanceMatrix.needsUpdate = true; });
  }

  let lastNear = new THREE.Vector3(1e9, 0, 0);
  function rebuildNear(c) {
    lastNear.copy(c);
    const counts = TYPES.map(() => 0);
    const ci = Math.floor((c.x + HALF) / CELLV), cj = Math.floor((c.z + HALF) / CELLV), rr = Math.ceil(NEAR / CELLV);
    for (let j = cj - rr; j <= cj + rr; j++) for (let i = ci - rr; i <= ci + rr; i++) {
      const list = cells.get((j << 8) | i); if (!list) continue;
      for (let k = 0; k < list.length; k += 2) {
        const t = list[k], idx = list[k + 1], L = inst[t];
        const dx = L[idx * 5] - c.x, dz = L[idx * 5 + 2] - c.z;
        if (dx * dx + dz * dz > NEAR * NEAR || counts[t] >= 6000) continue;
        setM(near[t], counts[t]++, L, idx);
      }
    }
    near.forEach((m, t) => { m.count = counts[t]; m.instanceMatrix.needsUpdate = true; });
    camU.value.set(c.x, c.y, c.z);
  }

  // ---------- grass field ----------
  const grass = (() => {
    const R = 62, SP = 1.05, side = Math.ceil(2 * R / SP), count = side * side;
    const blades = [];
    for (let b = 0; b < 6; b++) {
      const g = new THREE.PlaneGeometry(0.13, 0.75, 1, 2); g.translate(0, 0.375, 0);
      const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) * (1 - y / 0.8)); p.setZ(i, y * y * 0.25); }
      g.rotateY(b / 6 * Math.PI * 2 + rnd()); g.translate((rnd() - 0.5) * 0.5, 0, (rnd() - 0.5) * 0.5); blades.push(g);
    }
    const geo = mergeGeometries(blades); geo.deleteAttribute('uv');
    const ig = new THREE.InstancedBufferGeometry(); ig.index = geo.index; ig.attributes.position = geo.attributes.position; ig.attributes.normal = geo.attributes.normal;
    // low quality: checkerboard-thin the tufts (every other cell, evenly spread) instead of shrinking the field
    const keepN = LOW ? Math.ceil(count / 2) : count, off = new Float32Array(keepN * 3);
    let k = 0;
    for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
      const x = (i + rnd()) * SP - R, z = (j + rnd()) * SP - R, r = rnd();
      if (LOW && ((i + j) & 1)) continue;
      off[k * 3] = x; off[k * 3 + 1] = z; off[k * 3 + 2] = r; k++;
    }
    ig.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3)); ig.instanceCount = k;
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uTime: time, uCam: camU, tH: { value: terrain.heightTex }, tSplat: terrain.uniforms.tSplat });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute vec3 aOff; uniform float uTime; uniform vec3 uCam; uniform highp sampler2D tH; uniform sampler2D tSplat; varying vec3 vGCol;
float hAt(vec2 p){ vec2 u = (p + 4096.0) / 4.0; vec2 i = floor(u); vec2 f = u - i; ivec2 c = ivec2(i);
  float h00 = texelFetch(tH, c, 0).r, h10 = texelFetch(tH, c + ivec2(1,0), 0).r, h01 = texelFetch(tH, c + ivec2(0,1), 0).r, h11 = texelFetch(tH, c + ivec2(1,1), 0).r;
  return (f.x + f.y <= 1.0) ? h00 + (h10 - h00) * f.x + (h01 - h00) * f.y : h11 + (h01 - h11) * (1.0 - f.x) + (h10 - h11) * (1.0 - f.y); }`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
float span = ${(2 * R).toFixed(1)};
vec2 wp = uCam.xz + mod(aOff.xy - uCam.xz + span * 0.5, span) - span * 0.5;
float hy = hAt(wp);
float sl = abs(hAt(wp + vec2(2.0, 0.0)) - hy) + abs(hAt(wp + vec2(0.0, 2.0)) - hy);
vec4 sp = texture(tSplat, (wp + 4096.0) / 8192.0);
float d = distance(wp, uCam.xz);
float dens = smoothstep(3.0, 6.0, hy) * (1.0 - smoothstep(520.0, 600.0, hy)) * (1.0 - smoothstep(0.7, 1.3, sl)) * (1.0 - smoothstep(0.2, 0.45, sp.a)) * (1.0 - smoothstep(0.3, 0.6, sp.r)) * (1.0 - sp.b * 0.6);
float keep = step(aOff.z, dens) * (1.0 - smoothstep(${(R * 0.6).toFixed(1)}, ${(R * 0.95).toFixed(1)}, d + aOff.z * 8.0));
float s = keep * (0.55 + aOff.z * 0.6) * (1.0 + sp.g * 0.3);
float ph = uTime * 2.1 + wp.x * 0.21 + wp.y * 0.17;
float bend = (sin(ph) * 0.6 + sin(ph * 2.3 + 1.0) * 0.25 + 0.35) * position.y * position.y * 0.9;
transformed = vec3(position.x * s + bend * 0.7, position.y * s, position.z * s + bend * 0.4);
float ca = aOff.z * 6.283; transformed.xz = mat2(cos(ca), -sin(ca), sin(ca), cos(ca)) * transformed.xz;
transformed += vec3(wp.x, hy - 0.02, wp.y);
vGCol = mix(mix(vec3(0.16, 0.2, 0.065), vec3(0.44, 0.33, 0.13), clamp(0.3 + sp.g * 0.7 - sp.b * 0.3, 0.0, 1.0)), vec3(0.22, 0.24, 0.08), aOff.z * 0.35) * (0.55 + 0.6 * position.y / 0.75);`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGCol;').replace('#include <map_fragment>', 'diffuseColor.rgb = vGCol;')
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal *= faceDirection; // both blade faces use the up normal (back faces were rendering near-black)');
    };
    m.customProgramCacheKey = () => 'grass-v2';
    const mesh = new THREE.Mesh(ig, m); mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.name = 'grass';
    return mesh;
  })();
  root.add(grass);

  // ---------- trunk colliders near the player ----------
  const pool = []; let colTimer = 0;
  function updateColliders(p) {
    const R = game.RAPIER, W = game.physics; if (!R || !W) return;
    const want = [];
    const ci = Math.floor((p.x + HALF) / CELLV), cj = Math.floor((p.z + HALF) / CELLV);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      const list = cells.get((j << 8) | i); if (!list) continue;
      for (let k = 0; k < list.length; k += 2) {
        const t = list[k], idx = list[k + 1], T = TYPES[t]; if (t === 4) continue;
        const L = inst[t], dx = L[idx * 5] - p.x, dz = L[idx * 5 + 2] - p.z, d2 = dx * dx + dz * dz;
        if (d2 < 70 * 70) want.push([d2, t, idx]);
      }
    }
    want.sort((a, b) => a[0] - b[0]);
    for (let n = 0; n < Math.min(want.length, 96); n++) {
      const [, t, idx] = want[n], L = inst[t], T = TYPES[t], s = L[idx * 5 + 3];
      let c = pool[n];
      const rad = T.rock ? s * 0.9 : T.trunk * s, hh = T.rock ? 0 : T.h * s * 0.5;
      const sig = t + ':' + idx;
      if (c && c.sig === sig) continue;
      if (c) W.removeCollider(c.col, false);
      const desc = T.rock ? R.ColliderDesc.ball(rad) : R.ColliderDesc.cylinder(hh, rad);
      desc.setTranslation(L[idx * 5], L[idx * 5 + 1] + (T.rock ? 0.1 : hh), L[idx * 5 + 2]);
      const col2 = W.createCollider(desc); col2.userData = { kind: T.name };
      pool[n] = { col: col2, sig };
    }
    for (let n = want.length; n < pool.length; n++) if (pool[n]) { W.removeCollider(pool[n].col, false); pool[n] = null; }
  }

  const _c = new THREE.Vector3();
  function update(dt, camera) {
    time.value += dt;
    camera.getWorldPosition(_c);
    if (_c.distanceToSquared(lastNear) > 30 * 30) rebuildNear(_c);
    updateFar(camera, _c);
    camU.value.set(lastNear.x, _c.y, lastNear.z);
    grass.material.userData.cam = _c;
    // grass follows the live camera
    if (grass.material.userData.shader) grass.material.userData.shader.uniforms.uCam.value = _c;
    colTimer -= dt;
    if (colTimer <= 0) { colTimer = 0.4; const p = game.player?.pos || _c; updateColliders(p); }
  }
  // grass needs the live camera position but trees use the last near-rebuild centre
  const gCam = { value: new THREE.Vector3() };
  grass.material.onBeforeCompile = ((orig) => (sh) => { orig(sh); sh.uniforms.uCam = gCam; })(grass.material.onBeforeCompile);
  const baseUpdate = update;
  return {
    root, counts: TYPES.map((T, t) => [T.name, inst[t].length / 5]),
    update(dt, camera) { baseUpdate(dt, camera); gCam.value.copy(_c); },
    treesNear(x, z, r) { const out = []; const ci = Math.floor((x + HALF) / CELLV), cj = Math.floor((z + HALF) / CELLV), rr = Math.ceil(r / CELLV);
      for (let j = cj - rr; j <= cj + rr; j++) for (let i = ci - rr; i <= ci + rr; i++) { const l = cells.get((j << 8) | i); if (!l) continue;
        for (let k = 0; k < l.length; k += 2) { const L = inst[l[k]], id = l[k + 1]; if (Math.hypot(L[id * 5] - x, L[id * 5 + 2] - z) < r) out.push({ type: TYPES[l[k]].name, x: L[id * 5], y: L[id * 5 + 1], z: L[id * 5 + 2] }); } } return out; },
  };
}
