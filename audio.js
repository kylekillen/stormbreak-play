// STORMBREAK audio: fully procedural WebAudio SFX + adaptive generative score + ambience.
// API (game.audio): play(name,{pos,volume,pitch}), loop(name,{pos,volume,pitch})->{stop,set},
// engine(vehicle) per frame, setMusicIntensity(0..1), setVolume(channel,v), unlocked, ctx.
// Unknown names fall back to a generic sound. Nothing here ever throws into the caller.

let game, ctx = null, unlocked = false;
const bus = {};
const vol = { master: 0.9, sfx: 1, music: 0.55, ambient: 0.8, ui: 0.8 };
let noiseW, noiseB, noiseP, verb;
const engines = new Map();
const amb = {};
let musicI = 0.1, musicTarget = 0.1, extI = 0, extT = -99, combatHeat = 0;

const clamp = (v, a = 0, b = 1) => (Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : a);
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const rnd = (a, b) => a + Math.random() * (b - a);

function makeNoise(kind, secs = 3) {
  const n = ctx.sampleRate * secs, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w;
    else if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
  }
  return buf;
}
function impulse(secs, decay) {
  const n = ctx.sampleRate * secs, buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
  return buf;
}

function init_ctx() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC({ latencyHint: 'interactive' });
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
  bus.master = ctx.createGain(); bus.master.connect(comp); comp.connect(ctx.destination);
  for (const ch of ['sfx', 'music', 'ambient', 'ui']) { bus[ch] = ctx.createGain(); bus[ch].connect(bus.master); }
  noiseW = makeNoise('white'); noiseB = makeNoise('brown', 4); noiseP = makeNoise('pink');
  verb = ctx.createConvolver(); verb.buffer = impulse(2.6, 3.2);
  bus.verb = ctx.createGain(); bus.verb.gain.value = 0.35; bus.verb.connect(verb); verb.connect(bus.sfx);
  applyVolumes();
}
function applyVolumes() {
  if (!ctx) return;
  const t = ctx.currentTime;
  bus.master.gain.setTargetAtTime(vol.master, t, 0.05);
  for (const ch of ['sfx', 'music', 'ambient', 'ui']) bus[ch].gain.setTargetAtTime(vol[ch], t, 0.05);
}
function unlock() {
  try { init_ctx(); if (ctx && ctx.state !== 'running') ctx.resume(); unlocked = !!ctx; if (api) api.unlocked = unlocked; } catch (e) { /* ignore */ }
}

// ---------- node helpers ----------
const T = () => ctx.currentTime;
function osc(type, f, t0, t1, dest) { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t0); o.connect(dest); o.start(t0); o.stop(t1); return o; }
function noise(buf, t0, t1, dest, rate = 1) {
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.connect(dest);
  s.start(t0, Math.random() * (buf.duration - 0.5)); if (t1) s.stop(t1); return s;
}
function filt(type, f, q = 1, dest) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; if (dest) b.connect(dest); return b; }
function gain(v, dest) { const g = ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }
function env(g, t, a, peak, d, curve = 'exp') {
  g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); else g.gain.linearRampToValueAtTime(0, t + a + d);
  return t + a + d;
}

// Output chain: returns the node a recipe should connect into, applying volume, positional panning,
// distance air absorption and speed-of-sound delay for far events.
function outChain(opts, channel = 'sfx', ref = 8, maxD = 2500, sendAmt = 0.15) {
  const g = gain(opts.volume ?? 1);
  let delay = 0, dist = 0;
  const p = opts.pos;
  if (p && game?.camera) {
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = ref; pan.maxDistance = maxD; pan.rolloffFactor = 1;
    const x = p.x ?? p[0] ?? 0, y = p.y ?? p[1] ?? 0, z = p.z ?? p[2] ?? 0;
    if (pan.positionX) { pan.positionX.value = x; pan.positionY.value = y; pan.positionZ.value = z; } else pan.setPosition(x, y, z);
    const c = game.camera.position, d = Math.hypot(x - c.x, y - c.y, z - c.z);
    if (d > maxD * 1.2) return null;
    const lp = filt('lowpass', clamp(20000 * Math.exp(-d / 700), 500, 20000), 0.5);
    g.connect(lp); lp.connect(pan); pan.connect(bus[channel]);
    if (sendAmt) { const s = gain(sendAmt * clamp(0.4 + d / 300, 0, 1.6)); pan.connect(s); s.connect(bus.verb); }
    delay = Math.min(3.2, d / 343) * (d > 120 ? 1 : 0); dist = d; // speed of sound: a blast 1 km out lands ~3 s after the flash
  } else {
    g.connect(bus[channel]);
    if (sendAmt) { const s = gain(sendAmt * 0.6); g.connect(s); s.connect(bus.verb); }
  }
  return { node: g, t: T() + 0.005 + delay, d: dist };
}

