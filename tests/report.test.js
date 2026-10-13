'use strict';
// Testes do CSV e do relatório impresso (web/report.js). Rodar: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../web/report.js');

test('toCsv: BOM, ponto e vírgula, CRLF, aspas e decimal com vírgula', () => {
  const s = R.toCsv(['loja', 'total', 'obs'], [{ loja:'A;B', total:'12.5', obs:'diz "oi"' }, { loja:'C', total:3, obs:null }]);
  assert.ok(s.startsWith('\uFEFF'));
  assert.equal(s.slice(1), 'loja;total;obs\r\n"A;B";12,5;"diz ""oi"""\r\nC;3;\r\n');
});

test('toCsv neutraliza fórmula do Excel e preserva número negativo e código', () => {
  const s = R.toCsv(['a'], [{ a:'=HYPERLINK("x")' }, { a:'+1' }, { a:'@SUM' }, { a:'-texto' }, { a:'-5' }, { a:-2.5 }, { a:'0012345' }]);
  assert.deepEqual(s.slice(1).split('\r\n').slice(1, 8), ['"\'=HYPERLINK(""x"")"', "'+1", "'@SUM", "'-texto", '-5', '-2,5', '0012345']);
});

test('fileName com data e hora', () => {
  assert.equal(R.fileName(new Date(2026, 9, 13, 9, 5)), 'cd2-relatorio-20261013-0905.csv');
});

test('printHtml escapa o texto, mantém o HTML do gráfico e mostra o contato', () => {
  const h = R.printHtml({ pergunta:'<script>x</script>', titulo:'Vendas & cia', frase:'Maior: A.', aviso:'Mostrando 20.', visualHtml:'<svg class="chart"></svg>',
    tabelaHtml:'<div class="tbl"></div>', sql:'SELECT a < b', quando:'13/10/2026 09:05', motor:'PostgreSQL', base:'erp', contato:'cd2.com.br · (11) 0000-0000', logoSvg:'<svg class="logo"></svg>' });
  assert.ok(!h.includes('<script>')); assert.ok(h.includes('&lt;script&gt;')); assert.ok(h.includes('Vendas &amp; cia'));
  assert.ok(h.includes('<svg class="chart"></svg>')); assert.ok(h.includes('SELECT a &lt; b'));
  assert.ok(h.includes('cd2.com.br · (11) 0000-0000')); assert.ok(h.includes('Mostrando 20.'));
  assert.ok(h.includes('PostgreSQL')); assert.ok(h.includes('erp'));
  const sem = R.printHtml({ pergunta:'p', titulo:'t', frase:'f', visualHtml:'', tabelaHtml:'', sql:'s', quando:'q', motor:'m', base:'', contato:'', logoSvg:'' });
  assert.ok(sem.includes('CD2 Tech</footer>') || /CD2 Tech\s*<\/span>\s*<\/footer>/.test(sem));
  assert.ok(!sem.includes('undefined'));
});

test('toCsv nao deixa fórmula escapar por espaço, tabulação, CR ou número seguido de texto', () => {
  const casos = [
    ['-1+1', "'-1+1"],
    ["-1+cmd|' /C calc'!A0", "'-1+cmd|' /C calc'!A0"],
    ['\t=1', "'\t=1"],
    [' =1', "' =1"],
    ['\r=1', "\"'\r=1\""],
  ];
  for (const [entrada, esperado] of casos) {
    const linha = R.toCsv(['a'], [{ a: entrada }]).slice(1).split('\r\n')[1];
    assert.equal(linha, esperado, 'entrada ' + JSON.stringify(entrada));
  }
});
