// МЕНЮ (заглушка v0 — заменяется агентом «Меню и карьера»). Контракт — в ARCHITECTURE.md.
import { CATALOG } from '../aircraft/catalog.js';

export function createMenu(G) {
  const root = document.createElement('div');
  root.className = 'menu';
  G.ui.appendChild(root);
  function render(html) { root.innerHTML = `<div class="menu-v0">${html}</div>`; }
  const menu = {
    root,
    show(screen = 'main') {
      root.hidden = false;
      if (screen === 'main') {
        render(`<h1>Пятый океан</h1>
          <div class="menu-v0-list">${CATALOG.map((s) => `<button type="button" data-plane="${s.id}">${s.name}</button>`).join('')}</div>
          <div class="menu-v0-list">${G.missions.list.map((m) => `<button type="button" data-mission="${m.id}">${m.title}</button>`).join('')}</div>`);
      } else if (screen === 'pause') {
        render(`<h1>Пауза</h1><div class="menu-v0-list"><button type="button" data-act="resume">Продолжить</button><button type="button" data-act="quit">Завершить полёт</button></div>`);
      }
    },
    hide() { root.hidden = true; },
    showDebrief(result) {
      root.hidden = false;
      render(`<h1>${result.title || 'Полёт завершён'}</h1><p>${result.text || ''}</p><div class="menu-v0-list"><button type="button" data-act="menu">В меню</button></div>`);
    },
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    G.audio.unlock();
    if (b.dataset.plane) G.startFlight({ planeId: b.dataset.plane, airportId: 'yasny' });
    else if (b.dataset.mission) G.startFlight({ missionId: b.dataset.mission });
    else if (b.dataset.act === 'resume') G.setPaused(false);
    else if (b.dataset.act === 'quit') G.endFlight({ reason: 'quit' });
    else if (b.dataset.act === 'menu') G.toMenu();
  });
  G.bus.on('flight:start', () => menu.hide());
  G.bus.on('flight:end', ({ result }) => menu.showDebrief(result));
  G.bus.on('pause', ({ paused }) => (paused ? menu.show('pause') : menu.hide()));
  G.bus.on('menu:show', () => menu.show('main'));
  return menu;
}