// ---------- SFX recipes: (o, t, opts) ----------
const R = {};
R.explosion = (o, t, op) => {
  const s = op.size ?? 1;
  const sub = gain(0, o); env(sub, t, 0.008, 1.3 * s, 1.6 + s * 0.4);
  const so = osc('sine', 90, t, t + 2.4, sub); so.frequency.exponentialRampToValueAtTime(28, t + 1.5);
  const body = gain(0, o); env(body, t, 0.005, 1.4 * s, 2.4 + s * 0.6);
  const lp = filt('lowpass', 4200, 0.7, body); lp.frequency.setValueAtTime(4200, t); lp.frequency.exponentialRampToValueAtTime(160, t + 2.6);
  noise(noiseB, t, t + 3.4, lp, 0.9 / (op.pitch ?? 1));
  const far = clamp(((op.dist || 0) - 200) / 900, 0, 1); // 0 near .. 1 at ~1.1 km: the crack and debris die, the thump and roll remain
  const crack = gain(0, o); env(crack, t, 0.001, 0.9 * (1 - far), 0.09);
  if (far < 0.95) noise(noiseW, t, t + 0.12, filt('highpass', 1200, 0.7, crack));
  if (far > 0) { // distant boom: a rolling echo off the hills, arriving after the direct sound
    for (const [dt, v] of [[0.35 + far * 0.5, 0.45], [0.9 + far * 1.1, 0.25]]) {
      const e = gain(0, o); env(e, t + dt, 0.12, v * s * far, 1.8 + s * 0.6, 'lin');
      noise(noiseB, t + dt, t + dt + 2.6, filt('lowpass', 220, 0.8, e), 0.5);
    }
  }
  const rumble = gain(0, o); env(rumble, t + 0.1, 0.4, 0.5 * s, 3.2, 'lin');
  noise(noiseB, t, t + 4, filt('lowpass', 120, 1, rumble), 0.6);
  for (let i = 0; i < (10 + s * 8) * (1 - far); i++) { // debris tail
    const tt = t + rnd(0.25, 2.6), g = gain(0, o); env(g, tt, 0.002, rnd(0.04, 0.22), rnd(0.03, 0.12));
    noise(noiseW, tt, tt + 0.2, filt('bandpass', rnd(900, 5200), rnd(3, 9), g));
  }
};
R.explosion_small = (o, t, op) => R.explosion(o, t, { ...op, size: 0.45 });
R.gun = (o, t, op) => {
  const w = op.w || {}, p = op.pitch ?? 1;
  const crack = gain(0, o); env(crack, t, 0.001, w.crack ?? 0.8, w.cd ?? 0.05);
  noise(noiseW, t, t + 0.2, filt('highpass', (w.hp ?? 1800) * p, 0.8, crack));
  const body = gain(0, o); env(body, t, 0.002, w.body ?? 0.9, w.bd ?? 0.16);
  noise(noiseP, t, t + 0.6, filt('lowpass', (w.lp ?? 900) * p, 1.2, body));
  const th = gain(0, o); env(th, t, 0.001, w.thump ?? 0.6, w.td ?? 0.09);
  const to = osc('sine', (w.tf ?? 150) * p, t, t + 0.3, th); to.frequency.exponentialRampToValueAtTime(40, t + 0.2);
  if (w.tail) { const tl = gain(0, o); env(tl, t + 0.02, 0.03, w.tail, 0.9, 'lin'); noise(noiseB, t, t + 1.2, filt('lowpass', 500, 0.6, tl)); }
  if (w.mech) { const m = gain(0, o); env(m, t + 0.03, 0.001, 0.12, 0.03); osc('square', 2400, t + 0.03, t + 0.08, filt('bandpass', 3000, 6, m)); }
};
const GUNS = {
  pistol: { crack: 0.6, cd: 0.04, body: 0.7, bd: 0.12, lp: 1300, tf: 190, mech: 1 },
  smg: { crack: 0.5, cd: 0.03, body: 0.55, bd: 0.09, lp: 1500, tf: 210, thump: 0.4 },
  rifle: { crack: 0.95, cd: 0.05, body: 0.9, bd: 0.18, hp: 2200, lp: 900, tf: 140, tail: 0.25 },
  lmg: { crack: 0.9, cd: 0.05, body: 1, bd: 0.2, lp: 800, tf: 120, tail: 0.2 },
  shotgun: { crack: 0.7, cd: 0.07, body: 1.3, bd: 0.32, lp: 600, tf: 90, thump: 1, td: 0.18, tail: 0.35, mech: 1 },
  sniper: { crack: 1.2, cd: 0.07, body: 1, bd: 0.25, hp: 2600, lp: 700, tf: 100, thump: 0.9, tail: 0.6, mech: 1 },
  turret: { crack: 0.9, cd: 0.05, body: 1.1, bd: 0.22, lp: 700, tf: 80, thump: 0.9 },
};
R.rocket = (o, t, op) => {
  const th = gain(0, o); env(th, t, 0.003, 0.9, 0.2); const so = osc('sine', 120, t, t + 0.3, th); so.frequency.exponentialRampToValueAtTime(45, t + 0.25);
  const wh = gain(0, o); env(wh, t, 0.04, 0.6, 1.1, 'lin'); const bp = filt('bandpass', 600, 1.5, wh);
  bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 1); noise(noiseW, t, t + 1.3, bp);
};
R.grenade_launcher = (o, t) => { const g = gain(0, o); env(g, t, 0.002, 0.9, 0.15); const s = osc('sine', 160, t, t + 0.2, g); s.frequency.exponentialRampToValueAtTime(50, t + 0.15); noise(noiseP, t, t + 0.1, filt('lowpass', 900, 1, g)); };
R.grapple_fire = (o, t, op) => {
  // hook zip: a bright air-rip sweeping up + a ratchety line paying out off the gauntlet spool
  const g = gain(0, o); env(g, t, 0.005, 0.5, 0.28); const bp = filt('bandpass', 900, 4, g);
  bp.frequency.setValueAtTime(700, t); bp.frequency.exponentialRampToValueAtTime(5200, t + 0.25); noise(noiseW, t, t + 0.35, bp);
  const z = gain(0, o); env(z, t, 0.002, 0.15, 0.25); const so = osc('sawtooth', 300 * (op.pitch ?? 1), t, t + 0.3, filt('lowpass', 3000, 1, z)); so.frequency.exponentialRampToValueAtTime(1800, t + 0.25);
  for (let i = 0; i < 10; i++) { const tt = t + 0.01 + i * (0.018 + i * 0.002), c = gain(0, o); env(c, tt, 0.001, 0.12 * (1 - i / 12), 0.012); noise(noiseW, tt, tt + 0.02, filt('bandpass', 4200 - i * 120, 6, c)); }
  const k = gain(0, o); env(k, t, 0.001, 0.35, 0.05); const ko = osc('sine', 180, t, t + 0.07, k); ko.frequency.exponentialRampToValueAtTime(70, t + 0.05); // gauntlet recoil
};
R.grapple_hit = (o, t) => {
  // metallic thunk: a heavy bite (low sine drop), a hard click, a short ringing claw
  const g = gain(0, o); env(g, t, 0.001, 0.9, 0.18); const s = osc('sine', 240, t, t + 0.22, g); s.frequency.exponentialRampToValueAtTime(52, t + 0.15);
  const c = gain(0, o); env(c, t, 0.001, 0.55, 0.04); noise(noiseW, t, t + 0.06, filt('bandpass', 2800, 1.5, c));
  const m = gain(0, o); env(m, t, 0.001, 0.13, 0.45); const mf = filt('bandpass', 2200, 3, m); for (const f of [1870, 2630, 3410]) osc('triangle', f * rnd(0.97, 1.03), t, t + 0.5, mf);
};
R.tether = (o, t) => {
  const g = gain(0, o); env(g, t, 0.002, 0.35, 0.5); const lp = filt('lowpass', 4000, 6, g); lp.frequency.exponentialRampToValueAtTime(300, t + 0.45);
  const s = osc('sawtooth', 110, t, t + 0.6, lp); s.frequency.exponentialRampToValueAtTime(95, t + 0.5);
};
R.reel = (o, t) => { for (let i = 0; i < 9; i++) { const tt = t + i * 0.035, g = gain(0, o); env(g, tt, 0.001, 0.25, 0.02); noise(noiseW, tt, tt + 0.03, filt('bandpass', 3200, 5, g)); } R.tether(o, t + 0.3); };
R.parachute_open = (o, t) => {
  // canopy snap: a sharp fabric crack the instant it catches air, a low thump of load, then the cloth settling
  const cr = gain(0, o); env(cr, t, 0.001, 1.0, 0.07); noise(noiseW, t, t + 0.1, filt('highpass', 1400, 0.7, cr));
  const th = gain(0, o); env(th, t + 0.01, 0.004, 0.8, 0.22); const so = osc('sine', 110, t, t + 0.3, th); so.frequency.exponentialRampToValueAtTime(48, t + 0.2);
  const g = gain(0, o); env(g, t + 0.02, 0.01, 0.6, 0.35); noise(noiseP, t, t + 0.5, filt('lowpass', 1400, 0.8, g));
  for (let i = 0; i < 5; i++) { const tt = t + 0.09 + i * 0.065, f = gain(0, o); env(f, tt, 0.003, 0.35 * (1 - i / 6), 0.05); noise(noiseB, tt, tt + 0.1, filt('bandpass', 500, 1, f)); }
};
R.wingsuit_open = (o, t) => {
  const g = gain(0, o); env(g, t, 0.05, 0.6, 0.6); const bp = filt('bandpass', 400, 1, g); bp.frequency.exponentialRampToValueAtTime(1800, t + 0.5); noise(noiseW, t, t + 0.8, bp);
  const sn = gain(0, o); env(sn, t + 0.04, 0.001, 0.45, 0.05); noise(noiseW, t + 0.04, t + 0.1, filt('highpass', 1800, 0.7, sn)); // membrane snapping taut
};
R.grapple_pop = (o, t) => {
  // whoomph: air displaced as the hero is flung up off the arrival
  const g = gain(0, o); env(g, t, 0.03, 0.75, 0.4); const lp = filt('lowpass', 260, 1.2, g); lp.frequency.setValueAtTime(260, t); lp.frequency.exponentialRampToValueAtTime(1400, t + 0.12); lp.frequency.exponentialRampToValueAtTime(300, t + 0.42);
  noise(noiseP, t, t + 0.5, lp);
  const b = gain(0, o); env(b, t, 0.01, 0.5, 0.25); const so = osc('sine', 90, t, t + 0.3, b); so.frequency.exponentialRampToValueAtTime(55, t + 0.25);
};
R.grapple_boost = (o, t) => {
  const g = gain(0, o); env(g, t, 0.02, 0.6, 0.45); const bp = filt('bandpass', 350, 1.4, g); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.3); noise(noiseW, t, t + 0.55, bp);
  const s = gain(0, o); env(s, t, 0.01, 0.2, 0.35); const so = osc('sawtooth', 220, t, t + 0.4, filt('lowpass', 2400, 1, s)); so.frequency.exponentialRampToValueAtTime(900, t + 0.3);
};
R.whoosh = (o, t) => { const g = gain(0, o); env(g, t, 0.08, 0.5, 0.25); const bp = filt('bandpass', 500, 2, g); bp.frequency.exponentialRampToValueAtTime(2200, t + 0.3); noise(noiseW, t, t + 0.4, bp); };
R.impact = (o, t, op) => { const g = gain(0, o); env(g, t, 0.001, 0.5, 0.08); noise(noiseW, t, t + 0.1, filt('bandpass', 1800 * (op.pitch ?? 1), 1.5, g)); };
R.metal = (o, t, op) => {
  const g = gain(0, o); env(g, t, 0.001, 0.35, 0.6); const p = (op.pitch ?? 1) * rnd(0.9, 1.1);
  for (const f of [523, 1187, 1729, 2851]) osc('sine', f * p, t, t + 0.7, g);
  const c = gain(0, o); env(c, t, 0.001, 0.4, 0.03); noise(noiseW, t, t + 0.05, filt('highpass', 3000, 1, c));
};
R.ricochet = (o, t) => { const g = gain(0, o); env(g, t, 0.002, 0.25, 0.35); const s = osc('sine', 3200, t, t + 0.4, g); s.frequency.exponentialRampToValueAtTime(1400, t + 0.35); };
R.glass = (o, t) => { for (let i = 0; i < 14; i++) { const tt = t + rnd(0, 0.5), g = gain(0, o); env(g, tt, 0.001, rnd(0.05, 0.2), rnd(0.05, 0.3)); osc('sine', rnd(2500, 7000), tt, tt + 0.4, g); } };
R.thud = (o, t, op) => { const g = gain(0, o); env(g, t, 0.002, 0.8, 0.22); const s = osc('sine', 110 * (op.pitch ?? 1), t, t + 0.3, g); s.frequency.exponentialRampToValueAtTime(40, t + 0.2); noise(noiseB, t, t + 0.15, filt('lowpass', 500, 1, g)); };
R.footstep = (o, t) => { const g = gain(0, o); env(g, t, 0.002, 0.15, 0.06); noise(noiseP, t, t + 0.08, filt('bandpass', rnd(500, 900), 1.2, g)); };
R.splash = (o, t, op) => {
  const s = op.size ?? 1, g = gain(0, o); env(g, t, 0.01, 0.8 * s, 0.9); const lp = filt('lowpass', 3000, 0.7, g); lp.frequency.exponentialRampToValueAtTime(400, t + 0.9); noise(noiseW, t, t + 1, lp);
  for (let i = 0; i < 8; i++) { const tt = t + rnd(0.1, 0.9), b = gain(0, o); env(b, tt, 0.002, 0.08, 0.06); const so = osc('sine', rnd(500, 1300), tt, tt + 0.1, b); so.frequency.exponentialRampToValueAtTime(rnd(1400, 2500), tt + 0.06); }
};
R.click = (o, t, op) => { const g = gain(0, o); env(g, t, 0.001, 0.3, 0.05); const s = osc('square', 1400 * (op.pitch ?? 1), t, t + 0.07, filt('lowpass', 4000, 1, g)); s.frequency.exponentialRampToValueAtTime(700, t + 0.05); };
R.ui_click = (o, t, op) => { const g = gain(0, o); env(g, t, 0.001, 0.22, 0.07); const s = osc('sine', 1500 * (op.pitch ?? 1), t, t + 0.1, g); s.frequency.exponentialRampToValueAtTime(900, t + 0.06); };
R.ui_hover = (o, t) => { const g = gain(0, o); env(g, t, 0.001, 0.07, 0.03); osc('triangle', 2200, t, t + 0.05, g); };
R.ui_back = (o, t) => { const g = gain(0, o); env(g, t, 0.001, 0.2, 0.12); const s = osc('triangle', 800, t, t + 0.15, g); s.frequency.exponentialRampToValueAtTime(400, t + 0.12); };
R.ui_confirm = (o, t) => { for (const [i, f] of [[0, 660], [1, 990]]) { const g = gain(0, o); env(g, t + i * 0.07, 0.002, 0.18, 0.18); osc('triangle', f, t + i * 0.07, t + i * 0.07 + 0.25, g); } };
R.hitmarker = (o, t) => { const g = gain(0, o); env(g, t, 0.001, 0.18, 0.04); osc('square', 3100, t, t + 0.05, filt('bandpass', 3000, 3, g)); };
R.chaos = (o, t) => { const g = gain(0, o); env(g, t, 0.001, 0.08, 0.15); osc('triangle', 1760, t, t + 0.2, g); };
R.radio = (o, t) => {
  const g = gain(0, o); env(g, t, 0.001, 0.15, 0.08); osc('sine', 1850, t, t + 0.1, g);
  const n = gain(0, o); env(n, t + 0.08, 0.01, 0.12, 0.25, 'lin'); noise(noiseW, t, t + 0.4, filt('bandpass', 2200, 0.8, n));
};
R.damage = (o, t) => { const g = gain(0, o); env(g, t, 0.002, 0.6, 0.25); const s = osc('sine', 80, t, t + 0.3, g); s.frequency.exponentialRampToValueAtTime(35, t + 0.25); noise(noiseB, t, t + 0.2, filt('lowpass', 300, 1, g)); };
R.reload = (o, t) => { R.click(o, t, { pitch: 0.8 }); R.click(o, t + 0.35, { pitch: 1.1 }); R.metal(o, t + 0.55, { pitch: 1.6 }); };
R.empty = (o, t) => R.click(o, t, { pitch: 1.6 });
R.pickup = (o, t) => { for (const [i, f] of [[0, 880], [1, 1320], [2, 1760]]) { const g = gain(0, o); env(g, t + i * 0.05, 0.002, 0.14, 0.15); osc('sine', f, t + i * 0.05, t + i * 0.05 + 0.2, g); } };
R.beep = (o, t, op) => { const g = gain(0, o); env(g, t, 0.002, 0.2, 0.1); osc('square', 1000 * (op.pitch ?? 1), t, t + 0.12, filt('lowpass', 3000, 1, g)); };
function stinger(o, t, notes, dur, bright = 2400) {
  const g = gain(0, o); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35, t + 0.06); g.gain.setTargetAtTime(0.0001, t + dur * 0.6, dur * 0.25);
  const lp = filt('lowpass', 500, 1.5, g); lp.frequency.linearRampToValueAtTime(bright, t + 0.15); lp.frequency.setTargetAtTime(600, t + dur * 0.5, dur * 0.3);
  for (const n of notes) for (const d of [-6, 6]) { const s = osc('sawtooth', 440 * Math.pow(2, (n - 69) / 12), t, t + dur * 1.6, lp); s.detune.value = d; }
  const ti = gain(0, o); env(ti, t, 0.002, 0.25, 1.5); osc('sine', 440 * Math.pow(2, (notes[0] - 81) / 12), t, t + 1.6, ti);
}
function timp(o, t, f, v) { const g = gain(0, o); env(g, t, 0.003, v, 0.9); const so = osc('sine', f * 1.5, t, t + 1.2, g); so.frequency.exponentialRampToValueAtTime(f, t + 0.08);
  const n = gain(0, o); env(n, t, 0.001, v * 0.35, 0.12); noise(noiseB, t, t + 0.15, filt('lowpass', 900, 1, n)); }
