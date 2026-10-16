'use strict';
// Download fácil: o ZIP cd2tech-iadebolso.zip sai de uma release fixa, atualizada a cada push no main.
// README e site apontam para esse link, nunca para o ZIP automático do GitHub. Rodar: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const LINK = 'https://github.com/cd2tec/cd2-harness-pocket/releases/download/iadebolso/cd2tech-iadebolso.zip';

test('README e site usam o link do cd2tech-iadebolso.zip, não o ZIP automático', () => {
  for(const f of ['README.md', 'docs/index.html']){
    const s = ler(f);
    assert.ok(s.includes(LINK), f);
    assert.doesNotMatch(s, /archive\/refs\/heads\/main\.zip/, f);
  }
});

test('workflow monta o ZIP com a pasta cd2tech-iadebolso e publica na release iadebolso', () => {
  const w = ler('.github/workflows/zip-iadebolso.yml');
  assert.match(w, /branches: \[main\]/);
  assert.match(w, /--prefix=cd2tech-iadebolso\//);
  assert.match(w, /-o cd2tech-iadebolso\.zip/);
  assert.match(w, /gh release upload iadebolso cd2tech-iadebolso\.zip --clobber/);
  assert.match(w, /--latest=false/);
});
