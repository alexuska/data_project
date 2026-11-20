// Пауза и разбор полёта.
import { esc, icon, fmtInt, fmtMoney, fmtClock, fmtNum, fmtSigned, scale, shortAirport } from './menu-kit.js';
import { getSpec } from '../aircraft/catalog.js';

const CRASH_TEXT = {
  water: 'Самолёт упал в воду. Над морем высоту легко потерять — чаще поглядывайте на высотомер.',
  hard: 'Слишком грубое касание: вертикальная скорость оказалась выше допустимой. Перед полосой плавно выравнивайте самолёт и гасите снижение.',
  wing: 'Касание с большим креном — крыло задело землю. К моменту касания держите крылья ровно.',
  nose: 'Касание на нос. У самой земли чуть приподнимите нос, чтобы сесть на основные стойки.',
  gearup: 'Посадка с убранным шасси. Перед посадкой выпускайте шасси и ждите зелёные лампы.',
  terrain: 'Столкновение с землёй на большой скорости вне полосы.',
  shot: 'Самолёт сбит условным противником. Не летите по прямой под огнём и следите за хвостом.',
  collision: 'Столкновение с препятствием.',
  fuel: 'Топливо закончилось раньше, чем полоса оказалась под колёсами. Следите за остатком и планируйте запасной аэродром.',
};
const LANDING_HINT = {
  perfect: 'Притёр! Мягко и точно по оси.',
  good: 'Уверенная посадка.',
  fair: 'Жестковато: начинайте выравнивание чуть раньше.',
  rough: 'Грубая посадка. Гасите вертикальную скорость перед касанием.',
};
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

export function pauseScreen(ctx) {
  const { G } = ctx;
  let photo = false;
  const stopped = () => { const ac = G.player; return !!ac && ac.alive && ac.onGround && Math.hypot(ac.vel.x, ac.vel.z) < 3; };
  const setPhoto = (v) => { photo = v; try { G.hud?.setPhotoMode?.(v); } catch (e) { /* ignore */ } };
  return {
    render(el) {
      const f = G.flight, session = (f && f.session) || {};
      const def = session.missionId ? G.missions.byId?.[session.missionId] : null;
      if (photo) {
        el.innerHTML = `<button type="button" class="menu-btn menu-photo-back" data-act="photo-off">${icon('back', 18)}К паузе</button>`;
        return () => setPhoto(false);
      }
      const item = (act, name, ico, cls = '') => `<button type="button" class="menu-nav-item ${cls}" data-act="${act}">${icon(ico, 20)}<span class="menu-nav-name">${name}</span></button>`;
      el.innerHTML = `<div class="menu-pause">
        <header class="menu-pause-head">
          <div class="menu-label">${esc(getSpec(session.planeId).name)} · ${esc(def ? def.title : session.trial ? 'Пробный вылет' : 'Свободный полёт')} · ${fmtClock(f ? f.time : 0)}</div>
          <h2 class="menu-pause-title">Пауза</h2>
        </header>
        <nav class="menu-pause-nav">
          ${item('resume', 'Продолжить', 'play', 'is-primary')}
          ${item('restart', 'Начать заново', 'restart')}
          ${item('go-settings', 'Настройки', 'settings')}
          ${item('go-controls', 'Управление', 'controls')}
          ${typeof G.hud?.setPhotoMode === 'function' ? item('photo', 'Фото', 'camera') : ''}
          ${item('end', 'Завершить полёт', 'exit')}
        </nav>
      </div>`;
    },
    actions: {
      resume: () => G.setPaused(false),
      restart: () => {
        const s = { ...(G.flight ? G.flight.session : {}) };
        ctx.confirm({ over: 'Полёт начнётся с начала', title: 'Начать заново?', ok: 'Заново', cancel: 'Отмена' }).then((yes) => { if (yes) ctx.startFlight(s); });
      },
      'go-settings': () => ctx.go('settings'),
      'go-controls': () => ctx.go('controls'),
      photo: () => { setPhoto(true); ctx.refresh(); },
      'photo-off': () => { setPhoto(false); ctx.refresh(); },
      end: () => {
        const session = (G.flight && G.flight.session) || {};
        const onGround = stopped();
        const finish = () => G.endFlight({ reason: onGround ? 'landed' : 'quit' });
        const alive = !!(G.player && G.player.alive);
        if (session.missionId && alive) {
          ctx.confirm({ over: 'Задание не засчитается', title: 'Прервать задание?', text: 'Награда за задание не будет начислена, налёт попадёт в книжку.', ok: 'Прервать', cancel: 'Лететь дальше', danger: true }).then((yes) => { if (yes) finish(); });
        } else if (!onGround && alive && !session.trial) {
          ctx.confirm({ over: 'Самолёт ещё в воздухе', title: 'Завершить полёт?', text: 'Посадка не будет засчитана. Сядьте и остановитесь — получите оценку и доплату за посадку.', ok: 'Завершить', cancel: 'Лететь дальше' }).then((yes) => { if (yes) finish(); });
        } else finish();
      },
    },
  };
}