function swell(o, t, dur, v) { const g = gain(0, o); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + dur); g.gain.setTargetAtTime(0.0001, t + dur, 0.6);
  const hp = filt('highpass', 2500, 0.7, g); hp.frequency.setValueAtTime(2500, t); hp.frequency.exponentialRampToValueAtTime(7000, t + dur); noise(noiseW, t, t + dur + 2.5, hp); }
function lead(o, t, n, dur, v) { const g = gain(0, o); env(g, t, 0.02, v, dur); const lp = filt('lowpass', 2600, 1, g); for (const d of [-5, 5]) { const s = osc('triangle', 440 * Math.pow(2, (n - 69) / 12), t, t + dur + 0.4, lp); s.detune.value = d; } }
// liberation: D - G - A - D cadence (~3.2 s) with timpani on each chord, a cymbal swell into the last, and a rising horn line
R.liberated = (o, t) => {
  const ch = [[0, [50, 57, 62, 66], 0.9], [0.42, [55, 59, 62, 67], 0.9], [0.84, [57, 61, 64, 69], 1.0], [1.36, [62, 66, 69, 74], 2.8]];
  for (const [dt, notes, dur] of ch) stinger(o, t + dt, notes, dur, dt > 1 ? 3400 : 2400);
  for (const [dt, f, v] of [[0, 73, 0.9], [0.42, 98, 0.7], [0.84, 110, 0.8], [1.2, 110, 0.5], [1.28, 110, 0.6], [1.36, 73, 1.1]]) timp(o, t + dt, f, v);
  swell(o, t + 0.3, 1.06, 0.22);
  for (const [dt, n, d] of [[0, 69, 0.4], [0.42, 71, 0.4], [0.84, 73, 0.5], [1.36, 74, 2.2]]) lead(o, t + dt, n, d, 0.12);
  R.explosion(o, t, { size: 0.2 });
};
R.mission_complete = (o, t) => { stinger(o, t, [57, 61, 64], 0.5); stinger(o, t + 0.32, [62, 66, 69, 74], 2, 3500); };
R.mission_start = (o, t) => { stinger(o, t, [50, 53, 57], 0.9, 1600); stinger(o, t + 0.4, [49, 53, 56], 1.4, 1800); };
R.mission_fail = (o, t) => { stinger(o, t, [57, 60, 64], 0.5, 1400); stinger(o, t + 0.35, [52, 55, 58], 1.8, 900); };
R.objective = (o, t) => { stinger(o, t, [62, 69], 0.4, 2600); stinger(o, t + 0.18, [66, 73], 0.8, 3000); };
R.rank_up = (o, t) => { [0, 4, 7, 12].forEach((n, i) => stinger(o, t + i * 0.09, [62 + n], 0.5 + i * 0.3, 3000)); };
R.alarm = (o, t) => { const g = gain(0, o); env(g, t, 0.05, 0.25, 1.4, 'lin'); const s = osc('sawtooth', 600, t, t + 1.5, filt('lowpass', 2000, 1, g)); s.frequency.linearRampToValueAtTime(900, t + 0.7); s.frequency.linearRampToValueAtTime(600, t + 1.4); };
R.generic = (o, t, op) => { const g = gain(0, o); env(g, t, 0.002, 0.3, 0.12); noise(noiseP, t, t + 0.2, filt('bandpass', 1200 * (op.pitch ?? 1), 1, g)); };

