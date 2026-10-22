// STORMBREAK HUD: title, play HUD, minimap, world map, pause/settings/controls, subtitles, banners. DOM+CSS in #hud.
let game, root, el = {}, menu = null, mapOpen = false, prompt = null, promptSet = false, lastT = performance.now();
const S = { sens: 1, music: 0.55, sfx: 1, master: 0.9, quality: 'high', invertY: false };
const CSS = `
#hud{font-family:'Avenir Next Condensed','Avenir Next','Helvetica Neue',Arial,sans-serif;color:#f3efe6;--a:#e8452c;--t:#3fd0c9;--g:#ffd34d}
#hud .pa{pointer-events:auto}#hud .lay{position:absolute;inset:0}
.sb-title{background:radial-gradient(ellipse 46% 26% at 50% 44%,rgba(8,12,18,.34) 0%,rgba(8,12,18,.14) 55%,transparent 100%),linear-gradient(180deg,transparent 72%,rgba(6,9,14,.32) 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;transition:opacity .8s}
.sb-logo{font-weight:900;font-size:min(13vw,150px);letter-spacing:.06em;font-style:italic;line-height:.9;background:linear-gradient(180deg,#fff 0%,#f3efe6 45%,#c9c1b0 55%,#8f877a 100%);-webkit-background-clip:text;color:transparent;filter:drop-shadow(0 4px 18px rgba(0,0,0,.55));position:relative}
.sb-logo:after{content:'';position:absolute;left:47%;top:-8%;width:9%;height:116%;background:var(--a);clip-path:polygon(60% 0,100% 0,45% 48%,80% 48%,10% 100%,35% 55%,0 55%);filter:drop-shadow(0 0 18px var(--a))}
.sb-sub{letter-spacing:.8em;font-size:13px;margin-top:14px;opacity:.9;text-shadow:0 1px 6px rgba(0,0,0,.8)}.sb-press{margin-top:9vh;letter-spacing:.5em;font-size:14px;animation:sbp 1.6s infinite;text-shadow:0 1px 6px rgba(0,0,0,.85)}
@keyframes sbp{50%{opacity:.25}}
.sb-menu{margin-top:6vh;display:flex;flex-direction:column;gap:8px;min-width:320px}
.sb-btn{background:rgba(10,14,20,.7);border:0;border-left:4px solid transparent;color:#f3efe6;font:700 17px/1 'Avenir Next Condensed',sans-serif;letter-spacing:.3em;text-transform:uppercase;padding:14px 22px;text-align:left;clip-path:polygon(0 0,100% 0,96% 100%,0 100%);cursor:pointer;transition:all .12s}
.sb-btn.sel,.sb-btn:hover{background:var(--a);border-left-color:#fff;padding-left:30px}
.sb-panel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:linear-gradient(160deg,rgba(14,19,27,.96),rgba(8,10,14,.96));border-top:4px solid var(--a);padding:28px 34px;min-width:440px;max-height:80vh;overflow:auto;box-shadow:0 30px 80px rgba(0,0,0,.6)}
.sb-panel h2{margin:0 0 18px;font:900 italic 30px/1 'Avenir Next Condensed',sans-serif;letter-spacing:.12em}
.sb-row{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:8px 10px;font:600 14px 'Avenir Next Condensed',sans-serif;letter-spacing:.15em;text-transform:uppercase}.sb-row.sel{background:rgba(232,69,44,.25)}
.sb-row input[type=range]{width:180px;accent-color:var(--a)}.sb-ctl{display:grid;grid-template-columns:1fr auto auto;gap:6px 22px;font-size:13px;letter-spacing:.08em}
.sb-key{background:#f3efe6;color:#111;padding:2px 7px;border-radius:3px;font-weight:800;font-size:12px}
.sb-bars{position:absolute;left:28px;bottom:28px;width:300px}.sb-bar{height:9px;background:rgba(0,0,0,.5);margin-top:5px;clip-path:polygon(2% 0,100% 0,98% 100%,0 100%)}.sb-bar i{display:block;height:100%;background:linear-gradient(90deg,#c22,#f55);transition:width .2s}.sb-bar.ar i{background:linear-gradient(90deg,#3a8fd6,#8fd3ff)}
.sb-mini{position:absolute;left:28px;bottom:62px;width:210px;height:210px;border-radius:50%;overflow:hidden;border:3px solid rgba(243,239,230,.85);box-shadow:0 0 0 2px rgba(0,0,0,.5),0 10px 30px rgba(0,0,0,.5)}
.sb-wpn{position:absolute;right:28px;bottom:28px;text-align:right}.sb-ammo{font:900 italic 46px/1 'Avenir Next Condensed',sans-serif}.sb-ammo small{font-size:20px;opacity:.6}.sb-slots{display:flex;gap:6px;justify-content:flex-end;margin-top:6px}.sb-slots div{background:rgba(0,0,0,.45);padding:5px 10px;font:700 11px 'Avenir Next Condensed',sans-serif;letter-spacing:.15em}.sb-slots .on{background:var(--a)}
.sb-teth{display:flex;gap:4px;justify-content:flex-end;margin-top:8px}.sb-teth i{width:14px;height:5px;background:var(--t);transform:skewX(-20deg)}.sb-teth i.u{background:rgba(255,255,255,.2)}
.sb-heat{position:absolute;right:28px;top:24px;font-size:26px;letter-spacing:4px;color:rgba(255,255,255,.18)}.sb-heat b{color:var(--a);text-shadow:0 0 12px var(--a)}
.sb-chaos{position:absolute;right:28px;top:62px;text-align:right;font:800 13px 'Avenir Next Condensed',sans-serif;letter-spacing:.2em}.sb-chaos .v{font:900 italic 24px 'Avenir Next Condensed',sans-serif;color:var(--g)}
.sb-pops{position:absolute;right:28px;top:120px;display:flex;flex-direction:column;align-items:flex-end;gap:4px}.sb-pop{font:900 italic 18px 'Avenir Next Condensed',sans-serif;color:var(--g);text-shadow:0 2px 6px #000;animation:sbpop 2.2s forwards}.sb-pop span{font:700 11px 'Avenir Next Condensed',sans-serif;color:#fff;letter-spacing:.2em;margin-left:8px}
@keyframes sbpop{0%{transform:translateX(40px);opacity:0}10%{transform:none;opacity:1}75%{opacity:1}100%{opacity:0;transform:translateY(-14px)}}
.sb-obj{position:absolute;left:28px;top:70px;max-width:360px;border-left:4px solid var(--g);padding:6px 12px;background:linear-gradient(90deg,rgba(0,0,0,.5),transparent)}.sb-obj .t{font:800 11px 'Avenir Next Condensed',sans-serif;letter-spacing:.3em;color:var(--g)}.sb-obj .o{font:700 16px 'Avenir Next Condensed',sans-serif;margin-top:3px}.sb-obj .p{font:600 12px 'Avenir Next Condensed',sans-serif;opacity:.7;margin-top:2px}
.sb-comp{position:absolute;left:50%;top:16px;width:520px;height:30px;transform:translateX(-50%);overflow:hidden;-webkit-mask:linear-gradient(90deg,transparent,#000 20%,#000 80%,transparent)}.sb-comp div{position:absolute;top:6px;font:800 13px 'Avenir Next Condensed',sans-serif;transform:translateX(-50%)}.sb-comp:after{content:'';position:absolute;left:50%;top:0;width:2px;height:8px;background:var(--a)}
.sb-wp{position:absolute;transform:translate(-50%,-100%);text-align:center;font:800 12px 'Avenir Next Condensed',sans-serif;color:var(--g);text-shadow:0 1px 3px #000}.sb-wp:before{content:'';display:block;margin:0 auto 3px;width:14px;height:14px;border:3px solid var(--g);transform:rotate(45deg)}
.sb-subt{position:absolute;left:50%;bottom:16vh;transform:translateX(-50%);display:flex;gap:12px;align-items:center;max-width:820px;transition:opacity .3s}.sb-por{width:52px;height:52px;flex:none;clip-path:polygon(15% 0,100% 0,85% 100%,0 100%)}.sb-subt .n{font:900 12px 'Avenir Next Condensed',sans-serif;letter-spacing:.25em}.sb-subt .x{font:600 19px/1.3 'Avenir Next Condensed',sans-serif;text-shadow:0 2px 6px #000;background:rgba(0,0,0,.35);padding:4px 10px}
.sb-banner{position:absolute;left:0;right:0;top:30vh;text-align:center;pointer-events:none}.sb-banner .b{display:inline-block;padding:14px 60px;background:linear-gradient(90deg,transparent,rgba(232,69,44,.92) 15%,rgba(232,69,44,.92) 85%,transparent);font:900 italic 48px/1 'Avenir Next Condensed',sans-serif;letter-spacing:.12em;animation:sbban 4.5s forwards}.sb-banner .s{font:700 14px 'Avenir Next Condensed',sans-serif;letter-spacing:.5em;margin-top:10px;animation:sbban 4.5s forwards}
@keyframes sbban{0%{transform:scaleX(0);opacity:0}8%{transform:scaleX(1.05);opacity:1}12%{transform:none}85%{opacity:1}100%{opacity:0}}
.sb-ch{position:absolute;left:50%;top:50%;width:22px;height:22px;transform:translate(-50%,-50%)}.sb-ch i{position:absolute;background:#fff;box-shadow:0 0 2px #000}.sb-ch .h{left:0;right:0;top:10px;height:2px;-webkit-mask:linear-gradient(90deg,#000 35%,transparent 35% 65%,#000 65%)}.sb-ch .v{top:0;bottom:0;left:10px;width:2px;-webkit-mask:linear-gradient(#000 35%,transparent 35% 65%,#000 65%)}
.sb-gr{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none;transition:opacity .12s}.sb-gr .r{position:absolute;left:-17px;top:-17px;width:34px;height:34px;border-radius:50%;box-sizing:border-box;border:1.5px solid rgba(255,255,255,.85);box-shadow:0 0 3px rgba(0,0,0,.55),inset 0 0 3px rgba(0,0,0,.4);-webkit-mask:conic-gradient(#000 0 40deg,transparent 40deg 50deg,#000 50deg 130deg,transparent 130deg 140deg,#000 140deg 220deg,transparent 220deg 230deg,#000 230deg 310deg,transparent 310deg 320deg,#000 320deg);transition:transform .12s,border-color .12s,opacity .12s}
.sb-gr.in .r{border-color:var(--t);border-width:2px;transform:scale(.86)}.sb-gr.out .r{border-style:dashed;border-color:rgba(255,128,96,.8);transform:scale(1.12)}.sb-gr .d{position:absolute;left:-60px;top:34px;width:120px;white-space:nowrap;text-align:center;font:600 10px/1 system-ui,sans-serif;letter-spacing:.06em;color:rgba(255,140,110,.95);text-shadow:0 0 3px #000,0 1px 2px #000;display:none}.sb-gr.out .d{display:block}.sb-gr.none .r{opacity:.25}
.sb-gr .k{position:absolute;width:9px;height:9px;margin:-5.5px;border:2px solid var(--t);transform:rotate(45deg);box-shadow:0 0 4px rgba(0,0,0,.6);display:none}.sb-gr .k.v{border-color:#ff9a2e}
.sb-hit{position:absolute;left:50%;top:50%;width:34px;height:34px;transform:translate(-50%,-50%) rotate(45deg);opacity:0;background:linear-gradient(#fff,#fff) center/2px 10px no-repeat,linear-gradient(#fff,#fff) center/10px 2px no-repeat;-webkit-mask:radial-gradient(circle,transparent 7px,#000 8px)}
.sb-dmg{position:absolute;left:50%;top:50%;width:300px;height:300px;margin:-150px;border-radius:50%;border-top:6px solid rgba(255,40,30,.85);opacity:0;transition:opacity .7s}
.sb-prompt{position:absolute;left:50%;top:62%;transform:translateX(-50%);font:700 16px 'Avenir Next Condensed',sans-serif;letter-spacing:.15em;text-transform:uppercase;text-shadow:0 2px 4px #000}
.sb-toast{position:absolute;left:50%;top:110px;transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;align-items:center}.sb-toast div{background:rgba(10,14,20,.85);border-left:4px solid var(--t);padding:8px 16px;font:700 13px 'Avenir Next Condensed',sans-serif;letter-spacing:.15em;animation:sbpop 4s forwards}
.sb-lb:before,.sb-lb:after{content:'';position:absolute;left:0;right:0;height:11vh;background:#000;transition:transform .6s}.sb-lb:before{top:0;transform:translateY(-100%)}.sb-lb:after{bottom:0;transform:translateY(100%)}.sb-lb.on:before,.sb-lb.on:after{transform:none}
.sb-map{background:#0a0f14;display:none}.sb-map canvas{position:absolute;inset:0;width:100%;height:100%;cursor:grab}.sb-maphd{position:absolute;left:30px;top:24px;font:900 italic 34px 'Avenir Next Condensed',sans-serif;letter-spacing:.1em}.sb-maphd small{display:block;font:700 12px 'Avenir Next Condensed',sans-serif;letter-spacing:.3em;opacity:.7;font-style:normal}.sb-maptip{position:absolute;right:30px;bottom:24px;font:600 12px 'Avenir Next Condensed',sans-serif;letter-spacing:.15em;opacity:.8;text-align:right}
.sb-pause{background:rgba(5,8,12,.55);backdrop-filter:blur(6px);display:none}
.sb-obj{min-width:250px;max-width:380px;border-left:0;padding:9px 16px 10px 18px;background:linear-gradient(100deg,rgba(8,11,16,.78) 0%,rgba(8,11,16,.55) 70%,transparent 100%);clip-path:polygon(0 0,100% 0,94% 100%,0 100%);box-shadow:inset 4px 0 0 var(--g)}
.sb-obj .t{display:flex;align-items:center;gap:8px}.sb-obj .t:before{content:'';width:7px;height:7px;background:var(--g);transform:rotate(45deg);box-shadow:0 0 8px var(--g)}
.sb-obj .t em{font-style:normal;margin-left:auto;padding-left:14px;color:rgba(243,239,230,.55);letter-spacing:.2em}
.sb-obj .o{font:700 17px/1.25 'Avenir Next Condensed',sans-serif;text-shadow:0 1px 4px rgba(0,0,0,.7)}.sb-obj .p{color:var(--g);opacity:.85;letter-spacing:.12em;text-transform:uppercase;font-size:11px;margin-top:4px}
.sb-obj .bar{height:3px;margin-top:6px;background:rgba(255,255,255,.12)}.sb-obj .bar i{display:block;height:100%;background:var(--g);box-shadow:0 0 6px var(--g);transition:width .4s}
.sb-obj.new{animation:sbobj .9s ease-out}.sb-obj.new .o{animation:sbobjt .9s ease-out}
@keyframes sbobj{0%{transform:translateX(-30px);opacity:0}25%{transform:none;opacity:1}40%{box-shadow:inset 4px 0 0 var(--g),0 0 26px rgba(255,211,77,.45)}100%{box-shadow:inset 4px 0 0 var(--g)}}
@keyframes sbobjt{0%,20%{color:var(--g)}100%{color:#f3efe6}}
.sb-pops{gap:5px;top:142px}.sb-pop{display:flex;align-items:baseline;gap:8px;padding:3px 12px 3px 14px;background:linear-gradient(270deg,rgba(8,11,16,.7),rgba(8,11,16,.25) 80%,transparent);border-right:3px solid var(--g);clip-path:polygon(6% 0,100% 0,100% 100%,0 100%)}
.sb-pop span{margin-left:0}.sb-pop b{font:900 italic 15px 'Avenir Next Condensed',sans-serif;color:#fff;opacity:.9}.sb-pop.big{font-size:24px;border-right-color:var(--a)}.sb-pop.bump{animation:sbpop 2.2s forwards,sbbump .25s}
@keyframes sbbump{0%{transform:scale(1.25)}100%{transform:none}}
.sb-kills{position:absolute;right:28px;top:350px;display:flex;flex-direction:column;align-items:flex-end;gap:3px}
.sb-kill{font:700 12px 'Avenir Next Condensed',sans-serif;letter-spacing:.22em;padding:3px 10px;background:rgba(8,11,16,.6);border-right:3px solid var(--a);animation:sbkill 3.2s forwards}.sb-kill i{font-style:normal;color:var(--a);margin-right:6px}.sb-kill.hs{border-right-color:var(--g)}.sb-kill.hs i{color:var(--g)}
@keyframes sbkill{0%{transform:translateX(30px);opacity:0}8%{transform:none;opacity:1}80%{opacity:1}100%{opacity:0}}
.sb-banner .b.lib{position:relative;overflow:hidden;font-size:62px;padding:16px 90px;background:linear-gradient(90deg,transparent,rgba(24,150,145,.94) 14%,rgba(63,208,201,.94) 50%,rgba(24,150,145,.94) 86%,transparent);text-shadow:0 3px 14px rgba(0,0,0,.45);animation:sbban 4.8s forwards,sblibs .55s cubic-bezier(.2,1.6,.4,1)}
.sb-banner .b.lib:after{content:'';position:absolute;top:0;bottom:0;width:30%;left:-40%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);animation:sbshine 1.3s .35s ease-out}
.sb-banner .s.lib{color:#bff6f2;letter-spacing:.6em}.sb-banner .ln{width:0;height:2px;margin:10px auto 0;background:#bff6f2;animation:sbln 4.8s forwards}
@keyframes sblibs{0%{transform:scale(2.2);opacity:0;filter:blur(6px)}60%{transform:scale(.96);opacity:1;filter:none}100%{transform:none}}
@keyframes sbshine{0%{left:-40%}100%{left:120%}}@keyframes sbln{0%{width:0}15%{width:420px}85%{width:420px;opacity:1}100%{width:420px;opacity:0}}
.sb-banner .b.fail{background:linear-gradient(90deg,transparent,rgba(60,14,12,.92) 15%,rgba(110,22,18,.92) 85%,transparent)}
.sb-banner .b.ok{background:linear-gradient(90deg,transparent,rgba(196,150,30,.92) 15%,rgba(230,180,50,.92) 85%,transparent);color:#15110a}`;
const h = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; (parent || root).appendChild(e); return e; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const snd = n => game.audio?.play?.(n);
// gamepad column: Xbox / PlayStation names for the same W3C standard-mapping button (main.js PAD)
const CONTROLS = [['Move', 'W A S D', 'Left stick'], ['Look', 'Mouse', 'Right stick'], ['Jump / Parachute (in air)', 'Space', 'A / Cross'],
  ['Wingsuit (in air, also off the reel)', 'Shift', 'Y / Triangle (or X / Square) in air'], ['Sprint', 'Shift', 'L3'],
  ['Crouch / Let go / Cut line', 'C', 'B / Circle'], ['Interact / Hijack', 'F', 'Y / Triangle'], ['Grapple (hold while reeling = slingshot)', 'E', 'LB / L1'],
  ['Tether two objects', 'Q', 'RB / R1'], ['Reel tethers (hold = cut all)', 'R', 'R3'], ['Aim', 'RMB', 'LT / L2'], ['Fire', 'LMB', 'RT / R2'],
  ['Sticky charge: throw / detonate', 'G tap / hold G or V', 'D-pad down'], ['Reload', 'T', 'X / Square (on foot)'], ['Weapons', '1 2 3', 'D-pad up / right / left'],
  ['Supply drop: jeep', 'B', '—'], ['Supply drop: heli / gunship', 'Shift+B', '—'], ['Supply drop: tank', 'Alt+B', '—'],
  ['World map', 'M', 'View / Share'], ['Pause', 'Esc / P', 'Menu / Options']];

