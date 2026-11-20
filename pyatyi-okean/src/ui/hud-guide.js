// КАРТОЧКА ЗАДАЧИ: что делать сейчас, как это сделать пальцами и насколько близко к цели.
// Не исчезает, пока шаг не выполнен (в отличие от радиосубтитров). Сворачивается тапом до одной строки («?» — развернуть).
// Источник — объект card: { key, n, total, title, how, progress: { value, max, text } | null, hint, note, noteKind,
//   buttons?: [{ id, label, main? }], onButton?(id), kind?: 'task' | 'offer' | 'idle' }.
// Здесь же одноразовые подсказки (tip) — строка внутри карточки на несколько секунд.
// DOM меняется только при изменении значений; опрос — из ui/hud.js несколько раз в секунду.

const TIP_T = 9;

export function createGuide(G, parent) {
  const root = document.createElement('div');
  root.className = 'hud-guide';
  root.hidden = true;
  root.innerHTML = `
    <div class="hud-guide-head">
      <b class="hud-guide-n"></b><span class="hud-guide-title"></span><span class="hud-guide-mini"></span>
      <button type="button" class="hud-guide-tog" aria-label="Свернуть или развернуть подсказку"><span></span></button>
    </div>
    <div class="hud-guide-body">
      <div class="hud-guide-how"></div>
      <div class="hud-guide-prog"><div class="hud-guide-bar"><i></i></div><span></span></div>
      <div class="hud-guide-hint"></div>
      <div class="hud-guide-note"></div>
      <div class="hud-guide-btns"></div>
    </div>
    <div class="hud-guide-tip"></div>`;
  parent.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const el = {
    head: $('.hud-guide-head'), n: $('.hud-guide-n'), title: $('.hud-guide-title'), mini: $('.hud-guide-mini'), tog: $('.hud-guide-tog'), togTxt: $('.hud-guide-tog span'),
    body: $('.hud-guide-body'), how: $('.hud-guide-how'), prog: $('.hud-guide-prog'), bar: $('.hud-guide-bar i'), progTxt: $('.hud-guide-prog span'),
    hint: $('.hud-guide-hint'), note: $('.hud-guide-note'), btns: $('.hud-guide-btns'), tip: $('.hud-guide-tip'),
  };
  const last = { n: null, title: null, how: null, pct: -1, ptxt: null, hint: null, note: null, noteKind: null, btns: '', kind: null, key: null, collapsed: null, tip: null };
  let card = null, collapsed = false, tipT = 0, tipText = '', changed = true;

  function set(node, prop, key, v) {
    if (last[key] === v) return false;
    last[key] = v;
    node[prop] = v;
    changed = true;
    return true;
  }
  function show(node, on) { if (node.hidden === on) { node.hidden = !on; changed = true; } }

  function setCollapsed(c) {
    collapsed = c;
    root.classList.toggle('is-collapsed', c);
    el.togTxt.textContent = c ? '?' : '–';
    changed = true;
  }
  el.head.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!card || card.kind === 'idle') return;
    G.input?.haptic?.(8);
    setCollapsed(!collapsed);
  });
  el.btns.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    G.input?.haptic?.(10);
    if (card && card.onButton) card.onButton(b.dataset.id);
  });
  setCollapsed(false);

  const guide = {
    root,
    get collapsed() { return collapsed; },
    // одноразовая подсказка (строка в карточке на несколько секунд)
    tip(text) {
      tipText = text || '';
      tipT = text ? TIP_T : 0;
    },
    // true — если размер карточки мог измениться (hud.js пересчитает отступ маркеров)
    update(c, dt) {
      changed = false;
      card = c;
      const on = !!c;
      if (tipT > 0) { tipT -= dt; if (tipT <= 0) tipText = ''; }
      const tipOn = !!tipText;
      show(root, on || tipOn);
      if (!on && !tipOn) return changed;
      if (on) {
        // новый шаг — карточка разворачивается: новые инструкции должны быть видны
        if (c.key !== last.key) { last.key = c.key; if (collapsed && c.kind !== 'idle') setCollapsed(false); root.classList.remove('is-new'); void root.offsetWidth; root.classList.add('is-new'); }
        const kind = c.kind || 'task';
        if (kind !== last.kind) { last.kind = kind; root.dataset.kind = kind; changed = true; }
        set(el.n, 'textContent', 'n', c.n && c.total > 1 ? `${c.n}/${c.total}` : '');
        show(el.n, !!(c.n && c.total > 1));
        set(el.title, 'textContent', 'title', c.title || '');
        set(el.how, 'textContent', 'how', c.how || '');
        show(el.how, !!c.how);
        const p = c.progress;
        show(el.prog, !!p);
        if (p) {
          const pct = Math.round(Math.max(0, Math.min(1, p.max > 0 ? p.value / p.max : 0)) * 100);
          if (pct !== last.pct) { last.pct = pct; el.bar.style.transform = `scaleX(${pct / 100})`; root.classList.toggle('is-full', pct >= 100); }
          set(el.progTxt, 'textContent', 'ptxt', p.text || '');
        }
        set(el.mini, 'textContent', 'mini', p && p.text ? p.text : '');
        set(el.hint, 'textContent', 'hint', c.hint || '');
        show(el.hint, !!c.hint);
        set(el.note, 'textContent', 'note', c.note || '');
        show(el.note, !!c.note);
        if (c.noteKind !== last.noteKind) { last.noteKind = c.noteKind; el.note.classList.toggle('is-good', c.noteKind === 'good'); }
        const bk = c.buttons ? c.buttons.map((b) => b.id + ':' + b.label + (b.main ? '!' : '')).join('|') : '';
        if (bk !== last.btns) {
          last.btns = bk;
          el.btns.innerHTML = (c.buttons || []).map((b) => `<button type="button" class="hud-guide-btn${b.main ? ' is-main' : ''}" data-id="${b.id}">${b.label}</button>`).join('');
          changed = true;
        }
        show(el.btns, !!bk);
        show(el.head, true);
        show(el.body, true);
        // «пустая» строка свободного полёта не сворачивается — она и так одна строка с кнопкой
        show(el.tog, kind !== 'idle');
      } else {
        show(el.head, false);
        show(el.body, false);
      }
      set(el.tip, 'textContent', 'tip', tipText);
      show(el.tip, tipOn);
      if (collapsed !== last.collapsed) { last.collapsed = collapsed; changed = true; }
      return changed;
    },
    // нижний край карточки в пикселях экрана (0 — скрыта)
    bottom() {
      if (root.hidden) return 0;
      const r = root.getBoundingClientRect();
      return r.height > 0 ? r.bottom : 0;
    },
    reset() { card = null; tipT = 0; tipText = ''; last.key = null; setCollapsed(false); },
  };
  return guide;
}