const CHANNEL = n => n.startsWith('ui_') ? 'ui' : 'sfx';
// name resolution: exact recipe -> gun table -> substring aliases -> generic
const ALIAS = [
  [/explo|blast|boom|detonat/, 'explosion'], [/grenade_launch|launcher|gl_/, 'grenade_launcher'], [/rocket|missile|rpg/, 'rocket'],
  [/grapple.*(hit|attach|thunk|land)|hook_hit/, 'grapple_hit'], [/grapple|hook/, 'grapple_fire'], [/reel|retract/, 'reel'], [/tether/, 'tether'],
  [/parachute|chute/, 'parachute_open'], [/wingsuit/, 'wingsuit_open'], [/throw|swing|whoosh/, 'whoosh'],
  [/ricochet/, 'ricochet'], [/metal|clang/, 'metal'], [/glass|shatter/, 'glass'], [/bullet|impact|hit_/, 'impact'],
  [/land|thud|fall|crash|collide/, 'thud'], [/step|foot/, 'footstep'], [/splash|water/, 'splash'], [/hitmark/, 'hitmarker'],
  [/hurt|damage|pain/, 'damage'], [/reload/, 'reload'], [/empty|dry/, 'empty'], [/pickup|collect|ammo/, 'pickup'],
  [/liberat/, 'liberated'], [/complete|success|win/, 'mission_complete'], [/fail|lose/, 'mission_fail'], [/objective|checkpoint|ring/, 'objective'],
  [/rank/, 'rank_up'], [/radio|dialog|subtitle/, 'radio'], [/alarm|siren/, 'alarm'], [/chaos/, 'chaos'],
  [/hover/, 'ui_hover'], [/back|cancel/, 'ui_back'], [/confirm|select|start/, 'ui_confirm'], [/click|ui|menu/, 'ui_click'], [/beep|timer|tick/, 'beep'],
];
function resolve(name) {
  const n = String(name || '').toLowerCase();
  if (R[n]) return { fn: R[n], n };
  const g = n.replace(/^(gunshot|shot|fire|gun)[_:-]?/, '');
  for (const k in GUNS) if (g.includes(k)) return { fn: (o, t, op) => R.gun(o, t, { ...op, w: GUNS[k] }), n: 'gun' };
  if (/gun|shot|fire_|rifle|weapon/.test(n)) return { fn: (o, t, op) => R.gun(o, t, { ...op, w: GUNS.rifle }), n: 'gun' };
  for (const [re, k] of ALIAS) if (re.test(n)) return { fn: R[k], n: k };
  return { fn: R.generic, n: 'generic' };
}
const REF = { explosion: 30, explosion_small: 18, gun: 14, rocket: 14, liberated: 1e5, mission_complete: 1e5, mission_fail: 1e5, mission_start: 1e5, objective: 1e5, rank_up: 1e5 };
let voices = 0;

function play(name, opts = {}) {
  try {
    if (!ctx || !unlocked || ctx.state !== 'running') return;
    if (voices > 90) return;
    const { fn, n } = resolve(name);
    const tr = api && (api.trace || (api.trace = [])); if (tr) { tr.push(n); if (tr.length > 40) tr.shift(); } // recent one-shots (debug)
    const isMusicStinger = REF[n] === 1e5;
    const o = outChain(isMusicStinger ? { volume: opts.volume } : opts, isMusicStinger ? 'ui' : CHANNEL(n), REF[n] || 6, n.startsWith('explosion') ? 4000 : 1200, n === 'explosion' ? 0.35 : 0.12);
    if (!o) return;
    voices++; setTimeout(() => voices--, 3000);
    fn(o.node, o.t, o.d ? { ...opts, dist: o.d } : opts);
  } catch (e) { if (!play._e) { play._e = 1; console.warn('[audio] play', name, e); } }
}

