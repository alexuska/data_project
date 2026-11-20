// Настройки и шпаргалка по управлению.
import { esc, icon, segmented } from './menu-kit.js';
import { saveProfile } from '../core/save.js';

const QUALITY = [{ v: 'auto', label: 'Авто' }, { v: 'low', label: 'Низкое' }, { v: 'medium', label: 'Среднее' }, { v: 'high', label: 'Высокое' }];

export function settingsScreen(ctx) {
  const { G } = ctx;
  const S = () => G.profile.settings;
  const commit = () => { saveProfile(G.profile); G.bus.emit('settings:changed'); };
  const applyVolume = () => { try { G.audio?.setVolume?.(S().sound, S().music); } catch (e) { /* звук необязателен */ } };
  const pct = (v) => `${Math.round(v * 100)}%`;

  return {
    render(el) {
      const s = S();
      const inFlight = G.mode === 'flight';
      const range = (key, label, min, max, step, hint = '') => `<label class="menu-set">
          <span class="menu-set-name">${label}${hint ? `<i>${hint}</i>` : ''}</span>
          <span class="menu-set-ctl"><input class="menu-range" type="range" min="${min}" max="${max}" step="${step}" value="${s[key]}" data-set="${key}" aria-label="${label}"><b data-out="${key}">${pct(s[key])}</b></span></label>`;
      const toggle = (key, label, hint = '') => `<div class="menu-set">
          <span class="menu-set-name">${label}${hint ? `<i>${hint}</i>` : ''}</span>
          <span class="menu-set-ctl"><button type="button" class="menu-switch ${s[key] ? 'is-on' : ''}" role="switch" aria-checked="${!!s[key]}" aria-label="${label}" data-act="toggle" data-v="${key}" data-sfx="ui_tick"><i></i></button></span></div>`;
      el.innerHTML = `${ctx.bar('Настройки', { wallet: false })}
        <div class="menu-body menu-settings">
          <section class="menu-panel menu-settings-panel"><div class="menu-scroll menu-settings-scroll" data-scroll="settings">
            <h4 class="menu-book-sub">Изображение и звук</h4>
            <div class="menu-set"><span class="menu-set-name">Качество графики<i>«Авто» подстроится под телефон</i></span><span class="menu-set-ctl">${segmented('quality', QUALITY, s.quality || 'auto')}</span></div>
            ${range('sound', 'Звук', 0, 1, 0.05)}
            ${range('music', 'Музыка', 0, 1, 0.05)}
            <h4 class="menu-book-sub">Управление</h4>
            ${range('sensitivity', 'Чувствительность', 0.5, 1.5, 0.05, 'насколько резко самолёт идёт за пальцем')}
            ${toggle('invertPitch', 'Инверсия тангажа', 'выкл.: палец вниз — нос вверх, как штурвал на себя')}
            ${toggle('assist', 'Помощь пилоту', 'координация разворотов и мягкое сваливание')}
            ${toggle('leftHanded', 'Раскладка для левши', 'ручка управления справа, РУД слева')}
            ${toggle('unlockAll', 'Открыть всё', 'все самолёты и задания доступны сразу, без покупки и званий')}
            <div class="menu-set"><span class="menu-set-name">Шпаргалка по кнопкам</span><span class="menu-set-ctl"><button type="button" class="menu-btn menu-btn--small" data-act="go" data-to="controls">${icon('controls', 18)}Открыть</button></span></div>
            ${inFlight ? '' : `<h4 class="menu-book-sub">Пилот</h4>
            <label class="menu-set"><span class="menu-set-name">Имя в лётной книжке</span><span class="menu-set-ctl"><input class="menu-input" type="text" maxlength="18" value="${esc(G.profile.pilotName || '')}" data-name autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="done"></span></label>
            <div class="menu-set"><span class="menu-set-name">Сброс прогресса<i>звание, деньги, ангар и книжка начнутся заново</i></span><span class="menu-set-ctl"><button type="button" class="menu-btn menu-btn--small menu-btn--danger" data-act="reset">Сбросить</button></span></div>`}
          </div></section>
        </div>`;
      const onInput = (e) => {
        const t = e.target;
        if (t.dataset.set) {
          const v = parseFloat(t.value);
          S()[t.dataset.set] = v;
          const out = el.querySelector(`[data-out="${t.dataset.set}"]`);
          if (out) out.textContent = pct(v);
          if (t.dataset.set !== 'sensitivity') applyVolume();
        }
      };
      const onChange = (e) => {
        const t = e.target;
        if (t.dataset.set) { commit(); if (t.dataset.set === 'sound') ctx.sfx('ui_click'); }
        if ('name' in t.dataset) { G.profile.pilotName = t.value.trim().slice(0, 18) || 'Пилот'; saveProfile(G.profile); }
      };
      const onKey = (e) => { if (e.key === 'Enter' && e.target.matches('.menu-input')) e.target.blur(); };
      el.addEventListener('input', onInput);
      el.addEventListener('change', onChange);
      el.addEventListener('keydown', onKey);
      return () => { el.removeEventListener('input', onInput); el.removeEventListener('change', onChange); el.removeEventListener('keydown', onKey); };
    },
    actions: {
      quality: (d) => { S().quality = d.v; try { G.setQuality(d.v); } catch (e) { /* ignore */ } commit(); ctx.refresh(); },
      toggle: (d) => { S()[d.v] = !S()[d.v]; commit(); ctx.refresh(); },
      reset: () => {
        ctx.confirm({
          over: 'Это нельзя отменить', title: 'Сбросить прогресс?',
          text: 'Звание, деньги, купленные самолёты, улучшения, лётная книжка и достижения будут стёрты. Настройки останутся.',
          ok: 'Сбросить', cancel: 'Оставить', danger: true,
        }).then((yes) => {
          if (!yes) return;
          G.career.reset();
          ctx.state = Object.assign(ctx.state, { hangar: null, free: null, careerCat: null, briefPlane: null, logbook: null });
          ctx.home();
          ctx.toast('Прогресс сброшен. Чистого неба!', 'info');
        });
      },
    },
  };
}

