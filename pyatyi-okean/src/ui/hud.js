// HUD (заглушка v0 — заменяется агентом «Управление»). Контракт — в ARCHITECTURE.md.
import { KMH } from '../core/util.js';

export function createHud(G) {
  const root = document.createElement('div');
  root.className = 'hud';
  root.hidden = true;
  root.innerHTML = `<div class="hud-v0-data"></div><div class="hud-v0-obj"></div><div class="hud-v0-toast"></div>
    <button class="hud-v0-pause" type="button">II</button>`;
  G.ui.appendChild(root);
  const data = root.querySelector('.hud-v0-data');
  const obj = root.querySelector('.hud-v0-obj');
  const toastEl = root.querySelector('.hud-v0-toast');
  root.querySelector('.hud-v0-pause').addEventListener('click', () => G.bus.emit('input:pause'));
  let toastT = 0;
  const hud = {
    root,
    markers: [],
    show() { root.hidden = false; },
    hide() { root.hidden = true; },
    setObjective(text) { obj.textContent = text || ''; },
    setMarkers(list) { hud.markers = list || []; },
    toast(text, kind = 'info') { toastEl.textContent = text; toastT = 3.5; },
    radio(from, text) { hud.toast(`${from}: ${text}`); },
    update(dt) {
      const ac = G.player;
      if (!ac || root.hidden) return;
      data.textContent = `${Math.round(ac.ias * KMH)} км/ч · ${Math.round(ac.alt)} м · курс ${String(Math.round((ac.heading * 180) / Math.PI) % 360).padStart(3, '0')}° · газ ${Math.round(ac.throttle * 100)}% · Vy ${ac.vs.toFixed(1)} · ${ac.gearPos > 0.5 ? 'шасси' : ''} ${ac.flaps > 0 ? 'закр ' + ac.flaps : ''} ${ac.stalled ? 'СВАЛИВАНИЕ' : ''}`;
      if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.textContent = ''; }
    },
  };
  G.bus.on('ui:toast', (p) => hud.toast(p.text, p.kind));
  G.bus.on('radio', (p) => hud.radio(p.from, p.text));
  G.bus.on('flight:start', () => { hud.setObjective(''); hud.setMarkers([]); hud.show(); });
  G.bus.on('flight:end', () => hud.hide());
  return hud;
}
