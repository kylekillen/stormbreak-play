// STORMBREAK core: builds the shared `game` object, input, physics world, and the main loop,
// then loads every system module. See docs/CONTRACT.md.
import * as THREE from 'three';
import RAPIER from 'rapier';

// Order matters: each system's init can rely on the ones before it.
const SYSTEMS = ['gfx', 'world/index', 'fx', 'audio', 'save', 'camera', 'player', 'grapple', 'vehicles',
  'combat', 'enemies', 'progress', 'missions', 'hud'];

const params = new URLSearchParams(location.search);
const boot = (pct, msg) => {
  document.getElementById('bootfill').style.width = pct + '%';
  document.getElementById('bootmsg').textContent = msg || '';
};

function emitter() {
  const m = new Map();
  return {
    on(n, f) { (m.get(n) || m.set(n, []).get(n)).push(f); return f; },
    off(n, f) { const a = m.get(n); if (a) a.splice(a.indexOf(f) >>> 0, 1); },
    emit(n, d) { for (const f of (m.get(n) || []).slice()) { try { f(d); } catch (e) { console.error(`[event ${n}]`, e); } } },
  };
}

// ---------- input: keyboard + mouse + gamepad, one action vocabulary ----------
const KEYS = {
  jump: ['Space'], sprint: ['ShiftLeft', 'ShiftRight'], crouch: ['KeyC'], interact: ['KeyF'],
  grapple: ['KeyE'], tether: ['KeyQ'], reel: ['KeyR'], throw: ['KeyG'], reload: ['KeyT'],
  weapon1: ['Digit1'], weapon2: ['Digit2'], weapon3: ['Digit3'], map: ['KeyM'], pause: ['Escape', 'KeyP'],
  up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
};
// Gamepad: W3C "standard" mapping (https://w3c.github.io/gamepad/#remapping). Xbox / PlayStation names:
//  0 A/Cross  1 B/Circle  2 X/Square  3 Y/Triangle  4 LB/L1  5 RB/R1  6 LT/L2 (analog)  7 RT/R2 (analog)
//  8 View/Share(Create)  9 Menu/Options  10 L3  11 R3  12-15 D-pad up/down/left/right  16 Xbox/PS
// Layout follows Just Cause 3: A jump / chute, Y wingsuit (in the air) / interact, B crouch / cut, LB grapple,
// LT aim, RT fire. Triggers 6/7 are read separately (analog value with hysteresis), not through PAD.
const PAD = { jump: 0, crouch: 1, reload: 2, interact: 3, grapple: 4, tether: 5, map: 8, pause: 9,
  sprint: 10, reel: 11, weapon1: 12, throw: 13, weapon3: 14, weapon2: 15 };
const PAD_TRIG = { aim: 6, fire: 7 }, TRIG_ON = 0.5, TRIG_OFF = 0.3, STICK_DZ = 0.16, STICK_MAX = 0.95;
// radial deadzone: the stick vector's length is rescaled from [DZ, MAX] to [0, 1], direction kept
function stick(x, y) {
  x = Number.isFinite(x) ? x : 0; y = Number.isFinite(y) ? y : 0;
  const m = Math.hypot(x, y); if (m < STICK_DZ) return [0, 0];
  const k = Math.min(1, (m - STICK_DZ) / (STICK_MAX - STICK_DZ)) / m; return [x * k, y * k];
}

