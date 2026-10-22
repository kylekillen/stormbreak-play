// STORMBREAK fx: pooled, GPU-friendly particles and one-shot effects.
// Two instanced billboard pools (alpha-blended smoke/dust, additive fire/sparks) drawn with one
// procedural texture atlas, plus pooled debris chunks, shockwave rings, scorch/bullet decals and a
// tiny pool of always-on PointLights for flashes (never toggled visible, so no shader recompiles).
//
// API (game.fx):
//   explosion(pos, size=6, opts)       big cinematic blast (size ≈ radius in metres). opts.silent, opts.noColumn
//   smoke(pos, opts) -> handle|null    burst ({count,size,color,life,rise}) or emitter if opts.duration
//   fire(pos, opts) -> handle          {stop(), setPos(v), setIntensity(k), alive}; opts {size, obj, offset, duration, smoke}
//   trail(objOrFn, opts) -> handle     smoke trail following an Object3D or a () => Vector3
//   sparks(pos, normal, count)         hit sparks (also used for T-rated body hits)
//   impact(pos, normal, surface, opts) surface: dirt grass sand concrete stone metal wood water glass snow body
//   splash(pos, size=1)  tracer(from, to, opts)  muzzle(objOrPos, dir, opts)  debris(pos, count, opts)
//   dust(pos, opts)  flash(pos, intensity, range, dur)  column(pos, opts)  scorch(pos, normal, radius)
//   bulletHole(pos, normal)  stats()

const MAXA = 6500, MAXB = 4500;     // alpha / additive particle caps
const CELL = { smoke: 0, flame: 4, glow: 8, spark: 9, ring: 10, chunk: 11, drop: 12, star: 14, dust: 15 };

let T, game, scene;
const tmpV = () => new T.Vector3();

// ---------------------------------------------------------------- atlas texture
function makeAtlas() {
  const N = 1024, C = 256, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d');
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cell = (i, fn) => { g.save(); g.translate((i % 4) * C, Math.floor(i / 4) * C); g.beginPath(); g.rect(0, 0, C, C); g.clip(); fn(); g.restore(); };
  const blob = (x, y, r, a, col = '255,255,255') => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(0.55, `rgba(${col},${a * 0.45})`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  };
  // 0-3 smoke puffs: clustered soft blobs, light at top for a fake lit look
  for (let k = 0; k < 4; k++) cell(k, () => {
    for (let i = 0; i < 46; i++) {
      const a = rnd() * 6.283, d = Math.pow(rnd(), 0.7) * 70;
      const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d, r = 26 + rnd() * 40;
      const shade = Math.round(200 + 55 * (1 - (y - 40) / 180));
      blob(x, y, r, 0.16 + rnd() * 0.14, `${shade},${shade},${shade}`);
    }
  });
  // 4-7 flame licks: bright cores with ragged tongues
  for (let k = 0; k < 4; k++) cell(4 + k, () => {
    for (let i = 0; i < 34; i++) {
      const a = rnd() * 6.283, d = Math.pow(rnd(), 1.2) * 72;
      const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d * 1.1 - 8, r = 16 + rnd() * 36;
      blob(x, y, r, 0.22 + rnd() * 0.25);
    }
    blob(128, 132, 70, 0.55);
  });
  cell(8, () => { const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.65)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.14)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256); });
  cell(9, () => { g.translate(128, 128); g.scale(1, 0.16); const gr = g.createRadialGradient(0, 0, 0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 128, 0, 7); g.fill(); });
  cell(10, () => { const gr = g.createRadialGradient(128, 128, 60, 128, 128, 126);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.86, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256); });
  cell(11, () => { g.fillStyle = '#fff'; for (let i = 0; i < 9; i++) { g.beginPath();
    const cx = 40 + rnd() * 176, cy = 40 + rnd() * 176, r = 8 + rnd() * 22;
    for (let j = 0; j < 6; j++) { const a = j / 6 * 6.283 + rnd() * 0.6, rr = r * (0.6 + rnd() * 0.6); g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    g.fill(); } });
  cell(12, () => { for (let i = 0; i < 40; i++) blob(128 + (rnd() - 0.5) * 170, 128 + (rnd() - 0.5) * 170, 5 + rnd() * 14, 0.9); blob(128, 128, 90, 0.25); });
  cell(13, () => { blob(128, 128, 120, 0.9); });
  cell(14, () => { g.translate(128, 128); for (let i = 0; i < 6; i++) { g.rotate(Math.PI / 3 + rnd() * 0.2); g.save(); g.scale(1, 0.09 + rnd() * 0.05);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 128 * (0.6 + rnd() * 0.4)); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 128, 0, 7); g.fill(); g.restore(); }
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 60); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(-128, -128, 256, 256); });
  cell(15, () => { for (let i = 0; i < 30; i++) { const a = rnd() * 6.283, d = Math.pow(rnd(), 0.6) * 80;
    blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d * 0.8, 30 + rnd() * 40, 0.1 + rnd() * 0.1); } });
  const tex = new T.CanvasTexture(cv);
  tex.colorSpace = T.SRGBColorSpace; tex.generateMipmaps = true; tex.minFilter = T.LinearMipmapLinearFilter;
  return tex;
}

