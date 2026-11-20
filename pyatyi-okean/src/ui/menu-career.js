// Карьера: список заданий по категориям и брифинг. Рендерится строго по контракту «Описание задания».
import { esc, icon, fmtInt, fmtMoney, fmtNum, stars, pips, mapHtml, routeInfo, shortAirport, CLS_NAMES } from './menu-kit.js';
import { CATEGORY_ORDER } from '../systems/career.js';
import { STAR_BONUS } from '../systems/economy.js';
import { getSpec } from '../aircraft/catalog.js';

export const CATEGORIES = {
  training: { name: 'Обучение', desc: 'Курс первоначальной подготовки: взлёт, круг, посадка.' },
  civil: { name: 'Гражданские рейсы', desc: 'Пассажирские рейсы между аэродромами архипелага.' },
  cargo: { name: 'Грузы', desc: 'Почта, снабжение и срочные грузы — туда, куда иначе не добраться.' },
  rescue: { name: 'Спасатели', desc: 'Поиск, санитарные рейсы и тушение пожаров.' },
  combat: { name: 'Боевые', desc: 'Учения и боевые вылеты против условного противника.' },
  special: { name: 'Особые', desc: 'Испытания, показательные полёты и редкие поручения.' },
};
const catName = (c) => (CATEGORIES[c] ? CATEGORIES[c].name : c);

function byCategory(G) {
  const map = {};
  for (const m of G.career.sortedMissions()) (map[m.category] ??= []).push(m);
  const order = [...CATEGORY_ORDER.filter((c) => map[c]), ...Object.keys(map).filter((c) => !CATEGORY_ORDER.includes(c))];
  return { map, order };
}

export function careerScreen(ctx) {
  const { G } = ctx;
  return {
    render(el, params) {
      const career = G.career;
      const { map, order } = byCategory(G);
      const next = career.nextMission();
      let cat = params.cat || ctx.state.careerCat || (next && next.category) || order[0];
      if (!map[cat]) cat = order[0];
      ctx.state.careerCat = cat;
      const daily = career.dailyMission();
      const tabs = order.map((c) => {
        const list = map[c];
        const done = list.filter((m) => G.profile.missions[m.id]?.done).length;
        return `<button type="button" role="tab" aria-selected="${c === cat}" class="menu-rail-tab ${c === cat ? 'is-on' : ''}" data-act="cat" data-v="${esc(c)}" data-sfx="ui_tick">
          <span>${esc(catName(c))}</span><b>${done}/${list.length}</b></button>`;
      }).join('');
      const list = map[cat] || [];
      let got = 0;
      const rows = list.map((m, i) => {
        const st = career.missionState(m.id);
        got += st.stars;
        const route = m.from && m.to && m.from !== m.to ? `${shortAirport(G.world.airportById[m.from])} → ${shortAirport(G.world.airportById[m.to])}`
          : m.from ? `вылет: ${shortAirport(G.world.airportById[m.from])}` : '';
        const plane = m.plane ? getSpec(m.plane).name : '';
        const sub = st.unlocked ? [route, plane].filter(Boolean).join(' · ') : st.reason;
        const isDaily = daily && daily.id === m.id && !daily.done;
        const isNext = next && next.id === m.id;
        return `<button type="button" class="menu-mission ${st.unlocked ? '' : 'is-locked'} ${st.done ? 'is-done' : ''} ${isNext ? 'is-next' : ''}" data-act="open" data-id="${esc(m.id)}">
          <span class="menu-mission-no">${st.unlocked ? String(i + 1).padStart(2, '0') : icon('lock', 16)}</span>
          <span class="menu-mission-main">
            <span class="menu-mission-title">${esc(m.title)}${isDaily ? '<em class="menu-tag">задание дня ×2</em>' : ''}</span>
            ${sub ? `<span class="menu-mission-sub">${esc(sub)}</span>` : ''}
          </span>
          <span class="menu-mission-diff" title="Сложность">${pips(m.difficulty || 1)}</span>
          <span class="menu-mission-stars">${stars(st.stars)}</span>
          <span class="menu-mission-reward">${fmtMoney(m.reward?.money || 0)}</span>
          ${icon('next', 16, 'menu-mission-go')}
        </button>`;
      }).join('');
      el.innerHTML = `${ctx.bar('Карьера')}
        <div class="menu-body menu-career">
          <nav class="menu-rail menu-scroll-x" role="tablist" data-scroll="career-rail">${tabs}</nav>
          <section class="menu-panel menu-career-list">
            <header class="menu-career-head">
              <p>${esc(CATEGORIES[cat]?.desc || '')}</p>
              <span class="menu-career-total">${stars(0, 1, 13)}<b>${got}</b> / ${list.length * 3}</span>
            </header>
            <div class="menu-scroll menu-career-rows" data-scroll="career-${esc(cat)}">
              ${rows || '<p class="menu-empty">В этом разделе пока нет заданий.</p>'}
            </div>
          </section>
        </div>`;
    },
    actions: {
      cat: (d) => { ctx.state.careerCat = d.v; ctx.refresh(); },
      open: (d) => {
        const st = G.career.missionState(d.id);
        if (!st.unlocked && st.lock !== 'plane') { ctx.sfx('ui_error'); ctx.toast(st.reason, 'warn'); return; }
        ctx.go('brief', { id: d.id });
      },
    },
  };
}