// drop rows reflect gear mods: Shift+B becomes the gunship with Air Drop, Alt+B the tank with Heavy Drop (progress.js)
function controlRows() {
  const mods = game.progress?.mods, has = id => !!mods?.has?.(id);
  return CONTROLS.map(r => r[0] === 'Supply drop: heli / gunship' ? [has('drop_heli') ? 'Supply drop: gunship (Air Drop)' : 'Supply drop: heli · gunship with Air Drop', r[1], r[2]]
    : r[0] === 'Supply drop: tank' ? [has('drop_tank') ? 'Supply drop: tank (Heavy Drop)' : 'Supply drop: tank — unlock Heavy Drop', r[1], r[2]] : r);
}
// ---------- menus (keyboard/gamepad navigable lists) ----------
function openMenu(panel, items, onBack) { menu = { panel, items, sel: 0, onBack }; panel.style.display = ''; mark(); }
function mark() { if (!menu) return; menu.items.forEach((it, i) => it.el.classList.toggle('sel', i === menu.sel)); }
function menuNav(dy, dx, ok, back) {
  if (!menu) return;
  if (dy) { menu.sel = (menu.sel + dy + menu.items.length) % menu.items.length; mark(); snd('ui_hover'); }
  const it = menu.items[menu.sel];
  if (dx && it.adj) { it.adj(dx); snd('ui_click'); }
  if (ok && it.act) { snd('ui_confirm'); it.act(); }
  if (back && menu.onBack) { snd('ui_back'); menu.onBack(); }
}
function btn(parent, label, act) { const b = h('button', 'sb-btn pa', label, parent); const it = { el: b, act }; b.onclick = () => { snd('ui_confirm'); act(); }; b.onmouseenter = () => { if (menu) { menu.sel = menu.items.indexOf(it); mark(); } }; return it; }

