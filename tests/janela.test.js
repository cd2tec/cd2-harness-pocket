'use strict';
// A janela do app se adapta à tela: nada de tamanho fixo maior que a tela. Rodar: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('launchers abrem maximizado e sem tamanho fixo; no Mac, do tamanho útil da tela', () => {
  const sh = ler('core/start-unix.sh'), ps = ler('core/start-windows.ps1');
  for(const s of [sh, ps]){ assert.doesNotMatch(s, /window-size=1280,860/); assert.match(s, /--start-maximized/); }
  assert.match(sh, /NSScreen/);
});

test('modais com altura máxima, rolagem e botões presos no rodapé', () => {
  const h = ler('web/index.html');
  assert.match(h, /dialog\{[^}]*max-height:calc\(100dvh - 32px\)[^}]*overflow-y:auto/);
  assert.match(h, /dialog > \.row:last-child\{[^}]*position:sticky/);
  assert.match(h, /screen\.availHeight/);
});

// Com o Chrome já aberto, ele ignora o tamanho pedido pelo launcher (medido no Mac); a página então
// sempre ocupa a área útil da tela em que abriu, não só quando é maior que ela.
test('a página sempre ocupa a área útil da tela ao abrir', () => {
  const h = ler('web/index.html'), f = h.slice(h.indexOf('function ocuparTela'), h.indexOf('\n}', h.indexOf('function ocuparTela')));
  assert.match(f, /moveTo\(screen\.availLeft/); assert.match(f, /resizeTo\(screen\.availWidth, screen\.availHeight\)/);
  assert.doesNotMatch(f, /if\(window\.outer/);
  assert.match(h, /async function boot\(\)\{\n  ocuparTela\(\);/);
});