function makeScorchTex(holes) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d');
  let seed = holes ? 99 : 31; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  if (holes) {
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.18, 'rgba(10,8,6,1)'); gr.addColorStop(0.35, 'rgba(40,36,30,0.7)'); gr.addColorStop(1, 'rgba(60,55,50,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  } else {
    for (let i = 0; i < 70; i++) {
      const a = rnd() * 6.283, d = Math.pow(rnd(), 0.8) * 85, x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d, r = 20 + rnd() * 45;
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(8,6,5,${0.25 + rnd() * 0.25})`); gr.addColorStop(1, 'rgba(8,6,5,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3;
    for (let i = 0; i < 22; i++) { const a = rnd() * 6.283; g.beginPath(); g.moveTo(128 + Math.cos(a) * 30, 128 + Math.sin(a) * 30);
      g.lineTo(128 + Math.cos(a + rnd() * 0.2) * (80 + rnd() * 45), 128 + Math.sin(a + rnd() * 0.2) * (80 + rnd() * 45)); g.stroke(); }
  }
  const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------- particle pool
const VS = /* glsl */`
attribute vec4 iPosSize; attribute vec4 iColor; attribute vec4 iMisc; attribute vec3 iVel;
varying vec2 vUv; varying vec4 vColor; varying float vEmis;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(iPosSize.xyz, 1.0);
  float size = iPosSize.w; vec2 c = position.xy;
  if (iMisc.z > 0.0) {
    vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz; vec2 d = vv.xy; float l = length(d);
    vec2 ax = l > 1e-4 ? d / l : vec2(1.0, 0.0); vec2 ay = vec2(-ax.y, ax.x);
    mvPosition.xy += ax * (c.x - 0.5) * (size + iMisc.z * l) + ay * c.y * size;
  } else {
    float s = sin(iMisc.x), co = cos(iMisc.x);
    mvPosition.xy += vec2(co * c.x - s * c.y, s * c.x + co * c.y) * size;
  }
  gl_Position = projectionMatrix * mvPosition;
  float cell = iMisc.y; vec2 cxy = vec2(mod(cell, 4.0), 3.0 - floor(cell / 4.0));
  vUv = (cxy + (c + 0.5)) / 4.0; vColor = iColor; vEmis = iMisc.w;
  #include <fog_vertex>
}`;
const FS = /* glsl */`
uniform sampler2D map; uniform vec3 uLight;
varying vec2 vUv; varying vec4 vColor; varying float vEmis;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(map, vUv);
#ifdef ADDITIVE
  vec3 col = vColor.rgb * t.rgb * t.a * vColor.a;
  gl_FragColor = vec4(col, 1.0);
#else
  float a = t.a * vColor.a; if (a < 0.003) discard;
  vec3 col = vColor.rgb * t.rgb * mix(uLight, vec3(1.0), vEmis);
  gl_FragColor = vec4(col, a);
#endif
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  #ifdef ADDITIVE
    gl_FragColor.rgb *= 1.0 - fogFactor;
  #else
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor * 0.85);
  #endif
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class Pool {
  constructor(max, additive, atlas) {
    this.max = max; this.n = 0;
    const F = k => new Float32Array(max * k);
    Object.assign(this, { p: F(3), v: F(3), age: F(1), life: F(1), s0: F(1), s1: F(1), rot: F(1), rv: F(1),
      c0: F(3), c1: F(3), a0: F(1), cell: F(1), drag: F(1), grav: F(1), str: F(1), emis: F(1), fin: F(1), ck: F(1), flg: F(1) });
    const geo = new T.InstancedBufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const IA = (k) => { const a = new T.InstancedBufferAttribute(new Float32Array(max * k), k); a.setUsage(T.DynamicDrawUsage); return a; };
    this.aPS = IA(4); this.aC = IA(4); this.aM = IA(4); this.aV = IA(3);
    geo.setAttribute('iPosSize', this.aPS); geo.setAttribute('iColor', this.aC); geo.setAttribute('iMisc', this.aM); geo.setAttribute('iVel', this.aV);
    geo.instanceCount = 0;
    this.mat = new T.ShaderMaterial({
      uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, { map: { value: null }, uLight: { value: new T.Color(1, 1, 1) } }]),
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, fog: true,
      blending: additive ? T.AdditiveBlending : T.NormalBlending, defines: additive ? { ADDITIVE: 1 } : {},
    });
    this.mat.uniforms.map.value = atlas;
    this.mesh = new T.Mesh(geo, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 12 : 10;
    this.mesh.name = additive ? 'fx-additive' : 'fx-alpha';
    this.geo = geo;
  }
  // o: {p, v, life, s0, s1, rot, rv, c0, c1, a, cell, drag, grav, str, emis, fin, ck, delay, ground}
  add(px, py, pz, vx, vy, vz, o) {
    let i = this.n;
    if (i >= this.max) i = (Math.random() * this.max) | 0; else this.n++;   // full: recycle a random slot
    const i3 = i * 3;
    this.p[i3] = px; this.p[i3 + 1] = py; this.p[i3 + 2] = pz;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.age[i] = -(o.delay || 0); this.life[i] = o.life || 1;
    this.s0[i] = o.s0 ?? 1; this.s1[i] = o.s1 ?? this.s0[i];
    this.rot[i] = o.rot ?? Math.random() * 6.283; this.rv[i] = o.rv ?? 0;
    const c0 = o.c0 || [1, 1, 1], c1 = o.c1 || c0;
    this.c0[i3] = c0[0]; this.c0[i3 + 1] = c0[1]; this.c0[i3 + 2] = c0[2];
    this.c1[i3] = c1[0]; this.c1[i3 + 1] = c1[1]; this.c1[i3 + 2] = c1[2];
    this.a0[i] = o.a ?? 1; this.cell[i] = o.cell ?? 0; this.drag[i] = o.drag ?? 0; this.grav[i] = o.grav ?? 0;
    this.str[i] = o.str ?? 0; this.emis[i] = o.emis ?? 0; this.fin[i] = o.fin ?? 0.1; this.ck[i] = o.ck ?? 1; this.flg[i] = o.ground ? 1 : 0;
  }
  kill(i) {
    const j = --this.n; if (i === j) return;
    const mv = (arr, k) => { for (let q = 0; q < k; q++) arr[i * k + q] = arr[j * k + q]; };
    mv(this.p, 3); mv(this.v, 3); mv(this.c0, 3); mv(this.c1, 3);
    for (const a of [this.age, this.life, this.s0, this.s1, this.rot, this.rv, this.a0, this.cell, this.drag, this.grav, this.str, this.emis, this.fin, this.ck, this.flg]) a[i] = a[j];
  }
  update(dt, wind, groundFn) {
    const { p, v, age, life } = this;
    const PS = this.aPS.array, C = this.aC.array, M = this.aM.array, V = this.aV.array;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      age[i] += dt;
      if (age[i] >= life[i]) { this.kill(i); i--; continue; }
      if (age[i] < 0) continue;
      const i3 = i * 3, d = Math.max(0, 1 - this.drag[i] * dt);
      v[i3] = v[i3] * d + wind.x * this.drag[i] * dt * 0.5;
      v[i3 + 1] = v[i3 + 1] * d - this.grav[i] * dt;
      v[i3 + 2] = v[i3 + 2] * d + wind.z * this.drag[i] * dt * 0.5;
      p[i3] += v[i3] * dt; p[i3 + 1] += v[i3 + 1] * dt; p[i3 + 2] += v[i3 + 2] * dt;
      if (this.flg[i] && groundFn) {   // bounce/settle on the ground
        const gy = groundFn(p[i3], p[i3 + 2]);
        if (p[i3 + 1] < gy) { p[i3 + 1] = gy; v[i3 + 1] *= -0.3; v[i3] *= 0.5; v[i3 + 2] *= 0.5; }
      }
      this.rot[i] += this.rv[i] * dt;
      const t = age[i] / life[i];
      const fin = this.fin[i];
      const alpha = this.a0[i] * (t < fin ? t / fin : 1) * (1 - Math.pow((t - fin) / (1 - fin) > 0 ? (t - fin) / (1 - fin) : 0, 1.6));
      const e = 1 - (1 - t) * (1 - t);
      const size = this.s0[i] + (this.s1[i] - this.s0[i]) * e;
      const ct = Math.min(1, t * this.ck[i]);
      const w4 = w * 4, w3 = w * 3;
      PS[w4] = p[i3]; PS[w4 + 1] = p[i3 + 1]; PS[w4 + 2] = p[i3 + 2]; PS[w4 + 3] = size;
      C[w4] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * ct;
      C[w4 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * ct;
      C[w4 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * ct;
      C[w4 + 3] = alpha;
      M[w4] = this.rot[i]; M[w4 + 1] = this.cell[i]; M[w4 + 2] = this.str[i]; M[w4 + 3] = this.emis[i];
      V[w3] = v[i3]; V[w3 + 1] = v[i3 + 1]; V[w3 + 2] = v[i3 + 2];
      w++;
    }
    this.geo.instanceCount = w;
    if (w) {
      for (const a of [this.aPS, this.aC, this.aM, this.aV]) { a.clearUpdateRanges?.(); a.addUpdateRange?.(0, w * a.itemSize); a.needsUpdate = true; }
    }
  }
}

// ---------------------------------------------------------------- module state
let A, B;                     // alpha + additive pools
const emitters = [];          // continuous emitters (fire, smoke, columns, trails)
let debris, debrisData = [];  // instanced chunks
const DEBRIS_MAX = 260;
const rings = [];             // shockwave meshes
const decals = [], holes = [];
const lights = [];
const wind = { x: 1.6, z: 0.7 };
const R = (a, b) => a + Math.random() * (b - a);
const rs = () => Math.random() * 2 - 1;

function groundAt(x, z) {
  const h = game.world?.heightAt?.(x, z);
  return Number.isFinite(h) ? h : 0;
}
function isWater(x, z) { try { return !!game.world?.isWater?.(x, z); } catch { return false; } }
function V3(p) { return p?.isVector3 ? p : new T.Vector3(p?.x || 0, p?.y || 0, p?.z || 0); }
function camDist(p) { return game.camera ? game.camera.position.distanceTo(p) : 50; }

function shake(pos, amount, range) {
  const d = camDist(pos), k = Math.max(0, 1 - d / range);
  if (k > 0.01) { try { if (game.gfx?.shake) game.gfx.shake(amount * k * k, 0.25 + 0.5 * k); else game.cam?.shake?.(Math.min(1, amount * k * k * 0.6)); } catch { /* optional */ } }
}
function sound(name, pos, opts = {}) { try { game.audio?.play?.(name, { pos, ...opts }); } catch { /* optional */ } }

// ---------------------------------------------------------------- building blocks
function flash(pos, intensity = 1, range = 40, dur = 0.35, color = 0xffb060) {
  let best = lights[0];
  for (const L of lights) if (L.userData.t <= 0) { best = L; break; } else if (L.userData.t < best.userData.t) best = L;
  if (!best) return;
  best.position.copy(pos); best.color.set(color); best.distance = range;
  best.userData.t = dur; best.userData.dur = dur; best.userData.peak = intensity * range * range * 3;
}

function glow(pos, size, color, life, cell = CELL.glow) {
  B.add(pos.x, pos.y, pos.z, 0, 0, 0, { life, s0: size, s1: size * 1.3, c0: color, a: 1, cell, fin: 0.02, rot: Math.random() * 6.3 });
}

function sparks(pos, normal, count = 10, opts = {}) {
  pos = V3(pos); const n = normal ? V3(normal) : new T.Vector3(0, 1, 0);
  const speed = opts.speed || 14, hot = opts.color || [6, 3.6, 1.4];
  for (let i = 0; i < count; i++) {
    const d = new T.Vector3(rs(), rs(), rs()).normalize().add(n.clone().multiplyScalar(1.2)).normalize();
    const s = speed * R(0.35, 1.2);
    B.add(pos.x, pos.y, pos.z, d.x * s, d.y * s, d.z * s, { life: R(0.15, 0.5) * (opts.life || 1), s0: 0.05 * (opts.size || 1), s1: 0.03, c0: hot, c1: [2.4, 0.5, 0.08], ck: 1.2, cell: CELL.spark, grav: 9.8, drag: 1.2, str: 0.035, fin: 0.01 });
  }
  if (opts.glow !== false) glow(pos, 0.5 * (opts.size || 1), [4, 2.6, 1.2], 0.06);
}

function dustPuff(pos, o = {}) {
  const n = o.count ?? 5, col = o.color || [0.55, 0.5, 0.42], sz = o.size || 0.6;
  for (let i = 0; i < n; i++) {
    const up = o.normal ? V3(o.normal) : new T.Vector3(0, 1, 0);
    const d = new T.Vector3(rs(), rs(), rs()).multiplyScalar(0.7).add(up).normalize(), s = R(0.5, 2.5) * (o.speed || 1);
    A.add(pos.x, pos.y, pos.z, d.x * s, d.y * s, d.z * s, { life: R(0.8, 2.0) * (o.life || 1), s0: sz * 0.5, s1: sz * R(1.6, 2.6), c0: col, c1: col.map(c => c * 1.1), a: o.alpha ?? 0.55, cell: o.cell ?? CELL.dust, drag: 2.2, grav: -0.2, rv: rs() * 0.6, fin: 0.08 });
  }
}