function buildTitle() {
  const t = el.title = h('div', 'lay sb-title pa');
  h('div', 'sb-logo', 'STORMBREAK', t); h('div', 'sb-sub', 'THE ARCHIPELAGO OF CORVANA', t);
  const press = h('div', 'sb-press', 'PRESS ANY KEY', t);
  const m = h('div', 'sb-menu', null, t); m.style.display = 'none';
  const go = () => {
    if (!press.isConnected || press.style.display === 'none') return; press.style.display = 'none'; m.style.display = ''; game._audioUnlock?.(); snd('ui_confirm');
    const items = [];
    if (game.save?.exists?.()) items.push(btn(m, 'Continue', () => startGame(false)));
    items.push(btn(m, 'New Game', () => startGame(true)), btn(m, 'Settings', () => openSettings(() => openMenu(m, items))), btn(m, 'Controls', () => openControls(() => openMenu(m, items))));
    openMenu(m, items);
  };
  el.titleGo = go; t.addEventListener('pointerdown', go); addEventListener('keydown', e => { if (game.state === 'title' && !menu) go(); });
}
// requestPointerLock returns a promise in current Chrome; it rejects when not user-activated (tests, key menus)
function lockPointer() { try { const r = game.renderer.domElement.requestPointerLock?.(); r?.catch?.(() => {}); } catch (e) { /* not allowed now */ } }
function startGame(fresh) {
  if (fresh) game.save?.reset?.();
  const lp = !fresh && game.save?.get?.('lastPos');
  el.title.style.opacity = 0; setTimeout(() => el.title.style.display = 'none', 800);
  menu = null; game.state = 'play'; game.paused = false;
  if (lp) game.teleport?.(lp.x, lp.z); else if (fresh) { const s = game.world?.spawnPoint; if (s) game.teleport?.(s.x, s.z); }
  lockPointer();
  game.events.emit('game:started', { fresh });
}
function panel(title) { const p = h('div', 'sb-panel pa', `<h2>${title}</h2>`, el.over); return p; }
function openSettings(back) {
  el.over.innerHTML = ''; el.over.style.display = '';
  const p = panel('SETTINGS'), items = [];
  const row = (label, val, adj, ctrl) => { const r = h('div', 'sb-row pa', `<span>${label}</span>`, p); const v = ctrl ? ctrl(r) : h('span', '', val(), r); const it = { el: r, adj: d => { adj(d); if (!ctrl) v.textContent = val(); else ctrl.sync?.(); applySettings(); } }; items.push(it); r.onmouseenter = () => { menu.sel = items.indexOf(it); mark(); }; if (!ctrl) r.onclick = () => it.adj(1); return it; };
  const slider = (k, min, max) => r => { const i = h('input', 'pa', null, r); i.type = 'range'; i.min = min; i.max = max; i.step = (max - min) / 20; i.value = S[k]; i.oninput = () => { S[k] = +i.value; applySettings(); }; return i; };
  const sl = (label, k, min, max) => { const it = row(label, null, d => { S[k] = clamp(S[k] + d * (max - min) / 20, min, max); it.inp.value = S[k]; }, slider(k, min, max)); it.inp = it.el.querySelector('input'); };
  sl('Look sensitivity', 'sens', 0.2, 3); sl('Master volume', 'master', 0, 1); sl('Music volume', 'music', 0, 1); sl('Effects volume', 'sfx', 0, 1);
  row('Graphics quality', qLabel, d => cycleQuality(d));
  row('Invert Y', () => S.invertY ? 'ON' : 'OFF', () => S.invertY = !S.invertY);
  const b = btn(p, 'Back', () => { el.over.style.display = 'none'; back(); }); items.push(b);
  openMenu(p, items, b.act);
}
function openControls(back) {
  el.over.innerHTML = ''; el.over.style.display = '';
  const p = panel('CONTROLS');
  h('div', 'sb-ctl', '<b>ACTION</b><b>KEYBOARD</b><b>GAMEPAD</b>' + controlRows().map(([a, k, g]) => `<span>${a}</span><span class="sb-key">${k}</span><span class="sb-key">${g}</span>`).join(''), p);
  const b = btn(p, 'Back', () => { el.over.style.display = 'none'; back(); }); b.el.style.marginTop = '18px';
  openMenu(p, [b], b.act);
}
// Graphics preset: the choice lives in gfx (localStorage 'stormbreak.quality'); 'auto' = gfx picks on first load.
const QL = ['auto', 'low', 'medium', 'high'];
function syncQuality() {
  let v = null; try { v = localStorage.getItem('stormbreak.quality'); } catch (e) { /* */ }
  v = v === 'med' ? 'medium' : v;
  const forced = new URLSearchParams(location.search).get('quality');
  S.quality = QL.includes(v) ? v : 'auto';
  if (forced && game.gfx?.qualityLabel) S.quality = game.gfx.qualityLabel;
  S._q = S.quality;
}
function qLabel() { const cur = (game.gfx?.qualityLabel || 'high').toUpperCase(); return S.quality === 'auto' ? `AUTO (${cur})` : S.quality.toUpperCase(); }
function cycleQuality(d = 1) { const i = QL.indexOf(S.quality); S.quality = QL[((i < 0 ? 0 : i) + d + QL.length) % QL.length]; }
function applySettings() {
  const i = game.input; if (i) { i.sensitivity = 0.0022 * S.sens; i.padLook = 3.2 * S.sens; i.invertY = S.invertY; }
  game.audio?.setVolume?.('master', S.master); game.audio?.setVolume?.('music', S.music); game.audio?.setVolume?.('sfx', S.sfx);
  if (S._q !== S.quality) { S._q = S.quality; try { game.gfx?.setQuality?.(S.quality); } catch (e) { /* */ } }
  game.save?.set?.('settings', { ...S, _q: undefined, quality: undefined });
}
function openPause() {
  if (menu || mapOpen) return;
  game.paused = true; game.state = 'pause'; document.exitPointerLock?.();
  el.pause.style.display = ''; el.pause.innerHTML = '';
  const p = h('div', 'sb-panel pa', '<h2>PAUSED</h2>', el.pause);
  const pr = game.progress; if (pr) h('div', 'sb-row', `<span>${pr.rankName}</span><span>${(pr.chaos || 0).toLocaleString()} chaos · ${pr.liberatedSites?.size || 0} sites freed</span>`, p);
  const items = [btn(p, 'Resume', closePause), btn(p, 'World map', () => { closePause(); openMap(); }), btn(p, 'Settings', () => { el.pause.style.display = 'none'; openSettings(openPause2); }), btn(p, 'Controls', () => { el.pause.style.display = 'none'; openControls(openPause2); }),
    (() => { const it = btn(p, 'Graphics: ' + qLabel(), () => { cycleQuality(1); applySettings(); it.el.textContent = 'Graphics: ' + qLabel(); }); return it; })(),
    btn(p, 'Save game', () => { game.save?.flush?.(); toast('Game saved'); }), btn(p, 'Abandon mission', () => { game.missions?.abort?.(); closePause(); }), btn(p, 'Quit to title', () => { game.save?.flush?.(); location.reload(); })];
  openMenu(p, items, closePause);
}
function openPause2() { menu = null; openPause(); }
function closePause() { el.pause.style.display = 'none'; el.over.style.display = 'none'; menu = null; game.paused = false; game.state = 'play'; lockPointer(); }

