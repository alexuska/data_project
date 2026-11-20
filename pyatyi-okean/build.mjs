// Сборка: src/main.js -> <out>/game.js (один IIFE-бандл вместе с three),
// src/**/*.css -> встроенный <style>, src/index.html -> <out>/artifact.html (фрагмент для публикации)
// и <out>/index.html (полный документ для локального запуска / GitHub Pages).
// Использование: node build.mjs [--out dist] [--dev]
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = resolve(root, outIdx >= 0 ? args[outIdx + 1] : 'dist');
const dev = args.includes('--dev');

function walk(dir, ext, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, acc);
    else if (name.endsWith(ext)) acc.push(p);
  }
  return acc;
}

mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  outfile: join(out, 'game.js'),
  logLevel: 'warning',
});

// base.css всегда первым, остальные по алфавиту
const cssFiles = walk(join(root, 'src'), '.css');
cssFiles.sort((a, b) => (a.endsWith('base.css') ? -1 : b.endsWith('base.css') ? 1 : a.localeCompare(b)));
const css = cssFiles.map((f) => `/* ${f.slice(root.length + 1)} */\n` + readFileSync(f, 'utf8')).join('\n');

const fragment = readFileSync(join(root, 'src/index.html'), 'utf8').replace('/*__CSS__*/', () => css);
writeFileSync(join(out, 'artifact.html'), fragment);
writeFileSync(
  join(out, 'index.html'),
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>\n${fragment}\n</body></html>\n`
);
const kb = (statSync(join(out, 'game.js')).size / 1024).toFixed(0);
console.log(`built -> ${out} (game.js ${kb} KB, css ${(css.length / 1024).toFixed(0)} KB)`);