export function debriefScreen(ctx) {
  const { G } = ctx;
  let cur = null;
  return {
    render(el, params) {
      const result = params.result || {};
      const pay = result.payout || { money: 0, xp: 0, lines: [], landings: [], achievements: [], stars: result.stars || 0 };
      const career = G.career;
      const session = result.session || {};
      const def = result.missionId ? G.missions.byId?.[result.missionId] : null;
      const spec = getSpec(result.planeId);
      const s = result.stats || {};
      const complete = result.reason === 'mission_complete' && result.success !== false;
      const next = !session.trial ? career.nextMission(result.missionId || undefined) : null;
      cur = { result, next };

      let tone = 'neutral', title = 'Полёт завершён', text = result.text || '';
      if (complete) { tone = 'good'; title = result.title || 'Задание выполнено'; }
      else if (result.reason === 'mission_failed') { tone = 'bad'; title = result.title || 'Задание провалено'; }
      else if (result.reason === 'crashed') { tone = 'bad'; title = 'Авария'; text = CRASH_TEXT[result.crashReason] || text || 'Самолёт разбит.'; }
      else if (result.reason === 'landed') { title = result.missionId ? 'Задание прервано' : 'Посадка выполнена'; if (!result.missionId) tone = 'good'; }
      else if (result.missionId) title = 'Задание прервано';
      const sub = [spec.name, def ? def.title : session.trial ? 'Пробный вылет' : 'Свободный полёт'].join(' · ');

      const starsHtml = complete ? `<div class="menu-deb-stars">${[0, 1, 2].map((i) => `<span class="${i < pay.stars ? 'is-on' : ''}" style="--i:${i}">${icon('star', 40)}</span>`).join('')}</div>` : '';
      const l = pay.landing;
      const landingHtml = l ? `<div class="menu-plate menu-deb-landing is-${l.grade}">
          <span class="menu-label">Посадка${l.airportId ? ` · ${esc(shortAirport(G.world.airportById[l.airportId]))}` : l.surface === 'water' ? ' · на воду' : ' · вне аэродрома'}</span>
          <b>${esc(l.label)}</b>
          <span class="menu-deb-landing-num">касание ${fmtNum(Math.abs(l.vs), 1)} м/с${l.across != null ? ` · ${fmtNum(Math.abs(l.across), 0)} м от оси` : ''}${l.bounces ? ` · подскоков: ${l.bounces}` : ''}</span>
          <i>${LANDING_HINT[l.grade] || ''}</i>
        </div>` : '';
      const figs = `<div class="menu-deb-figs">
          <span><i>Время</i><b>${fmtClock(s.time)}</b></span><span><i>Путь</i><b>${fmtNum((s.distance || 0) / 1000, 1)} км</b></span>
          <span><i>Высота</i><b>${fmtInt(s.maxAlt)} м</b></span><span><i>Скорость</i><b>${fmtInt((s.maxSpeed || 0) * 3.6)} км/ч</b></span>
        </div>`;

      const lines = pay.lines || [];
      const linesHtml = lines.length ? lines.map((ln, i) => `<div class="menu-deb-line is-${ln.kind || 'plain'}" style="--i:${i}">
          <span>${ln.kind === 'achievement' ? icon('medal', 16) : ''}${esc(ln.label)}</span>
          <b class="${ln.money < 0 ? 'menu-bad' : ''}">${ln.money ? `${fmtSigned(ln.money)} ₽` : ''}</b>
          <em>${ln.xp ? `${fmtSigned(ln.xp)} оп.` : ''}</em></div>`).join('')
        : '<p class="menu-empty">За этот полёт начислений нет.</p>';
      const r = career.rank();
      const kBefore = pay.rankUp || pay.xpBefore == null || r.nextXp == null ? (r.nextXp == null ? 1 : 0) : Math.max(0, (pay.xpBefore - r.prevXp) / (r.nextXp - r.prevXp));

      const btn = (act, label, primary) => `<button type="button" class="menu-btn ${primary ? 'menu-btn--primary' : ''}" data-act="${act}">${label}</button>`;
      const primary = session.trial ? 'hangar' : complete && next ? 'next' : !complete && (result.reason === 'crashed' || result.reason === 'mission_failed') ? 'again' : next && result.missionId ? 'next' : 'menu';
      el.innerHTML = `<div class="menu-deb is-${tone}">
        <section class="menu-deb-left">
          <div class="menu-label">${esc(sub)}</div>
          <h2 class="menu-deb-title">${esc(title)}</h2>
          ${starsHtml}
          ${text ? `<p class="menu-deb-text">${esc(text)}</p>` : ''}
          ${landingHtml}
          ${figs}
        </section>
        <section class="menu-panel menu-deb-pay">
          <div class="menu-label">Ведомость начислений</div>
          <div class="menu-scroll menu-deb-lines" data-scroll="deb">${linesHtml}</div>
          <div class="menu-deb-total">
            <span class="menu-label">Итого</span>
            <b class="${pay.money < 0 ? 'menu-bad' : ''}"><span data-count="${pay.money}" data-sign="1">0</span> ₽</b>
            <em><span data-count="${pay.xp}" data-sign="1">0</span> оп.</em>
          </div>
          <div class="menu-deb-rank">
            <span>${esc(r.name)}</span>
            <span class="menu-scale menu-scale--ticks"><i data-rankbar style="width:${(kBefore * 100).toFixed(1)}%"></i></span>
            <span class="menu-deb-rank-num">${r.nextXp != null ? `${fmtInt(r.xp)} / ${fmtInt(r.nextXp)}` : fmtInt(r.xp)}</span>
          </div>
        </section>
        <footer class="menu-deb-actions">
          ${btn('again', session.trial ? 'Ещё вылет' : 'Ещё раз', primary === 'again')}
          ${next ? btn('next', result.missionId ? 'Следующее задание' : 'К заданиям', primary === 'next') : ''}
          ${btn('hangar', session.trial ? 'В ангар — к покупке' : 'В ангар', primary === 'hangar')}
          ${btn('menu', 'В меню', primary === 'menu')}
        </footer>
      </div>`;

      // анимации: звёзды → строки → итог с «набеганием» → звание
      const fast = reduced();
      const timers = [];
      let raf = 0, finished = false;
      const counters = [...el.querySelectorAll('[data-count]')];
      const setCount = (n, v) => { n.textContent = n.dataset.sign && v > 0 ? `+${fmtInt(v)}` : v < 0 ? `−${fmtInt(-v)}` : fmtInt(v); };
      const rankbar = el.querySelector('[data-rankbar]');
      const finish = () => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(raf);
        for (const n of counters) setCount(n, +n.dataset.count);
        if (rankbar) rankbar.style.width = `${(r.progress * 100).toFixed(1)}%`;
        el.firstElementChild?.classList.add('is-settled');
        if (pay.rankUp) {
          timers.push(setTimeout(() => {
            ctx.sfx('ui_rankup');
            ctx.confirm({
              cls: 'menu-dialog--rank', over: 'Приказом по авиаотряду присвоено звание', title: pay.rankUp.name,
              html: `<div class="menu-rank-stamp"><span class="menu-stamp">допущен</span></div>${pay.rankUp.planes && pay.rankUp.planes.length ? `<p class="menu-dialog-text">Теперь в ангаре можно купить: <b>${esc(pay.rankUp.planes.join(', '))}</b>. Открылись и новые задания.</p>` : '<p class="menu-dialog-text">Открылись новые задания.</p>'}`,
              ok: 'Служу небу', cancel: false,
            });
          }, fast ? 0 : 500));
        }
      };
      const startCount = () => {
        const t0 = performance.now(), dur = 900;
        ctx.sfx('ui_coin');
        const tick = (now) => {
          const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
          for (const n of counters) setCount(n, Math.round(+n.dataset.count * e));
          if (k < 1 && !finished) raf = requestAnimationFrame(tick); else finish();
        };
        raf = requestAnimationFrame(tick);
        if (rankbar) rankbar.style.width = `${(r.progress * 100).toFixed(1)}%`;
      };
      if (fast) finish();
      else {
        if (complete) for (let i = 0; i < pay.stars; i++) timers.push(setTimeout(() => ctx.sfx('ui_star'), 350 + i * 320));
        timers.push(setTimeout(startCount, (complete ? 500 + pay.stars * 320 : 300) + Math.min(lines.length, 8) * 70));
        timers.push(setTimeout(finish, 4500));
      }
      const skip = (e) => { if (!e.target.closest('button')) finish(); };
      el.addEventListener('pointerdown', skip);
      ctx.sfx(tone === 'bad' ? 'ui_fail' : complete ? 'ui_success' : 'ui_debrief');
      return () => { finished = true; cancelAnimationFrame(raf); timers.forEach(clearTimeout); el.removeEventListener('pointerdown', skip); };
    },
    actions: {
      again: () => {
        const s = cur.result.session || {};
        const session = s.missionId ? { missionId: s.missionId, planeId: s.planeId } : { ...s };
        if (s.livery) session.livery = s.livery;
        ctx.startFlight(session);
      },
      next: () => { if (cur.next) ctx.toMenu(cur.result.missionId ? 'brief' : 'career', cur.result.missionId ? { id: cur.next.id } : {}); else ctx.toMenu(); },
      hangar: () => ctx.toMenu('hangar', { planeId: cur.result.planeId }),
      menu: () => ctx.toMenu(),
    },
  };
}