// ---------- terrain bake (minimap + world map) ----------
let bake = null, bakeCtx, bakeRow = 0, B = 512, WS = 8000;
function startBake() { WS = game.world?.size || 8000; bake = document.createElement('canvas'); bake.width = bake.height = B; bakeCtx = bake.getContext('2d'); bakeCtx.fillStyle = '#1b3a52'; bakeCtx.fillRect(0, 0, B, B); bakeRow = 0; }
function bakeTick() {
  const w = game.world; if (!bake || bakeRow >= B || !w?.heightAt) return;
  const img = bakeCtx.createImageData(B, 16), sea = w.seaLevel ?? 0;
  for (let r = 0; r < 16 && bakeRow + r < B; r++) for (let c = 0; c < B; c++) {
    const x = (c / B - 0.5) * WS, z = ((bakeRow + r) / B - 0.5) * WS, y = w.heightAt(x, z), sh = clamp((y - w.heightAt(x + 12, z + 12)) * 0.04, -0.4, 0.4);
    let col = y < sea ? [26 + y * 0.05, 70 + y * 0.12, 105 + y * 0.1] : y < sea + 4 ? [214, 200, 160] : y < 140 ? [112 - y * 0.15, 128 - y * 0.05, 72] : y < 380 ? [120, 112, 96] : [235, 238, 242];
    if (y >= sea) col = col.map(v => v * (1 + sh));
    const i = (r * B + c) * 4; img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
  }
  bakeCtx.putImageData(img, 0, bakeRow); bakeRow += 16;
  if (bakeRow >= B) drawRoads();
}
function drawRoads() {
  const roads = game.world?.roads; if (!roads) return;
  const list = Array.isArray(roads) ? roads : roads.list || roads.segments || [];
  bakeCtx.strokeStyle = 'rgba(70,62,52,.9)'; bakeCtx.lineWidth = 1.4;
  for (const r of list) { const pts = r.points || r.path || r; if (!Array.isArray(pts)) continue; bakeCtx.beginPath(); pts.forEach((p, i) => { const x = p.x ?? p[0], z = p.z ?? p[1]; const u = (x / WS + 0.5) * B, v = (z / WS + 0.5) * B; i ? bakeCtx.lineTo(u, v) : bakeCtx.moveTo(u, v); }); bakeCtx.stroke(); }
}
const camYaw = () => { const d = new game.THREE.Vector3(); game.camera.getWorldDirection(d); return Math.atan2(d.x, -d.z); };
function siteColor(s) { return game.progress?.liberatedSites?.has(s.id) ? '#3fd0c9' : '#e8452c'; }
function drawMini() {
  const c = el.miniC, x = c.getContext('2d'), R = 105, pp = game.player?.pos || game.camera.position, yaw = camYaw();
  const spd = game.player?.vel ? Math.hypot(game.player.vel.x, game.player.vel.z) : 0, mpp = 2.2 + clamp(spd / 30, 0, 2); // metres per pixel
  x.save(); x.fillStyle = '#123'; x.fillRect(0, 0, 210, 210); x.translate(R, R); x.rotate(-yaw);
  if (bake) { const s = B / WS / (1 / mpp); x.drawImage(bake, (pp.x / WS + 0.5) * B - R * s * 1.5, (pp.z / WS + 0.5) * B - R * s * 1.5, R * 3 * s, R * 3 * s, -R * 1.5, -R * 1.5, R * 3, R * 3); }
  const dot = (wx, wz, col, r = 4, sq) => { const u = (wx - pp.x) / mpp, v = (wz - pp.z) / mpp; const d = Math.hypot(u, v); const k = d > R - 8 ? (R - 8) / d : 1; x.fillStyle = col; x.beginPath(); sq ? x.rect(u * k - r, v * k - r, r * 2, r * 2) : x.arc(u * k, v * k, r, 0, 7); x.fill(); x.strokeStyle = '#000'; x.lineWidth = 1; x.stroke(); };
  for (const s of game.progress?.sites || []) dot(s.pos.x, s.pos.z, siteColor(s), s.kind === 'base' ? 5 : 3.5, s.kind === 'base');
  for (const e of (game.enemies?.list || []).slice(0, 60)) { const p = e.pos || e.obj?.position; if (p && Math.hypot(p.x - pp.x, p.z - pp.z) < R * mpp) dot(p.x, p.z, '#ff3030', 2.2); }
  for (const ch of game.progress?.challenges || []) if (Math.hypot(ch.start.x - pp.x, ch.start.z - pp.z) < 700) dot(ch.start.x, ch.start.z, ch.type === 'wingsuit' ? '#66d9ff' : ch.type === 'race' ? '#b6ff5a' : '#ff6b2a', 4);
  const cv = game.missions?.convoy; if (cv) dot(cv.pos.x, cv.pos.z, '#ff9a1f', 5.5, true);
  const wp = game.missions?.objectiveWaypoint; if (wp) dot(wp.x, wp.z, '#ffd34d', 6);
  x.restore();
  x.fillStyle = '#fff'; x.beginPath(); x.moveTo(R, R - 9); x.lineTo(R + 6, R + 6); x.lineTo(R, R + 2); x.lineTo(R - 6, R + 6); x.fill();
  x.fillStyle = '#e8452c'; x.font = '900 13px sans-serif'; x.textAlign = 'center'; x.fillText('N', R + Math.sin(-yaw) * (R - 12), R - Math.cos(-yaw) * (R - 12) + 5);
}
// ---------- world map ----------
const mapV = { cx: 0, cz: 0, zoom: 1, drag: null, hover: null, wp: null };
function openMap() {
  if (menu) return; mapOpen = true; game.paused = true; game.state = 'map'; document.exitPointerLock?.(); el.map.style.display = 'block';
  const pp = game.player?.pos || game.camera.position; mapV.cx = pp.x; mapV.cz = pp.z; snd('ui_confirm');
}
function closeMap() { mapOpen = false; el.map.style.display = 'none'; game.paused = false; game.state = 'play'; lockPointer(); snd('ui_back'); }
function mapXf() { const c = el.mapC, s = Math.min(c.width, c.height) / WS * 1.1 * mapV.zoom; return { s, ox: c.width / 2 - mapV.cx * s, oz: c.height / 2 - mapV.cz * s }; }
function drawMap() {
  const c = el.mapC; if (c.width !== innerWidth * devicePixelRatio) { c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; }
  const x = c.getContext('2d'), { s, ox, oz } = mapXf(), dp = devicePixelRatio, P = (wx, wz) => [ox + wx * s, oz + wz * s];
  x.fillStyle = '#0d2233'; x.fillRect(0, 0, c.width, c.height);
  if (bake) { x.imageSmoothingEnabled = true; const [a, b] = P(-WS / 2, -WS / 2); x.drawImage(bake, a, b, WS * s, WS * s); }
  x.strokeStyle = 'rgba(255,255,255,.05)'; for (let g = -WS / 2; g <= WS / 2; g += 500) { const [a] = P(g, 0), [, b] = P(0, g); x.beginPath(); x.moveTo(a, 0); x.lineTo(a, c.height); x.moveTo(0, b); x.lineTo(c.width, b); x.stroke(); }
  x.textAlign = 'center';
  for (const r of game.progress?.regionStats?.() || []) { if (!r.center) continue; const [u, v] = P(r.center.x, r.center.z); x.font = `900 italic ${18 * dp}px sans-serif`; x.fillStyle = 'rgba(255,255,255,.85)'; x.fillText(r.name.toUpperCase(), u, v - 40 * dp); x.font = `700 ${12 * dp}px sans-serif`; x.fillStyle = r.liberated ? '#3fd0c9' : '#ffd34d'; x.fillText(`${Math.round(r.pct * 100)}% LIBERATED`, u, v - 24 * dp); }
  mapV.hover = null; const mx = mapV.mx * dp, my = mapV.my * dp;
  for (const st of game.progress?.sites || []) { const [u, v] = P(st.pos.x, st.pos.z), r = (st.kind === 'base' ? 7 : 5) * dp; x.fillStyle = siteColor(st); x.strokeStyle = '#000'; x.lineWidth = 2; x.beginPath(); st.kind === 'base' ? x.rect(u - r, v - r, r * 2, r * 2) : x.arc(u, v, r, 0, 7); x.fill(); x.stroke(); if (Math.hypot(mx - u, my - v) < r + 6 * dp) mapV.hover = st; }
  for (const ch of game.progress?.challenges || []) { const [u, v] = P(ch.start.x, ch.start.z); x.fillStyle = ch.type === 'wingsuit' ? '#66d9ff' : ch.type === 'race' ? '#b6ff5a' : '#ff6b2a'; x.beginPath(); x.moveTo(u, v - 7 * dp); x.lineTo(u + 6 * dp, v + 5 * dp); x.lineTo(u - 6 * dp, v + 5 * dp); x.fill(); }
  for (const m of (game.missions?.list || []).filter(m => m.available && !m.done && m.pos)) { const [u, v] = P(m.pos.x, m.pos.z); x.fillStyle = '#ffd34d'; x.font = `900 ${20 * dp}px sans-serif`; x.fillText('★', u, v + 7 * dp); x.font = `700 ${11 * dp}px sans-serif`; x.fillText(m.title.toUpperCase(), u, v + 22 * dp); }
  const cv = game.missions?.convoy; if (cv) { const [u, v] = P(cv.pos.x, cv.pos.z); x.fillStyle = '#ff9a1f'; x.strokeStyle = '#000'; x.lineWidth = 2; x.fillRect(u - 8 * dp, v - 5 * dp, 16 * dp, 10 * dp); x.strokeRect(u - 8 * dp, v - 5 * dp, 16 * dp, 10 * dp); x.font = `700 ${11 * dp}px sans-serif`; x.fillText(`CONVOY ${cv.alive}/${cv.total} → ${(cv.to || '').toUpperCase()}`, u, v + 20 * dp); }
  if (el.mapPct) { const pct = Math.round((game.progress?.islandPct || 0) * 100); if (el.mapPct._v !== pct) { el.mapPct._v = pct; el.mapPct.textContent = `WORLD MAP · ${pct}% OF CORVANA LIBERATED`; } }
  const wp = game.missions?.objectiveWaypoint || mapV.wp; if (wp) { const [u, v] = P(wp.x, wp.z); x.strokeStyle = '#ffd34d'; x.lineWidth = 3; x.beginPath(); x.arc(u, v, 12 * dp, 0, 7); x.stroke(); }
  const pp = game.player?.pos || game.camera.position, [pu, pv] = P(pp.x, pp.z), yaw = camYaw();
  x.save(); x.translate(pu, pv); x.rotate(yaw); x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.beginPath(); x.moveTo(0, -12 * dp); x.lineTo(8 * dp, 9 * dp); x.lineTo(0, 4 * dp); x.lineTo(-8 * dp, 9 * dp); x.closePath(); x.fill(); x.stroke(); x.restore();
  const hv = mapV.hover, lib = hv && game.progress?.liberatedSites?.has(hv.id);
  el.mapTip.innerHTML = (hv ? `<b>${hv.name.toUpperCase()}</b> — ${lib ? 'LIBERATED · CLICK TO FAST TRAVEL' : 'REGIME CONTROLLED'}<br>` : '') + 'DRAG PAN · WHEEL ZOOM · CLICK SET WAYPOINT · M CLOSE';
}
// fast travel to a liberated site (progress site id, e.g. 'base:capo-sereno-airfield'); false if not allowed
function fastTravel(id) {
  const hv = game.progress?.sites?.find(s => s.id === id);
  if (!hv || !game.progress?.liberatedSites?.has(hv.id)) return false;
  if (mapOpen) closeMap();
  game.teleport?.(hv.pos.x + 30, hv.pos.z + 30); toast(`Fast travel: ${hv.name}`); game.events.emit('fasttravel', { id: hv.id, pos: hv.pos });
  return true;
}
function mapClick() {
  const hv = mapV.hover;
  if (hv && fastTravel(hv.id)) return;
  const { s, ox, oz } = mapXf(), dp = devicePixelRatio; mapV.wp = { x: (mapV.mx * dp - ox) / s, z: (mapV.my * dp - oz) / s }; snd('ui_click');
}

