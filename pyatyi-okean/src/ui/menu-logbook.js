// Лётная книжка: налёт, журнал полётов, достижения, открытые места.
import { esc, icon, fmtInt, fmtMoney, fmtHours, fmtClock, fmtDate, fmtNum, fmtSigned, scale, stars, mapHtml, shortAirport, KIND_NAMES } from './menu-kit.js';
import { getSpec, CATALOG } from '../aircraft/catalog.js';
import { LANDING_PAY } from '../systems/economy.js';

const TABS = [
  { v: 'summary', label: 'Налёт' },
  { v: 'journal', label: 'Журнал' },
  { v: 'awards', label: 'Достижения' },
  { v: 'places', label: 'Места' },
];
const RESULT_NAMES = { mission_complete: 'выполнено', mission_failed: 'не выполнено', crashed: 'авария', landed: 'посадка', quit: 'завершён' };

export function logbookScreen(ctx) {
  const { G } = ctx;
  let st = null;

  function summary() {
    const p = G.profile, s = p.stats, career = G.career;
    const ms = career.missionSummary();
    const fig = (label, value, sub = '') => `<div class="menu-fig"><span class="menu-label">${label}</span><b>${value}</b>${sub ? `<i>${sub}</i>` : ''}</div>`;
    const line = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
    const per = CATALOG.map((c) => ({ c, r: s.perPlane[c.id] })).filter((x) => x.r && x.r.flights > 0).sort((a, b) => b.r.time - a.r.time);
    const maxT = Math.max(1, ...per.map((x) => x.r.time));
    return `<div class="menu-book-head">
        <div><span class="menu-label">Лётная книжка</span><h3>${esc(p.pilotName || 'Пилот')}</h3></div>
        <span class="menu-stamp">${esc(career.rank().name)}</span>
      </div>
      <div class="menu-figs">
        ${fig('Общий налёт', fmtHours(s.flightTime))}
        ${fig('Полётов', fmtInt(s.flights))}
        ${fig('Посадок', fmtInt(s.landings), s.perfectLandings ? `отличных ${fmtInt(s.perfectLandings)}` : '')}
        ${fig('Пройдено', `${fmtInt(s.distance / 1000)} км`)}
      </div>
      <dl class="menu-book-lines">
        ${line('Заданий выполнено', `${ms.done} из ${ms.total}`)}
        ${line('Звёзд за задания', `${ms.stars} из ${ms.maxStars}`)}
        ${line('Перевезено пассажиров', fmtInt(s.passengers))}
        ${line('Перевезено груза', `${fmtNum(s.cargo / 1000, 1)} т`)}
        ${line('Сбито самолётов', fmtInt(s.kills))}
        ${line('Поражено наземных целей', fmtInt(s.groundKills))}
        ${line('Ночных посадок', fmtInt(s.nightLandings))}
        ${line('Наибольшая высота', `${fmtInt(s.maxAlt)} м`)}
        ${line('Наибольшая скорость', `${fmtInt(s.maxSpeed * 3.6)} км/ч`)}
        ${line('Аварий', fmtInt(s.crashes))}
        ${line('Заработано всего', fmtMoney(s.earned))}
      </dl>
      <h4 class="menu-book-sub">Налёт по типам</h4>
      ${per.length ? `<div class="menu-types">${per.map(({ c, r }) => `<div class="menu-type"><span>${esc(c.name)}</span>${scale(r.time / maxT)}<b>${fmtHours(r.time)}</b><i>${fmtInt(r.flights)} пол. · ${fmtInt(r.landings)} пос.</i></div>`).join('')}</div>`
    : '<p class="menu-empty">Записей пока нет — первый полёт всё изменит.</p>'}`;
  }

  function journal() {
    const log = G.profile.logbook || [];
    if (!log.length) return '<p class="menu-empty">Журнал пуст. Каждый полёт будет записан сюда: тип, задание, время и оценка посадки.</p>';
    return `<div class="menu-journal">
      <div class="menu-journal-row is-head"><span>Дата</span><span>Тип</span><span>Полёт</span><span>Время</span><span>Посадка</span><span>Итог</span></div>
      ${log.map((e) => `<div class="menu-journal-row ${e.result === 'crashed' ? 'is-bad' : ''}">
        <span>${fmtDate(e.t)}</span><span>${esc(getSpec(e.plane).name)}</span>
        <span class="menu-journal-what">${esc(e.title || 'Свободный полёт')}${e.stars ? stars(e.stars, 3, 11) : ''}<i>${RESULT_NAMES[e.result] || ''}${e.to ? ` · ${esc(shortAirport(G.world.airportById[e.to]))}` : ''}</i></span>
        <span>${fmtClock(e.time)}</span>
        <span>${e.landing ? LANDING_PAY[e.landing]?.label || '' : '—'}</span>
        <span class="${e.money < 0 ? 'menu-bad' : ''}">${e.money ? fmtSigned(e.money) : '—'}</span>
      </div>`).join('')}</div>`;
  }

  function awards() {
    const list = G.career.achievements();
    const cnt = G.career.achievementCount();
    const sel = list.find((a) => a.id === st.ach) || list.find((a) => !a.got && a.k > 0) || list[0];
    st.ach = sel.id;
    const C = 2 * Math.PI * 21;
    const badge = (a) => `<button type="button" class="menu-badge ${a.got ? 'is-got' : ''} ${a.id === sel.id ? 'is-on' : ''}" data-act="ach" data-v="${a.id}" data-sfx="ui_tick" aria-label="${esc(a.title)}">
        <svg class="menu-badge-ring" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21"/><circle class="is-arc" cx="24" cy="24" r="21" stroke-dasharray="${(C * a.k).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 24 24)"/></svg>
        ${icon(a.icon, 22)}<span>${esc(a.title)}</span></button>`;
    const prog = sel.got ? `получено ${fmtDate(sel.at)}` : sel.value ? `${fmtInt(sel.cur)} из ${fmtInt(sel.goal)}${sel.unit ? ` ${sel.unit}` : ''}` : 'ещё не получено';
    return `<div class="menu-awards">
      <div class="menu-award-info">
        <span class="menu-label">Получено ${cnt.got} из ${cnt.total}</span>
        <h3>${esc(sel.title)}</h3>
        <p>${esc(sel.desc)}</p>
        <div class="menu-award-meta">${scale(sel.k)}<span>${prog}</span><b>${sel.reward?.money ? `+${fmtMoney(sel.reward.money)}` : ''}${sel.reward?.xp ? ` · +${fmtInt(sel.reward.xp)} оп.` : ''}</b></div>
      </div>
      <div class="menu-badges">${list.map(badge).join('')}</div>
    </div>`;
  }

  function places() {
    const p = G.profile, world = G.world;
    const aps = world.airports || [], pois = world.pois || [];
    const va = aps.filter((a) => p.visited[a.id]).length, vp = pois.filter((x) => p.places[x.id]).length;
    return `<div class="menu-places">
      <div class="menu-places-map">${mapHtml(G, { visited: p.visited, places: p.places })}</div>
      <div class="menu-places-list">
        <h4 class="menu-book-sub">Аэродромы <b>${va}/${aps.length}</b></h4>
        <ul>${aps.map((a) => `<li class="${p.visited[a.id] ? 'is-on' : ''}">${icon(p.visited[a.id] ? 'check' : 'pin', 14)}<span>${esc(a.name)}</span><i>${esc(KIND_NAMES[a.kind] || '')}</i></li>`).join('')}</ul>
        <h4 class="menu-book-sub">Ориентиры <b>${vp}/${pois.length}</b></h4>
        <ul>${pois.map((x) => `<li class="${p.places[x.id] ? 'is-on' : ''}">${icon(p.places[x.id] ? 'check' : 'compass', 14)}<span>${esc(x.name)}</span></li>`).join('')}</ul>
        <p class="menu-note">Аэродром отмечается после посадки, ориентир — когда пролетите рядом.</p>
      </div>
    </div>`;
  }

  return {
    render(el, params) {
      st = (ctx.state.logbook ??= { tab: 'summary', ach: null });
      if (params.tab) { st.tab = params.tab; params.tab = null; }
      const body = st.tab === 'journal' ? journal() : st.tab === 'awards' ? awards() : st.tab === 'places' ? places() : summary();
      el.innerHTML = `${ctx.bar('Лётная книжка')}
        <div class="menu-body menu-book">
          <nav class="menu-rail menu-scroll-x" role="tablist" data-scroll="book-rail">${TABS.map((t) => `<button type="button" role="tab" aria-selected="${t.v === st.tab}" class="menu-rail-tab ${t.v === st.tab ? 'is-on' : ''}" data-act="tab" data-v="${t.v}" data-sfx="ui_tick"><span>${t.label}</span></button>`).join('')}</nav>
          <section class="menu-panel menu-book-page menu-book-page--${st.tab}"><div class="menu-scroll menu-book-scroll" data-scroll="book-${st.tab}">${body}</div></section>
        </div>`;
    },
    actions: {
      tab: (d) => { st.tab = d.v; ctx.refresh(); },
      ach: (d) => { st.ach = d.v; ctx.refresh(); },
    },
  };
}
