// Road network: A* over a 32 m cost grid (slope-penalised, land only, reuses existing roads),
// Chaikin-smoothed, profile-smoothed, flattened into the terrain, then one merged asphalt
// ribbon mesh with painted centre/edge lines. Exposes polylines for vehicle AI.
import { clamp } from './noise.js';

const G = 32;

export function planRoads(terrain, sites) {
  const HALF = 4096, n = (2 * HALF) / G;
  const hAt = (i, j) => terrain.heightAt(-HALF + i * G + G / 2, -HALF + j * G + G / 2);
  const hg = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hg[j * n + i] = hAt(i, j);
  const used = new Uint8Array(n * n);
  const cellOf = (x, z) => [clamp(Math.floor((x + HALF) / G), 0, n - 1), clamp(Math.floor((z + HALF) / G), 0, n - 1)];

  function astar(a, b) {
    const [si, sj] = cellOf(a.x, a.z), [ti, tj] = cellOf(b.x, b.z);
    const S = sj * n + si, T = tj * n + ti;
    const g = new Float32Array(n * n).fill(Infinity), from = new Int32Array(n * n).fill(-1), closed = new Uint8Array(n * n);
    const heap = [[0, S]]; g[S] = 0;
    const push = (f, k) => { heap.push([f, k]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    let iter = 0;
    while (heap.length && iter++ < 200000) {
      const [, k] = pop(); if (closed[k]) continue; closed[k] = 1;
      if (k === T) break;
      const i = k % n, j = (k / n) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const nk = nj * n + ni; if (closed[nk]) continue;
        const h = hg[nk]; if (h < 1.5 && nk !== T) continue;
        const len = G * (di && dj ? 1.4142 : 1);
        const grade = Math.abs(h - hg[k]) / len;
        let c = len * (1 + 140 * grade * grade + (grade > 0.16 ? 30 : 0) + (h > 650 ? 1.5 : 0));
        if (used[nk]) c *= 0.45;
        const ng = g[k] + c;
        if (ng < g[nk]) { g[nk] = ng; from[nk] = k; push(ng + Math.hypot(ni - ti, nj - tj) * G * 0.9, nk); }
      }
    }
    if (from[T] < 0) return null;
    const path = []; for (let k = T; k !== -1; k = from[k]) { path.push(k); used[k] = 1; }
    path.reverse();
    const pts = path.map(k => ({ x: -HALF + (k % n) * G + G / 2, z: -HALF + ((k / n) | 0) * G + G / 2 }));
    pts[0] = { x: a.x, z: a.z }; pts[pts.length - 1] = { x: b.x, z: b.z };
    return pts;
  }

  // ---- graph: per island MST + extra links for towns/cities ----
  const isl = s => terrain.biome.island(s.x, s.z);
  const edges = [], key = new Set();
  const addEdge = (a, b) => { const k = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id; if (key.has(k) || a === b) return; key.add(k); edges.push([a, b]); };
  const groups = new Map();
  for (const s of sites) { if (terrain.heightAt(s.x, s.z) < 0) continue; const k = isl(s); (groups.get(k) || groups.set(k, []).get(k)).push(s); }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const inT = new Set([g[0]]);
    while (inT.size < g.length) { // Prim
      let best = null, bd = Infinity;
      for (const a of inT) for (const b of g) if (!inT.has(b)) { const d = Math.hypot(a.x - b.x, a.z - b.z); if (d < bd) { bd = d; best = [a, b]; } }
      inT.add(best[1]); addEdge(best[0], best[1]);
    }
    for (const a of g) if (a.type === 'city' || a.type === 'town' || a.type === 'airbase') {
      const near = g.filter(b => b !== a).sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z));
      for (const b of near.slice(0, 2)) if (Math.hypot(b.x - a.x, b.z - a.z) < 2600) addEdge(a, b);
    }
  }
  // major roads first so minor ones merge onto them
  const rank = s => ({ city: 0, town: 1, airbase: 1, naval: 2, base: 2, village: 3, outpost: 4 })[s.type] ?? 3;
  edges.sort((e, f) => (rank(e[0]) + rank(e[1])) - (rank(f[0]) + rank(f[1])));

  const roads = [];
  for (const [a, b] of edges) {
    let pts = astar(a, b); if (!pts || pts.length < 2) continue;
    for (let it = 0; it < 3; it++) { // Chaikin
      const o = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) { const p = pts[i], q = pts[i + 1]; o.push({ x: p.x * 0.75 + q.x * 0.25, z: p.z * 0.75 + q.z * 0.25 }, { x: p.x * 0.25 + q.x * 0.75, z: p.z * 0.25 + q.z * 0.75 }); }
      o.push(pts[pts.length - 1]); pts = o;
    }
    // resample every 6 m
    const rs = [pts[0]]; let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i], L = Math.hypot(q.x - p.x, q.z - p.z);
      let t = 6 - acc;
      while (t <= L) { rs.push({ x: p.x + (q.x - p.x) * t / L, z: p.z + (q.z - p.z) * t / L }); t += 6; }
      acc = L - (t - 6);
    }
    rs.push(pts[pts.length - 1]);
    // trim the ends inside the site footprints (settlements lay their own streets)
    const inA = p => Math.hypot(p.x - a.x, p.z - a.z) < a.radius * 0.85, inB = p => Math.hypot(p.x - b.x, p.z - b.z) < b.radius * 0.85;
    let s0 = 0, s1 = rs.length - 1;
    while (s0 < s1 && inA(rs[s0])) s0++;
    while (s1 > s0 && inB(rs[s1])) s1--;
    const seg = rs.slice(Math.max(0, s0 - 1), s1 + 2);
    if (seg.length < 4) continue;
    // height profile: terrain, smoothed, clamped above sea
    let ys = seg.map(p => terrain.heightAt(p.x, p.z));
    for (let pass = 0; pass < 6; pass++) {
      const o = ys.slice();
      for (let i = 1; i < ys.length - 1; i++) { let s = 0, c = 0; for (let k = -5; k <= 5; k++) { const v = ys[clamp(i + k, 0, ys.length - 1)]; s += v; c++; } o[i] = s / c; }
      ys = o;
    }
    seg.forEach((p, i) => { p.y = Math.max(1.4, ys[i]); });
    const major = rank(a) <= 1 && rank(b) <= 2;
    // rural links (nothing bigger than a village / base at either end, not a trunk road) are graded dirt tracks
    const surface = !major && rank(a) >= 2 && rank(b) >= 2 && (rank(a) >= 3 || rank(b) >= 3) ? 'dirt' : 'asphalt';
    roads.push({ points: seg, width: major ? 9 : surface === 'dirt' ? 6 : 7, from: a.id, to: b.id, major, surface });
  }
  return roads;
}

