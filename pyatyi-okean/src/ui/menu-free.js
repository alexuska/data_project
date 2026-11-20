// Свободный полёт: самолёт, аэродром, старт, время суток и погода.
import { esc, icon, fmtInt, mapHtml, segmented, KIND_NAMES, WEATHER, TIMES } from './menu-kit.js';
import { getSpec, CATALOG } from '../aircraft/catalog.js';
import { headingVec } from '../core/util.js';
import * as N from '../systems/autoflight-nav.js';
import { saveProfile } from '../core/save.js';

const STARTS = [{ v: 'parking', label: 'Со стоянки' }, { v: 'runway', label: 'С полосы' }, { v: 'air', label: 'В воздухе' }];
const START_NOTE = {
  parking: 'Как в настоящем аэропорту: со стоянки запроси у вышки руление, прорули по меткам к полосе и запроси взлёт.',
  runway: 'Самолёт стоит на исполнительном старте — РУД вперёд и на взлёт.',
  air: 'Сразу в воздухе, на прямой к полосе — можно попробовать посадку или включить автопилот.',
};
// стоянка под размер самолёта: большие — на места L, малые — на S
function parkingFor(a, spec) {
  const pk = a.parking || [];
  if (!pk.length) return null;
  const want = spec.cls === 'airliner' || spec.cls === 'cargo' || spec.cls === 'bomber' || spec.mass > 40000 ? 'L' : spec.mass < 4000 ? 'S' : 'M';
  const order = want === 'L' ? ['L', 'M'] : want === 'S' ? ['S', 'M', 'L'] : ['M', 'L'];
  for (const sz of order) { const i = pk.findIndex((p) => p.size === sz); if (i >= 0) return i; }
  return 0;
}

export function freeScreen(ctx) {
  const { G } = ctx;
  let st = null;
  return {
    render(el) {
      const p = G.profile, world = G.world;
      st = (ctx.state.free ??= {});
      const owned = CATALOG.filter((s) => p.owned.includes(s.id));
      if (!owned.some((s) => s.id === st.planeId)) st.planeId = p.selectedPlane;
      if (!world.airportById[st.airportId]) st.airportId = 'yasny';
      st.start ??= 'runway';
      st.tod ??= 'day';
      st.weather ??= 'clear';
      const a = world.airportById[st.airportId] || world.airports[0];
      const rw = a.runways || [];
      const canPark = !!(a.parking && a.parking.length) && a.kind !== 'carrier';
      const starts = canPark ? STARTS : STARTS.filter((x) => x.v !== 'parking');
      const start = canPark || st.start !== 'parking' ? st.start : 'runway';
      const wi = N.windInfo(world), wx = N.weatherInfo(world), sel = N.bestRunway(a, world, getSpec(st.planeId));
      el.innerHTML = `${ctx.bar('Свободный полёт')}
        <div class="menu-body menu-free">
          <section class="menu-free-map">
            ${mapHtml(G, { selected: a.id, visited: p.visited, act: 'airport' })}
          </section>
          <section class="menu-panel menu-free-panel">
            <div class="menu-scroll menu-free-opts" data-scroll="free">
              <div class="menu-free-airport">
                <div class="menu-label">${esc(KIND_NAMES[a.kind] || '')} · ${rw.map((r) => `ВПП ${esc(r.name)} — ${fmtInt(r.length)} м`).join(', ')}${p.visited[a.id] ? ' · <span class="menu-ok">посещён</span>' : ''}</div>
                <h3 class="menu-free-name">${esc(a.name)}</h3>
                <p class="menu-free-desc">${esc(a.desc || '')} Высота ${fmtInt(a.elevation)} м.</p>
                ${sel && a.kind !== 'carrier' ? `<p class="menu-free-desc af-wx">Сводка: ${esc(wi.text)}, давление ${wx.qnh} · взлёт с полосы ${sel.name}</p>` : ''}
              </div>
              <div class="menu-opt"><span class="menu-label">Самолёт</span>
                <div class="menu-chips menu-scroll-x" data-scroll="free-planes">${owned.map((s) => `<button type="button" class="menu-chip ${s.id === st.planeId ? 'is-on' : ''}" data-act="plane" data-v="${s.id}" data-sfx="ui_tick">${icon('plane', 16)}${esc(s.name)}</button>`).join('')}</div></div>
              <div class="menu-opt"><span class="menu-label">Старт</span>${segmented('start', starts, start)}</div>
              <p class="menu-free-desc">${esc(START_NOTE[start] || '')}</p>
              <div class="menu-opt"><span class="menu-label">Подсказки</span>${segmented('checks', [{ v: 'on', label: 'Чек-листы' }, { v: 'off', label: 'Без подсказок' }], G.profile.settings.checklists === false ? 'off' : 'on')}</div>
              <div class="menu-opt"><span class="menu-label">Время</span>${segmented('tod', TIMES, st.tod, 'menu-seg--icons')}</div>
              <div class="menu-opt"><span class="menu-label">Погода</span>
                <div class="menu-chips menu-scroll-x" data-scroll="free-weather">${WEATHER.map((w) => `<button type="button" class="menu-chip ${w.v === st.weather ? 'is-on' : ''}" data-act="weather" data-v="${w.v}" data-sfx="ui_tick">${icon(w.icon, 16)}${w.label}</button>`).join('')}</div></div>
            </div>
            <footer class="menu-free-foot">
              <span class="menu-note">Налёт и посадки идут в лётную книжку</span>
              <button type="button" class="menu-btn menu-btn--primary menu-btn--wide" data-act="fly">На взлёт${icon('next', 18)}</button>
            </footer>
          </section>
        </div>`;
    },
    actions: {
      airport: (d) => { st.airportId = d.id; ctx.refresh(); },
      plane: (d) => { st.planeId = d.v; ctx.refresh(); },
      start: (d) => { st.start = d.v; ctx.refresh(); },
      checks: (d) => { G.profile.settings.checklists = d.v !== 'off'; saveProfile(G.profile); ctx.refresh(); },
      tod: (d) => { st.tod = d.v; ctx.refresh(); },
      weather: (d) => { st.weather = d.v; ctx.refresh(); },
      fly: () => {
        const spec = getSpec(st.planeId);
        const session = {
          planeId: spec.id, airportId: st.airportId,
          timeOfDay: (TIMES.find((t) => t.v === st.tod) || TIMES[1]).h, weather: st.weather,
        };
        const lv = G.career.livery(spec.id);
        if (lv) session.livery = lv;
        const a = G.world.airportById[st.airportId];
        if (st.start === 'parking' && a && a.parking && a.parking.length && a.kind !== 'carrier') {
          session.parking = parkingFor(a, spec);
        } else if (st.start === 'air') {
          // в воздухе: на прямой в 2,5 км до торца, с запасом высоты над рельефом по курсу
          const s0 = G.world.runwayStart(st.airportId, 0, 'A');
          const d = headingVec(s0.heading);
          const x = s0.x - d.x * 2500, z = s0.z - d.z * 2500;
          let top = 0;
          for (let k = -1; k <= 16; k++) top = Math.max(top, G.world.heightAt(x + d.x * k * 500, z + d.z * k * 500));
          session.air = { x, y: Math.max(s0.y + 450, top + 250), z, heading: s0.heading, speed: spec.vCruise };
        }
        G.career.select(spec.id);
        ctx.startFlight(session);
      },
    },
  };
}