// ---------- loops ----------
const L = {};
L.wind = (o) => {
  // two layers: low body rumble (brown noise) + high hiss (white), plus a proximity "rush" band; levels set per frame
  const lo = gain(0, o), hi = gain(0, o), ru = gain(0, o);
  const lp = filt('lowpass', 180, 0.8, lo); const s1 = noise(noiseB, T(), 0, lp);
  const hm = gain(1, hi); const bp = filt('bandpass', 900, 0.6, hm); const s2 = noise(noiseW, T(), 0, filt('highpass', 300, 0.5, bp));
  const rb = filt('bandpass', 2400, 1.2, ru); const s3 = noise(noiseP, T(), 0, rb, 1.3);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.37; const lg = gain(0.3); lfo.connect(lg); lg.connect(hm.gain); lfo.start(); // gusting
  return { srcs: [s1, s2, s3, lfo], set: p => {
    const t = T();
    if (p.speed != null) { bp.frequency.setTargetAtTime(500 + Math.min(p.speed, 90) * 32, t, 0.25); lp.frequency.setTargetAtTime(120 + Math.min(p.speed, 90) * 3, t, 0.25); }
    if (p.low != null) lo.gain.setTargetAtTime(p.low, t, 0.12);
    if (p.high != null) hi.gain.setTargetAtTime(p.high, t, 0.12);
    if (p.rush != null) { ru.gain.setTargetAtTime(p.rush, t, 0.08); rb.frequency.setTargetAtTime(1600 + p.rush * 2400, t, 0.1); }
  } };
};
L.fire = (o) => { const lp = filt('lowpass', 900, 0.8, o); const s = noise(noiseB, T(), 0, lp, 1.4); const cr = gain(0.3, o); const s2 = noise(noiseW, T(), 0, filt('highpass', 3000, 1, cr), 0.5); return { srcs: [s, s2] }; };
L.alarm = (o) => { const so = ctx.createOscillator(); so.type = 'sawtooth'; so.frequency.value = 700; const lfo = ctx.createOscillator(); lfo.frequency.value = 0.7; const lg = gain(220); lfo.connect(lg); lg.connect(so.frequency); so.connect(filt('lowpass', 1800, 1, gain(0.25, o))); so.start(); lfo.start(); return { srcs: [so, lfo] }; };
L.waves = (o) => { const lp = filt('lowpass', 700, 0.5); const g = gain(0.5, o); lp.connect(g); const s = noise(noiseB, T(), 0, lp, 0.8); const lfo = ctx.createOscillator(); lfo.frequency.value = 0.12; const lg = gain(0.4); lfo.connect(lg); lg.connect(g.gain); lfo.start(); return { srcs: [s, lfo] }; };
L.rain = (o) => { const s = noise(noiseW, T(), 0, filt('highpass', 1500, 0.5, gain(0.3, o))); return { srcs: [s] }; };
L.parachute = (o) => {
  // canopy flapping: low cloth noise chopped by an irregular flutter whose rate and depth climb with airspeed
  const lp = filt('lowpass', 700, 0.9); const am = gain(0.45, o); lp.connect(am); const s = noise(noiseP, T(), 0, lp);
  const lfo = ctx.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 5; const lg = gain(0.3); lfo.connect(lg); lg.connect(am.gain); lfo.start();
  const l2 = ctx.createOscillator(); l2.frequency.value = 0.8; const l2g = gain(1.5); l2.connect(l2g); l2g.connect(lfo.frequency); l2.start(); // irregularity
  const rg = gain(0.06, o); const s2 = noise(noiseW, T(), 0, filt('bandpass', 1800, 2, rg)); // line hum
  return { srcs: [s, lfo, l2, s2], set: p => { if (p.speed != null) { const k = Math.min(1, p.speed / 25), t = T(); lfo.frequency.setTargetAtTime(3.5 + k * 9, t, 0.3); lg.gain.setTargetAtTime(0.18 + k * 0.3, t, 0.3); lp.frequency.setTargetAtTime(500 + k * 900, t, 0.3); rg.gain.setTargetAtTime(0.03 + k * 0.08, t, 0.3); } } };
};
L.wingsuit = (o) => {
  // suit flutter (fabric trailing edges chattering) + a thin whistle off the arm wings; both climb with speed
  const fl = filt('bandpass', 600, 1.4); const am = gain(0.3, o); fl.connect(am); const s = noise(noiseP, T(), 0, fl);
  const lfo = ctx.createOscillator(); lfo.type = 'sawtooth'; lfo.frequency.value = 16; const lg = gain(0.22); lfo.connect(lg); lg.connect(am.gain); lfo.start();
  const wg = gain(0.03, o); const w = ctx.createOscillator(); w.frequency.value = 1400; w.connect(filt('bandpass', 1400, 8, wg)); w.start();
  return { srcs: [s, lfo, w], set: p => { if (p.speed != null) { const t = T(), sp = Math.min(p.speed, 90); fl.frequency.setTargetAtTime(380 + sp * 14, t, 0.15); lfo.frequency.setTargetAtTime(10 + sp * 0.45, t, 0.15); lg.gain.setTargetAtTime(0.1 + Math.min(1, sp / 60) * 0.25, t, 0.2); w.frequency.setTargetAtTime(900 + sp * 18, t, 0.15); wg.gain.setTargetAtTime(0.015 + Math.min(1, sp / 70) * 0.05, t, 0.2); } } };
};
L.reelwhine = (o) => {
  // gauntlet winch: geared whine + motor buzz, pitch follows pull speed
  const g = gain(0.5, o); const lp = filt('lowpass', 2600, 2, g);
  const a = ctx.createOscillator(); a.type = 'sawtooth'; a.frequency.value = 300; a.connect(lp); a.start();
  const b2 = ctx.createOscillator(); b2.type = 'square'; b2.frequency.value = 151; const bg = gain(0.25); b2.connect(bg); bg.connect(lp); b2.start();
  const gr = ctx.createOscillator(); gr.type = 'square'; gr.frequency.value = 45; const grg = gain(0.35); gr.connect(grg); grg.connect(g.gain); gr.start(); // gear teeth
  const hs = gain(0.08, o); const s = noise(noiseW, T(), 0, filt('bandpass', 3800, 3, hs)); // line hiss over the spool
  return { srcs: [a, b2, gr, s], set: p => { if (p.speed != null) { const t = T(), k = Math.min(1, p.speed / 45); a.frequency.setTargetAtTime(240 + k * 620, t, 0.06); b2.frequency.setTargetAtTime(121 + k * 311, t, 0.06); gr.frequency.setTargetAtTime(30 + k * 70, t, 0.06); lp.frequency.setTargetAtTime(1400 + k * 2600, t, 0.08); } } };
};
L.rotor = (o) => rotorSynth(o);
L.engine = (o) => engineSynth(o, 'car');
L.generic = (o) => { const s = noise(noiseP, T(), 0, filt('lowpass', 600, 0.7, gain(0.3, o))); return { srcs: [s] }; };

function loop(name, opts = {}) {
  const dummy = { stop() {}, set() {}, dead: true };
  try {
    if (!ctx) return dummy;
    const n = String(name || '').toLowerCase();
    const key = Object.keys(L).find(k => n.includes(k)) || (/heli|rotor/.test(n) ? 'rotor' : /engine|motor|car/.test(n) ? 'engine' : /siren/.test(n) ? 'alarm' : /sea|surf|shore/.test(n) ? 'waves' : 'generic');
    const ch = opts.channel || (['wind', 'waves', 'rain'].includes(key) ? 'ambient' : 'sfx');
    const out = gain(0);
    let pan = null;
    if (opts.pos && game?.camera) { pan = ctx.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = opts.ref || 10; pan.maxDistance = 2000; out.connect(pan); pan.connect(bus[ch]); }
    else out.connect(bus[ch]);
    const inner = gain(1, out);
    const v = L[key](inner);
    const tr = api && (api.trace || (api.trace = [])); if (tr) { tr.push('loop:' + key); if (tr.length > 40) tr.shift(); }
    const h = {
      dead: false, gain: out,
      set(p = {}) {
        if (h.dead) return;
        if (p.volume != null) out.gain.setTargetAtTime(p.volume, T(), 0.08);
        if (p.pitch != null) for (const s of v.srcs) { if (s.playbackRate) s.playbackRate.setTargetAtTime(p.pitch, T(), 0.1); }
        if (p.pos && pan) setPan(pan, p.pos);
        v.set?.(p);
      },
      stop(fade = 0.3) { if (h.dead) return; h.dead = true; out.gain.setTargetAtTime(0, T(), fade / 3); const t = T() + fade + 0.1; for (const s of v.srcs) { try { s.stop(t); } catch (e) { /* */ } } },
    };
    h.set({ volume: opts.volume ?? 1, pos: opts.pos, ...opts });
    return h;
  } catch (e) { console.warn('[audio] loop', name, e); return dummy; }
}
function setPan(pan, p) {
  const x = fin(p.x), y = fin(p.y), z = fin(p.z), t = T();
  if (pan.positionX) { pan.positionX.setTargetAtTime(x, t, 0.03); pan.positionY.setTargetAtTime(y, t, 0.03); pan.positionZ.setTargetAtTime(z, t, 0.03); } else pan.setPosition(x, y, z);
}