// ---------- notifications ----------
function toast(text) { const d = h('div', '', text, el.toast); setTimeout(() => d.remove(), 4000); }
// banners queue instead of overwriting each other (a liberation and the mission complete it causes land in the same frame)
const banQ = [], banHist = []; let banOn = false, banCur = null;
function banner(big, small, kind = '') {
  const b = { big, small, kind };
  if (kind === 'lib') { // liberation is the payoff: it jumps the queue and pre-empts a lesser banner (rank-up fires first)
    banQ.unshift(b); if (banOn && banCur?.kind !== 'lib') { if (banCur) banQ.splice(1, 0, banCur); nextBanner(); } else if (!banOn) nextBanner(); return;
  }
  if (banQ.length > 3) banQ.shift();
  banQ.push(b); if (!banOn) nextBanner();
}
function nextBanner() {
  const b = banCur = banQ.shift(); if (!b) { banOn = false; el.banner.innerHTML = ''; return; }
  banOn = true; const k = b.kind;
  el.banner.innerHTML = `<div class="b ${k}">${b.big}</div>${k === 'lib' ? '<div class="ln"></div>' : ''}<div class="s ${k}">${b.small || ''}</div>`;
  const dur = k === 'lib' ? 4800 : 4600, hold = banQ.length && k !== 'lib' ? Math.min(dur, 2600) : dur; // shorten when more are waiting (never a liberation)
  banHist.push(b.big + (b.small ? ' · ' + b.small : '')); if (banHist.length > 8) banHist.shift();
  clearTimeout(banner._t); banner._t = setTimeout(nextBanner, hold);
}
// kill feed (right side, under the chaos pops)
function killFeed(d) {
  if (!el.kills) return; const e = d?.enemy, hs = !!d?.head, t = (d?.type || e?.type || 'soldier').toString().toUpperCase();
  const k = h('div', 'sb-kill' + (hs ? ' hs' : ''), `<i>${hs ? '◎' : '✕'}</i>${t}${hs ? ' · HEADSHOT' : ''}`, el.kills);
  setTimeout(() => k.remove(), 3300); while (el.kills.children.length > 5) el.kills.firstChild.remove();
}
const REASON = { kill: 'KILL', hijack: 'HIJACK', destroy: 'DESTRUCTION', destroyed: 'DESTRUCTION' };
function chaosPop(d) {
  if (!d?.amount) return; const now = performance.now(), why = REASON[d.reason] || (d.reason || 'CHAOS').toString().toUpperCase();
  const last = el.pops.lastElementChild;
  if (last && last._why === why && now - last._t < 1600) { // combo: same reason in quick succession stacks into one pop
    last._n++; last._amt += d.amount; last._t = now; clearTimeout(last._rm); last._rm = setTimeout(() => last.remove(), 2300);
    last.innerHTML = `+${Math.round(last._amt).toLocaleString()}<span>${why}</span><b>×${last._n}</b>`;
    last.classList.remove('bump'); void last.offsetWidth; last.classList.add('bump'); return;
  }
  const p = h('div', 'sb-pop' + (d.amount >= 1000 ? ' big' : ''), `+${Math.round(d.amount).toLocaleString()}<span>${why}</span>`, el.pops);
  p._why = why; p._t = now; p._n = 1; p._amt = d.amount; p._rm = setTimeout(() => p.remove(), 2300); while (el.pops.children.length > 6) el.pops.firstChild.remove();
}
let subT = 0;
function subtitle(d) {
  const nm = d.speaker || '', col = d.color || '#fff', ini = nm.split(' ').map(w => w[0]).slice(0, 2).join('');
  el.sub.innerHTML = `<div class="sb-por" style="background:linear-gradient(160deg,${col},#111)"><svg viewBox="0 0 52 52" width="52" height="52"><circle cx="26" cy="20" r="10" fill="rgba(0,0,0,.45)"/><path d="M6 52c2-14 10-18 20-18s18 4 20 18z" fill="rgba(0,0,0,.45)"/><text x="46" y="48" text-anchor="end" font-size="11" font-weight="900" fill="#fff">${ini}</text></svg></div><div><div class="n" style="color:${col}">${nm.toUpperCase()}${d.loudspeaker ? ' · LOUDSPEAKER' : d.radio ? ' · RADIO' : ''}</div><div class="x">${d.text}</div></div>`;
  el.sub.style.opacity = 1; subT = d.dur || 4;
}

