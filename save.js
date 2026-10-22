// STORMBREAK save: versioned localStorage store. game.save.get(key, def), set(key,val), flush(), reset(), exists().
const KEY = 'stormbreak.save';
const VERSION = 2;
let data = null, dirty = false, timer = 0, game;

function blank() { return { version: VERSION, created: Date.now(), updated: Date.now(), playTime: 0 }; }
function migrate(d) {
  if (!d || typeof d !== 'object') return blank();
  if (!d.version || d.version < 2) { d.version = 2; d.playTime = d.playTime || 0; }
  return d;
}
function load() {
  try { const raw = localStorage.getItem(KEY); data = raw ? migrate(JSON.parse(raw)) : blank(); } catch (e) { console.warn('[save] corrupt save, starting fresh', e); data = blank(); }
}
function flush() {
  try { data.updated = Date.now(); localStorage.setItem(KEY, JSON.stringify(data)); dirty = false; game?.events?.emit('save:written', {}); return true; } catch (e) { console.warn('[save] write failed', e); return false; }
}
const api = {
  get(k, def) { const v = data[k]; return v === undefined ? def : v; },
  set(k, v) { data[k] = v; dirty = true; },
  flush,
  reset(keep = ['settings']) { const kept = {}; for (const k of keep) if (data[k] !== undefined) kept[k] = data[k]; data = { ...blank(), ...kept }; flush(); game?.events?.emit('save:reset', {}); },
  exists() { return !!(data && (data.progress || data.missions)); },
  get data() { return data; },
  version: VERSION,
};

export default {
  name: 'save',
  init(g) {
    game = g; load(); g.save = api;
    for (const ev of ['base:liberated', 'settlement:liberated', 'region:liberated', 'mission:complete', 'mod:unlocked', 'campaign:complete']) g.events.on(ev, () => { dirty = true; setTimeout(flush, 50); });
    addEventListener('beforeunload', () => { if (game.state !== 'title') flush(); });
    addEventListener('visibilitychange', () => { if (document.hidden && dirty) flush(); });
  },
  update(dt, g) {
    if (g.state === 'play') data.playTime = (data.playTime || 0) + dt;
    timer += dt;
    if (timer > 20) { timer = 0; if (g.state === 'play' && g.player?.pos) { const p = g.player.pos; data.lastPos = { x: p.x, z: p.z }; dirty = true; } if (dirty && g.state !== 'title') flush(); }
  },
};
