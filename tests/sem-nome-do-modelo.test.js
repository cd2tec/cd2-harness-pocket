'use strict';
// Para quem usa, o modelo é só "o modelo de IA": nem o front nem o terminal mostram qual é.
// Rodar: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('front não pede nem mostra o nome do modelo', () => {
  const h = ler('web/index.html');
  assert.doesNotMatch(h, /\/v1\/models/);
  assert.doesNotMatch(h, /qwen|gguf/i);
});

test('launchers não mostram o arquivo do modelo nem o log do servidor no terminal', () => {
  const sh = ler('core/start-unix.sh'), ps = ler('core/start-windows.ps1');
  assert.doesNotMatch(sh, /say "[^"]*\$\(basename "\$MODEL"\)/);
  assert.doesNotMatch(sh, /tail -n \d+ "\$LOG"/);
  assert.doesNotMatch(ps, /Write-Host "[^"]*\$\(\$ModelFile\.Name\)/);
  assert.doesNotMatch(ps, /Get-Content \$LogErr -Tail/);
});

test('site e README só citam o modelo na seção de licenças', () => {
  assert.doesNotMatch(ler('docs/index.html'), /qwen/i);
  const r = ler('README.md'), i = r.indexOf('## 9. Licenças'), f = r.indexOf('\n## ', i + 1);
  assert.ok(i > 0);
  assert.doesNotMatch(r.slice(0, i) + r.slice(f), /qwen/i);
  assert.match(r.slice(i, f), /Qwen3-4B-Instruct-2507/);
});