export function briefScreen(ctx) {
  const { G } = ctx;
  let cur = null;
  return {
    render(el, params) {
      const career = G.career;
      const m = G.missions.byId?.[params.id] || G.missions.list.find((x) => x.id === params.id);
      if (!m) { el.innerHTML = `${ctx.bar('Брифинг')}<div class="menu-body"><p class="menu-empty">Задание не найдено.</p></div>`; return; }
      const st = career.missionState(m.id);
      const planes = career.missionPlanes(m.id);
      ctx.state.briefPlane ??= {};
      let planeId = planes.fixed || ctx.state.briefPlane[m.id];
      if (!planes.fixed && !planes.options.includes(planeId)) planeId = planes.pick;
      cur = { m, planeId, st };
      let fp = null;
      try { fp = G.missions.flightParams?.(m.id) || null; } catch (e) { fp = null; }
      const from = m.from || fp?.airportId || null;
      const to = m.to || null;
      const ri = from && to ? routeInfo(G, from, to) : null;
      const ap = (id) => G.world.airportById[id];
      const daily = career.dailyMission();
      const isDaily = daily && daily.id === m.id && !daily.done;
      const reward = m.reward || { money: 0, xp: 0 };

      let planeHtml;
      if (planes.fixed) {
        const s = getSpec(planes.fixed);
        planeHtml = `<div class="menu-brief-plane"><span class="menu-chip is-on is-static">${icon('plane', 16)}${esc(s.name)}</span><span class="menu-note">самолёт задания${career.owns(s.id) ? '' : ' — предоставляется'}</span></div>`;
      } else if (planes.options.length) {
        planeHtml = `<div class="menu-brief-plane menu-scroll-x" data-scroll="brief-planes">${planes.options.map((id) => `<button type="button" class="menu-chip ${id === planeId ? 'is-on' : ''}" data-act="plane" data-v="${id}" data-sfx="ui_tick">${icon('plane', 16)}${esc(getSpec(id).name)}</button>`).join('')}</div>`;
      } else {
        planeHtml = `<div class="menu-brief-plane"><span class="menu-note is-warn">${icon('lock', 16)} ${esc(st.reason)}</span></div>`;
      }
      const routeHtml = from || to ? `<div class="menu-brief-route">
          <span class="menu-label">Маршрут</span>
          <span class="menu-brief-route-line">${from ? esc(shortAirport(ap(from))) : ''}${to && to !== from ? `<i>${icon('next', 16)}</i>${esc(shortAirport(ap(to)))}` : ''}</span>
          ${ri ? `<span class="menu-brief-route-num">${fmtNum(ri.km, 0)} км · курс ${String(ri.course).padStart(3, '0')}°</span>` : ''}
        </div>` : '';
      const canFly = st.unlocked && !!planeId;
      el.innerHTML = `${ctx.bar('Брифинг', { backLabel: 'К заданиям' })}
        <div class="menu-body menu-brief">
          <section class="menu-panel menu-brief-main">
            <div class="menu-scroll menu-brief-text" data-scroll="brief">
              <div class="menu-brief-over"><span class="menu-label">${esc(catName(m.category))}</span>${pips(m.difficulty || 1)}${st.done ? `<span class="menu-brief-stars">${stars(st.stars, 3, 16)}</span>` : ''}${isDaily ? '<em class="menu-tag">задание дня ×2</em>' : ''}</div>
              <h3 class="menu-brief-title">${esc(m.title)}</h3>
              <p class="menu-brief-desc">${esc(m.brief || '')}</p>
              ${routeHtml}
              <div class="menu-brief-row"><span class="menu-label">Самолёт</span>${planeHtml}</div>
              <div class="menu-brief-row"><span class="menu-label">Награда</span>
                <div class="menu-brief-reward"><b>${fmtMoney(reward.money || 0)}</b><span>${fmtInt(reward.xp || 0)} опыта</span>
                <span class="menu-note">${st.done ? 'повторное выполнение оплачивается частично' : `за три звезды +${Math.round(STAR_BONUS[3] * 100)}%`}</span></div></div>
            </div>
            <footer class="menu-brief-foot">
              ${!st.unlocked && st.lock === 'plane' ? '<button type="button" class="menu-btn" data-act="go" data-to="hangar">В ангар</button>' : ''}
              <button type="button" class="menu-btn menu-btn--primary menu-btn--wide ${canFly ? '' : 'is-off'}" data-act="fly" data-sfx="${canFly ? 'ui_click' : 'ui_error'}">На взлёт${icon('next', 18)}</button>
            </footer>
          </section>
          <aside class="menu-brief-map">${mapHtml(G, { route: [from, to], selected: from, visited: G.profile.visited })}</aside>
        </div>`;
    },
    actions: {
      plane: (d) => { (ctx.state.briefPlane ??= {})[cur.m.id] = d.v; ctx.refresh(); },
      fly: () => {
        if (!cur) return;
        if (!cur.st.unlocked || !cur.planeId) { ctx.toast(cur.st.reason || 'Задание пока недоступно', 'warn'); return; }
        const session = { missionId: cur.m.id, planeId: cur.planeId };
        if (G.career.owns(cur.planeId)) { const lv = G.career.livery(cur.planeId); if (lv) session.livery = lv; }
        ctx.startFlight(session);
      },
    },
  };
}
export { catName, CLS_NAMES };