function makeInput(canvas) {
  const keys = new Set(), mouse = new Set();
  let cur = {}, prev = {};
  const look = { x: 0, y: 0 }, move = { x: 0, y: 0 };
  let mdx = 0, mdy = 0, wheel = 0;
  const trig = { aim: false, fire: false }, trigRest = {};
  let padIdx = -1; // index of the pad last used; sticks until another pad sends input
  // trigger value: the standard mapping gives analog .value; never treat a resting trigger (value 0) as held
  const trigValue = b => !b ? 0 : Number.isFinite(b.value) ? Math.max(0, b.value) : b.pressed ? 1 : 0; // value only: a 'pressed' flag with value 0 is a driver mis-report
  // getGamepads() can hold nulls, disconnected ghosts and phantom devices (no buttons, e.g. some virtual HID drivers).
  // Prefer a connected 'standard' pad; among several, the one whose input last CHANGED wins (a phantom with a stuck
  // button never changes, so it can't steal focus from the pad in Kyle's hands).
  const sig = {}, active = p => { const k = (p.buttons || []).map(b => b?.pressed ? 1 : 0).join('') + (p.axes || []).slice(0, 4).map(v => Math.abs(v) > 0.5 ? Math.sign(v) : 0).join('');
    const was = sig[p.index]; sig[p.index] = k; return was !== undefined && was !== k; };
  function pickPad() {
    let list = []; try { list = [...(navigator.getGamepads?.() || [])]; } catch (e) { return null; }
    const ok = list.filter(p => p && p.connected !== false && (p.buttons?.length || 0) >= 4 && (p.axes?.length || 0) >= 2);
    if (!ok.length) { padIdx = -1; return null; }
    const std = ok.filter(p => p.mapping === 'standard'), pool = std.length ? std : ok;
    const hot = pool.filter(active).find(p => p.index !== padIdx); if (hot) padIdx = hot.index;
    const gp = pool.find(p => p.index === padIdx) || pool[0]; padIdx = gp.index; return gp;
  }
  addEventListener('keydown', e => { keys.add(e.code); if (e.code === 'Space' || e.code === 'Tab') e.preventDefault(); });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); mouse.clear(); });
  canvas.addEventListener('mousedown', e => { mouse.add(e.button); if (game.state === 'play' && !document.pointerLockElement) canvas.requestPointerLock?.(); });
  addEventListener('mouseup', e => mouse.delete(e.button));
  addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('mousemove', e => { if (document.pointerLockElement) { mdx += e.movementX; mdy += e.movementY; } });
  addEventListener('wheel', e => { wheel += Math.sign(e.deltaY); });
  const api = {
    move, look, wheel: 0, gamepad: null, padMapping: null, trig: { aim: 0, fire: 0 }, sensitivity: 0.0022, padLook: 3.2,
    down: a => !!cur[a], pressed: a => !!cur[a] && !prev[a], released: a => !cur[a] && !!prev[a],
    poll(dt) {
      prev = cur; cur = {};
      for (const [a, codes] of Object.entries(KEYS)) if (codes.some(c => keys.has(c))) cur[a] = true;
      if (mouse.has(0)) cur.fire = true;
      if (mouse.has(2)) cur.aim = true;
      let mx = (cur.right ? 1 : 0) - (cur.left ? 1 : 0), my = (cur.up ? 1 : 0) - (cur.down ? 1 : 0);
      look.x = mdx * api.sensitivity; look.y = mdy * api.sensitivity; mdx = mdy = 0;
      api.wheel = wheel; wheel = 0;
      const gp = pickPad();
      api.gamepad = gp; api.padMapping = gp ? (gp.mapping || 'nonstandard') : null;
      if (gp) {
        const B = gp.buttons || [], A = gp.axes || [], std = gp.mapping === 'standard';
        if (!std && !trigRest[gp.index]) trigRest[gp.index] = { 6: A[4] <= -0.9, 7: A[5] <= -0.9 };
        const [lx, ly] = stick(A[0], A[1]), [rx, ry] = stick(A[2], A[3]);
        if (lx || ly) { mx = lx; my = -ly; }
        // response curve: squared magnitude for fine aim near centre, full speed at the rim
        const rm = Math.hypot(rx, ry);
        look.x += rx * rm * api.padLook * dt; look.y += ry * rm * api.padLook * dt;
        for (const [a, i] of Object.entries(PAD)) if (B[i]?.pressed) cur[a] = true;
        for (const [a, i] of Object.entries(PAD_TRIG)) {
          let v = trigValue(B[i]);
          // non-standard pads (Firefox/Safari DualSense over BT, generic HID) often expose L2/R2 as axes 4/5 resting
          // at -1. Trust such an axis only if it read <= -0.9 the first frame we saw this pad (sticks rest at 0, so a
          // stick axis pushed to -1 later can never be mistaken for a trigger)
          if (!std) { const ax = A[i - 2]; if (Number.isFinite(ax) && trigRest[gp.index]?.[i]) v = Math.max(v, (ax + 1) / 2); }
          trig[a] = trig[a] ? v > TRIG_OFF : v > TRIG_ON; // hysteresis: press at 0.5, release below 0.3
          if (trig[a]) cur[a] = true;
        }
        api.trig = { aim: trigValue(B[6]), fire: trigValue(B[7]) };
        // airborne pad layout (JC3): Y / Triangle = wingsuit, X / Square also opens it (X reloads only on the ground);
        // A / Cross = parachute is just 'jump' in the air. In the grapple state Y keeps 'interact' too so a hook on a
        // vehicle still hijacks (grapple.js checks interact first) and otherwise the wingsuit opens off the reel.
        const ps = game.player?.state, air = ps === 'air' || ps === 'parachute' || ps === 'wingsuit' || ps === 'grapple';
        if (air && B[2]?.pressed) { cur.sprint = true; delete cur.reload; }
        if (air && B[3]?.pressed) { cur.sprint = true; if (ps !== 'grapple') delete cur.interact; }
      } else { trig.aim = trig.fire = false; api.trig = { aim: 0, fire: 0 }; }
      const len = Math.hypot(mx, my); if (len > 1) { mx /= len; my /= len; }
      move.x = mx; move.y = my;
    },
  };
  return api;
}