function buildPlay() {
  const p = el.play = h('div', 'lay'); p.style.display = 'none';
  el.lb = h('div', 'lay sb-lb', null, p);
  el.comp = h('div', 'sb-comp', null, p); el.compMarks = [];
  for (let a = 0; a < 360; a += 15) { const d = h('div', '', a % 90 === 0 ? 'NESW'[a / 90] : a % 45 === 0 ? ['NE', 'SE', 'SW', 'NW'][(a - 45) / 90] : '·', el.comp); d.style.color = a % 90 ? '#ddd' : '#fff'; el.compMarks.push({ d, a }); }
  el.compWp = h('div', '', '◆', el.comp); el.compWp.style.color = '#ffd34d';
  el.obj = h('div', 'sb-obj', null, p);
  el.heat = h('div', 'sb-heat', null, p); el.chaos = h('div', 'sb-chaos', null, p); el.pops = h('div', 'sb-pops', null, p); el.kills = h('div', 'sb-kills', null, p);
  el.mini = h('div', 'sb-mini', null, p); el.miniC = h('canvas', '', null, el.mini); el.miniC.width = el.miniC.height = 210;
  el.bars = h('div', 'sb-bars', '<div class="sb-bar ar"><i></i></div><div class="sb-bar"><i></i></div>', p); [el.arm, el.hp] = el.bars.querySelectorAll('i');
  el.wpn = h('div', 'sb-wpn', '<div class="sb-ammo"></div><div class="sb-slots"></div><div class="sb-teth"></div>', p);
  el.wp = h('div', 'sb-wp', null, p);
  el.gr = h('div', 'sb-gr', '<div class="r"></div><div class="k"></div><div class="d"></div>', p); el.grK = el.gr.children[1]; el.grD = el.gr.children[2];
  el.ch = h('div', 'sb-ch', '<i class="h"></i><i class="v"></i>', p); el.hit = h('div', 'sb-hit', null, p);
  el.dmg = h('div', 'sb-dmg', null, p); el.prompt = h('div', 'sb-prompt', null, p);
  el.sub = h('div', 'sb-subt', null, root); el.sub.style.opacity = 0;
  el.banner = h('div', 'sb-banner', null, root); el.toast = h('div', 'sb-toast', null, root);
}
function buildMap() {
  el.map = h('div', 'lay sb-map pa'); el.mapC = h('canvas', '', null, el.map); { const hd = h('div', 'sb-maphd', 'CORVANA', el.map); el.mapPct = h('small', '', 'WORLD MAP', hd); } el.mapTip = h('div', 'sb-maptip', null, el.map);
  const c = el.mapC;
  c.onmousedown = e => mapV.drag = { x: e.clientX, y: e.clientY, cx: mapV.cx, cz: mapV.cz, moved: 0 };
  addEventListener('mousemove', e => { mapV.mx = e.clientX; mapV.my = e.clientY; const d = mapV.drag; if (d && mapOpen) { const { s } = mapXf(), dp = devicePixelRatio; mapV.cx = d.cx - (e.clientX - d.x) * dp / s; mapV.cz = d.cz - (e.clientY - d.y) * dp / s; d.moved += Math.abs(e.movementX) + Math.abs(e.movementY); } });
  addEventListener('mouseup', () => { if (mapV.drag && mapOpen && mapV.drag.moved < 5) mapClick(); mapV.drag = null; });
  c.onwheel = e => { mapV.zoom = clamp(mapV.zoom * (e.deltaY > 0 ? 0.88 : 1.14), 0.7, 8); };
}

