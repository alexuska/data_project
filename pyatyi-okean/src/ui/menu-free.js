// Свободный полёт: самолёт, аэродром, старт, время суток и погода.
import { esc, icon, fmtInt, mapHtml, segmented, KIND_NAMES, WEATHER, TIMES } from './menu-kit.js';
import { getSpec, CATALOG } from '../aircraft/catalog.js';
import { headingVec } from '../core/util.js';

const STARTS = [{ v: 'runway', label: 'С полосы' }, { v: 'air', label: 'В воздухе' }];

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
      el.innerHTML = `${ctx.bar('Свободный полёт')}
        <div class="menu-body menu-free">
          <section class="menu-free-map">
            ${mapHtml(G, { selected: a.id, visited: p.visited, act: 'airport' })}
          </section>
          <section class="menu-panel menu-free-panel">
            <div class="menu-scroll menu-free-opts" data-scroll="free">
              <div class="menu-free-airport">
                <div class="menu-label">${esc(KIND_NAMES[a.kind] || '')} · ${esc(a.code || '')}${p.visited[a.id] ? ' · <span class="menu-ok">посещён</span>' : ''}</div>
                <h3 class="menu-free-name">${esc(a.name)}</h3>
                <p class="menu-free-desc">${esc(a.desc || '')} ${rw.map((r) => `ВПП ${esc(r.name)} — ${fmtInt(r.length)} м`).join(', ')}. Высота ${fmtInt(a.elevation)} м.</p>
              </div>
              <div class="menu-opt"><span class="menu-label">Самолёт</span>
                <div class="menu-chips menu-scroll-x" data-scroll="free-planes">${owned.map((s) => `<button type="button" class="menu-chip ${s.id === st.planeId ? 'is-on' : ''}" data-act="plane" data-v="${s.id}" data-sfx="ui_tick">${icon('plane', 16)}${esc(s.name)}</button>`).join('')}</div></div>
              <div class="menu-opt"><span class="menu-label">Старт</span>${segmented('start', STARTS, st.start)}</div>
              <div class="menu-opt"><span class="menu-label">Время</span>${segmented('tod', TIMES, st.tod, 'menu-seg--icons')}</div>
              <div class="menu-opt"><span class="menu-label">Погода</span>
                <div class="menu-chips">${WEATHER.map((w) => `<button type="button" class="menu-chip ${w.v === st.weather ? 'is-on' : ''}" data-act="weather" data-v="${w.v}" data-sfx="ui_tick">${icon(w.icon, 16)}${w.label}</button>`).join('')}</div></div>
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
        if (st.start === 'air') {
          // в воздухе: на прямой перед полосой, в 3 км от торца
          const s0 = G.world.runwayStart(st.airportId, 0, 'A');
          const d = headingVec(s0.heading);
          const x = s0.x - d.x * 3000, z = s0.z - d.z * 3000;
          const ground = Math.max(0, G.world.heightAt(x, z));
          session.air = { x, y: Math.max(s0.y + 450, ground + 350), z, heading: s0.heading, speed: spec.vCruise };
        }
        G.career.select(spec.id);
        ctx.startFlight(session);
      },
    },
  };
}