// ---------- engines ----------
function engineSynth(o, type) {
  const heavy = type === 'tank' || type === 'truck';
  const lp = filt('lowpass', 800, 2, o);
  const shaper = ctx.createWaveShaper(); const c = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; c[i] = Math.tanh(x * 2.5); } shaper.curve = c; shaper.connect(lp);
  const a = ctx.createOscillator(); a.type = 'sawtooth'; const b = ctx.createOscillator(); b.type = 'square'; b.detune.value = 7;
  const sub = ctx.createOscillator(); sub.type = 'sine';
  const ga = gain(0.5, shaper), gb = gain(0.25, shaper), gs = gain(heavy ? 0.7 : 0.4, lp);
  a.connect(ga); b.connect(gb); sub.connect(gs);
  const nb = filt('bandpass', 300, 1.5, gain(heavy ? 0.6 : 0.3, o)); const ns = noise(noiseB, T(), 0, nb, 1);
  if (type === 'tank') { const tr = gain(0.12, o); noise(noiseW, T(), 0, filt('bandpass', 2400, 3, tr), 1); }
  // cylinder-firing lope: AM on the harmonic stack at a sub-multiple of the firing rate (strong at idle, smooths with revs)
  shaper.disconnect(); const am = gain(0.8, lp); shaper.connect(am);
  const lope = ctx.createOscillator(); lope.type = 'triangle'; const lopeG = gain(0.3); lope.connect(lopeG); lopeG.connect(am.gain);
  const growl = ctx.createOscillator(); growl.type = 'sawtooth'; const gg = gain(0, shaper); growl.connect(gg); // 1.5x "load" partial, rises with throttle
  const whine = ctx.createOscillator(); whine.type = 'sine'; const wg = gain(0, o); whine.connect(filt('bandpass', 1800, 4, wg)); // gearbox/turbo whine
  const intake = gain(0, o); const ib = filt('bandpass', 1200, 0.9, intake); const ins = noise(noiseP || noiseW, T(), 0, ib, 1);
  a.start(); b.start(); sub.start(); lope.start(); growl.start(); whine.start();
  const base = heavy ? 28 : type === 'jetski' || type === 'boat' ? 55 : 38, span = heavy ? 70 : 150, cyl = heavy ? 0.5 : 0.25;
  return {
    srcs: [a, b, sub, ns, lope, growl, whine, ins],
    set(p) {
      const r = clamp(p.rpm ?? 0.2), th = clamp(p.throttle ?? 0.3), t = T();
      const f = base + r * span;
      a.frequency.setTargetAtTime(f, t, 0.05); b.frequency.setTargetAtTime(f * 0.5, t, 0.05); sub.frequency.setTargetAtTime(f * 0.5, t, 0.05);
      lp.frequency.setTargetAtTime(350 + r * 1500 + th * 1400, t, 0.06); nb.frequency.setTargetAtTime(200 + r * 900, t, 0.08);
      lope.frequency.setTargetAtTime(f * cyl, t, 0.05); lopeG.gain.setTargetAtTime(0.32 * (1 - r * 0.8), t, 0.1);
      growl.frequency.setTargetAtTime(f * 1.5, t, 0.05); gg.gain.setTargetAtTime(th * (heavy ? 0.22 : 0.16), t, 0.08);
      whine.frequency.setTargetAtTime(500 + r * (heavy ? 900 : 2600), t, 0.08); wg.gain.setTargetAtTime(heavy ? 0.01 + r * 0.02 : r * r * 0.05, t, 0.1);
      intake.gain.setTargetAtTime(th * (0.05 + r * 0.12), t, 0.08); ib.frequency.setTargetAtTime(700 + r * 2200, t, 0.1);
    },
  };
}
function rotorSynth(o) {
  const chopG = gain(0, o); const bp = filt('bandpass', 380, 0.9, chopG); const ns = noise(noiseP, T(), 0, bp, 1);
  const lfo = ctx.createOscillator(); lfo.type = 'sawtooth'; lfo.frequency.value = 16; const lg = gain(0.55); lfo.connect(lg); lg.connect(chopG.gain);
  const thump = ctx.createOscillator(); thump.type = 'sine'; thump.frequency.value = 52; const tg = gain(0); thump.connect(tg); tg.connect(o); lg.connect(tg.gain);
  const wh = ctx.createOscillator(); wh.type = 'sine'; wh.frequency.value = 3200; wh.connect(gain(0.015, o));
  lfo.start(); thump.start(); wh.start();
  return { srcs: [ns, lfo, thump, wh], set(p) { const r = clamp(p.rpm ?? 1), t = T(); lfo.frequency.setTargetAtTime(6 + r * 13, t, 0.2); wh.frequency.setTargetAtTime(1800 + r * 2200, t, 0.3); bp.frequency.setTargetAtTime(250 + r * 250, t, 0.2); } };
}
function jetSynth(o) {
  const lp = filt('lowpass', 900, 0.7, o); const ns = noise(noiseP, T(), 0, lp, 1);
  const w = ctx.createOscillator(); w.type = 'sawtooth'; const wg = gain(0.06, filt('bandpass', 2000, 3, o)); w.connect(wg); w.start();
  return { srcs: [ns, w], set(p) { const r = clamp(p.rpm ?? 0.5), t = T(); lp.frequency.setTargetAtTime(400 + r * 2600, t, 0.1); w.frequency.setTargetAtTime(600 + r * 1800, t, 0.1); } };
}
function vpos(v) { return v.pos || v.position || v.obj?.position || v.mesh?.position || v.group?.position || null; }
function engine(v) {
  try {
    if (!ctx || !unlocked || !v) return;
    let e = engines.get(v);
    const type = String(v.type || 'car').toLowerCase();
    if (!e) {
      const out = gain(0); const pan = ctx.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = type.includes('heli') ? 25 : 8; pan.maxDistance = 1500;
      out.connect(pan); pan.connect(bus.sfx);
      const inner = gain(1, out);
      const syn = type.includes('heli') ? rotorSynth(inner) : type === 'plane' ? jetSynth(inner) : engineSynth(inner, type);
      e = { out, pan, syn, seen: 0, type }; engines.set(v, e);
      out.gain.setTargetAtTime(type.includes('heli') ? 0.9 : 0.55, T(), 0.3);
    }
    e.seen = performance.now();
    let rpm = v.rpm ?? (v.speed != null ? Math.abs(v.speed) / 40 : 0.3);
    if (rpm > 20) rpm = (rpm - 700) / 6300; else if (rpm > 1.5) rpm /= 8;
    e.syn.set({ rpm: clamp(rpm), throttle: Math.abs(v.throttle ?? 0.3) });
    const p = vpos(v); if (p) setPan(e.pan, p);
    const dead = v.dead || v.destroyed || v.hp <= 0;
    if (dead) killEngine(v, e);
  } catch (err) { if (!engine._e) { engine._e = 1; console.warn('[audio] engine', err); } }
}
function killEngine(v, e) { e.out.gain.setTargetAtTime(0, T(), 0.15); const t = T() + 0.8; for (const s of e.syn.srcs) { try { s.stop(t); } catch (x) { /* */ } } engines.delete(v); }