// ---------- per-frame ----------
let pad = { prev: {} };
function padEdges() {
  const gp = game.input?.gamepad, out = { dy: 0, dx: 0, ok: false, back: false, start: false, map: false }; if (!gp) return out;
  const b = i => gp.buttons[i]?.pressed, tv = i => +gp.buttons[i]?.value || 0, cur = { u: b(12) || gp.axes[1] < -0.6, d: b(13) || gp.axes[1] > 0.6, l: b(14) || gp.axes[0] < -0.6, r: b(15) || gp.axes[0] > 0.6, a: b(0), b: b(1), s: b(9), m: b(8) };
  const e = k => cur[k] && !pad.prev[k]; out.dy = e('u') ? -1 : e('d') ? 1 : 0; out.dx = e('l') ? -1 : e('r') ? 1 : 0; out.ok = e('a'); out.back = e('b'); out.start = e('s'); out.map = e('m');
  if (mapOpen) { mapV.cx += gp.axes[0] * 40 / mapV.zoom; mapV.cz += gp.axes[1] * 40 / mapV.zoom; if (tv(6) > 0.5) mapV.zoom = clamp(mapV.zoom * 0.97, 0.7, 8); if (tv(7) > 0.5) mapV.zoom = clamp(mapV.zoom * 1.03, 0.7, 8); }
  pad.prev = cur; return out;
}
const keyQ = [];
function project(p) { const v = new game.THREE.Vector3(p.x, p.y ?? ((game.world?.heightAt?.(p.x, p.z) ?? 0) + 4), p.z).project(game.camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, behind: v.z > 1 }; }
// grapple reticle: ring solid teal when the hook will connect, dashed/dim when out of range; diamond on an assist-snapped point
function grReticle(cut) {
  const g = game, pl = g.player, pv = g.grapple?.preview, show = !cut && g.state === 'play' && pv && pl && pl.state !== 'vehicle' && pl.state !== 'dead';
  el.gr.style.display = show ? '' : 'none'; if (!show) return;
  const cls = 'sb-gr ' + (pv.inRange ? 'in' : pv.ok ? 'out' : 'none'); if (el.gr.className !== cls) el.gr.className = cls;
  const busy = g.grapple.state !== 'idle'; el.gr.style.opacity = busy ? 0.7 : 1;
  if (!pv.inRange && pv.ok) { const t = `${Math.round(pv.dist)} / ${Math.round(pv.range)} m`; if (el.grD.textContent !== t) el.grD.textContent = t; } // out of range: how far vs reach
  let kx = null, ky = 0;
  if (pv.inRange && pv.snap && pv.point) { const s = project(pv.point); const dx = s.x - innerWidth / 2, dy = s.y - innerHeight / 2; if (!s.behind && dx * dx + dy * dy > 64) { kx = dx; ky = dy; } }
  if (kx == null) el.grK.style.display = 'none';
  else { el.grK.style.display = 'block'; el.grK.style.left = kx + 'px'; el.grK.style.top = ky + 'px'; el.grK.classList.toggle('v', pv.kind === 'vehicle' || pv.kind === 'enemy'); }
}
function updatePlay(rdt) {
  const g = game, pl = g.player, pr = g.progress, mi = g.missions;
  el.lb.classList.toggle('on', g.state === 'cutscene');
  const cut = g.state === 'cutscene'; for (const k of ['comp', 'obj', 'mini', 'bars', 'wpn', 'heat', 'chaos', 'ch', 'pops', 'kills']) el[k].style.visibility = cut ? 'hidden' : '';
  if (pl) { const mh = pl.maxHealth || 100; el.hp.style.width = clamp((pl.health ?? mh) / mh * 100, 0, 100) + '%'; el.arm.style.width = clamp((pl.armor ?? 0) / (pl.maxArmor || 100) * 100, 0, 100) + '%'; }
  const cb = g.combat, wdef = cb?.weapon, am = cb?.ammo, curId = cb?.current;
  const stk = cb?.sticky ? ` · ◉${cb.sticky.count ?? ''}` : '';
  const ammoTxt = wdef && am ? `${cb.reloading ? '<small>RELOAD</small>' : am.mag}<small> / ${am.reserve ?? '∞'}${stk}</small>` : '';
  const slotTxt = (cb?.slots || []).map((ids, i) => { const own = ids.filter(id => cb.owned?.has?.(id)); const id = own.includes(curId) ? curId : own[0]; return id ? `<div class="${id === curId ? 'on' : ''}">${i + 1} ${(cb.weapons[id]?.name || id).toUpperCase()}</div>` : ''; }).join('');
  if (el.wpn._a !== ammoTxt + slotTxt) { el.wpn._a = ammoTxt + slotTxt; el.wpn.children[0].innerHTML = ammoTxt; el.wpn.children[1].innerHTML = slotTxt; }
  const gr = g.grapple; if (gr) { const max = gr.maxTethers ?? 3, used = gr.tethers?.length ?? gr.activeTethers ?? 0, key = max + ':' + used; if (el.wpn._t !== key) { el.wpn._t = key; el.wpn.children[2].innerHTML = Array.from({ length: max }, (_, i) => `<i class="${i < used ? 'u' : ''}"></i>`).join(''); } }
  const heat = clamp(Math.floor(g.enemies?.heat ?? 0), 0, 5); el.heat.innerHTML = '<b>' + '★'.repeat(heat) + '</b>' + '★'.repeat(5 - heat);
  el.chaos.innerHTML = pr ? `${pr.rankName.toUpperCase()}<div class="v">${pr.chaos.toLocaleString()}</div>CHAOS` : '';
  const yaw = camYaw() * 180 / Math.PI;
  for (const m of el.compMarks) { let d = ((m.a - yaw + 540) % 360) - 180; m.d.style.left = (260 + d * 2.6) + 'px'; m.d.style.display = Math.abs(d) > 100 ? 'none' : ''; }
  const wp = mi?.objectiveWaypoint, pp = pl?.pos || g.camera.position, ch = pr?.activeChallenge;
  if (wp) {
    const bd = Math.atan2(wp.x - pp.x, -(wp.z - pp.z)) * 180 / Math.PI; let d = ((bd - yaw + 540) % 360) - 180; el.compWp.style.left = (260 + clamp(d, -95, 95) * 2.6) + 'px'; el.compWp.style.display = '';
    const s = project(wp), dist = Math.hypot(wp.x - pp.x, wp.z - pp.z); let x = s.x, y = s.y;
    if (s.behind) { x = innerWidth - x; y = innerHeight - 40; } x = clamp(x, 40, innerWidth - 40); y = clamp(y, 60, innerHeight - 40);
    el.wp.style.display = cut ? 'none' : ''; el.wp.style.left = x + 'px'; el.wp.style.top = y + 'px'; el.wp.textContent = dist > 1000 ? (dist / 1000).toFixed(1) + ' KM' : Math.round(dist) + ' M';
  } else { el.wp.style.display = 'none'; el.compWp.style.display = 'none'; }
  const sp = mi?.active && mi.step, stepTxt = sp && sp.n > 1 ? `<em>${Math.min(sp.i + 1, sp.n)}/${sp.n}</em>` : '', fr = /^(\d+)\s*\/\s*(\d+)/.exec(mi?.objectiveProgress || '');
  const objHTML = mi?.active ? `<div class="t">${mi.title.toUpperCase()}${stepTxt}</div><div class="o">${mi.objectiveText}</div>${mi.objectiveProgress ? `<div class="p">${mi.objectiveProgress}</div>` : ''}${fr && +fr[2] > 0 ? `<div class="bar"><i style="width:${Math.min(100, fr[1] / fr[2] * 100)}%"></i></div>` : ''}` : ch ? `<div class="t">${ch.c.name.toUpperCase()}</div><div class="o">${ch.c.desc}</div><div class="p">${ch.status || ''}</div>` : (cv => cv ? `<div class="t">CONVOY AMBUSH</div><div class="o">Wreck the regime convoy before it reaches ${cv.to || 'its base'}</div><div class="p">${cv.total - cv.alive}/${cv.total} trucks · ${Math.round(Math.hypot(cv.pos.x - (game.player?.pos?.x || 0), cv.pos.z - (game.player?.pos?.z || 0)))} m</div>` : '')(game.missions?.convoy);
  if (el.obj._h !== objHTML) {
    el.obj._h = objHTML; el.obj.innerHTML = objHTML; el.obj.style.display = objHTML ? '' : 'none';
    const key = objHTML.replace(/<div class="p">.*$/s, ''); // re-animate only when the objective itself changes, not its live progress text
    if (objHTML && el.obj._k !== key) { el.obj._k = key; el.obj.classList.remove('new'); void el.obj.offsetWidth; el.obj.classList.add('new'); }
  }
  if (!promptSet && pl && pl.state !== 'vehicle' && g.vehicles?.nearest?.(pl.pos, 4)) prompt = { text: 'Hijack', key: 'F' };
  el.prompt.innerHTML = prompt && !cut ? `${prompt.key ? `<span class="sb-key">${prompt.key}</span> ` : ''}${prompt.text}` : '';
  prompt = null; promptSet = false;
  const combatCh = g.combat && g.combat.ownCrosshair !== false;
  el.ch.style.display = el.hit.style.display = combatCh ? 'none' : '';
  el.ch.style.opacity = pl?.state === 'vehicle' ? 0.3 : g.input?.down?.('aim') ? 1 : 0.75;
  grReticle(cut);
  if (subT > 0 && (subT -= rdt) <= 0) el.sub.style.opacity = 0;
  if ((el.miniT = (el.miniT || 0) + rdt) > 1 / 30) { el.miniT = 0; drawMini(); }
}