function chips(pos, normal, n, col, o = {}) {
  const nn = normal ? V3(normal) : new T.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const d = new T.Vector3(rs(), rs(), rs()).add(nn.clone().multiplyScalar(1.3)).normalize(), s = R(3, 9) * (o.speed || 1);
    A.add(pos.x, pos.y, pos.z, d.x * s, d.y * s, d.z * s, { life: R(0.5, 1.2), s0: (o.size || 0.06) * R(0.6, 1.4), c0: col, a: 1, cell: CELL.chunk, grav: 9.8, drag: 0.4, rv: rs() * 14, fin: 0.01, ground: true });
  }
}

function splash(pos, size = 1) {
  pos = V3(pos); const y = Math.max(pos.y, game.world?.seaLevel ?? 0);
  const n = Math.round(18 * Math.min(4, size));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, r = R(0.2, 1.2) * size, up = R(4, 11) * Math.sqrt(size);
    B.add(pos.x, y, pos.z, Math.cos(a) * r * 2, up, Math.sin(a) * r * 2, { life: R(0.5, 1.3) * Math.sqrt(size), s0: 0.12 * size, s1: 0.08 * size, c0: [0.95, 0.98, 1.0], cell: CELL.spark, grav: 9.8, drag: 0.3, str: 0.05, fin: 0.02, a: 0.55 });
  }
  for (let i = 0; i < Math.round(8 * Math.min(3, size)); i++) {
    const a = Math.random() * 6.283;
    A.add(pos.x + Math.cos(a) * 0.4 * size, y + 0.2, pos.z + Math.sin(a) * 0.4 * size, Math.cos(a) * 2 * size, R(1, 4) * size, Math.sin(a) * 2 * size,
      { life: R(0.9, 2.2), s0: 0.6 * size, s1: 2.6 * size, c0: [0.92, 0.95, 0.97], a: 0.6, cell: CELL.drop, drag: 1.6, grav: 1.5, rv: rs(), fin: 0.05, emis: 0.3 });
  }
  ring(new T.Vector3(pos.x, y + 0.05, pos.z), 2.5 * size, 1.1, [0.9, 0.95, 1], 0.5, false);
  if (size > 0.6) sound('splash', pos, { volume: Math.min(1, size * 0.5) });
}

function ring(pos, radius, dur, color = [1, 0.85, 0.6], alpha = 0.8, additive = true) {
  let r = rings.find(x => !x.visible) || rings.reduce((a, b) => (a.userData.t > b.userData.t ? a : b));
  r.position.copy(pos); r.visible = true;
  r.userData = { t: 0, dur, radius, alpha };
  r.material.color.setRGB(color[0], color[1], color[2]);
  r.material.blending = additive ? T.AdditiveBlending : T.NormalBlending;
  r.scale.setScalar(0.01);
}

function placeDecal(arr, max, mat, pos, normal, size, life) {
  let d;
  if (arr.length < max) { d = new T.Mesh(DECAL_GEO, mat.clone()); d.renderOrder = 2; d.receiveShadow = true; scene.add(d); arr.push(d); }
  else d = arr.reduce((a, b) => (a.userData.age > b.userData.age ? a : b));
  const n = normal ? V3(normal).clone().normalize() : new T.Vector3(0, 1, 0);
  d.position.copy(pos).addScaledVector(n, 0.03);
  d.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), n);
  d.rotateZ(Math.random() * 6.283);
  d.scale.setScalar(size); d.visible = true; d.material.opacity = 1;
  d.userData = { age: 0, life };
}
let DECAL_GEO, scorchMat, holeMat;
function scorch(pos, normal, radius = 4) { placeDecal(decals, 48, scorchMat, V3(pos), normal, radius * 2.2, 120); }
function bulletHole(pos, normal) { placeDecal(holes, 96, holeMat, V3(pos), normal, R(0.12, 0.2), 25); }