export function buildRoadMesh(game, terrain, roads) {
  // Ribbon: 5 verts across (outer shoulder, edge, centre, edge, outer shoulder). uv.x = signed lateral offset in metres,
  // uv.y = distance along; aRoad = (half width, surface 0 asphalt / 1 dirt). Shoulders fade out in alpha over the terrain.
  const THREE = game.THREE;
  const pos = [], uv = [], nor = [], rd = [], idx = [];
  let base = 0;
  roads.forEach((r, ri) => {
    const P = r.points, hw = r.width / 2, dirt = r.surface === 'dirt' ? 1 : 0, sh = dirt ? 1.6 : 1.8;
    const offs = [-(hw + sh), -hw, 0, hw, hw + sh];
    let along = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      if (i > 0) along += Math.hypot(p.x - P[i - 1].x, p.z - P[i - 1].z);
      for (let s = 0; s < 5; s++) {
        const o = offs[s], x = p.x - tz * o, z = p.z + tx * o;
        pos.push(x, terrain.heightAt(x, z) + (s === 0 || s === 4 ? 0.04 : 0.07) + ri * 0.0005, z);
        uv.push(o, along); nor.push(0, 1, 0); rd.push(hw, dirt);
      }
      if (i > 0) { const c = base + (i - 1) * 5, d = base + i * 5; for (let s = 0; s < 4; s++) idx.push(c + s, c + s + 1, d + s, d + s, c + s + 1, d + s + 1); }
    }
    base += P.length * 5;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aRoad', new THREE.Float32BufferAttribute(rd, 2));
  g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
  const L = new THREE.TextureLoader(), lt = (u, srgb) => { const t = L.load(u); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  const mat = new THREE.MeshStandardMaterial({ map: lt('assets/tex/asphalt_diff.jpg', true), normalMap: lt('assets/tex/asphalt_nor.jpg'), roughness: 0.9,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aRoad; varying vec2 vRUv; varying vec2 vRoad; varying float vCamD;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRUv = uv; vRoad = aRoad;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCamD = -mvPosition.z;\ngl_Position = projectionMatrix * vec4( mvPosition.xyz * ( 1.0 - 0.004 * smoothstep( 2.0, 30.0, - mvPosition.z ) ), 1.0 );'); // depth-only bias vs coarse terrain LOD
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec2 vRUv; varying vec2 vRoad; varying float vCamD;
float rh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rh(i), rh(i + vec2(1.0, 0.0)), f.x), mix(rh(i + vec2(0.0, 1.0)), rh(i + vec2(1.0, 1.0)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `
float o = vRUv.x, a = abs(o), hw = vRoad.x, along = vRUv.y; bool dirtRd = vRoad.y > 0.5;
vec2 ruv = vec2(o / 6.0, along / 5.0);
vec4 texelColor = texture2D(map, ruv);
float tl = clamp(dot(texelColor.rgb, vec3(0.3, 0.55, 0.15)) / 0.11, 0.6, 1.4);
tl = mix(tl, 1.0, smoothstep(40.0, 400.0, vCamD)); // texture detail averages out at range: no dark speckle from the air
float nBig = rn(vec2(along / 23.0, o / 7.0)), nMid = rn(vec2(along / 3.1, o / 1.3)), nFine = rn(vec2(along * 1.7, o * 2.3));
vec3 DUST = vec3(0.47, 0.39, 0.28);
vec3 c;
if (!dirtRd) {
  // sun-bleached asphalt: warm mid grey, lighter polished wheel paths / worn centre, patchy repairs
  vec3 ASPH = vec3(0.30, 0.285, 0.265);
  c = ASPH * tl * (0.92 + 0.16 * nBig);
  float wheel = exp(-pow((a - hw * 0.5) / (hw * 0.16), 2.0));
  float centreW = 1.0 - smoothstep(0.0, hw * 0.35, a);
  c = mix(c, vec3(0.39, 0.37, 0.34) * tl, clamp(centreW * 0.35 + wheel * 0.18, 0.0, 1.0));
  c = mix(c, ASPH * 0.8, smoothstep(0.62, 0.8, nBig) * 0.35 * (1.0 - smoothstep(hw - 0.6, hw, a))); // patched tarmac
  // dust blown onto the edges
  c = mix(c, DUST * (0.9 + 0.2 * nMid), smoothstep(hw - 1.4 - nMid * 0.6, hw, a) * 0.55);
  // faded dashed centre line (cracked, partly worn off)
  float dash = smoothstep(0.0, 0.08, fract(along / 10.0)) * (1.0 - smoothstep(0.48, 0.56, fract(along / 10.0)));
  float line = (1.0 - smoothstep(0.06, 0.11, a)) * dash * (0.35 + 0.35 * smoothstep(0.2, 0.7, nMid)) * step(0.15, nFine + 0.1);
  c = mix(c, vec3(0.86, 0.83, 0.74), line * mix(1.0, 0.5, smoothstep(200.0, 700.0, vCamD)));
} else {
  // graded dirt track: packed light earth, two darker wheel ruts, sparse dry grass on the crown
  vec3 EARTH = vec3(0.47, 0.405, 0.315);
  c = EARTH * mix(1.0, tl, 0.4) * (0.88 + 0.22 * nBig) * (0.94 + 0.12 * nMid);
  float rut = exp(-pow((a - hw * 0.45) / (hw * 0.14), 2.0));
  c *= 1.0 - rut * 0.16;
  float crown = (1.0 - smoothstep(0.0, hw * 0.22, a)) * smoothstep(0.45, 0.75, nMid);
  c = mix(c, vec3(0.34, 0.31, 0.16), crown * 0.45);
}
// soft dusty shoulder: road colour -> dust -> terrain (alpha), ragged edge
float edgeN = (nMid - 0.5) * 0.9 + (nBig - 0.5) * 0.8;
float shW = dirtRd ? 1.6 : 1.8;
float sh = smoothstep(hw - 0.3, hw + 0.4, a + edgeN * 0.5);
c = mix(c, DUST * (0.85 + 0.25 * nMid), sh * 0.8);
float alpha = 1.0 - smoothstep(hw - 0.1, hw + shW, a + edgeN * 1.2);
alpha *= alpha;
if (dirtRd) alpha *= 1.0 - smoothstep(hw * 0.75, hw + shW * 0.9, a + edgeN * 1.4) * 0.5;
diffuseColor = vec4(c, alpha);
`).replace('#include <normal_fragment_maps>', `
vec3 mapN = texture2D(normalMap, ruv).xyz * 2.0 - 1.0; mapN.xy *= (dirtRd ? 0.3 : 0.5) * (1.0 - smoothstep(30.0, 200.0, vCamD));
normal = normalize(normal + (viewMatrix * vec4(mapN.x, 0.0, mapN.y, 0.0)).xyz * 0.5);`);
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'roads'; mesh.receiveShadow = true; mesh.renderOrder = -0.5; // first of the transparents (after the ocean): smoke/fx blend over it
  return mesh;
}
