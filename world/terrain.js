// Corvana terrain: deterministic island heightfield (4 m grid over 8 km), biome fields,
// site/road flattening, quadtree LOD chunk meshes with skirts, splat+triplanar shader,
// Rapier heightfield collider. heightAt/normalAt interpolate the exact triangles that both
// the LOD0 mesh and the Rapier heightfield use (diagonal from (x1,z0) to (x0,z1)).
import { makeNoise, mulberry32, smoothstep, clamp, lerp } from './noise.js';

export const HALF = 4096;          // map spans -HALF..HALF on x and z
export const N = 2048;             // cells per side
export const CELL = (2 * HALF) / N; // 4 m
const NV = N + 1;
const CN = 512, CNV = CN + 1, CCELL = (2 * HALF) / CN; // coarse grid for low-frequency fields
const SEA_FLOOR = -90;

export function createTerrain(game) {
  const THREE = game.THREE;
  const seed = game.seed | 0;
  const noise = makeNoise(seed * 7 + 11);
  const noiseB = makeNoise(seed * 13 + 5);
  const rnd = mulberry32(seed * 31 + 7);

  // ---------------- island layout ----------------
  const J = (a) => (rnd() - 0.5) * 2 * a;
  const islands = [
    { name: 'west', x: -1750 + J(120), z: -1150 + J(120), rx: 1800, rz: 1250, rot: 0.55 + J(0.1), peak: 1150 },
    { name: 'east', x: 1900 + J(120), z: -850 + J(120), rx: 1300, rz: 1700, rot: -0.35 + J(0.1), peak: 980 },
    { name: 'south', x: 250 + J(120), z: 2200 + J(100), rx: 1550, rz: 950, rot: 0.12 + J(0.1), peak: 720 },
  ];
  // islets in the gaps and around the rim
  const isletSpots = [[-80, -700], [520, 300], [-1300, 1300], [-3200, 900], [3300, 1300], [1650, 1500], [-500, -3400], [2600, -3300], [-2600, 2700], [2900, 3000], [-3500, -2800]];
  for (const [x, z] of isletSpots) {
    const r = 140 + rnd() * 260;
    islands.push({ name: 'islet', x: x + J(150), z: z + J(150), rx: r * (0.8 + rnd() * 0.5), rz: r * (0.8 + rnd() * 0.5), rot: rnd() * 3, peak: 40 + rnd() * 110, islet: true });
  }
  for (const is of islands) { is.c = Math.cos(is.rot); is.s = Math.sin(is.rot); }

  // ---------------- coarse fields (16 m) ----------------
  const F = (n) => new Float32Array(n);
  const cC = F(CNV * CNV), cIsl = new Int8Array(CNV * CNV), cHill = F(CNV * CNV), cMount = F(CNV * CNV),
    cPlain = F(CNV * CNV), cCliff = F(CNV * CNV), cForest = F(CNV * CNV), cDry = F(CNV * CNV), cFarm = F(CNV * CNV);
  for (let j = 0; j < CNV; j++) {
    const z = -HALF + j * CCELL;
    for (let i = 0; i < CNV; i++) {
      const x = -HALF + i * CCELL;
      const k = j * CNV + i;
      const wx = x + noise.fbm(x / 1400, z / 1400, 3) * 320, wz = z + noise.fbm(x / 1400 + 50, z / 1400 - 20, 3) * 320;
      const fine = noise.fbm(x / 330, z / 330, 3) * 0.07;
      let best = -9, bi = -1, mBest = 0;
      const rid = noise.ridged((x * 0.8 + z * 0.6) / 2800, (-x * 0.6 + z * 0.8) / 1900, 4);
      const ridP = Math.pow(rid, 1.1);
      for (let n = 0; n < islands.length; n++) {
        const is = islands[n];
        const dx = wx - is.x, dz = wz - is.z;
        const u = (dx * is.c + dz * is.s) / is.rx, v = (-dx * is.s + dz * is.c) / is.rz;
        const c = 1 - Math.sqrt(u * u + v * v) + fine;
        if (c > best) { best = c; bi = n; }
        if (c > 0.1) {
          const m = is.islet ? 0 : ridP * is.peak * smoothstep(0.12, 0.7, c);
          if (m > mBest) mBest = m;
        }
      }
      cC[k] = best; cIsl[k] = bi;
      const plain = smoothstep(0.05, 0.4, noiseB.fbm(x / 800, z / 800, 3)) * (1 - smoothstep(0.45, 0.75, best));
      cPlain[k] = plain;
      cHill[k] = noise.fbm(x / 950, z / 950, 4) * 0.5 + 0.5;
      cMount[k] = mBest * (1 - plain * 0.9);
      cCliff[k] = noiseB.fbm(x / 600 + 9, z / 600 - 3, 3);
      cForest[k] = noiseB.fbm(x / 520 - 40, z / 520 + 70, 4);
      cDry[k] = noise.fbm(x / 700 + 300, z / 700 - 100, 3);
      cFarm[k] = noiseB.fbm(x / 380 + 77, z / 380 + 31, 3);
    }
  }
  function coarse(f, x, z) {
    let u = (x + HALF) / CCELL, v = (z + HALF) / CCELL;
    u = clamp(u, 0, CN - 1e-4); v = clamp(v, 0, CN - 1e-4);
    const i = u | 0, j = v | 0, fu = u - i, fv = v - j, k = j * CNV + i;
    return (f[k] * (1 - fu) + f[k + 1] * fu) * (1 - fv) + (f[k + CNV] * (1 - fu) + f[k + CNV + 1] * fu) * fv;
  }

  // ---------------- full-res heights ----------------
  const H = new Float32Array(NV * NV);
  function baseHeight(x, z) {
    const c = coarse(cC, x, z);
    const cliff = smoothstep(0.12, 0.42, coarse(cCliff, x, z));
    if (c < 0) {
      const d = -c;
      let h = SEA_FLOOR * Math.pow(smoothstep(0, lerp(0.42, 0.12, cliff), d), 0.85);
      if (d > 0.03) h += noise.n2(x / 90, z / 90) * 3 * smoothstep(0.03, 0.15, d);
      return h;
    }
    const t = smoothstep(0, 0.55, c);
    const plain = coarse(cPlain, x, z);
    const hill = coarse(cHill, x, z);
    const mount = coarse(cMount, x, z);
    let land = hill * (22 + 190 * t) * (1 - 0.82 * plain) + plain * (6 + 45 * t) + mount;
    const det = noise.fbm(x / 150, z / 150, 3);
    land += det * (2 + 9 * t + mount * 0.06) + noiseB.n2(x / 38, z / 38) * (0.4 + mount * 0.012);
    const beachP = Math.max(0, land) * smoothstep(0.012, 0.11, c) + 2.0 * smoothstep(0, 0.02, c);
    const cliffH = 22 + 40 * (noiseB.n2(x / 400, z / 400) * 0.5 + 0.5);
    const cliffP = (Math.max(0, land) + cliffH) * smoothstep(0.0, 0.014, c);
    return lerp(beachP, cliffP, cliff);
  }
  for (let j = 0; j < NV; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < NV; i++) H[j * NV + i] = baseHeight(-HALF + i * CELL, z);
  }

  // ---------------- sampling ----------------
  function heightAt(x, z) {
    const u = (x + HALF) / CELL, v = (z + HALF) / CELL;
    if (!(u >= 0 && v >= 0 && u <= N && v <= N)) return SEA_FLOOR;
    let i = Math.floor(u), j = Math.floor(v);
    if (i >= N) i = N - 1; if (j >= N) j = N - 1;
    const fu = u - i, fv = v - j, k = j * NV + i;
    if (fu + fv <= 1) { const h00 = H[k]; return h00 + (H[k + 1] - h00) * fu + (H[k + NV] - h00) * fv; }
    const h11 = H[k + NV + 1]; return h11 + (H[k + NV] - h11) * (1 - fu) + (H[k + 1] - h11) * (1 - fv);
  }
  function normalAt(x, z, target) {
    const out = target || new THREE.Vector3();
    const u = (x + HALF) / CELL, v = (z + HALF) / CELL;
    if (!(u >= 0 && v >= 0 && u <= N && v <= N)) return out.set(0, 1, 0);
    let i = Math.floor(u), j = Math.floor(v);
    if (i >= N) i = N - 1; if (j >= N) j = N - 1;
    const fu = u - i, fv = v - j, k = j * NV + i;
    let dx, dz;
    if (fu + fv <= 1) { dx = (H[k + 1] - H[k]) / CELL; dz = (H[k + NV] - H[k]) / CELL; }
    else { dx = (H[k + NV + 1] - H[k + NV]) / CELL; dz = (H[k + NV + 1] - H[k + 1]) / CELL; }
    return out.set(-dx, 1, -dz).normalize();
  }
  const gridH = (i, j) => H[clamp(j, 0, N) * NV + clamp(i, 0, N)];
  function slopeAt(x, z) { // 0 flat .. 1 vertical (1 - n.y)
    const u = clamp(Math.round((x + HALF) / CELL), 1, N - 1), v = clamp(Math.round((z + HALF) / CELL), 1, N - 1);
    const dx = (gridH(u + 1, v) - gridH(u - 1, v)) / (2 * CELL), dz = (gridH(u, v + 1) - gridH(u, v - 1)) / (2 * CELL);
    return 1 - 1 / Math.sqrt(1 + dx * dx + dz * dz);
  }

  // ---------------- biome queries (used by splat + vegetation) ----------------
  const biome = {
    continent: (x, z) => coarse(cC, x, z),
    island: (x, z) => { const u = clamp(Math.round((x + HALF) / CCELL), 0, CN), v = clamp(Math.round((z + HALF) / CCELL), 0, CN); return cIsl[v * CNV + u]; },
    forest: (x, z) => coarse(cForest, x, z),
    dry: (x, z) => coarse(cDry, x, z),
    farm: (x, z) => coarse(cFarm, x, z) + coarse(cPlain, x, z) * 0.6 - 0.25,
    plain: (x, z) => coarse(cPlain, x, z),
  };

  // ---------------- flattening (sites + roads) ----------------
  const sitesFlat = [];
  function flattenSite(site) {
    const r = site.radius, R = r * 1.75;
    // target: robust mean height inside the site footprint, kept above the waterline
    let sum = 0, n = 0;
    for (let a = 0; a < 24; a++) for (let rr = 0; rr <= 1; rr += 0.34) {
      const ang = a / 24 * Math.PI * 2;
      const h = heightAt(site.x + Math.cos(ang) * r * rr, site.z + Math.sin(ang) * r * rr);
      sum += h; n++;
    }
    let T = sum / n;
    T = Math.max(T, site.type === 'naval' ? 2.5 : 4);
    site.y = T;
    sitesFlat.push(site);
    const i0 = clamp(Math.floor((site.x - R + HALF) / CELL), 0, N), i1 = clamp(Math.ceil((site.x + R + HALF) / CELL), 0, N);
    const j0 = clamp(Math.floor((site.z - R + HALF) / CELL), 0, N), j1 = clamp(Math.ceil((site.z + R + HALF) / CELL), 0, N);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      const d = Math.hypot(x - site.x, z - site.z) + noise.n2(x / 60, z / 60) * r * 0.08;
      const w = 1 - smoothstep(r, R, d);
      if (w <= 0) continue;
      const k = j * NV + i;
      H[k] = lerp(H[k], T, w);
    }
  }
  // road flatten: accumulate nearest-road target per vertex, then blend
  let roadD = null, roadT = null, roadW = null;
  function flattenRoad(points, width) {
    if (!roadD) { roadD = new Float32Array(NV * NV).fill(1e9); roadT = new Float32Array(NV * NV); roadW = new Float32Array(NV * NV); }
    const hw = width / 2, blend = 14;
    for (let s = 0; s < points.length - 1; s++) {
      const a = points[s], b = points[s + 1];
      const minx = Math.min(a.x, b.x) - hw - blend, maxx = Math.max(a.x, b.x) + hw + blend;
      const minz = Math.min(a.z, b.z) - hw - blend, maxz = Math.max(a.z, b.z) + hw + blend;
      const i0 = clamp(Math.floor((minx + HALF) / CELL), 0, N), i1 = clamp(Math.ceil((maxx + HALF) / CELL), 0, N);
      const j0 = clamp(Math.floor((minz + HALF) / CELL), 0, N), j1 = clamp(Math.ceil((maxz + HALF) / CELL), 0, N);
      const ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez || 1;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = -HALF + i * CELL, z = -HALF + j * CELL;
        const t = clamp(((x - a.x) * ex + (z - a.z) * ez) / L2, 0, 1);
        const px = a.x + ex * t, pz = a.z + ez * t;
        const d = Math.hypot(x - px, z - pz);
        const k = j * NV + i;
        const w = 1 - smoothstep(hw + 1.5, hw + blend, d);
        if (d < roadD[k]) { roadD[k] = d; roadT[k] = a.y + (b.y - a.y) * t; }
        if (w > roadW[k]) roadW[k] = w;
      }
    }
  }
  function applyRoads() {
    if (!roadD) return;
    for (let k = 0; k < H.length; k++) if (roadW[k] > 0) H[k] = lerp(H[k], roadT[k] - 0.05, roadW[k]);
  }
  function roadMaskAt(x, z) { // distance to the nearest road (m), or 1e9
    if (!roadD) return 1e9;
    const i = clamp(Math.round((x + HALF) / CELL), 0, N), j = clamp(Math.round((z + HALF) / CELL), 0, N);
    return roadD[j * NV + i];
  }

  // ---------------- splat texture (2048^2, RGBA8: farm, dry, dirt/forest floor, road/settled) ----------------
  let splatTex = null, heightTex = null, splatData = null;
  function buildSplat() {
    const S = N; const data = splatData = new Uint8Array(S * S * 4);
    for (let j = 0; j < S; j++) {
      const z = -HALF + (j + 0.5) * CELL;
      for (let i = 0; i < S; i++) {
        const x = -HALF + (i + 0.5) * CELL;
        const h = heightAt(x, z), sl = slopeAt(x, z);
        const o = (j * S + i) * 4;
        const fm = biome.farm(x, z), fo = biome.forest(x, z), dr = biome.dry(x, z);
        const flat = 1 - smoothstep(0.03, 0.09, sl);
        const farm = smoothstep(0.05, 0.12, fm) * flat * smoothstep(4, 9, h) * (1 - smoothstep(260, 330, h)) * (1 - smoothstep(0.15, 0.3, fo));
        const dry = clamp(smoothstep(-0.1, 0.4, dr) * 0.9 + smoothstep(250, 520, h) * 0.3 - smoothstep(0.1, 0.35, fo) * 0.6, 0, 1);
        const forestFloor = smoothstep(0.12, 0.3, fo) * smoothstep(30, 60, h) * (1 - smoothstep(620, 700, h));
        let settled = 0;
        const rd = roadMaskAt(x, z); if (rd < 9) settled = Math.max(settled, 1 - smoothstep(4.5, 8.5, rd));
        for (const s of sitesFlat) { const d = Math.hypot(x - s.x, z - s.z); if (d < s.radius * 1.15) settled = Math.max(settled, 0.55 * (1 - smoothstep(s.radius * 0.7, s.radius * 1.15, d))); }
        data[o] = farm * 255; data[o + 1] = dry * 255; data[o + 2] = forestFloor * 255; data[o + 3] = settled * 255;
      }
    }
    splatTex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    splatTex.magFilter = THREE.LinearFilter; splatTex.minFilter = THREE.LinearMipmapLinearFilter; splatTex.generateMipmaps = true;
    splatTex.needsUpdate = true;
    heightTex = new THREE.DataTexture(H, NV, NV, THREE.RedFormat, THREE.FloatType);
    heightTex.magFilter = heightTex.minFilter = THREE.NearestFilter; heightTex.needsUpdate = true;
  }
  function splatAt(x, z) { // [farm, dry, forestFloor, settled] 0..1
    if (!splatData) return [0, 0, 0, 0];
    const i = clamp(Math.floor((x + HALF) / CELL), 0, N - 1), j = clamp(Math.floor((z + HALF) / CELL), 0, N - 1);
    const o = (j * N + i) * 4;
    return [splatData[o] / 255, splatData[o + 1] / 255, splatData[o + 2] / 255, splatData[o + 3] / 255];
  }

  // ---------------- textures ----------------
  const LAYERS = ['grass', 'dry', 'rock', 'sand', 'snow', 'dirt'];
  async function loadArray(kind) {
    const TS = 1024;
    const urls = LAYERS.map(l => l === 'grass' ? `assets/tex/grass_${kind}.jpg` : `assets/world/${l}_${kind}.jpg`);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = TS;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const data = new Uint8Array(TS * TS * 4 * LAYERS.length);
    const imgs = await Promise.all(urls.map(u => new Promise((res) => {
      const im = new Image(); im.onload = () => res(im); im.onerror = () => { console.warn('[world] missing texture', u); res(null); }; im.src = u;
    })));
    imgs.forEach((im, li) => {
      if (im) ctx.drawImage(im, 0, 0, TS, TS);
      else { ctx.fillStyle = kind === 'nor' ? '#8080ff' : ['#5a7a3a', '#a89a5a', '#7a746a', '#d8c8a0', '#f4f6fa', '#6a5640'][li]; ctx.fillRect(0, 0, TS, TS); }
      data.set(ctx.getImageData(0, 0, TS, TS).data, li * TS * TS * 4);
    });
    const tex = new THREE.DataArrayTexture(data, TS, TS, LAYERS.length);
    tex.format = THREE.RGBAFormat; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true;
    tex.anisotropy = Math.min(8, game.renderer?.capabilities?.getMaxAnisotropy?.() || 1);
    if (kind === 'diff') tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }
  function makeNoiseTex() { // tileable value-ish noise, 4 independent channels
    const S = 256, d = new Uint8Array(S * S * 4), nz = makeNoise(seed + 99);
    const tile = (x, y, f, o) => { // tileable via 4D torus trick approximated with blended corners
      const a = nz.fbm(x * f + o, y * f, 4), b = nz.fbm((x - 1) * f + o, y * f, 4), c = nz.fbm(x * f + o, (y - 1) * f, 4), e = nz.fbm((x - 1) * f + o, (y - 1) * f, 4);
      return lerp(lerp(a, b, x), lerp(c, e, x), y);
    };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, o = (y * S + x) * 4;
      for (let ch = 0; ch < 4; ch++) d[o + ch] = clamp((tile(u, v, 4 + ch * 2, ch * 37) * 0.5 + 0.5) * 255, 0, 255);
    }
    const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
    return t;
  }

  // ---------------- material ----------------
  let material = null;
  const uniforms = { tDiff: { value: null }, tNor: { value: null }, tSplat: { value: null }, tNoise: { value: null }, uHalf: { value: HALF }, uTime: { value: 0 } };
  function makeMaterial() {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vWNrm;
uniform highp sampler2DArray tDiff; uniform highp sampler2DArray tNor;
uniform sampler2D tSplat; uniform sampler2D tNoise; uniform float uHalf; uniform float uTime;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// two-scale, rotated sampling kills obvious tiling
vec4 sampD(vec2 uv, float l, float mixv){ vec4 a = texture(tDiff, vec3(uv, l)); vec2 r = mat2(0.8,-0.6,0.6,0.8) * uv * 0.29 + 0.37; vec4 b = texture(tDiff, vec3(r, l)); return mix(a, b, mixv); }
vec3 sampN(vec2 uv, float l, float mixv){ vec3 a = texture(tNor, vec3(uv, l)).xyz; vec2 r = mat2(0.8,-0.6,0.6,0.8) * uv * 0.29 + 0.37; vec3 b = texture(tNor, vec3(r, l)).xyz;
  b.xy = mat2(0.8,0.6,-0.6,0.8) * (b.xy*2.0-1.0) * 0.5 + 0.5; return mix(a, b, mixv) * 2.0 - 1.0; }
`)
        .replace('#include <map_fragment>', `
vec3 wN = normalize(vWNrm);
vec2 wxz = vWPos.xz;
float camD = length(vWPos - cameraPosition);
vec4 sp = texture(tSplat, (wxz + uHalf) / (2.0 * uHalf));
vec4 nzA = texture(tNoise, wxz / 1100.0);
vec4 nzB = texture(tNoise, wxz / 140.0);
vec4 nzC = texture(tNoise, wxz / 23.0);
float slope = 1.0 - wN.y;
float h = vWPos.y;
float mixv = smoothstep(0.3, 0.7, nzB.r);
// ---- layer weights ----
float wSand = (1.0 - smoothstep(2.4 + nzA.b * 3.0, 4.2 + nzA.b * 4.0, h)) * (1.0 - smoothstep(0.28, 0.5, slope));
float rockT = 0.27 + nzA.r * 0.1 - sp.a * 0.2;
float wRock = smoothstep(rockT, rockT + 0.12, slope + (nzC.b - 0.5) * 0.08);
wRock = max(wRock, smoothstep(820.0, 1050.0, h) * 0.55);
float snowLine = 1080.0 + (nzA.a - 0.5) * 120.0; // summer Mediterranean: only a dusting on the very highest summits
float wSnow = smoothstep(snowLine, snowLine + 50.0, h + (nzB.a - 0.5) * 40.0) * (1.0 - smoothstep(0.45, 0.62, slope));
// ---- Mediterranean ground: palette colours, textures only supply luminance detail (no raw texture hue -> no purple/grey cast)
vec2 uvG = wxz / 9.0;
vec4 cG = sampD(uvG, 0.0, mixv); vec3 nG = sampN(uvG, 0.0, mixv);
vec4 cDr = sampD(wxz / 7.0, 1.0, mixv); vec3 nDr = sampN(wxz / 7.0, 1.0, mixv);
float dG = clamp(dot(cG.rgb, vec3(0.3, 0.55, 0.15)) / 0.12, 0.45, 1.7);
float dD = clamp(dot(cDr.rgb, vec3(0.3, 0.55, 0.15)) / 0.05, 0.45, 1.7);
// dryness: splat dry field + broad macro + sun-facing (south/west) slopes bake drier; valleys/forest stay greener
float sunFace = clamp(dot(wN.xz, normalize(vec2(-0.4, 0.9))) * 2.0, -1.0, 1.0) * smoothstep(0.03, 0.2, slope);
float dry = clamp(0.35 + sp.g * 0.55 + (nzA.g - 0.5) * 0.45 + sunFace * 0.18 - sp.b * 0.35 + smoothstep(300.0, 600.0, h) * 0.15, 0.0, 1.0);
vec3 MEADOW = vec3(0.15, 0.16, 0.055), GOLD = vec3(0.46, 0.33, 0.12), STRAW = vec3(0.6, 0.48, 0.25);
vec3 SCRUB = vec3(0.055, 0.085, 0.025), FFLOOR = vec3(0.13, 0.1, 0.05), DIRT = vec3(0.4, 0.3, 0.18);
vec3 col = mix(MEADOW, GOLD, smoothstep(0.3, 0.75, dry));
col = mix(col, STRAW, smoothstep(0.55, 0.9, nzC.r) * smoothstep(0.5, 0.9, dry) * 0.45);
// dark-green maquis clumps (mid scale, soft edges) — denser on cooler/forest ground, sparse on the driest slopes
float scrubN = nzB.g * 0.55 + nzC.b * 0.3 + texture(tNoise, wxz / 9.0).r * 0.15;
float scrub = smoothstep(0.47, 0.7, scrubN + sp.b * 0.25 - dry * 0.18) * (1.0 - smoothstep(0.35, 0.6, slope));
// softer from range: at altitude the full-strength clumps read as heavy dark blotches across the gold hillsides
scrub *= 0.62 - 0.22 * smoothstep(250.0, 1400.0, camD);
col = mix(col, mix(SCRUB, MEADOW, 0.35), scrub);
col *= mix(1.0, mix(dG, dD, smoothstep(0.3, 0.75, dry)), 0.6);
vec3 tn = mix(nG, nDr, smoothstep(0.3, 0.75, dry)); float rough = 0.92;
// farmland: rotated field grid, each field its own crop (wheat, stubble, olive grove, vineyard, ploughed earth)
if (sp.r > 0.01) {
  vec2 blk = floor(wxz / 700.0); float ang = hash12(blk) * 3.1416;
  vec2 fl = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * wxz;
  vec2 fsz = vec2(46.0, 78.0); vec2 fid = floor(fl / fsz); vec2 fu = fract(fl / fsz);
  float r = hash12(fid + blk * 13.0);
  vec3 crop = r < 0.3 ? vec3(0.5, 0.37, 0.14) : r < 0.5 ? vec3(0.5, 0.39, 0.21) : r < 0.7 ? vec3(0.16, 0.18, 0.07) : r < 0.85 ? vec3(0.12, 0.17, 0.05) : vec3(0.33, 0.19, 0.1);
  float rows = 0.88 + 0.12 * sin(fl.x * 3.1);
  float fd = clamp(dot(sampD(wxz / 6.0, 5.0, 0.0).rgb, vec3(0.3, 0.55, 0.15)) / 0.23, 0.6, 1.4);
  vec3 fcol = crop * mix(1.0, fd, 0.5) * rows;
  float edge = min(min(fu.x, 1.0 - fu.x) * fsz.x, min(fu.y, 1.0 - fu.y) * fsz.y);
  fcol = mix(SCRUB * 1.3, fcol, smoothstep(0.8, 2.2, edge));
  float fw = smoothstep(0.2, 0.6, sp.r);
  col = mix(col, fcol, fw); rough = mix(rough, 0.95, fw);
}
// pine/olive forest floor: needles + shade, and packed earth around roads/settlements
float wFF = clamp(sp.b * (0.55 + nzB.g * 0.5), 0.0, 1.0) * 0.75;
if (wFF > 0.01) col = mix(col, mix(FFLOOR, SCRUB, 0.35 + 0.3 * nzC.g) * dD, wFF);
float wDirt = clamp(sp.a * 0.9, 0.0, 1.0);
if (wDirt > 0.01) { vec2 uv = wxz / 6.0; vec4 c = sampD(uv, 5.0, mixv); vec3 n = sampN(uv, 5.0, mixv);
  float dd = clamp(dot(c.rgb, vec3(0.3, 0.55, 0.15)) / 0.23, 0.5, 1.5);
  col = mix(col, DIRT * dd, wDirt); tn = mix(tn, n, wDirt); }
if (wSand > 0.01) { vec2 uv = wxz / 7.0; vec4 c = sampD(uv, 3.0, mixv); vec3 n = sampN(uv, 3.0, mixv);
  float wet = 1.0 - smoothstep(-0.5, 1.2, h);
  float sd = clamp(dot(c.rgb, vec3(0.3, 0.55, 0.15)) / 0.175, 0.6, 1.4);
  vec3 sc = vec3(0.52, 0.41, 0.25) * mix(1.0, sd, 0.6) * mix(1.0, 0.55, wet);
  col = mix(col, sc, wSand); tn = mix(tn, n, wSand); rough = mix(rough, mix(0.95, 0.45, wet), wSand); }
// rock: triplanar; warm limestone with ochre / tan strata, crevices, ledge scrub
if (wRock > 0.01) {
  vec3 bw = pow(abs(wN), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
  vec3 p = vWPos / 16.0;
  vec4 cx = texture(tDiff, vec3(p.zy, 2.0)), cy = texture(tDiff, vec3(p.xz, 2.0)), cz = texture(tDiff, vec3(p.xy, 2.0));
  vec3 rc = (cx.rgb * bw.x + cy.rgb * bw.y + cz.rgb * bw.z);
  vec3 pm = vWPos / 110.0; vec2 sw = vec2(0.37, 0.71);
  vec3 mc = texture(tDiff, vec3(pm.zy + sw, 2.0)).rgb * bw.x + texture(tDiff, vec3(pm.xz + sw, 2.0)).rgb * bw.y + texture(tDiff, vec3(pm.xy + sw, 2.0)).rgb * bw.z;
  float far = smoothstep(60.0, 500.0, camD);
  float lum = dot(rc, vec3(0.3, 0.55, 0.15)), mlum = dot(mc, vec3(0.3, 0.55, 0.15));
  float sy = vWPos.y + (nzA.g - 0.5) * 60.0 + (nzB.r - 0.5) * 9.0 + dot(vWPos.xz, vec2(0.035, -0.02));
  float band = sin(sy * 0.29) * 0.45 + sin(sy * 0.71 + nzA.b * 6.0) * 0.3 + sin(sy * 0.053 + 1.3) * 0.25;
  band = smoothstep(-0.55, 0.65, band) * mix(0.35, 1.0, smoothstep(0.3, 0.7, nzB.g));
  band = mix(band, 0.5, far * 0.75); // fine strata alias into contour lines at range: fade them, keep the broad ones
  float band2 = sin(sy * 0.021 + nzA.r * 4.0) * 0.5 + 0.5;
  vec3 rkA = vec3(0.35, 0.28, 0.19), rkB = vec3(0.38, 0.22, 0.1), rkC = vec3(0.19, 0.135, 0.085);
  vec3 tint = mix(rkA, rkB, smoothstep(0.35, 0.8, nzA.r * 0.6 + band2 * 0.5));
  tint = mix(tint, rkC, smoothstep(0.55, 0.9, nzB.b * 0.6 + (1.0 - band) * 0.3 + (1.0 - band2) * 0.3) * 0.6);
  tint *= 0.8 + 0.4 * nzA.a;
  float detail = clamp(mix(lum, mix(lum, mlum, 0.6), far) / 0.075, 0.4, 1.8);
  rc = tint * mix(1.0, detail, 0.7) * (0.9 + 0.16 * band) * (0.8 + 0.4 * nzB.a);
  float crev = smoothstep(0.045, 0.015, mix(lum, mlum, far * 0.7)) * smoothstep(0.25, 0.6, slope);
  rc *= 1.0 - crev * 0.45;
  float ledge = smoothstep(0.6, 0.84, wN.y) * (1.0 - smoothstep(420.0, 620.0, h)) * smoothstep(0.3, 0.6, nzC.g * 0.7 + nzB.g * 0.3 + band * 0.2);
  rc = mix(rc, SCRUB * (0.9 + 0.4 * nzC.r), ledge * 0.75);
  vec3 nx = texture(tNor, vec3(p.zy, 2.0)).xyz * 2.0 - 1.0, ny = texture(tNor, vec3(p.xz, 2.0)).xyz * 2.0 - 1.0, nz = texture(tNor, vec3(p.xy, 2.0)).xyz * 2.0 - 1.0;
  vec3 wx = vec3(0.0, nx.y, nx.x) * bw.x, wy = vec3(ny.x, 0.0, ny.y) * bw.y, wz = vec3(nz.x, nz.y, 0.0) * bw.z;
  vec3 rn = normalize(wN + (wx + wy + wz) * 1.2);
  float hb = smoothstep(0.0, 1.0, clamp(wRock + (detail - 1.0) * 0.3 * wRock * (1.0 - wRock) * 4.0, 0.0, 1.0));
  col = mix(col, rc, hb); rough = mix(rough, 0.82, hb);
  tn = mix(tn, vec3(0.0, 0.0, 1.0), hb);
  wN = normalize(mix(wN, rn, hb));
}
if (wSnow > 0.01) { vec2 uv = wxz / 10.0; vec4 c = sampD(uv, 4.0, mixv); vec3 n = sampN(uv, 4.0, mixv);
  col = mix(col, c.rgb * vec3(0.96, 0.98, 1.04), wSnow); tn = mix(tn, n, wSnow); rough = mix(rough, 0.55, wSnow); }
col *= mix(1.0, 0.7, 1.0 - smoothstep(-6.0, 0.0, h));
// gentle macro variation only (strong multiplicative noise read as camouflage blotches)
col *= 0.92 + 0.16 * nzA.b;
col *= 0.96 + 0.08 * nzC.r;
// faint drifting cloud shadows: broad, soft-edged, low contrast (sky clouds are high and thin)
{ vec2 cw = uTime * vec2(5.5, 2.2);
  float cs = texture(tNoise, (wxz + cw) / 3100.0).g * 0.65 + texture(tNoise, (wxz + cw * 1.3) / 1300.0).b * 0.35;
  col *= 1.0 - smoothstep(0.56, 0.78, cs) * 0.1; }
col = mix(col, col * vec3(1.04, 1.0, 0.9), smoothstep(400.0, 2500.0, camD) * 0.5);
diffuseColor.rgb *= col;
// tangent frame for top-down projection (u = +x, v = +z)
vec3 Tt = normalize(vec3(1.0, 0.0, 0.0) - wN * wN.x); vec3 Bt = normalize(cross(Tt, wN)) * -1.0;
float nStr = 1.0 - smoothstep(150.0, 900.0, camD) * 0.7;
vec3 tNorW = normalize(Tt * tn.x * nStr + Bt * tn.y * nStr + wN * max(tn.z, 0.2));
float tRough = rough;
`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
        .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(tNorW, 0.0)).xyz);');
    };
    m.customProgramCacheKey = () => 'corvana-terrain-v3';
    return m;
  }

  // ---------------- quadtree LOD chunks ----------------
  const RES = 64;                  // quads per chunk side (64: 4x fewer chunks / draw calls than 32 at the same density)
  const MIN_SIZE = RES * CELL;     // 256 m leaves at full grid res
  const root = new THREE.Group(); root.name = 'terrain';
  const cache = new Map();
  let frame = 0;
  // shared index buffer: grid + skirt (diagonal p10-p01 to match Rapier)
  const VG = RES + 1, gridCount = VG * VG, skirtCount = RES * 4;
  const idx = [];
  for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
    const a = j * VG + i, b = a + 1, c = a + VG, d = c + 1; // a=p00 b=p10 c=p01 d=p11
    idx.push(a, c, b, b, c, d);
  }
  // skirt ring: border vertices in order around the perimeter
  const ring = [];
  for (let i = 0; i < RES; i++) ring.push(i);                       // top edge (j=0)
  for (let j = 0; j < RES; j++) ring.push(j * VG + RES);            // right edge
  for (let i = RES; i > 0; i--) ring.push(RES * VG + i);            // bottom edge
  for (let j = RES; j > 0; j--) ring.push(j * VG);                  // left edge
  for (let r = 0; r < skirtCount; r++) {
    const a = ring[r], b = ring[(r + 1) % skirtCount], sa = gridCount + r, sb = gridCount + (r + 1) % skirtCount;
    idx.push(a, sa, b, b, sa, sb); idx.push(a, b, sa, b, sb, sa); // both windings (cheap, avoids culling issues)
  }
  const indexAttr = new THREE.BufferAttribute(new Uint16Array(idx), 1);

  function buildChunk(level, cx, cz) { // level 0 = leaf (128 m)
    const size = MIN_SIZE << level, step = 1 << level;   // grid cells per quad
    const i0 = ((cx * size) / CELL) | 0, j0 = ((cz * size) / CELL) | 0;
    const pos = new Float32Array((gridCount + skirtCount) * 3), nor = new Float32Array((gridCount + skirtCount) * 3);
    let minY = 1e9, maxY = -1e9;
    for (let j = 0; j < VG; j++) for (let i = 0; i < VG; i++) {
      const gi = i0 + i * step, gj = j0 + j * step, v = j * VG + i;
      const y = gridH(gi, gj);
      pos[v * 3] = -HALF + gi * CELL; pos[v * 3 + 1] = y; pos[v * 3 + 2] = -HALF + gj * CELL;
      const dx = (gridH(gi + step, gj) - gridH(gi - step, gj)), dz = (gridH(gi, gj + step) - gridH(gi, gj - step));
      const s = 2 * step * CELL, l = Math.hypot(dx, s, dz);
      nor[v * 3] = -dx / l; nor[v * 3 + 1] = s / l; nor[v * 3 + 2] = -dz / l;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const skirtDepth = 2 + size * 0.03;
    for (let r = 0; r < skirtCount; r++) {
      const a = ring[r], v = gridCount + r;
      pos[v * 3] = pos[a * 3]; pos[v * 3 + 1] = pos[a * 3 + 1] - skirtDepth; pos[v * 3 + 2] = pos[a * 3 + 2];
      nor[v * 3] = nor[a * 3]; nor[v * 3 + 1] = nor[a * 3 + 1]; nor[v * 3 + 2] = nor[a * 3 + 2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(indexAttr);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(pos[0], minY - skirtDepth, pos[2]), new THREE.Vector3(pos[0] + size, maxY, pos[2] + size));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(g, material);
    mesh.matrixAutoUpdate = false; mesh.receiveShadow = true; mesh.castShadow = level === 0; // 256 m leaves only: coarser chunks are beyond the shadow range anyway
    mesh.userData.terrain = true; mesh.userData.minY = minY; mesh.userData.maxY = maxY;
    return mesh;
  }
  // node height range for LOD distance: from a coarse min/max pyramid
  const LEVELS = Math.log2((2 * HALF) / MIN_SIZE); // 6 => root level 6 covers 8192 m
  const ranges = [];
  {
    const n0 = (2 * HALF) / MIN_SIZE; // 64 leaves per side
    let mn = new Float32Array(n0 * n0), mx = new Float32Array(n0 * n0);
    for (let cz = 0; cz < n0; cz++) for (let cx = 0; cx < n0; cx++) {
      let a = 1e9, b = -1e9;
      for (let j = 0; j <= RES; j += 4) for (let i = 0; i <= RES; i += 4) { const y = gridH(cx * RES + i, cz * RES + j); if (y < a) a = y; if (y > b) b = y; }
      mn[cz * n0 + cx] = a; mx[cz * n0 + cx] = b;
    }
    ranges.push({ n: n0, mn, mx });
    for (let L = 1; L <= LEVELS; L++) {
      const p = ranges[L - 1], n = p.n / 2, a = new Float32Array(n * n), b = new Float32Array(n * n);
      for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
        const q = [(2 * z) * p.n + 2 * x, (2 * z) * p.n + 2 * x + 1, (2 * z + 1) * p.n + 2 * x, (2 * z + 1) * p.n + 2 * x + 1];
        a[z * n + x] = Math.min(...q.map(k => p.mn[k])); b[z * n + x] = Math.max(...q.map(k => p.mx[k]));
      }
      ranges.push({ n, mn: a, mx: b });
    }
  }
  // the ranges above were built on the pre-flatten grid if called early; refresh() rebuilds them
  function refreshRanges() {
    const r0 = ranges[0], n0 = r0.n;
    for (let cz = 0; cz < n0; cz++) for (let cx = 0; cx < n0; cx++) {
      let a = 1e9, b = -1e9;
      for (let j = 0; j <= RES; j += 2) for (let i = 0; i <= RES; i += 2) { const y = gridH(cx * RES + i, cz * RES + j); if (y < a) a = y; if (y > b) b = y; }
      r0.mn[cz * n0 + cx] = a; r0.mx[cz * n0 + cx] = b;
    }
    for (let L = 1; L <= LEVELS; L++) {
      const p = ranges[L - 1], c = ranges[L], n = c.n;
      for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
        const k = [(2 * z) * p.n + 2 * x, (2 * z) * p.n + 2 * x + 1, (2 * z + 1) * p.n + 2 * x, (2 * z + 1) * p.n + 2 * x + 1];
        c.mn[z * n + x] = Math.min(p.mn[k[0]], p.mn[k[1]], p.mn[k[2]], p.mn[k[3]]);
        c.mx[z * n + x] = Math.max(p.mx[k[0]], p.mx[k[1]], p.mx[k[2]], p.mx[k[3]]);
      }
    }
  }

  let lodFactor = 0.95; // split distance / node size (RES 64: 0.95 matches the old 32-quad 1.9 triangle density)
  const want = [];
  function select(level, cx, cz, cam) {
    const size = MIN_SIZE << level;
    const x0 = -HALF + cx * size, z0 = -HALF + cz * size;
    const r = ranges[level], k = cz * r.n + cx;
    const dx = Math.max(x0 - cam.x, 0, cam.x - (x0 + size));
    const dz = Math.max(z0 - cam.z, 0, cam.z - (z0 + size));
    const dy = Math.max(r.mn[k] - cam.y, 0, cam.y - r.mx[k]);
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (level > 0 && d < size * lodFactor) {
      for (let q = 0; q < 4; q++) select(level - 1, cx * 2 + (q & 1), cz * 2 + (q >> 1), cam);
    } else want.push(level, cx, cz);
  }
  const _cam = new THREE.Vector3();
  let lastCam = new THREE.Vector3(1e9, 0, 0);
  function update(camera) {
    frame++;
    uniforms.uTime.value = performance.now() / 1000;
    camera.getWorldPosition(_cam);
    if (_cam.distanceToSquared(lastCam) < 1) { return; }
    lastCam.copy(_cam);
    want.length = 0;
    select(LEVELS, 0, 0, _cam);
    for (const m of root.children) m.visible = false;
    for (let w = 0; w < want.length; w += 3) {
      const key = (want[w] << 24) | (want[w + 2] << 12) | want[w + 1];
      let m = cache.get(key);
      if (!m) { m = buildChunk(want[w], want[w + 1], want[w + 2]); cache.set(key, m); root.add(m); m.updateMatrix(); }
      m.visible = true; m.userData.used = frame;
    }
    if (cache.size > 900) { // evict least-recently used
      const arr = [...cache.entries()].filter(([, m]) => !m.visible).sort((a, b) => a[1].userData.used - b[1].userData.used);
      for (let i = 0; i < arr.length - 700; i++) { const [k, m] = arr[i]; root.remove(m); m.geometry.dispose(); cache.delete(k); }
    }
  }
  function invalidate() { for (const [, m] of cache) { root.remove(m); m.geometry.dispose(); } cache.clear(); refreshRanges(); lastCam.set(1e9, 0, 0); }

  // ---------------- physics ----------------
  let collider = null;
  function buildCollider() {
    const R = game.RAPIER, W = game.physics;
    if (!R || !W) return null;
    if (collider) { W.removeCollider(collider, false); collider = null; }
    const hf = new Float32Array(NV * NV);
    for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) hf[i * NV + j] = H[j * NV + i];
    const desc = R.ColliderDesc.heightfield(N, N, hf, { x: 2 * HALF, y: 1, z: 2 * HALF }).setFriction(0.9);
    collider = W.createCollider(desc);
    collider.userData = { kind: 'terrain' };
    return collider;
  }

  async function initGPU() {
    const [d, n] = await Promise.all([loadArray('diff'), loadArray('nor')]);
    uniforms.tDiff.value = d; uniforms.tNor.value = n; uniforms.tNoise.value = makeNoiseTex();
    material = makeMaterial();
  }
  function finalize() { // after all flattening
    buildSplat();
    uniforms.tSplat.value = splatTex;
    invalidate();
  }

  return {
    H, islands, biome, heightAt, normalAt, slopeAt, splatAt, roadMaskAt, flattenSite, flattenRoad, applyRoads,
    initGPU, finalize, buildCollider, update, root, uniforms,
    get heightTex() { return heightTex; }, get material() { return material; }, get collider() { return collider; },
    setLodFactor(f) { lodFactor = f; lastCam.set(1e9, 0, 0); },
  };
}