const TOUCH = [
  ['Ручка управления', 'левая часть экрана: от себя — нос вниз, на себя — нос вверх, в стороны — крен'],
  ['РУД (газ)', 'ползунок справа: вверх — больше тяги'],
  ['Шасси и закрылки', 'кнопки на экране; закрылки выпускайте перед посадкой и на взлёте'],
  ['Тормоз', 'удерживайте кнопку после касания полосы'],
  ['Камера', 'кнопка вида: снаружи, из кабины, облёт'],
  ['Оружие', 'пушка — удержание, пуск — отдельная кнопка, смена подвески — рядом'],
  ['Пауза', 'кнопка в углу экрана'],
];
const KEYS = [
  ['W / S или ↑ / ↓', 'тангаж'], ['A / D или ← / →', 'крен'], ['Q / E', 'руль направления'],
  ['Shift / Ctrl', 'газ больше / меньше'], ['G', 'шасси'], ['F', 'закрылки'], ['B', 'тормоз'], ['X', 'воздушный тормоз'],
  ['C', 'камера'], ['M', 'карта'], ['Пробел / Enter', 'пушка / пуск'], ['R', 'смена оружия'], ['Esc или P', 'пауза'],
];
const TIPS = [
  'Взлёт: закрылки, полный газ, на скорости отрыва плавно ручку на себя.',
  'Посадка: шасси, закрылки, газ прибрать; у самой полосы чуть приподнять нос и сесть на основные стойки.',
  'Сваливание: если самолёт «клюёт» и трясётся — ручку от себя и газ вперёд.',
];

export function controlsScreen(ctx) {
  return {
    render(el) {
      const rows = (list) => list.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
      el.innerHTML = `${ctx.bar('Управление', { wallet: false })}
        <div class="menu-body menu-controls">
          <section class="menu-panel menu-controls-panel"><div class="menu-scroll menu-controls-scroll" data-scroll="controls">
            <div class="menu-controls-cols">
              <div><h4 class="menu-book-sub">Сенсорный экран</h4><dl class="menu-keys">${rows(TOUCH)}</dl></div>
              <div><h4 class="menu-book-sub">Клавиатура</h4><dl class="menu-keys menu-keys--kbd">${rows(KEYS)}</dl></div>
            </div>
            <h4 class="menu-book-sub">Памятка пилота</h4>
            <ul class="menu-tips">${TIPS.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
          </div></section>
        </div>`;
    },
    actions: {},
  };
}