export default {
  name: 'hud',
  init(g) {
    // main.js and hud both call canvas.requestPointerLock(); in current Chrome it returns a promise that rejects when
    // the document can't lock (headless, no user activation). Swallow that rejection on this one element.
    { const cv = g.renderer?.domElement, orig = cv?.requestPointerLock; if (orig && !cv._sbLock) { cv._sbLock = 1; cv.requestPointerLock = function (...a) { try { const r = orig.apply(this, a); r?.catch?.(() => {}); return r; } catch (e) { return undefined; } }; } }
    game = g; root = document.getElementById('hud') || h('div', '', null, document.body); root.id = 'hud';
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    Object.assign(S, g.save?.get?.('settings') || {});
    syncQuality();
    // invert-Y applied after input polling so the camera sees it (input lives in main.js)
    if (g.input?.poll && !g.input._sbInv) { const orig = g.input.poll.bind(g.input); g.input.poll = dt => { orig(dt); if (g.input.invertY) g.input.look.y = -g.input.look.y; }; g.input._sbInv = 1; }
    buildPlay(); buildMap(); el.pause = h('div', 'lay sb-pause pa'); el.over = h('div', 'lay', null); el.over.style.display = 'none'; buildTitle();
    applySettings();
    g.hud = { prompt: (text, key) => { prompt = { text, key }; promptSet = true; }, banner, get banners() { return banHist.slice(); }, toast, subtitle, openMap, closeMap, fastTravel, get mapOpen() { return mapOpen; }, openPause, closePause, startGame, get menuOpen() { return !!menu || mapOpen; } };
    const E = g.events;
    E.on('chaos', d => { if (g.state !== 'title') chaosPop(d); });
    E.on('dialogue', subtitle); E.on('subtitle', subtitle);
    E.on('hitmarker', d => { el.hit.animate([{ opacity: 1, transform: 'translate(-50%,-50%) rotate(45deg) scale(1.3)' }, { opacity: 0, transform: 'translate(-50%,-50%) rotate(45deg) scale(1)' }], { duration: 260 }); if (d?.kill) el.hit.style.filter = 'hue-rotate(-40deg)'; });
    E.on('player:damaged', d => {
      const src = d?.src?.pos || d?.src?.position || d?.pos || d?.src; const pp = g.player?.pos;
      let ang = 0; if (src?.x != null && pp) ang = Math.atan2(src.x - pp.x, -(src.z - pp.z)) * 180 / Math.PI - camYaw() * 180 / Math.PI;
      el.dmg.style.transform = `rotate(${ang}deg)`; el.dmg.style.transition = 'none'; el.dmg.style.opacity = clamp((d?.amount || 10) / 25, 0.4, 1); requestAnimationFrame(() => { el.dmg.style.transition = 'opacity .9s'; el.dmg.style.opacity = 0; });
    });
    E.on('base:liberated', d => { const s = g.progress?.siteOf?.('base', d?.baseId); banner('BASE LIBERATED', s?.name?.toUpperCase(), 'lib'); });
    E.on('settlement:liberated', d => { const s = g.progress?.siteOf?.('settlement', d?.id); banner('SETTLEMENT LIBERATED', s?.name?.toUpperCase(), 'lib'); });
    E.on('region:liberated', d => banner('PROVINCE LIBERATED', (d?.name || '').toUpperCase(), 'lib'));
    E.on('mission:start', d => banner(d?.title?.toUpperCase() || 'MISSION', 'MISSION STARTED'));
    // finale: missions.js shows the CORVANA IS FREE end card a beat later, so the banner must not pre-empt it
    E.on('mission:complete', d => banner(d?.finale ? 'VASK HAS FALLEN' : 'MISSION COMPLETE', d?.title?.toUpperCase(), 'ok'));
    E.on('mission:fail', d => banner('MISSION FAILED', (d?.reason || '').toUpperCase(), 'fail'));
    E.on('enemy:killed', d => { if (g.state !== 'title' && (d?.by === 'player' || d?.by === g.player)) killFeed(d); });
    E.on('mod:unlocked', d => toast(`GEAR MOD UNLOCKED — ${d.name.toUpperCase()}: ${d.desc}`));
    E.on('rank:up', d => banner('RANK UP', d.name.toUpperCase()));
    E.on('challenge:end', d => banner(d.ok && d.medal ? ['', 'BRONZE', 'SILVER', 'GOLD'][d.medal] : 'CHALLENGE FAILED', d.name.toUpperCase()));
    E.on('toast', d => toast(d.text));
    E.on('ready', startBake); if (g.world) startBake();
    addEventListener('keydown', e => {
      if (game.state === 'title' && !menu) return;
      const k = e.code; if (menu || mapOpen) e.preventDefault?.();
      keyQ.push(k);
    });
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && g.state === 'play' && !menu && !mapOpen && g.ready) { pauseFromLock = performance.now(); } });
  },
  update(dt, g) {
    const now = performance.now(), rdt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    bakeTick();
    const pe = padEdges();
    let dy = pe.dy, dx = pe.dx, ok = pe.ok, back = pe.back, esc = false, mapK = pe.map;
    for (const k of keyQ.splice(0)) { if (k === 'ArrowUp' || k === 'KeyW') dy = -1; else if (k === 'ArrowDown' || k === 'KeyS') dy = 1; else if (k === 'ArrowLeft' || k === 'KeyA') dx = -1; else if (k === 'ArrowRight' || k === 'KeyD') dx = 1; else if (k === 'Enter' || k === 'Space') ok = true; else if (k === 'Escape' || k === 'Backspace' || k === 'KeyP') esc = true; else if (k === 'KeyM') mapK = true; }
    if (g.state === 'title') { el.play.style.display = 'none'; if (!menu && (pe.ok || pe.start)) el.titleGo(); if (menu) menuNav(dy, dx, ok, back || esc); return; }
    el.play.style.display = '';
    if (menu) { if (mapOpen) closeMap(); menuNav(dy, dx, ok, back || esc); }
    else if (mapOpen) { drawMap(); if (esc || mapK || back) closeMap(); else if (ok && mapV.hover) mapClick(); }
    else if (g.state === 'play' || g.state === 'cutscene') {
      if (esc || pe.start || (pauseFromLock && now - pauseFromLock < 400)) { pauseFromLock = 0; openPause(); }
      else if (mapK) openMap();
    }
    pauseFromLock = 0;
    updatePlay(rdt);
  },
};
let pauseFromLock = 0;
