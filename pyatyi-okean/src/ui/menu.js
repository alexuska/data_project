// МЕНЮ: оболочка (экраны, переходы, диалоги, подсказки). Контракт — в ARCHITECTURE.md:
// G.menu.show(screen), hide(), showDebrief(result). Экраны лежат в menu-*.js.
import { esc, icon, fmtInt, fmtMoney } from './menu-kit.js';
import { mainScreen } from './menu-main.js';
import { careerScreen, briefScreen } from './menu-career.js';
import { hangarScreen } from './menu-hangar.js';
import { freeScreen } from './menu-free.js';
import { logbookScreen } from './menu-logbook.js';
import { settingsScreen, controlsScreen } from './menu-settings.js';
import { pauseScreen, debriefScreen } from './menu-flight.js';

export function createMenu(G) {
  const root = document.createElement('div');
  root.className = 'menu';
  root.hidden = true;
  root.innerHTML = '<div class="menu-stage"></div><div class="menu-rotate" hidden></div><div class="menu-toasts" aria-live="polite"></div><div class="menu-overlay" hidden></div>';
  G.ui.appendChild(root);
  const stage = root.querySelector('.menu-stage');
  const overlay = root.querySelector('.menu-overlay');
  const toasts = root.querySelector('.menu-toasts');
  const rotateEl = root.querySelector('.menu-rotate');

  let stack = [];       // [{ id, params }]
  let current = null;   // { id, el, def, params, cleanup }
  let dialog = null;    // { resolve, actions }
  let afterMenu = null; // куда перейти после возврата в меню
  let rotateDismissed = false;
  let wakeLock = null;
  // погода и время суток фона меню — те, с которыми мир стартовал
  const ambient = { tod: G.world?.timeOfDay ?? null, weather: G.world?.weather?.type ?? null, dirty: false };

  const sfx = (name) => { try { G.audio?.play?.(name); } catch (e) { /* звук необязателен */ } };

  // ---------- общий контекст экранов ----------
  const ctx = {
    G,
    state: {},            // память экранов между заходами (выбранная вкладка, самолёт и т.п.)
    sfx,
    go(id, params) { stack.push({ id, params: params || {} }); mount('fwd'); },
    replace(id, params) { stack[stack.length - 1] = { id, params: params || {} }; mount('fwd'); },
    back() {
      if (stack.length > 1) { stack.pop(); mount('back'); } else if (G.mode === 'flight' && G.paused) G.setPaused(false);
    },
    home() { stack = [{ id: 'main', params: {} }]; mount('back'); },
    refresh() {
      if (!current) return;
      const keep = [...current.el.querySelectorAll('[data-scroll]')].map((n) => [n.dataset.scroll, n.scrollTop, n.scrollLeft]);
      current.cleanup?.();
      current.cleanup = current.def.render(current.el, current.params) || null;
      for (const [k, top, left] of keep) {
        const n = current.el.querySelector(`[data-scroll="${k}"]`);
        if (n) { n.scrollTop = top; n.scrollLeft = left; }
      }
    },
    // вернуться из полёта в меню и открыть нужный экран
    toMenu(id, params) { afterMenu = id ? { id, params } : null; G.toMenu(); },
    startFlight(session) {
      G.audio?.unlock?.();
      requestWakeLock();
      sfx('ui_start');
      G.startFlight(session);
    },
    toast(text, kind = 'info') {
      const t = document.createElement('div');
      t.className = `menu-toast is-${kind}`;
      t.textContent = text;
      toasts.appendChild(t);
      while (toasts.children.length > 3) toasts.firstChild.remove();
      setTimeout(() => { t.classList.add('is-out'); setTimeout(() => t.remove(), 260); }, 2800);
    },
    // шапка внутренних экранов
    bar(title, opts = {}) {
      const r = G.career.rank();
      return `<header class="menu-bar">
        <button type="button" class="menu-bar-back" data-act="back" data-sfx="ui_back" aria-label="Назад">${icon('back', 22)}<span>${esc(opts.backLabel || 'Назад')}</span></button>
        <h2 class="menu-bar-title">${esc(title)}</h2>
        <div class="menu-bar-mid">${opts.mid || ''}</div>
        ${opts.wallet === false ? '' : `<div class="menu-bar-wallet"><span class="menu-bar-rank" data-wallet="rank">${esc(r.name)}</span><span class="menu-bar-money" data-wallet="money">${fmtMoney(G.profile.money)}</span></div>`}
      </header>`;
    },
    // диалог. opts: { title, text?, html?, ok, cancel?, danger?, cls?, stamp? } -> Promise<boolean>
    confirm(opts) {
      closeDialog(false);
      overlay.hidden = false;
      overlay.innerHTML = `<div class="menu-dialog ${opts.cls || ''}" role="dialog" aria-modal="true">
        ${opts.over ? `<div class="menu-label">${esc(opts.over)}</div>` : ''}
        <h3 class="menu-dialog-title">${esc(opts.title || '')}</h3>
        ${opts.text ? `<p class="menu-dialog-text">${esc(opts.text)}</p>` : ''}${opts.html || ''}
        <div class="menu-dialog-actions">
          ${opts.cancel === false ? '' : `<button type="button" class="menu-btn" data-act="dlg-cancel" data-sfx="ui_back">${esc(opts.cancel || 'Отмена')}</button>`}
          <button type="button" class="menu-btn ${opts.danger ? 'menu-btn--danger' : 'menu-btn--primary'}" data-act="dlg-ok">${esc(opts.ok || 'Да')}</button>
        </div></div>`;
      return new Promise((resolve) => { dialog = { resolve }; });
    },
    fullscreen: {
      available() {
        const d = document, el = document.documentElement;
        return !!((d.fullscreenEnabled || d.webkitFullscreenEnabled) && (el.requestFullscreen || el.webkitRequestFullscreen));
      },
      active() { return !!(document.fullscreenElement || document.webkitFullscreenElement); },
      toggle() {
        try {
          const d = document, el = document.documentElement;
          if (ctx.fullscreen.active()) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
          else {
            const r = (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
            if (r && r.catch) r.catch(() => {});
            try { const o = screen.orientation?.lock?.('landscape'); if (o && o.catch) o.catch(() => {}); } catch (e) { /* не везде можно */ }
          }
        } catch (e) { /* полноэкранный режим недоступен */ }
      },
    },
  };

  function closeDialog(value) {
    if (!dialog) return;
    const d = dialog;
    dialog = null;
    overlay.hidden = true;
    overlay.innerHTML = '';
    d.resolve(value);
  }

  async function requestWakeLock() {
    try {
      if (wakeLock || !navigator.wakeLock) return;
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener?.('release', () => { wakeLock = null; });
    } catch (e) { wakeLock = null; }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && G.mode === 'flight') requestWakeLock(); });

  const screens = {
    main: mainScreen(ctx),
    career: careerScreen(ctx),
    brief: briefScreen(ctx),
    hangar: hangarScreen(ctx),
    free: freeScreen(ctx),
    logbook: logbookScreen(ctx),
    settings: settingsScreen(ctx),
    controls: controlsScreen(ctx),
    pause: pauseScreen(ctx),
    debrief: debriefScreen(ctx),
  };

  function unmount() {
    if (!current) return;
    const old = current;
    current = null;
    try { old.cleanup?.(); } catch (e) { console.error('[menu]', e); }
    old.el.classList.add('is-leaving');
    old.el.style.pointerEvents = 'none';
    setTimeout(() => old.el.remove(), 170);
  }
  function mount(dir = 'fwd') {
    const entry = stack[stack.length - 1];
    const def = entry && screens[entry.id];
    unmount();
    if (!def) return;
    const el = document.createElement('div');
    el.className = `menu-screen menu-screen--${entry.id} menu-in-${dir}`;
    stage.appendChild(el);
    root.dataset.screen = entry.id;
    current = { id: entry.id, el, def, params: entry.params, cleanup: null };
    try { current.cleanup = def.render(el, entry.params) || null; } catch (e) {
      console.error('[menu]', e);
      el.innerHTML = `<div class="menu-fail"><p>Экран не открылся.</p><button type="button" class="menu-btn" data-act="home">В меню</button></div>`;
    }
    updateRotateHint();
  }

  function updateRotateHint() {
    const portrait = innerHeight > innerWidth * 1.15;
    const show = !root.hidden && portrait && !rotateDismissed && G.mode === 'menu' && !!current && current.id === 'main';
    if (show && rotateEl.hidden) {
      rotateEl.innerHTML = `${icon('rotate', 22)}<span>В альбомной ориентации летать удобнее — поверните телефон.</span><button type="button" data-act="rotate-close" aria-label="Закрыть">${icon('close', 18)}</button>`;
    }
    rotateEl.hidden = !show;
  }

  // ---------- действия ----------
  const globalActions = {
    back: () => ctx.back(),
    home: () => ctx.home(),
    go: (d) => ctx.go(d.to, d.id ? { id: d.id } : {}),
    'rotate-close': () => { rotateDismissed = true; updateRotateHint(); },
  };
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t || !root.contains(t)) return;
    G.audio?.unlock?.();
    const act = t.dataset.act;
    if (act === 'dlg-ok' || act === 'dlg-cancel') { sfx(t.dataset.sfx || 'ui_click'); closeDialog(act === 'dlg-ok'); return; }
    if (dialog && !overlay.contains(t)) return;
    const fn = (current && current.def.actions && current.def.actions[act]) || globalActions[act];
    if (!fn) return;
    sfx(t.dataset.sfx || 'ui_click');
    try { fn(t.dataset, t, e); } catch (err) { console.error('[menu]', err); }
  });
  addEventListener('keydown', (e) => {
    if (root.hidden || e.code !== 'Escape') return;
    if (dialog) closeDialog(false);
    else if (G.mode === 'menu' && stack.length > 1) ctx.back();
  });

  // ---------- публичный интерфейс ----------
  const menu = {
    root,
    ctx,
    get screen() { return current ? current.id : null; },
    show(screen = 'main', params) {
      root.hidden = false;
      stack = [{ id: screens[screen] ? screen : 'main', params: params || {} }];
      mount('fwd');
    },
    hide() {
      closeDialog(false);
      unmount();
      stack = [];
      root.hidden = true;
      delete root.dataset.screen;
      rotateEl.hidden = true;
    },
    showDebrief(result) {
      root.hidden = false;
      closeDialog(false);
      stack = [{ id: 'debrief', params: { result } }];
      mount('fwd');
    },
    go: (id, params) => ctx.go(id, params),
    toast: (text, kind) => ctx.toast(text, kind),
  };

  // первый запуск и ежедневное довольствие — только на главном экране, с небольшой задержкой (автозапуск из адреса их не увидит)
  function greet() {
    if (G.mode !== 'menu' || !current || current.id !== 'main' || dialog) return;
    const p = G.profile;
    if (!p.seen.welcome) {
      const first = G.career.nextMission();
      G.career.claimDaily();
      ctx.confirm({
        cls: 'menu-dialog--welcome', over: 'Добро пожаловать на борт',
        title: 'Пятый океан',
        text: 'Архипелаг Семи Ветров ждёт своего пилота. Начните с учебного Як-52: взлёт, круг над аэродромом и первая посадка — а дальше рейсы, спасатели, истребители и свой ангар.',
        ok: first ? 'Первое задание' : 'В небо', cancel: 'Осмотреться',
      }).then((yes) => {
        p.seen.welcome = true;
        G.career.changed();
        if (yes && first && G.mode === 'menu') ctx.go('brief', { id: first.id });
      });
      return;
    }
    const bonus = G.career.claimDaily();
    if (bonus) {
      sfx('ui_coin');
      ctx.confirm({
        cls: 'menu-dialog--daily', over: `День ${bonus.streak} подряд`,
        title: 'Ежедневное довольствие',
        html: `<p class="menu-dialog-sum">+${fmtInt(bonus.money)} ₽</p><p class="menu-dialog-text">Заходите каждый день — довольствие растёт до пятого дня подряд.</p>`,
        ok: 'Принять', cancel: false,
      }).then(() => { if (current && current.id === 'main') ctx.refresh(); });
    }
  }

  G.bus.on('flight:start', ({ session } = {}) => {
    if (session && (session.timeOfDay != null || session.weather)) ambient.dirty = true;
    menu.hide();
  });
  G.bus.on('flight:end', ({ result }) => menu.showDebrief(result));
  G.bus.on('pause', ({ paused }) => {
    // на паузе приборы убираем: экран паузы и настройки читаются чище
    try { if (paused) G.hud?.hide?.(); else if (G.mode === 'flight') G.hud?.show?.(); } catch (e) { /* ignore */ }
    if (paused) menu.show('pause'); else menu.hide();
  });
  G.bus.on('menu:show', () => {
    // фон меню — спокойная погода, а не гроза из последнего вылета
    if (ambient.dirty) {
      ambient.dirty = false;
      try {
        if (ambient.tod != null) G.world.setTimeOfDay(ambient.tod);
        if (ambient.weather) G.world.setWeather(ambient.weather);
      } catch (e) { /* мир переживёт */ }
    }
    menu.show('main');
    if (afterMenu) {
      const a = afterMenu;
      afterMenu = null;
      if (a.id === 'brief') stack.push({ id: 'career', params: {} });
      ctx.go(a.id, a.params);
    }
    else setTimeout(greet, 350);
  });
  G.bus.on('career:changed', () => {
    if (root.hidden || !current) return;
    const r = G.career.rank();
    for (const n of current.el.querySelectorAll('[data-wallet="money"]')) n.textContent = fmtMoney(G.profile.money);
    for (const n of current.el.querySelectorAll('[data-wallet="rank"]')) n.textContent = r.name;
  });
  G.bus.on('career:achievement', ({ achievement }) => {
    if (root.hidden || G.mode !== 'menu') return;
    sfx('ui_achievement');
    ctx.toast(`Достижение: ${achievement.title} · +${fmtInt(achievement.reward?.money || 0)} ₽`, 'good');
  });
  G.bus.on('resize', updateRotateHint);
  addEventListener('resize', updateRotateHint);
  return menu;
}
