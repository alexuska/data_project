// Главный экран: логотип, пилот, пункты меню, выбранный борт.
import { esc, icon, fmtInt, fmtMoney, fmtHours, scale, CLS_NAMES } from './menu-kit.js';
import { getSpec, CATALOG } from '../aircraft/catalog.js';

export function mainScreen(ctx) {
  const { G } = ctx;
  return {
    render(el) {
      const career = G.career, p = G.profile;
      const r = career.rank();
      const spec = getSpec(p.selectedPlane);
      const sum = career.missionSummary();
      const next = career.nextMission();
      const daily = career.dailyMission();
      const dailyDef = daily && !daily.done ? G.missions.byId?.[daily.id] : null;
      const ach = career.achievementCount();
      const item = (to, name, note, cls = '') => `<button type="button" class="menu-nav-item ${cls}" data-act="go" data-to="${to}">
          <span class="menu-nav-name">${name}</span><span class="menu-nav-dots" aria-hidden="true"></span><span class="menu-nav-note">${note}</span></button>`;
      const careerNote = next ? `далее: ${esc(next.title)}` : sum.total ? `все задания пройдены · ${sum.stars}/${sum.maxStars}` : '';
      el.innerHTML = `<div class="menu-main">
        <header class="menu-main-logo">
          <div class="menu-main-over">Лётная карьера <i></i> Архипелаг Семи Ветров</div>
          <h1 class="menu-main-title">Пятый океан</h1>
        </header>
        <nav class="menu-main-nav">
          ${item('career', 'Карьера', careerNote, 'is-primary')}
          ${item('free', 'Свободный полёт', `${(G.world.airports || []).length} аэродромов`)}
          ${item('hangar', 'Ангар', `${p.owned.length} из ${CATALOG.length} бортов`)}
          ${item('logbook', 'Лётная книжка', `налёт ${fmtHours(p.stats.flightTime)} · значков ${ach.got}/${ach.total}`)}
          ${item('settings', 'Настройки', '')}
        </nav>
        <aside class="menu-main-side">
          <button type="button" class="menu-pilot" data-act="go" data-to="logbook">
            <span class="menu-label">${p.callsign ? `«${esc(p.callsign)}» · ${esc((p.pilotName || '').split(' ')[0])}` : esc(p.pilotName || 'Пилот')}</span>
            <span class="menu-pilot-rank">${esc(r.name)}</span>
            ${scale(r.progress, 0, 'menu-scale--ticks')}
            <span class="menu-pilot-xp">${r.nextXp != null ? `<b>${fmtInt(r.xp)}</b> / ${fmtInt(r.nextXp)} опыта <i>до звания «${esc(r.nextName)}»</i>` : `<b>${fmtInt(r.xp)}</b> опыта · высшее звание`}</span>
            <span class="menu-pilot-money" data-wallet="money">${fmtMoney(p.money)}</span>
          </button>
          ${dailyDef ? `<button type="button" class="menu-daily" data-act="go" data-to="brief" data-id="${esc(dailyDef.id)}">
            <span class="menu-label">Задание дня · оплата ×2</span><span class="menu-daily-title">${esc(dailyDef.title)}</span></button>` : ''}
          <button type="button" class="menu-plate menu-main-plane" data-act="go" data-to="hangar">
            <span class="menu-label">Выбранный борт</span>
            <span class="menu-main-plane-name">${esc(spec.name)}</span>
            <span class="menu-main-plane-sub">${esc(spec.role === 'military' ? 'военный' : 'гражданский')} · ${esc(CLS_NAMES[spec.cls] || '')} · ${spec.year}</span>
          </button>
        </aside>
        ${ctx.fullscreen.available() ? `<button type="button" class="menu-icon-btn menu-main-fs" data-act="fullscreen" aria-label="На весь экран">${icon('fullscreen', 22)}</button>` : ''}
      </div>`;
    },
    actions: {
      fullscreen: () => ctx.fullscreen.toggle(),
    },
  };
}