// ---------- adaptive generative score ----------
// Andalusian cadence (Dm C Bb A) in a Mediterranean dorian/phrygian colour; calm layers (pad, plucked
// arpeggio, frame drum) crossfade into combat layers (bass, kit, string ostinato, brass stabs) by intensity.
const music = { next: 0, step: 0, bpm: 96, on: false, gains: {} };
const CHORDS = [[50, 53, 57, 62], [48, 52, 55, 60], [46, 50, 53, 58], [45, 49, 52, 57], [50, 53, 57, 62], [55, 58, 62, 65], [46, 50, 53, 58], [45, 49, 52, 57]];
const mtof = n => 440 * Math.pow(2, (n - 69) / 12);
function musicSetup() {
  for (const k of ['pad', 'arp', 'bass', 'drums', 'perc', 'strings', 'brass']) { music.gains[k] = gain(0, bus.music); }
  const mv = gain(0.25); music.gains.pad.connect(mv); mv.connect(verb); music.gains.arp.connect(mv);
  music.on = true; music.next = T() + 0.2;
}
function mNote(dest, type, n, t, dur, peak, cutoff = 2000, a = 0.005) {
  const g = gain(0, dest); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
  const lp = filt('lowpass', cutoff, 1, g); const o = osc(type, mtof(n), t, t + a + dur + 0.05, lp); return o;
}
function kick(dest, t, v) { const g = gain(0, dest); env(g, t, 0.002, v, 0.35); const o = osc('sine', 140, t, t + 0.4, g); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); }
function snare(dest, t, v) { const g = gain(0, dest); env(g, t, 0.001, v, 0.18); noise(noiseW, t, t + 0.2, filt('bandpass', 1900, 0.8, g)); const b = gain(0, dest); env(b, t, 0.001, v * 0.6, 0.08); osc('triangle', 190, t, t + 0.1, b); }
function hat(dest, t, v) { const g = gain(0, dest); env(g, t, 0.001, v, 0.04); noise(noiseW, t, t + 0.05, filt('highpass', 7000, 1, g)); }
function tom(dest, t, v, f) { const g = gain(0, dest); env(g, t, 0.002, v, 0.3); const o = osc('sine', f, t, t + 0.35, g); o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.3); }
function frame(dest, t, v) { const g = gain(0, dest); env(g, t, 0.003, v, 0.4); const o = osc('sine', 95, t, t + 0.45, g); o.frequency.exponentialRampToValueAtTime(70, t + 0.3); const n = gain(0, dest); env(n, t, 0.001, v * 0.3, 0.05); noise(noiseP, t, t + 0.06, filt('bandpass', 700, 1, n)); }
function musicTick() {
  if (!music.on) return;
  const spb = 60 / music.bpm / 4; // 16th
  const i = musicI, G = music.gains, t0 = T();
  const tc = 0.6;
  G.pad.gain.setTargetAtTime(0.16 * (1 - i * 0.4), t0, tc);
  G.arp.gain.setTargetAtTime(0.14 * clamp(1.2 - i * 1.4), t0, tc);
  G.perc.gain.setTargetAtTime(0.25 * clamp(1 - i), t0, tc);
  G.bass.gain.setTargetAtTime(0.22 * clamp((i - 0.15) * 2), t0, tc);
  G.drums.gain.setTargetAtTime(0.35 * clamp((i - 0.3) * 2), t0, tc);
  G.strings.gain.setTargetAtTime(0.09 * clamp((i - 0.45) * 2.5), t0, tc);
  G.brass.gain.setTargetAtTime(0.12 * clamp((i - 0.65) * 3), t0, tc);
  while (music.next < t0 + 0.25) {
    const t = music.next, s = music.step, bar = Math.floor(s / 16), b16 = s % 16;
    const ch = CHORDS[bar % CHORDS.length];
    if (b16 === 0) {
      for (const n of ch) for (const d of [-8, 8]) { const o = mNote(G.pad, 'sawtooth', n, t, spb * 16 * 1.1, 0.12, 700 + Math.sin(bar) * 200, 0.6); o.detune.value = d; }
      if (i > 0.65) for (const n of ch.slice(0, 3)) mNote(G.brass, 'sawtooth', n + 12, t, 0.5, 0.25, 1800, 0.03);
    }
    if (b16 % 2 === 0 && Math.random() < (b16 % 4 === 0 ? 0.6 : 0.3)) { // plucked mandolin-ish arpeggio
      const n = ch[(Math.random() * 4) | 0] + 12 + (Math.random() < 0.3 ? 12 : 0);
      mNote(G.arp, 'triangle', n, t, 0.45, 0.3, 3000, 0.002);
      if (Math.random() < 0.25) mNote(G.arp, 'triangle', n, t + spb * 0.5, 0.3, 0.15, 2600, 0.002);
    }
    if (b16 === 0 || b16 === 10) frame(G.perc, t, b16 === 0 ? 0.6 : 0.35);
    if (b16 === 6 && Math.random() < 0.5) frame(G.perc, t, 0.25);
    if ([0, 3, 8, 11, 14].includes(b16)) mNote(G.bass, 'sawtooth', ch[0] - 12 + (b16 === 14 ? 7 : 0), t, spb * 2.5, 0.5, 500);
    if (b16 % 4 === 0) kick(G.drums, t, 0.8); if (b16 === 7 && bar % 2) kick(G.drums, t, 0.5);
    if (b16 === 4 || b16 === 12) snare(G.drums, t, 0.6);
    hat(G.drums, t, b16 % 2 ? 0.12 : 0.22);
    if (bar % 4 === 3 && b16 >= 12) tom(G.drums, t, 0.6, 180 - (b16 - 12) * 25);
    const sn = ch[b16 % 4 === 2 ? 2 : 0] + (b16 % 8 < 4 ? 0 : 12); mNote(G.strings, 'sawtooth', sn, t, spb * 0.8, 0.4, 2200, 0.01);
    music.step++; music.next += spb;
  }
}