// ---------- the game object ----------
const game = window.game = {
  THREE, RAPIER, events: emitter(), state: 'title', paused: false, simTime: 0, dt: 0, ready: false,
  params, seed: +(params.get('seed') || 1337), systems: [], errors: [],
};

async function start() {
  boot(5, 'physics');
  await RAPIER.init();
  game.physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  const renderer = game.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.prepend(renderer.domElement);
  game.scene = new THREE.Scene();
  game.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 6000);
  game.camera.position.set(0, 60, 0);
  game.input = makeInput(renderer.domElement);
  game.render = () => renderer.render(game.scene, game.camera);
  game.teleport = (x, z) => game.player?.respawn?.(new THREE.Vector3(x, (game.world?.heightAt?.(x, z) ?? 0) + 2, z));
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    game.camera.aspect = innerWidth / innerHeight; game.camera.updateProjectionMatrix();
    game.events.emit('resize', {});
  });

  for (let i = 0; i < SYSTEMS.length; i++) {
    const name = SYSTEMS[i];
    boot(10 + 85 * i / SYSTEMS.length, name);
    try {
      const mod = (await import(`./${name}.js`)).default;
      if (mod?.init) await mod.init(game);
      if (mod) game.systems.push(mod);
    } catch (e) {
      console.error(`[system ${name}] failed to load:`, e);
      game.errors.push({ system: name, error: String(e?.stack || e) });
    }
  }
  boot(100, '');
  document.getElementById('boot').classList.add('done');
  game.ready = true;
  game.events.emit('ready', {});
  loop();
}

const STEP = 1 / 60;
let last = performance.now(), acc = 0;
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  game.input.poll(dt);
  game.dt = game.paused ? 0 : dt;
  if (!game.paused) {
    game.simTime += dt;
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps++ < 4) { game.physics.timestep = STEP; game.physics.step(game.eventQueue); acc -= STEP; game.events.emit('physicsStep', STEP); }
    if (steps >= 4) acc = 0;
  }
  for (const s of game.systems) if (s.update) { try { s.update(game.dt, game); } catch (e) { if (!s._err) { s._err = 1; console.error(`[${s.name}] update`, e); } } }
  for (const s of game.systems) if (s.lateUpdate) { try { s.lateUpdate(game.dt, game); } catch (e) { if (!s._lerr) { s._lerr = 1; console.error(`[${s.name}] lateUpdate`, e); } } }
  (game.gfx?.render || game.render)();
}

start().catch(e => { console.error(e); boot(0, 'boot failed: ' + e.message); });
