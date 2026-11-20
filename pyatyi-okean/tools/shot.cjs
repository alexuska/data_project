#!/usr/bin/env node
// Тестовый стенд: открывает собранную игру в headless Chromium (WebGL через SwiftShader), выполняет шаги, делает скриншоты.
//
//   node tools/shot.cjs --dist out/мойкаталог [--query "start=free&plane=an2&air=1"] [--size 844x390] [--touch]
//        --do "wait:2" --do "eval:__G.debug.advance(20)" --do "shot:shots/a.png" --do "tap:420,200" ...
//
// Шаги (--do, выполняются по порядку):
//   wait:<сек>            — подождать реальное время
//   eval:<js>             — выполнить JS на странице, результат напечатать (JSON)
//   advance:<сек>         — прокрутить симуляцию: __G.debug.advance(сек) и напечатать состояние
//   hold:<json|null>      — зафиксировать управление игрока, напр. hold:{"pitch":0.3,"throttle":1}
//   shot:<путь.png>       — скриншот
//   tap:<x>,<y>           — тап/клик в точке
//   drag:<x1>,<y1>,<x2>,<y2>[,<мс>] — протянуть пальцем/мышью
//   key:<Key>             — нажать клавишу (Playwright-имя, напр. KeyG)
// Без шагов: wait:2 + shot:shots/shot.png.
// Реальное время в headless медленное (несколько кадров/с) — для физики используйте advance, а не wait.
// Игровой цикл по умолчанию работает; --manual отключает его (время идёт только через advance).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const argv = process.argv.slice(2);
const opt = { dist: 'dist', query: '', size: '844x390', steps: [], touch: false, manual: false, dpr: 1 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--dist') opt.dist = argv[++i];
  else if (a === '--query') opt.query = argv[++i];
  else if (a === '--size') opt.size = argv[++i];
  else if (a === '--do') opt.steps.push(argv[++i]);
  else if (a === '--touch') opt.touch = true;
  else if (a === '--manual') opt.manual = true;
  else if (a === '--dpr') opt.dpr = +argv[++i];
}
if (!opt.steps.length) opt.steps = ['wait:2', 'shot:shots/shot.png'];
const [w, h] = opt.size.split('x').map(Number);

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: opt.dpr, hasTouch: opt.touch, isMobile: opt.touch });
  const page = await ctx.newPage();
  let errors = 0;
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      const t = m.text();
      if (/fonts\.g|net::ERR|Failed to load resource/.test(t)) return;
      errors += m.type() === 'error' ? 1 : 0;
      console.log(`[console.${m.type()}] ${t.slice(0, 600)}`);
    }
  });
  page.on('pageerror', (e) => { errors++; console.log('[pageerror]', String(e.stack || e).slice(0, 800)); });
  const file = path.resolve(opt.dist, 'index.html');
  if (!fs.existsSync(file)) { console.error('нет файла ' + file + ' — сначала соберите: node build.mjs --out ' + opt.dist); process.exit(2); }
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto('file://' + file + (opt.query ? '?' + opt.query : ''));
  await page.waitForFunction(() => window.__G && window.__G.mode !== 'boot', null, { timeout: 30000 }).catch(() => console.log('[стенд] игра не загрузилась за 30 с'));
  if (opt.manual) await page.evaluate(() => { window.__G.debug.manual = true; });

  for (const step of opt.steps) {
    const idx = step.indexOf(':');
    const cmd = idx < 0 ? step : step.slice(0, idx);
    const arg = idx < 0 ? '' : step.slice(idx + 1);
    try {
      if (cmd === 'wait') await page.waitForTimeout(parseFloat(arg) * 1000);
      else if (cmd === 'eval') {
        const r = await page.evaluate((code) => { const v = (0, eval)(code); return v === undefined ? null : JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x))); }, arg).catch((e) => 'EVAL ERROR: ' + e.message.slice(0, 500));
        console.log('eval>', JSON.stringify(r));
      } else if (cmd === 'advance') {
        const r = await page.evaluate((s) => window.__G.debug.advance(s), parseFloat(arg));
        console.log('advance>', JSON.stringify(r));
      } else if (cmd === 'hold') {
        await page.evaluate((c) => window.__G.debug.hold(c), JSON.parse(arg));
      } else if (cmd === 'shot') {
        fs.mkdirSync(path.dirname(path.resolve(arg)), { recursive: true });
        await page.screenshot({ path: arg });
        console.log('shot>', arg);
      } else if (cmd === 'tap') {
        const [x, y] = arg.split(',').map(Number);
        if (opt.touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
      } else if (cmd === 'drag') {
        const [x1, y1, x2, y2, ms] = arg.split(',').map(Number);
        await page.mouse.move(x1, y1); await page.mouse.down();
        await page.mouse.move(x2, y2, { steps: 8 });
        await page.waitForTimeout(ms || 300); await page.mouse.up();
      } else if (cmd === 'key') await page.keyboard.press(arg);
      else console.log('неизвестный шаг: ' + step);
    } catch (e) {
      console.log(`[шаг ${step}] ошибка: ${String(e.message).slice(0, 400)}`);
    }
  }
  const errs = await page.evaluate(() => (window.__G ? window.__G.errors : null)).catch(() => null);
  console.log('ошибки модулей:', JSON.stringify(errs), '| ошибок консоли:', errors);
  await browser.close();
})();