// ---------- ambience: wind by speed, waves near shore, cicadas/birds/crickets by hour, flight loops ----------
function ambienceSetup() {
  amb.wind = loop('wind', { volume: 0, channel: 'ambient' });
  amb.waves = loop('waves', { volume: 0, channel: 'ambient' });
  amb.cic = gain(0, bus.ambient);
  const c = ctx.createOscillator(); c.frequency.value = 4800; const am = gain(0); c.connect(am); am.connect(filt('bandpass', 5000, 4, amb.cic));
  const lfo = ctx.createOscillator(); lfo.frequency.value = 38; lfo.type = 'square'; const lg = gain(0.5); lfo.connect(lg); lg.connect(am.gain);
  const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.3; const lg2 = gain(0.5); lfo2.connect(lg2); lg2.connect(am.gain);
  c.start(); lfo.start(); lfo2.start();
  amb.crk = gain(0, bus.ambient);
  const k = ctx.createOscillator(); k.frequency.value = 3600; const ka = gain(0); k.connect(ka); ka.connect(amb.crk);
  const kl = ctx.createOscillator(); kl.frequency.value = 2.2; kl.type = 'square'; const kg = gain(0.5); kl.connect(kg); kg.connect(ka.gain); k.start(); kl.start();
  amb.birdT = 0;
}
function bird(t) {
  const g = gain(0, bus.ambient); const p = { x: game.camera.position.x + rnd(-40, 40), y: game.camera.position.y + rnd(5, 20), z: game.camera.position.z + rnd(-40, 40) };
  const pan = ctx.createPanner(); pan.panningModel = 'HRTF'; pan.refDistance = 12; setPan(pan, p); g.disconnect(); g.connect(pan); pan.connect(bus.ambient);
  const n = 2 + (Math.random() * 5 | 0), f0 = rnd(2200, 4200);
  for (let i = 0; i < n; i++) { const tt = t + i * rnd(0.08, 0.16), e = gain(0, g); env(e, tt, 0.005, 0.07, 0.07); const o = osc('sine', f0, tt, tt + 0.1, e); o.frequency.exponentialRampToValueAtTime(f0 * rnd(1.2, 1.6), tt + 0.06); }
  g.gain.value = 1;
}
let flight = { mode: null, h: null };
function hourNow() { const g = game.gfx; const h = g?.timeOfDay ?? g?.hour ?? g?.time ?? g?.tod; return typeof h === 'number' ? ((h % 24) + 24) % 24 : 13; }
function ambienceTick(dt) {
  const pl = game.player, cam = game.camera, t = T();
  const vel = pl?.vel; const speed = vel ? Math.hypot(vel.x || 0, vel.y || 0, vel.z || 0) : 0;
  const inVeh = pl?.state === 'vehicle';
  const airborne = ['air', 'parachute', 'wingsuit', 'grapple'].includes(pl?.state);
  // wind roar ∝ speed² (dynamic pressure); louder in a wingsuit dive, a high "rush" when skimming terrain
  const q = clamp(Math.max(0, speed - 3) / 62) ** 2 * (inVeh ? 0.3 : 1);
  const dive = pl?.state === 'wingsuit' ? 1.25 + clamp(-(vel?.y || 0) / 40) * 0.25 : airborne ? 1 : 0.55;
  const prox = pl?.state === 'wingsuit' ? clamp(pl.proximity || 0) : 0;
  const alt = clamp((cam.position.y - 300) / 900) * 0.12;
  const wl = 0.04 + alt + q * 0.55 * dive * (1 + prox * 0.4), wh = 0.015 + q * 0.42 * dive, wr = prox * prox * 0.4 * clamp(speed / 40);
  amb.wind.set({ volume: 1, speed, low: wl, high: wh, rush: wr });
  // what the roar is doing right now (tests / tuning read this): gains + the hiss band centre (brightness)
  api.windDebug = { speed: +speed.toFixed(1), low: +wl.toFixed(3), high: +wh.toFixed(3), rush: +wr.toFixed(3), hissHz: Math.round(500 + Math.min(speed, 90) * 32), rumbleHz: Math.round(120 + Math.min(speed, 90) * 3) };
  // shore proximity: sample isWater in a ring around the listener
  let shore = 0;
  if (game.world?.isWater && (amb._s = (amb._s || 0) + dt) > 0.5) {
    amb._s = 0; let w = 0; const x = cam.position.x, z = cam.position.z;
    for (let a = 0; a < 8; a++) for (const r of [15, 45]) if (game.world.isWater(x + Math.cos(a * 0.785) * r, z + Math.sin(a * 0.785) * r)) w++;
    shore = w > 0 && w < 16 ? 1 - Math.abs(w - 8) / 10 : w === 16 ? 0.4 : 0;
    const alt = cam.position.y - (game.world.seaLevel ?? 0);
    amb.waves.set({ volume: shore * 0.7 * clamp(1 - alt / 120) });
  }
  const h = hourNow(), day = h > 7 && h < 19.5, dayAmt = day ? clamp(Math.min(h - 7, 19.5 - h) / 2) : 0;
  const ground = !airborne && cam.position.y - (game.world?.heightAt?.(cam.position.x, cam.position.z) ?? 0) < 40;
  amb.cic.gain.setTargetAtTime(ground ? 0.03 * dayAmt * (h > 10 && h < 18 ? 1 : 0.3) : 0, t, 1);
  amb.crk.gain.setTargetAtTime(ground && !day ? 0.02 : 0, t, 1);
  amb.birdT -= dt;
  if (amb.birdT <= 0) { amb.birdT = rnd(1.5, 6); if (ground && h > 5 && h < 11 || (ground && day && Math.random() < 0.3)) bird(t + 0.05); }
  // flight loops follow player state
  const mode = pl?.state === 'parachute' ? 'parachute' : pl?.state === 'wingsuit' ? 'wingsuit' : null;
  if (mode !== flight.mode) {
    flight.h?.stop(0.4); flight.h = null; if (mode) { flight.h = loop(mode, { volume: 0 }); play(mode === 'parachute' ? 'parachute_open' : 'wingsuit_open', { volume: 0.8 }); }
    flight.mode = mode;
  }
  flight.h?.set({ speed, volume: mode === 'wingsuit' ? 0.2 + clamp(speed / 60) * 0.45 : 0.3 + clamp(speed / 25) * 0.25 });
  // reel whine while being pulled by the grapple
  const G = game.grapple, reeling = pl?.state === 'grapple' && !pl.hanging && G?.state === 'reeling';
  if (reeling && !flight.reel) flight.reel = loop('reelwhine', { volume: 0 });
  if (flight.reel) {
    if (!reeling) { flight.reel.stop(0.25); flight.reel = null; }
    else { const rs = Math.max(fin(flight.reelSpeed), speed); flight.reel.set({ speed: rs, volume: 0.07 + clamp(rs / 45) * 0.12 }); }
  }
}

// ---------- listener ----------
const _f = { x: 0, y: 0, z: -1 };
function listenerTick() {
  const c = game.camera; if (!c) return;
  c.updateMatrixWorld?.();
  const e = c.matrixWorld.elements, L0 = ctx.listener, t = T();
  const fx = -e[8], fy = -e[9], fz = -e[10], ux = e[4], uy = e[5], uz = e[6];
  const p = c.getWorldPosition ? c.getWorldPosition(new game.THREE.Vector3()) : c.position;
  if (L0.positionX) {
    L0.positionX.setTargetAtTime(p.x, t, 0.02); L0.positionY.setTargetAtTime(p.y, t, 0.02); L0.positionZ.setTargetAtTime(p.z, t, 0.02);
    L0.forwardX.setTargetAtTime(fx, t, 0.02); L0.forwardY.setTargetAtTime(fy, t, 0.02); L0.forwardZ.setTargetAtTime(fz, t, 0.02);
    L0.upX.setTargetAtTime(ux, t, 0.02); L0.upY.setTargetAtTime(uy, t, 0.02); L0.upZ.setTargetAtTime(uz, t, 0.02);
  } else { L0.setPosition(p.x, p.y, p.z); L0.setOrientation(fx, fy, fz, ux, uy, uz); }
}

let api;
function setMusicIntensity(v) { extI = clamp(+v || 0); extT = performance.now(); }
function setVolume(ch, v) { if (ch in vol) { vol[ch] = clamp(+v, 0, 1.5); applyVolumes(); } }

export default {
  name: 'audio',
  init(g) {
    game = g;
    api = g.audio = { play, loop, engine, setMusicIntensity, setVolume, unlock, unlocked: false, get ctx() { return ctx; }, get volumes() { return { ...vol }; }, get intensity() { return musicI; } };
    const u = () => { unlock(); if (ctx && ctx.state === 'running' && !music.on) { musicSetup(); ambienceSetup(); } };
    for (const ev of ['pointerdown', 'keydown', 'touchstart', 'mousedown']) addEventListener(ev, u, { capture: true });
    g._audioUnlock = u;
    // event-driven SFX for common contract events (other modules may also call play directly)
    const E = g.events;
    E.on('explosion', d => { const r = d?.radius ?? 6; play(r < 4 ? 'explosion_small' : 'explosion', { pos: d?.pos, size: clamp(r / 8, 0.4, 2) }); combatHeat = Math.min(1, combatHeat + 0.25); g.gfx?.shake?.(0); });
    E.on('enemy:killed', () => { combatHeat = Math.min(1, combatHeat + 0.1); });
    E.on('player:damaged', () => { combatHeat = Math.min(1, combatHeat + 0.15); play('damage', { volume: 0.6 }); });
    E.on('hitmarker', () => play('hitmarker'));
    E.on('base:liberated', () => play('liberated'));
    E.on('region:liberated', () => play('liberated', { volume: 1.2 }));
    E.on('mission:start', () => play('mission_start'));
    E.on('mission:complete', () => play('mission_complete'));
    E.on('mission:fail', () => play('mission_fail'));
    // traversal cues (grapple.js already plays grapple_fire / grapple_hit / reel itself; these are the extra layers)
    E.on('grapple:pop', d => play('grapple_pop', { volume: 0.9 }));
    E.on('grapple:boost', () => play('grapple_boost', { volume: 0.8 }));
    E.on('grapple:reel', d => { flight.reelSpeed = fin(d?.speed); });
    E.on('vehicle:exited', d => { const e = d?.v && engines.get(d.v); if (e) { /* keep idling; fades when not updated */ } });
  },
  update(dt) {
    if (!ctx || ctx.state !== 'running' || !music.on) return;
    const rdt = Math.min(0.1, (performance.now() - (this._t || performance.now())) / 1000); this._t = performance.now();
    listenerTick();
    // engines not refreshed this frame fade out
    const now = performance.now();
    for (const [v, e] of engines) if (now - e.seen > 300) killEngine(v, e);
    combatHeat = Math.max(0, combatHeat - rdt * 0.05);
    const heat = (game.enemies?.heat ?? 0) / 5;
    const ext = now - extT < 8000 ? extI : 0;
    musicTarget = game.state === 'title' ? 0.05 : Math.max(ext, clamp(heat * 0.85 + combatHeat * 0.6));
    musicI += (musicTarget - musicI) * Math.min(1, rdt * (musicTarget > musicI ? 0.8 : 0.15));
    musicTick();
    if (game.camera) ambienceTick(rdt);
  },
};