function debrisBurst(pos, count = 12, o = {}) {
  pos = V3(pos);
  const speed = o.speed || 18, size = o.size || 0.5;
  for (let i = 0; i < count; i++) {
    let d = debrisData.find(x => !x.alive);
    if (!d) d = debrisData.reduce((a, b) => (a.age > b.age ? a : b));
    const dir = new T.Vector3(rs(), Math.random() * 1.4 + 0.25, rs()).normalize();
    const s = speed * R(0.35, 1.1);
    d.alive = true; d.age = 0; d.life = R(4, 8); d.bounces = 0;
    d.p.copy(pos).addScaledVector(dir, R(0.2, 1.0) * size * 2);
    d.v.copy(dir).multiplyScalar(s);
    d.w.set(rs(), rs(), rs()).multiplyScalar(R(4, 14));
    d.q.setFromEuler(new T.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    d.s.set(R(0.4, 1.4), R(0.3, 1), R(0.4, 1.4)).multiplyScalar(size * R(0.5, 1.4));
    d.burn = o.burning !== false && Math.random() < (o.burnChance ?? 0.45);
    d.smoke = Math.random() < 0.5; d.emitLast = null;
    const c = o.color || [0.18, 0.17, 0.16]; const k = R(0.7, 1.2);
    debris.setColorAt(d.i, new T.Color(c[0] * k, c[1] * k, c[2] * k));
  }
  if (debris.instanceColor) debris.instanceColor.needsUpdate = true;
}

// ---------------------------------------------------------------- emitters
function addEmitter(e) { e.alive = true; e.age = 0; e.acc = 0; emitters.push(e);
  return { get alive() { return e.alive; }, stop() { e.alive = false; }, setPos(v) { e.pos.copy(v); }, setIntensity(k) { e.k = k; }, emitter: e }; }

function fire(pos, opts = {}) {
  const e = { kind: 'fire', pos: V3(pos).clone(), size: opts.size || 1, k: 1, duration: opts.duration ?? Infinity,
    obj: opts.obj || null, offset: opts.offset ? V3(opts.offset).clone() : new T.Vector3(), smoke: opts.smoke !== false, glowT: 0 };
  return addEmitter(e);
}
function smoke(pos, opts = {}) {
  pos = V3(pos);
  if (opts.duration) return addEmitter({ kind: 'smoke', pos: pos.clone(), size: opts.size || 2, k: 1, duration: opts.duration, color: opts.color || [0.3, 0.3, 0.3], rate: opts.rate || 6, rise: opts.rise ?? 2, obj: opts.obj || null, offset: opts.offset ? V3(opts.offset).clone() : new T.Vector3() });
  const n = opts.count || 8, sz = opts.size || 2, col = opts.color || [0.3, 0.3, 0.3];
  for (let i = 0; i < n; i++) A.add(pos.x + rs() * sz * 0.3, pos.y, pos.z + rs() * sz * 0.3, rs() * 0.8, (opts.rise ?? 2) * R(0.6, 1.3), rs() * 0.8,
    { life: (opts.life || 4) * R(0.7, 1.3), s0: sz * 0.5, s1: sz * R(1.8, 3), c0: col, c1: col.map(c => Math.min(1, c * 1.4)), a: opts.alpha ?? 0.7, cell: (Math.random() * 4) | 0, drag: 0.8, grav: -0.3, rv: rs() * 0.4, fin: 0.12 });
  return null;
}
function column(pos, opts = {}) {
  return addEmitter({ kind: 'column', pos: V3(pos).clone(), size: opts.size || 10, k: 1, duration: opts.duration || 35, rate: opts.rate || 2.4, dark: opts.dark ?? 0.1 });
}
function trail(target, opts = {}) {
  const get = typeof target === 'function' ? target : () => target.getWorldPosition ? target.getWorldPosition(new T.Vector3()) : V3(target);
  const p = get();
  return addEmitter({ kind: 'trail', get, last: p.clone(), pos: p.clone(), size: opts.size || 0.6, k: 1, duration: opts.duration ?? 30, spacing: opts.spacing || Math.max(0.2, (opts.size || 0.6) * 0.5),
    color: opts.color || [0.75, 0.73, 0.7], flame: opts.flame !== false, life: opts.life || 2.6 });
}

function updateEmitters(dt) {
  for (let i = emitters.length - 1; i >= 0; i--) {
    const e = emitters[i];
    e.age += dt;
    if (e.age > e.duration) e.alive = false;
    if (!e.alive) { emitters.splice(i, 1); continue; }
    if (e.obj) {
      if (e.obj.parent === null && e.obj !== scene) { e.alive = false; continue; }
      e.obj.updateWorldMatrix(true, false); e.pos.copy(e.offset).applyMatrix4(e.obj.matrixWorld);
    }
    const p = e.pos;
    if (e.kind === 'fire') {
      const s = e.size * e.k, rate = 22 * Math.sqrt(s) * Math.min(1, e.k);
      e.acc += dt * rate;
      while (e.acc >= 1) { e.acc--;
        const ox = rs() * 0.45 * s, oz = rs() * 0.45 * s;
        B.add(p.x + ox, p.y + R(0, 0.3) * s, p.z + oz, rs() * 0.3, R(1.6, 3.2) * Math.sqrt(s), rs() * 0.3,
          { life: R(0.5, 0.95), s0: 0.9 * s, s1: 0.25 * s, c0: [5, 2.6, 0.9], c1: [1.6, 0.25, 0.04], ck: 1.4, cell: CELL.flame + ((Math.random() * 4) | 0), rv: rs() * 2, fin: 0.12, drag: 0.6, grav: -0.8 });
        if (e.smoke && Math.random() < 0.35) A.add(p.x + ox, p.y + s * 1.2, p.z + oz, rs() * 0.4, R(1.5, 3), rs() * 0.4,
          { life: R(3, 6), s0: 0.8 * s, s1: 3.5 * s, c0: [0.08, 0.075, 0.07], c1: [0.28, 0.27, 0.26], a: 0.6, cell: (Math.random() * 4) | 0, drag: 0.5, grav: -0.25, rv: rs() * 0.3, fin: 0.15, delay: 0.1 });
      }
      e.glowT -= dt;
      if (e.glowT <= 0) { e.glowT = 0.12; B.add(p.x, p.y + 0.5 * s, p.z, 0, 0, 0, { life: 0.22, s0: 3.2 * s, s1: 3.6 * s, c0: [0.9, 0.42, 0.12], a: R(0.5, 0.8), cell: CELL.glow, fin: 0.3 }); }
    } else if (e.kind === 'smoke') {
      e.acc += dt * e.rate * e.k;
      while (e.acc >= 1) { e.acc--; const s = e.size;
        A.add(p.x + rs() * s * 0.2, p.y, p.z + rs() * s * 0.2, rs() * 0.5, e.rise * R(0.7, 1.3), rs() * 0.5,
          { life: R(3, 6), s0: s * 0.5, s1: s * R(2, 3), c0: e.color, c1: e.color.map(c => Math.min(1, c * 1.5)), a: 0.65, cell: (Math.random() * 4) | 0, drag: 0.5, grav: -0.2, rv: rs() * 0.3, fin: 0.15 }); }
    } else if (e.kind === 'column') {
      const fade = 1 - e.age / e.duration;
      e.acc += dt * e.rate;
      while (e.acc >= 1) { e.acc--; const s = e.size, d = e.dark + (1 - fade) * 0.15;
        A.add(p.x + rs() * s * 0.25, p.y + R(0, s * 0.3), p.z + rs() * s * 0.25, rs() * 0.6, R(3, 6), rs() * 0.6,
          { life: R(14, 22), s0: s * 0.6, s1: s * R(3.5, 5) * (0.6 + fade * 0.4), c0: [d, d * 0.96, d * 0.92], c1: [0.42, 0.41, 0.4], ck: 0.8, a: 0.75 * (0.4 + 0.6 * fade), cell: (Math.random() * 4) | 0, drag: 0.15, grav: -0.12, rv: rs() * 0.12, fin: 0.06 });
        if (fade > 0.6 && Math.random() < 0.5) B.add(p.x + rs() * s * 0.2, p.y + 0.3, p.z + rs() * s * 0.2, rs(), R(2, 4), rs(),
          { life: R(0.6, 1.1), s0: s * 0.35, s1: s * 0.1, c0: [5, 2.4, 0.7], c1: [1.2, 0.2, 0.03], cell: CELL.flame + ((Math.random() * 4) | 0), fin: 0.1, grav: -1 });
      }
    } else if (e.kind === 'trail') {
      let cur; try { cur = e.get(); } catch { cur = null; }
      if (!cur) { e.alive = false; continue; }
      const seg = cur.distanceTo(e.last), steps = Math.min(50, Math.floor(seg / (e.spacing * (1 + Math.max(0, A.n - 2200) / 2500))));
      for (let k = 1; k <= steps; k++) {
        const q = e.last.clone().lerp(cur, k / steps), s = e.size;
        A.add(q.x, q.y, q.z, rs() * 0.4, rs() * 0.4 + 0.3, rs() * 0.4, { life: e.life * R(0.7, 1.3), s0: Math.max(s * 1.1, e.spacing * 2.6), s1: s * R(3, 5), c0: e.color, a: 0.24, cell: CELL.dust, drag: 0.6, grav: -0.15, rv: rs() * 0.5, fin: 0.04 });
      }
      if (steps) { e.last.copy(cur); e.pos.copy(cur); }
      if (e.flame) { const nk = Math.min(1, Math.max(0.3, camDist(cur) / 12)); B.add(cur.x, cur.y, cur.z, 0, 0, 0, { life: 0.05, s0: e.size * 1.1 * nk, c0: [4, 2.4, 0.9], cell: CELL.glow, fin: 0.01 }); }
    }
  }
}

// ---------------------------------------------------------------- the big one
// Layered blast, all from the two pooled billboard meshes + pooled debris/rings/decals/lights (no per-blast
// materials or geometry): short hot core -> lumpy orange billows that rise and roll -> dark smoke that takes
// over and lingers as a column; plus ground shockwave + air ring, burning debris, embers, scorch, shake.
// opts: silent (no sound/shake), noColumn, noFire, noSound, debrisColor, big (signature props: fuel/radar)
let lastBlast = { t: -1, pos: null, size: 0 };
function explosion(pos, size = 6, opts = {}) {
  pos = V3(pos).clone();
  size = Math.max(0.5, +size || 6);
  if (!Number.isFinite(pos.x + pos.y + pos.z)) return;
  const s = size / 6, gy = groundAt(pos.x, pos.z), sea = game.world?.seaLevel ?? 0;
  const nearGround = pos.y - gy < size * 0.9;
  const water = isWater(pos.x, pos.z) && pos.y < sea + size * 0.5 && gy < sea;
  const ks = Math.min(2.6, Math.max(0.5, s)), big = !!opts.big || size >= 9;
  lastBlast = { t: game.simTime || 0, pos, size };

  // 1. core: a short, hot, compact pop (not a screen-filling white card). When the blast is right at the lens
  // (enemy rocket on the player, point-blank grenade) shrink the core + fireball so the frame stays readable.
  const cdist = camDist(pos), nearK = Math.min(1, Math.max(0.3, cdist / (size * 2.2)));
  const cs = 4 * Math.sqrt(size) * nearK;
  glow(pos, cs * 0.8, [2.8, 1.7, 0.7], 0.12);
  glow(pos, cs * 0.45, [3, 2.2, 1.2], 0.06, CELL.star);
  flash(pos.clone().add(new T.Vector3(0, size * 0.5, 0)), big ? 0.55 : 0.6, Math.min(55, (big ? 4.5 : 6) * size), 0.5 + 0.1 * s, 0xff8a30);
  if (!opts.silent && cdist < 40 + size * 10) { try { game.gfx?.flash?.(Math.min(0.12, 0.04 * ks) * Math.max(0.2, 1 - cdist / (40 + size * 10))); } catch { /* optional */ } }

  if (water) {
    splash(pos, size * 0.9);
    for (let i = 0; i < 26 * ks; i++) {   // white water column
      const a = Math.random() * 6.283, r = R(0, 0.35) * size;
      A.add(pos.x + Math.cos(a) * r, sea, pos.z + Math.sin(a) * r, Math.cos(a) * R(0.5, 2) * s, R(8, 22) * Math.sqrt(s), Math.sin(a) * R(0.5, 2) * s,
        { life: R(1.4, 2.6), s0: 0.8 * size * 0.3, s1: 2.4 * size * 0.4, c0: [0.95, 0.97, 1], a: 0.75, cell: CELL.drop, grav: 9.8, drag: 0.4, rv: rs(), fin: 0.03, emis: 0.4 });
    }
    ring(new T.Vector3(pos.x, sea + 0.1, pos.z), size * 3.5, 0.9, [0.9, 0.95, 1], 0.6, false);
  } else {
    // 2. fireball: lumpy lobes blooming in quick succession. Drawn in the ALPHA pool as emissive billows (not
    // additive) so overlapping puffs read as a rolling orange mass instead of summing to a white card.
    const lobes = big ? 6 : 4;
    for (let l = 0; l < lobes; l++) {
      const off = l === 0 ? new T.Vector3() : new T.Vector3(rs(), Math.random() * 0.9 + (nearGround ? 0.2 : -0.3), rs()).normalize().multiplyScalar(size * R(0.35, 0.8));
      const delay = l === 0 ? 0 : R(0.03, 0.22) + l * 0.025, n = Math.round((l === 0 ? 10 : 5) * ks);
      for (let i = 0; i < n; i++) {
        const d = new T.Vector3(rs(), Math.random() * 1.1 + (nearGround ? 0.25 : -0.5), rs()).normalize(), sp = size * R(0.9, 2.4);
        const x = pos.x + off.x + d.x * size * 0.12, y = pos.y + off.y + d.y * size * 0.12, z = pos.z + off.z + d.z * size * 0.12;
        const hot = Math.random() < 0.35;
        A.add(x, y, z, d.x * sp + off.x * 0.8, d.y * sp + off.y * 0.8, d.z * sp + off.z * 0.8,
          { delay, life: R(1.0, 1.8) * Math.sqrt(ks), s0: 0.5 * size * nearK, s1: R(1.2, 1.9) * size * nearK, c0: hot ? [4.5, 2.3, 0.6] : [3.4, 1.25, 0.25], c1: [0.09, 0.07, 0.06], ck: R(1.0, 1.3), a: 0.95, emis: 1, cell: CELL.flame + ((Math.random() * 4) | 0), rv: rs() * 1.2, drag: 2.6, grav: -3.2, fin: 0.04 });
      }
    }
    // hot flicker inside the billows (few, small, additive) so the core still glows
    for (let i = 0; i < 6 * ks; i++)
      B.add(pos.x + rs() * size * 0.4, pos.y + R(0, size * 0.5), pos.z + rs() * size * 0.4, rs() * 2, R(1, 4), rs() * 2,
        { delay: R(0, 0.25), life: R(0.5, 0.9), s0: 0.6 * size, s1: 0.9 * size, c0: [2.2, 1.1, 0.3], c1: [0.4, 0.06, 0.01], a: 0.6, cell: CELL.flame + ((Math.random() * 4) | 0), rv: rs(), drag: 1.5, grav: -2, fin: 0.1 });
    // rising mushroom head: a fat, slower ball that climbs out of the blast and chars to smoke
    const nm = Math.round((big ? 10 : 4) * ks);
    for (let i = 0; i < nm; i++)
      A.add(pos.x + rs() * size * 0.3, pos.y + R(0, size * 0.4), pos.z + rs() * size * 0.3, rs() * 1.5, R(5, 9) * Math.sqrt(ks), rs() * 1.5,
        { delay: R(0.05, 0.3), life: R(2.2, 3.4), s0: 0.9 * size, s1: R(1.7, 2.5) * size, c0: [3.0, 1.3, 0.3], c1: [0.06, 0.05, 0.045], ck: 1.6, a: 0.95, emis: 1, cell: CELL.flame + ((Math.random() * 4) | 0), rv: rs() * 0.8, drag: 0.9, grav: -1.4, fin: 0.1 });
    // 3. dark smoke takes over from the fire and lingers, rolling upward
    const ns = Math.round((big ? 40 : 26) * ks);
    for (let i = 0; i < ns; i++) {
      const d = new T.Vector3(rs(), Math.random() * 1.2 + 0.2, rs()).normalize(), sp = size * R(0.4, 1.6);
      A.add(pos.x + d.x * size * 0.4, pos.y + d.y * size * 0.4, pos.z + d.z * size * 0.4, d.x * sp, d.y * sp + R(1, 4), d.z * sp,
        { delay: R(0.25, 0.9), life: R(7, 13) * Math.sqrt(ks), s0: 0.9 * size, s1: R(2.6, 4) * size, c0: [0.045, 0.04, 0.038], c1: [0.3, 0.29, 0.28], ck: 0.7, a: 0.9, cell: (Math.random() * 4) | 0, rv: rs() * 0.25, drag: 1.4, grav: -1.1, fin: 0.07 });
    }
    // 4. shockwave: fast bright air ring + ground dust ring + skirt of dirt
    ring(pos.clone(), size * 2.6, 0.22, [1, 0.85, 0.6], 0.55);
    if (nearGround) {
      const n = Math.round(22 * ks);
      for (let i = 0; i < n; i++) {
        const a = i / n * 6.283 + rs() * 0.2, sp = size * R(3, 5.5);
        A.add(pos.x + Math.cos(a) * size * 0.3, gy + 0.4, pos.z + Math.sin(a) * size * 0.3, Math.cos(a) * sp, R(0.3, 1.8), Math.sin(a) * sp,
          { life: R(2.5, 4.5), s0: 0.6 * size, s1: 2 * size, c0: [0.5, 0.45, 0.37], c1: [0.62, 0.58, 0.5], a: 0.6, cell: CELL.dust, drag: 2.4, grav: -0.15, rv: rs() * 0.3, fin: 0.05 });
      }
      ring(new T.Vector3(pos.x, gy + 0.15, pos.z), size * 4.2, 0.6, [1, 0.78, 0.5], 0.9);
      if (big) ring(new T.Vector3(pos.x, gy + 0.25, pos.z), size * 6.5, 1.3, [0.75, 0.68, 0.58], 0.45, false);
      // 5. scorch decal
      scorch(new T.Vector3(pos.x, gy, pos.z), game.world?.normalAt?.(pos.x, pos.z) || null, size * 0.85);
    } else ring(pos, size * 3.4, 0.45, [1, 0.8, 0.55], 0.7);
  }
  // 6. embers & sparks (streaked)
  const ne = Math.round((big ? 70 : 45) * ks);
  for (let i = 0; i < ne; i++) {
    const d = new T.Vector3(rs(), Math.random() * 1.3, rs()).normalize(), sp = R(14, 50) * Math.sqrt(ks);
    B.add(pos.x, pos.y, pos.z, d.x * sp, d.y * sp, d.z * sp, { life: R(0.6, 2.2), s0: 0.14 * Math.sqrt(ks), s1: 0.06, c0: [7, 3.8, 1.2], c1: [2.2, 0.35, 0.05], ck: 1.1, cell: CELL.spark, grav: 9.8, drag: 0.9, str: 0.04, fin: 0.01 });
  }
  // 6b. big blasts: secondary pops ripple out over ~1 s, plus a fountain of long-lived arcing sparks
  if (big && !water) {
    const np = Math.round(3 + ks * 1.5);
    for (let i = 0; i < np; i++) {
      const a = Math.random() * 6.283, r = size * R(0.3, 0.9);
      pops.push({ t: R(0.25, 1.1) + i * 0.08, pos: new T.Vector3(pos.x + Math.cos(a) * r, pos.y + R(-0.2, 0.6) * size * 0.5, pos.z + Math.sin(a) * r), size: size * R(0.22, 0.38) });
    }
    for (let i = 0; i < 40 * ks; i++) {
      const d = new T.Vector3(rs() * 0.5, R(0.8, 1.6), rs() * 0.5).normalize(), sp = R(18, 38);
      B.add(pos.x, pos.y, pos.z, d.x * sp, d.y * sp, d.z * sp, { delay: R(0, 0.4), life: R(1.6, 3.2), s0: 0.12, s1: 0.05, c0: [7, 4, 1.4], c1: [2, 0.3, 0.04], ck: 1, cell: CELL.spark, grav: 9.8, drag: 0.5, str: 0.03, fin: 0.01 });
    }
  }
  // 7. flying burning debris (pooled instanced chunks; burning ones trail fire + smoke)
  if (!water) debrisBurst(pos, Math.round(Math.min(48, (big ? 16 : 10) * ks)), { speed: 14 + size * 1.8, size: 0.2 * Math.sqrt(size), color: opts.debrisColor, burnChance: big ? 0.75 : 0.5 });
  // 8. lingering smoke column (visible from km away) + ground fire
  if (size >= 5 && !water && !opts.noColumn) column(new T.Vector3(pos.x, Math.max(gy, pos.y - size * 0.3), pos.z), { size: size * 0.9, duration: big ? 40 + size * 2 : 22 + size * 2, rate: big ? 3.4 : 2.4, dark: big ? 0.03 : 0.08 });
  if (size >= 4 && !water && !opts.noFire && nearGround) fire(new T.Vector3(pos.x + rs() * size * 0.2, gy + 0.1, pos.z + rs() * size * 0.2), { size: 0.5 * Math.sqrt(size) * (big ? 1.5 : 1), duration: big ? R(12, 18) : R(5, 9) });

  if (!opts.silent) {
    shake(pos, Math.min(1.8, 0.35 + size * 0.08), 40 + size * 20);
    if (!opts.noSound) sound('explosion', pos, { size, volume: Math.min(1, 0.4 + size * 0.06) });
  }
  game.events.emit('fx:explosion', { pos, size });
}
// a small cook-off pop: hot flame burst + sparks + a puff of black smoke (no column/debris/ring/sound spam)
const pops = [];
function pop(pos, size = 2) {
  const s = size;
  glow(pos, 2.2 * Math.sqrt(s), [3.4, 2, 0.8], 0.09);
  for (let i = 0; i < 7; i++) {
    const d = new T.Vector3(rs(), Math.random() * 1.2, rs()).normalize(), sp = s * R(1, 3);
    A.add(pos.x, pos.y, pos.z, d.x * sp, d.y * sp, d.z * sp, { life: R(0.6, 1.1), s0: 0.5 * s, s1: R(1.3, 1.8) * s, c0: [4, 1.8, 0.4], c1: [0.07, 0.06, 0.05], ck: 1.3, a: 0.95, emis: 1, cell: CELL.flame + ((Math.random() * 4) | 0), rv: rs(), drag: 2.4, grav: -2.5, fin: 0.05 });
  }
  for (let i = 0; i < 6; i++) A.add(pos.x + rs() * s * 0.3, pos.y + s * 0.3, pos.z + rs() * s * 0.3, rs() * 1.5, R(2, 5), rs() * 1.5,
    { delay: R(0.2, 0.5), life: R(4, 7), s0: 0.8 * s, s1: R(2.5, 3.5) * s, c0: [0.05, 0.045, 0.04], c1: [0.28, 0.27, 0.26], ck: 0.7, a: 0.85, cell: (Math.random() * 4) | 0, rv: rs() * 0.3, drag: 1.2, grav: -0.9, fin: 0.08 });
  for (let i = 0; i < 18; i++) {
    const d = new T.Vector3(rs(), Math.random() * 1.4, rs()).normalize(), sp = R(10, 30);
    B.add(pos.x, pos.y, pos.z, d.x * sp, d.y * sp, d.z * sp, { life: R(0.4, 1.4), s0: 0.09, s1: 0.04, c0: [7, 3.8, 1.2], c1: [2, 0.3, 0.05], cell: CELL.spark, grav: 9.8, drag: 0.9, str: 0.035, fin: 0.01 });
  }
  flash(pos, 0.6, Math.min(40, 6 * s), 0.25, 0xff9040);
}
function updatePops(dt) {
  for (let i = pops.length - 1; i >= 0; i--) { const p = pops[i]; p.t -= dt; if (p.t <= 0) { pops.splice(i, 1); pop(p.pos, p.size); } }
}
// cook-off after a big prop dies (combat's chain blast calls this): two or three staggered pops + shake + embers
function secondary(pos, radius = 6) {
  pos = V3(pos).clone(); if (!Number.isFinite(pos.x + pos.y + pos.z)) return;
  pop(pos.clone().add(new T.Vector3(0, radius * 0.25, 0)), radius * 0.45);
  for (let i = 0; i < 2; i++) pops.push({ t: R(0.15, 0.6) + i * 0.2, pos: pos.clone().add(new T.Vector3(rs() * radius * 0.5, R(0, radius * 0.5), rs() * radius * 0.5)), size: radius * R(0.25, 0.4) });
  debrisBurst(pos, 6, { speed: 16 + radius, size: 0.25 * Math.sqrt(radius), burnChance: 0.8 });
  shake(pos, 0.5 + radius * 0.04, 60 + radius * 12);
  sound('explosion', pos, { size: radius, volume: 0.6 });
}

// ---------------------------------------------------------------- physics chunks
// Destroyed signature props throw a handful of real Rapier boxes (one InstancedMesh, pooled, capped) that tumble,
// bounce off terrain/walls and get swept up after ~8 s. Burning ones trail fire/smoke like the sprite debris.
const CHUNK_MAX = 48;
const CHUNK = {   // kind: [count, min size, max size, colour]
  fuelTank: [9, 0.8, 2.4, 0x9c9a90], gasSilo: [10, 1, 2.8, 0xa8a49a], radar: [8, 0.5, 2.0, 0x6e7868], sam: [7, 0.5, 1.6, 0x4d5238],
  commAntenna: [8, 0.25, 1.8, 0xb03a2e], satUplink: [6, 0.4, 1.6, 0xc8c8c0], generator: [5, 0.4, 1.2, 0x5a5e4a], transformer: [5, 0.4, 1.2, 0x606468],
  mission_fuel: [9, 0.8, 2.4, 0x9c9a90], mission_generator: [5, 0.4, 1.2, 0x5a5e4a], mission_tower: [8, 0.3, 1.8, 0x7a7a74],
};
let chunkMesh = null; const chunks = [];
function physChunks(pos, kind, n) {
  const spec = CHUNK[kind] || [n || 4, 0.4, 1.2, 0x55524c];
  const P = game.physics, RAP = game.RAPIER; if (!P || !RAP || !chunkMesh) return 0;
  pos = V3(pos); const cnt = Math.min(n || spec[0], CHUNK_MAX);
  let made = 0;
  for (let i = 0; i < cnt; i++) {
    let c = chunks.find(x => !x.alive);
    if (!c) { c = chunks.reduce((a, b) => (a.age > b.age ? a : b)); killChunk(c); }
    const sx = R(spec[1], spec[2]), sy = R(spec[1], spec[2]) * R(0.15, 0.5), sz = R(spec[1], spec[2]) * R(0.4, 1);
    const dir = new T.Vector3(rs(), R(0.6, 1.6), rs()).normalize(), sp = R(8, 20) / Math.sqrt(Math.max(0.6, sx * sz));
    try {
      const b = P.createRigidBody(RAP.RigidBodyDesc.dynamic().setTranslation(pos.x + rs() * 1.5, pos.y + R(0, 2), pos.z + rs() * 1.5)
        .setLinvel(dir.x * sp, dir.y * sp, dir.z * sp).setAngvel({ x: rs() * 8, y: rs() * 8, z: rs() * 8 }).setLinearDamping(0.05).setAngularDamping(0.4));
      P.createCollider(RAP.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setDensity(0.7).setFriction(0.8).setRestitution(0.15), b);
      Object.assign(c, { alive: true, body: b, age: 0, life: R(7.5, 8.5), s: new T.Vector3(sx, sy, sz), burn: Math.random() < 0.55, emitLast: null });
      const col = new T.Color(spec[3]).multiplyScalar(R(0.35, 0.8));
      if (Math.random() < 0.5) col.lerp(new T.Color(0x151210), 0.6);   // charred
      chunkMesh.setColorAt(c.i, col); made++;
    } catch (e) { console.warn('[fx] chunk', e); break; }
  }
  if (chunkMesh.instanceColor) chunkMesh.instanceColor.needsUpdate = true;
  return made;
}
function killChunk(c) {
  if (c.body) { try { game.physics.removeRigidBody(c.body); } catch { /* already gone */ } }
  c.body = null; c.alive = false; chunkMesh.setMatrixAt(c.i, new T.Matrix4().makeScale(0, 0, 0));
}
const _cm = { m: null, q: null, p: null, s: null };
function updateChunks(dt) {
  if (!chunkMesh) return;
  if (!_cm.m) { _cm.m = new T.Matrix4(); _cm.q = new T.Quaternion(); _cm.p = new T.Vector3(); _cm.s = new T.Vector3(); }
  let any = false;
  for (const c of chunks) {
    if (!c.alive) continue; any = true;
    c.age += dt;
    if (c.age > c.life) { killChunk(c); continue; }
    let t, r; try { t = c.body.translation(); r = c.body.rotation(); } catch { killChunk(c); continue; }
    if (!Number.isFinite(t.x + t.y + t.z) || t.y < -50) { killChunk(c); continue; }
    _cm.p.set(t.x, t.y, t.z); _cm.q.set(r.x, r.y, r.z, r.w);
    const k = Math.min(1, (c.life - c.age) / 0.6);
    _cm.m.compose(_cm.p, _cm.q, _cm.s.copy(c.s).multiplyScalar(k)); chunkMesh.setMatrixAt(c.i, _cm.m);
    if (c.age < 3.2) trailAlong(c, _cm.p, c.burn, c.age < 2 ? 0.55 : 0.3);
  }
  if (any) chunkMesh.instanceMatrix.needsUpdate = true;
}

// continuous trail: drop sprites by DISTANCE travelled (not by time), with interpolation between frames, so a
// fast chunk leaves an unbroken ribbon of smoke instead of a string of beads. Spacing grows when the pool is busy.
function trailAlong(o, p, burn, size = 0.5) {
  if (!o.emitLast) { o.emitLast = p.clone(); return; }
  const seg = p.distanceTo(o.emitLast);
  const busy = 1 + Math.max(0, A.n - 2200) / 2500, spacing = 0.26 * busy * Math.max(0.6, size / 0.5);
  if (seg < spacing) return;
  const steps = Math.min(14, Math.floor(seg / spacing));
  for (let k = 1; k <= steps; k++) {
    const f = k / steps, x = o.emitLast.x + (p.x - o.emitLast.x) * f, y = o.emitLast.y + (p.y - o.emitLast.y) * f, z = o.emitLast.z + (p.z - o.emitLast.z) * f;
    // born already ~3x the spacing wide (soft dust cell, low alpha) so neighbours overlap into one ribbon
    A.add(x, y, z, rs() * 0.2, 0.35, rs() * 0.2, { life: R(1.1, 1.8), s0: Math.max(size * 1.1, spacing * 3), s1: size * R(3, 4), c0: burn ? [0.07, 0.065, 0.06] : [0.42, 0.4, 0.37], c1: [0.3, 0.29, 0.28], ck: 0.8, a: burn ? 0.3 : 0.22, cell: CELL.dust, drag: 1.1, grav: -0.3, rv: rs() * 0.5, fin: 0.03 });
    if (burn && (k & 1)) B.add(x, y, z, 0, 0.4, 0, { life: 0.22, s0: size * 1.1, s1: size * 0.3, c0: [6, 2.8, 0.8], c1: [1.2, 0.2, 0.02], cell: CELL.flame + ((Math.random() * 4) | 0), fin: 0.05 });
  }
  o.emitLast.copy(p);
}

// signature props get a bigger, genre-sized blast on top of whatever the world/combat spawned for them
const SIGNATURE = { fuelTank: 13, gasSilo: 15, radar: 9, sam: 9, satUplink: 7, commAntenna: 7, generator: 6, transformer: 6, mission_fuel: 11, mission_generator: 8, mission_tower: 7 };
function signatureBlast(d) {
  const sz = SIGNATURE[d?.kind]; if (!sz || !d.pos) return;
  const p = V3(d.pos).clone();
  if (lastBlast.pos && lastBlast.t === (game.simTime || 0) && lastBlast.size >= sz && lastBlast.pos.distanceTo(p) < 4) return;
  explosion(p, sz, { big: true, noSound: true });
  try { physChunks(p, d.kind); } catch (e) { console.warn('[fx] chunks', e); }
}

// ---------------------------------------------------------------- small stuff
function tracer(from, to, opts = {}) {
  from = V3(from); to = V3(to);
  const d = to.clone().sub(from), len = d.length(); if (len < 0.5) return;
  d.divideScalar(len);
  const speed = opts.speed || 650, life = Math.min(1.2, len / speed);
  const col = opts.color || [7, 4.6, 2.0];
  // start a little down-barrel so the streak never begins inside the camera; width is thin and constant
  const o = Math.min(1.5, len * 0.2), w = opts.width || 0.028;
  B.add(from.x + d.x * o, from.y + d.y * o, from.z + d.z * o, d.x * speed, d.y * speed, d.z * speed,
    { life, s0: w, c0: col, cell: CELL.spark, str: Math.min(0.016, len / speed), fin: 0.001, a: 1 });
}

function muzzle(src, dir, opts = {}) {
  let pos;
  if (src?.isObject3D) pos = src.getWorldPosition(new T.Vector3()); else pos = V3(src).clone();
  const d = dir ? V3(dir).clone().normalize() : new T.Vector3(0, 0, -1);
  let k = opts.size || 1;
  // sized to the weapon, not the screen: in the over-shoulder aim camera the muzzle can be ~1.5 m from the lens,
  // where a half-metre additive star (plus bloom) used to cover a third of the frame. Shrink it as it nears the camera.
  // ...and grow it a little with distance so an enemy's flash still reads as a spark of light at 30-80 m
  const cd = camDist(pos), near = Math.min(1, Math.max(0.2, (cd - 0.6) / 4)), far = Math.min(3.2, Math.max(1, cd / 18));
  k *= near * far;
  const core = 0.16 * k;
  // forward flash cone: a few short streaks along the barrel axis (stretched sprites) + a small hot core
  glow(pos.clone().addScaledVector(d, 0.05 * k), core * 1.6, [3.2, 2.2, 1.0], 0.05, CELL.star);
  glow(pos, core * 1.4, [1.6, 0.9, 0.3], 0.055);
  for (let i = 0; i < 3; i++) {
    const s = R(10, 18) * (0.6 + 0.4 * k);
    B.add(pos.x, pos.y, pos.z, d.x * s + rs() * 0.8, d.y * s + rs() * 0.8, d.z * s + rs() * 0.8,
      { life: 0.04, s0: 0.09 * k, s1: 0.05 * k, c0: [4.5, 2.8, 1.1], c1: [1.6, 0.5, 0.1], cell: CELL.flame + i, fin: 0.01, drag: 8, str: 0.012 });
  }
  if (Math.random() < 0.5) A.add(pos.x, pos.y, pos.z, d.x * 1.2, d.y * 1.2 + 0.4, d.z * 1.2, { life: R(0.5, 0.9), s0: 0.08 * k, s1: 0.45 * k, c0: [0.7, 0.7, 0.7], a: 0.18, cell: CELL.dust, drag: 2, grav: -0.4, fin: 0.1 });
  // small, short light; skip it right at the lens so it doesn't flood the hero's own back/helmet
  if (opts.light !== false && cd > 1.8) flash(pos.clone().addScaledVector(d, 0.4), 0.12 * (opts.size || 1), 4.5 * Math.min(1.5, opts.size || 1), 0.045, 0xffb060);
}

const SURF = {
  dirt: { dust: [0.42, 0.34, 0.25], chip: [0.25, 0.19, 0.13] }, grass: { dust: [0.42, 0.4, 0.3], chip: [0.2, 0.26, 0.12] },
  sand: { dust: [0.72, 0.64, 0.5], chip: [0.6, 0.52, 0.4] }, snow: { dust: [0.95, 0.96, 1], chip: [0.9, 0.92, 0.95] },
  concrete: { dust: [0.62, 0.6, 0.57], chip: [0.5, 0.49, 0.47], spark: 2 }, stone: { dust: [0.58, 0.55, 0.5], chip: [0.45, 0.43, 0.4], spark: 3 },
  wood: { dust: [0.5, 0.4, 0.28], chip: [0.42, 0.29, 0.16] }, metal: { spark: 12 }, glass: { spark: 3, glint: true }, body: { spark: 6 },
};
function impact(pos, normal, surface = 'dirt', opts = {}) {
  pos = V3(pos); const n = normal ? V3(normal) : new T.Vector3(0, 1, 0);
  if (surface === 'water' || (isWater(pos.x, pos.z) && pos.y < (game.world?.seaLevel ?? 0) + 0.4)) { splash(pos, 0.3 * (opts.size || 1)); return; }
  const S = SURF[surface] || SURF.dirt, k = opts.size || 1;
  if (S.dust) { dustPuff(pos, { count: 3 + (k * 2 | 0), color: S.dust, size: 0.35 * k, normal: n, speed: 1.4, alpha: 0.6 }); chips(pos, n, 4 + (k * 3 | 0), S.chip, { size: 0.05 * k }); }
  if (surface === 'body') {
    // flesh/kevlar hit: a few dim sparks + a small dark-red puff; no glow card (enemy fire hitting the hero sits right in
    // front of the camera, and a bright glow there read as a giant white-orange blob over the player)
    const cd = camDist(pos), kk = Math.min(1, Math.max(0.35, cd / 10)) * k;
    sparks(pos, n, Math.round(3 * kk + 1), { speed: 5, size: 0.7 * kk, color: [3, 1.4, 0.5], glow: false });
    dustPuff(pos, { count: 2, color: [0.32, 0.06, 0.05], size: 0.22 * kk, normal: n, speed: 0.8, alpha: 0.55, life: 0.5 });
  } else if (S.spark) sparks(pos, n, Math.round(S.spark * k), { speed: 14, size: 1 });
  if (S.glint) for (let i = 0; i < 6; i++) B.add(pos.x, pos.y, pos.z, n.x * 3 + rs() * 3, n.y * 3 + R(0, 3), n.z * 3 + rs() * 3, { life: R(0.4, 1), s0: 0.1, c0: [3, 3.4, 4], cell: CELL.star, grav: 9.8, fin: 0.05, ground: true });
  if (opts.decal !== false && surface !== 'body') bulletHole(pos, n);
}

function dust(pos, opts = {}) { dustPuff(V3(pos), { count: opts.count ?? 8, color: opts.color, size: opts.size || 1.2, speed: opts.speed || 1.5, alpha: opts.alpha ?? 0.45, life: opts.life || 1.3 }); }

// ---------------------------------------------------------------- per-frame
function updateDebris(dt) {
  const m = new T.Matrix4(), dq = new T.Quaternion(), e = new T.Euler();
  let any = false;
  for (const d of debrisData) {
    if (!d.alive) continue;
    any = true;
    d.age += dt;
    if (d.age > d.life) { d.alive = false; m.makeScale(0, 0, 0); debris.setMatrixAt(d.i, m); continue; }
    d.v.y -= 9.81 * dt; d.v.multiplyScalar(1 - 0.05 * dt);
    d.p.addScaledVector(d.v, dt);
    const gy = groundAt(d.p.x, d.p.z);
    if (d.p.y < gy + d.s.y * 0.5) {
      if (isWater(d.p.x, d.p.z) && d.bounces === 0 && d.v.y < -4) { splash(d.p, 0.35); d.life = d.age + 0.6; d.burn = false; }
      d.p.y = gy + d.s.y * 0.5;
      if (d.v.y < -2.5) { d.bounces++; if (d.bounces < 3) dustPuff(d.p, { count: 2, size: 0.4, alpha: 0.4 }); }
      d.v.y = Math.abs(d.v.y) * 0.32; d.v.x *= 0.55; d.v.z *= 0.55; d.w.multiplyScalar(0.6);
      if (d.v.lengthSq() < 0.3) { d.v.set(0, 0, 0); d.w.set(0, 0, 0); }
    }
    e.set(d.w.x * dt, d.w.y * dt, d.w.z * dt); dq.setFromEuler(e); d.q.multiply(dq);
    const fadeK = Math.min(1, (d.life - d.age) / 0.8);
    m.compose(d.p, d.q, d.s.clone().multiplyScalar(fadeK)); debris.setMatrixAt(d.i, m);
    if ((d.burn || d.smoke) && d.age < 2.6 && d.v.lengthSq() > 4) trailAlong(d, d.p, d.burn, 0.45);
    else d.emitLast = null;
  }
  if (any) debris.instanceMatrix.needsUpdate = true;
}

function updateRings(dt) {
  for (const r of rings) {
    if (!r.visible) continue;
    const u = r.userData; u.t += dt;
    const t = u.t / u.dur; if (t >= 1) { r.visible = false; continue; }
    r.scale.setScalar(Math.max(0.01, u.radius * (1 - Math.pow(1 - t, 3))));
    r.material.opacity = u.alpha * (1 - t) * (1 - t);
  }
}

function updateDecals(dt) {
  for (const arr of [decals, holes]) for (const d of arr) {
    if (!d.visible) continue;
    d.userData.age += dt;
    const left = d.userData.life - d.userData.age;
    if (left <= 0) d.visible = false; else if (left < 5) d.material.opacity = left / 5;
  }
}

function updateLights(dt) {
  for (const L of lights) {
    const u = L.userData;
    if (u.t > 0) { u.t -= dt; const k = Math.max(0, u.t / u.dur); L.intensity = u.peak * k * k * (0.85 + Math.random() * 0.3); }
    else if (L.intensity !== 0) L.intensity = 0;
  }
}

function updateLighting() {
  // dim smoke at night: follow the sun if gfx exposes one
  const sun = game.gfx?.sun;
  let k = 1;
  if (sun && Number.isFinite(sun.intensity)) {
    const base = game.gfx?.sunBaseIntensity || 3;
    k = Math.max(0.18, Math.min(1, sun.intensity / base));
    if (sun.position && sun.position.y < 0) k = 0.18;
  }
  A.mat.uniforms.uLight.value.setScalar(k);
  if (game.gfx?.wind) { wind.x = game.gfx.wind.x ?? wind.x; wind.z = game.gfx.wind.z ?? wind.z; }
}

// ---------------------------------------------------------------- traversal juice (wingsuit ground rush, grapple pop)
// Skimming terrain in the wingsuit kicks up a dust wake under/behind the hero and fills the near ground with
// fast-streaking motes, so proximity reads as speed. Colours follow the ground (sand, grass, rock, snow).
let rushAcc = 0;
function groundTint(x, z, h) {
  const w = game.world;
  let sl = 0; try { sl = w?.slopeAt?.(x, z) ?? 0; } catch { /* optional */ }
  if (sl > 0.3) return [0.6, 0.57, 0.52];
  if (h < (w?.seaLevel ?? 0) + 4) return [0.74, 0.66, 0.52];
  return h > 420 ? [0.62, 0.59, 0.54] : [0.56, 0.53, 0.4];
}
function traversalFx(dt) {
  const P = game.player;
  if (!P || P.state !== 'wingsuit' || !(P.proximity > 0.12) || !P.vel) { rushAcc = 0; return; }
  const sp = P.vel.length(); if (sp < 15) return;
  const k = P.proximity;
  rushAcc += dt * (30 + sp * 1.2) * k;
  const vx = P.vel.x / sp, vz = P.vel.z / sp;
  const sx = -vz, sz = vx; // horizontal side axis
  while (rushAcc >= 1) {
    rushAcc -= 1;
    // where the wake touches the ground: under and a little behind, spread sideways
    const back = R(-4, 9), side = rs() * (2.5 + Math.abs(back) * 0.45);
    const x = P.pos.x - vx * back + sx * side, z = P.pos.z - vz * back + sz * side;
    const gy = groundAt(x, z);
    if (isWater(x, z)) { // spray instead of dust over water
      B.add(x, Math.max(gy, game.world?.seaLevel ?? gy) + 0.2, z, P.vel.x * 0.25 + rs() * 2, R(2, 5), P.vel.z * 0.25 + rs() * 2,
        { life: R(0.4, 0.8), s0: 0.5, s1: 1.6, c0: [0.5, 0.55, 0.6], a: 0.5 * k, cell: CELL.dust, drag: 1.5, grav: 4, fin: 0.05 });
      continue;
    }
    if (P.pos.y - gy > 26) continue;
    const col = groundTint(x, z, gy).map(c => Math.min(1, c * 1.18)); // a shade lighter than the ground so it reads
    if (Math.random() < 0.55) // billowing wake puff, dragged along a little by the passing body
      A.add(x, gy + R(0.2, 1), z, P.vel.x * R(0.1, 0.25) + rs() * 1.5, R(0.8, 2.6), P.vel.z * R(0.1, 0.25) + rs() * 1.5,
        { life: R(0.7, 1.4), s0: R(0.8, 1.4), s1: R(3, 5), c0: col, c1: col.map(c => c * 1.08), a: 0.42 * k, cell: CELL.smoke + ((Math.random() * 4) | 0), drag: 1.8, grav: -0.3, rv: rs() * 0.5, fin: 0.06 });
    else // streaking mote: small, quick, stretched along the hero's travel so it reads as ground rush
      A.add(x, gy + R(0.3, 2.5), z, P.vel.x * 0.35, R(0, 1.2), P.vel.z * 0.35,
        { life: R(0.25, 0.5), s0: 0.09, s1: 0.06, c0: col.map(c => Math.min(1, c * 1.25)), a: 0.8 * k, cell: 13, drag: 0.6, str: 0.06, fin: 0.05 });
  }
}
function onPop(d) {
  const p = d?.point; if (!p) return;
  const gy = groundAt(p.x, p.z); if (Math.abs((p.y ?? gy) - gy) > 3) return; // only a ground/roof-level arrival kicks dust
  dustPuff(V3(p), { count: 7, size: 0.7, speed: 2.2, alpha: 0.4, life: 0.8, color: groundTint(p.x, p.z, gy) });
}

// ---------------------------------------------------------------- module
export default {
  name: 'fx',
  init(g) {
    game = g; T = g.THREE; scene = g.scene;
    const atlas = makeAtlas();
    A = new Pool(MAXA, false, atlas); B = new Pool(MAXB, true, atlas);
    scene.add(A.mesh, B.mesh);

    const dg = new T.DodecahedronGeometry(0.5, 0); dg.scale(1, 0.7, 1.2);
    debris = new T.InstancedMesh(dg, new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.15 }), DEBRIS_MAX);
    debris.instanceMatrix.setUsage(T.DynamicDrawUsage); debris.castShadow = true; debris.frustumCulled = false; debris.name = 'fx-debris';
    const zero = new T.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < DEBRIS_MAX; i++) {
      debris.setMatrixAt(i, zero); debris.setColorAt(i, new T.Color(0.2, 0.2, 0.2));
      debrisData.push({ i, alive: false, age: 0, life: 0, p: new T.Vector3(), v: new T.Vector3(), w: new T.Vector3(), q: new T.Quaternion(), s: new T.Vector3(1, 1, 1), bounces: 0 });
    }
    scene.add(debris);
    chunkMesh = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.35 }), CHUNK_MAX);
    chunkMesh.instanceMatrix.setUsage(T.DynamicDrawUsage); chunkMesh.castShadow = true; chunkMesh.receiveShadow = true; chunkMesh.frustumCulled = false; chunkMesh.name = 'fx-chunks';
    for (let i = 0; i < CHUNK_MAX; i++) { chunkMesh.setMatrixAt(i, zero); chunkMesh.setColorAt(i, new T.Color(0.3, 0.3, 0.3)); chunks.push({ i, alive: false, age: 0, life: 0, body: null }); }
    scene.add(chunkMesh);

    const ringTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d');
      const gr = c.createRadialGradient(128, 128, 70, 128, 128, 127); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.75, 'rgba(255,255,255,0.6)');
      gr.addColorStop(0.9, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, 256, 256);
      return new T.CanvasTexture(cv); })();
    const rg = new T.PlaneGeometry(2, 2); rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const r = new T.Mesh(rg, new T.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: true }));
      r.visible = false; r.renderOrder = 11; r.frustumCulled = false; r.userData = { t: 0, dur: 1 }; scene.add(r); rings.push(r);
    }

    DECAL_GEO = new T.PlaneGeometry(1, 1);
    scorchMat = new T.MeshLambertMaterial({ map: makeScorchTex(false), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    holeMat = new T.MeshLambertMaterial({ map: makeScorchTex(true), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

    for (let i = 0; i < 3; i++) {
      const L = new T.PointLight(0xffa050, 0, 60, 2); L.userData = { t: 0, dur: 1, peak: 0 }; L.name = 'fx-flash'; scene.add(L); lights.push(L);
    }

    g.events?.on?.('grapple:pop', d => { try { onPop(d); } catch (e) { /* cosmetic */ } });
    g.events?.on?.('destructible:destroyed', d => { try { signatureBlast(d); } catch (e) { console.warn('[fx] signature blast', e); } });
    g.fx = {
      explosion, signatureBlast, smoke, fire, trail, sparks, impact, splash, tracer, muzzle, dust, flash, column, scorch, bulletHole,
      debris: debrisBurst, wind, pop, secondary, chunks: physChunks,
      stats: () => ({ alpha: A.n, additive: B.n, emitters: emitters.length, debris: debrisData.filter(d => d.alive).length, chunks: chunks.filter(c => c.alive).length, pops: pops.length }),
    };
  },
  update(dt) {
    if (!A) return;
    if (dt <= 0) return;
    updateLighting();
    updateEmitters(dt);
    const gfn = (x, z) => groundAt(x, z) + 0.03;
    A.update(dt, wind, gfn); B.update(dt, wind, gfn);
    traversalFx(dt);
    updatePops(dt); updateDebris(dt); updateChunks(dt); updateRings(dt); updateDecals(dt); updateLights(dt);
  },
};
