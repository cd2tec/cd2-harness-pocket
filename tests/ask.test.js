'use strict';
// Testes do roteiro de relatórios (web/ask.js). Rodar: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../web/ask.js');

test('parseRows: array, objeto, uma linha por objeto, vazio, erro e lixo', () => {
  assert.deepEqual(A.parseRows('[{"a":1},{"a":2}]'), { ok:true, rows:[{ a:1 }, { a:2 }] });
  assert.deepEqual(A.parseRows('{"a":1}'), { ok:true, rows:[{ a:1 }] });
  assert.deepEqual(A.parseRows('{"a":1}\n{"a":2}'), { ok:true, rows:[{ a:1 }, { a:2 }] });
  assert.deepEqual(A.parseRows(''), { ok:true, rows:[] });
  assert.deepEqual(A.parseRows('null'), { ok:true, rows:[] });
  assert.deepEqual(A.parseRows('ERRO: boom'), { ok:false, error:'boom' });
  const r = A.parseRows('texto qualquer'); assert.equal(r.ok, false); assert.match(r.error, /inesperada/);
});

test('parseModelJson: JSON puro, com cerca de código, com raciocínio, e recusas', () => {
  const j = '{"sql":" SELECT 1 ","visual":"numero","x":"","y":"n","titulo":"Total"}';
  assert.deepEqual(A.parseModelJson(j), { sql:'SELECT 1', visual:'numero', x:'', y:'n', titulo:'Total' });
  assert.equal(A.parseModelJson('```json\n' + j + '\n```').sql, 'SELECT 1');
  assert.equal(A.parseModelJson('<think>hmm {x}</think>\n' + j).visual, 'numero');
  assert.deepEqual(A.parseModelJson('{"sql":"SELECT 1","visual":"barra"}'), { sql:'SELECT 1', visual:'barra', x:'', y:'', titulo:'' });
  assert.equal(A.parseModelJson('{"sql":"SELECT 1","visual":"radar"}'), null);
  assert.equal(A.parseModelJson('{"visual":"barra"}'), null);
  assert.equal(A.parseModelJson('não sei'), null);
  assert.equal(A.parseModelJson(undefined), null);
});

test('isTimeout reconhece as mensagens dos motores', () => {
  for(const m of ['ERROR: canceling statement due to statement timeout (SQLSTATE 57014)', 'context deadline exceeded',
    'Query execution was interrupted (max_statement_time exceeded)', 'Query execution was interrupted, maximum statement execution time exceeded',
    'unable to execute query: invalid connection', 'ORA-01013: user requested cancel of current operation', 'tempo esgotado'])
    assert.equal(A.isTimeout(m), true, m);
  assert.equal(A.isTimeout('column "x" does not exist'), false);
  assert.equal(A.isTimeout(undefined), false);
});

const L = (n, f) => Array.from({ length:n }, (_, i) => f(i));

test('pickVisual: x ou y fora do resultado, ou y não numérico, vira tabela', () => {
  const linhas = [{ loja:'A', total:1 }, { loja:'B', total:2 }];
  assert.equal(A.pickVisual({ visual:'barra', x:'nada', y:'total' }, ['loja', 'total'], linhas).visual, 'tabela');
  assert.equal(A.pickVisual({ visual:'barra', x:'total', y:'loja' }, ['loja', 'total'], linhas).visual, 'tabela');
  assert.equal(A.pickVisual({ visual:'tabela', x:'loja', y:'total' }, ['loja', 'total'], linhas).visual, 'tabela');
});

test('pickVisual: casa x e y sem diferenciar caixa (Oracle devolve MES, TOTAL)', () => {
  const r = A.pickVisual({ visual:'linha', x:'mes', y:'total' }, ['MES', 'TOTAL'], [{ MES:'2026-01', TOTAL:'5' }, { MES:'2026-02', TOTAL:'7' }]);
  assert.deepEqual([r.visual, r.x, r.y], ['linha', 'MES', 'TOTAL']);
});

test('pickVisual: y numérico em texto é número', () => {
  const r = A.pickVisual({ visual:'barra', x:'d', y:'v' }, ['d', 'v'], [{ d:'A', v:'10.50' }, { d:'B', v:'20.25' }]);
  assert.equal(r.visual, 'barra'); assert.deepEqual(r.linhas.map(l => l.d), ['B', 'A']);
});

test('pickVisual: uma linha de uma coluna numérica vira número; número com várias linhas vira tabela', () => {
  assert.deepEqual(A.pickVisual({ visual:'barra', x:'', y:'' }, ['n'], [{ n:'42' }]).visual, 'numero');
  const r = A.pickVisual({ visual:'numero', x:'', y:'total' }, ['loja', 'total'], [{ loja:'A', total:3 }]);
  assert.deepEqual([r.visual, r.y], ['numero', 'total']);
  assert.equal(A.pickVisual({ visual:'numero', x:'', y:'n' }, ['n'], [{ n:1 }, { n:2 }]).visual, 'tabela');
});

test('pickVisual: pizza com mais de 6 fatias ou valor negativo vira barra', () => {
  assert.equal(A.pickVisual({ visual:'pizza', x:'d', y:'v' }, ['d', 'v'], L(7, i => ({ d:'d' + i, v:i + 1 }))).visual, 'barra');
  assert.equal(A.pickVisual({ visual:'pizza', x:'d', y:'v' }, ['d', 'v'], [{ d:'a', v:5 }, { d:'b', v:-1 }]).visual, 'barra');
  assert.equal(A.pickVisual({ visual:'pizza', x:'d', y:'v' }, ['d', 'v'], L(6, i => ({ d:'d' + i, v:i + 1 }))).visual, 'pizza');
});

test('pickVisual: linha sem eixo de tempo vira barra; com tempo, ordena pelo tempo', () => {
  assert.equal(A.pickVisual({ visual:'linha', x:'loja', y:'v' }, ['loja', 'v'], [{ loja:'A', v:1 }, { loja:'B', v:2 }]).visual, 'barra');
  const r = A.pickVisual({ visual:'linha', x:'mes', y:'v' }, ['mes', 'v'], [{ mes:'2026-03', v:1 }, { mes:'2026-01', v:2 }, { mes:'2026-02', v:3 }]);
  assert.equal(r.visual, 'linha'); assert.deepEqual(r.linhas.map(l => l.mes), ['2026-01', '2026-02', '2026-03']);
  const n = A.pickVisual({ visual:'linha', x:'mes', y:'v' }, ['mes', 'v'], [{ mes:3, v:1 }, { mes:1, v:2 }]);
  assert.equal(n.visual, 'linha'); assert.deepEqual(n.linhas.map(l => l.mes), [1, 3]);
});

test('pickVisual: barra com mais de 20 mostra as 20 maiores e avisa; barra no tempo fica em ordem de tempo', () => {
  const r = A.pickVisual({ visual:'barra', x:'d', y:'v' }, ['d', 'v'], L(25, i => ({ d:'d' + i, v:i })));
  assert.equal(r.linhas.length, 20); assert.equal(r.linhas[0].v, 24); assert.equal(r.aviso, 'Mostrando os 20 maiores de 25.');
  const t = A.pickVisual({ visual:'barra', x:'mes', y:'v' }, ['mes', 'v'], [{ mes:'2026-02', v:9 }, { mes:'2026-01', v:1 }]);
  assert.deepEqual(t.linhas.map(l => l.mes), ['2026-01', '2026-02']); assert.equal(t.aviso, null);
});

test('frase: número, barra, linha e tabela', () => {
  assert.equal(A.frase({ visual:'numero', y:'n', linhas:[{ n:'1234' }], todas:[{ n:'1234' }] }), 'Resultado: 1.234.');
  const b = [{ d:'B', v:30 }, { d:'A', v:20 }, { d:'C', v:10 }];
  assert.equal(A.frase({ visual:'barra', x:'d', y:'v', linhas:b, todas:b }), 'Maior: B, 30. Total: 60 em 3 categorias.');
  const l = [{ m:'2026-01-01', v:10 }, { m:'2026-02-01', v:30 }, { m:'2026-03-01', v:20 }];
  assert.equal(A.frase({ visual:'linha', x:'m', y:'v', linhas:l, todas:l }), 'De jan/2026 a mar/2026. Maior valor em fev/2026: 30.');
  assert.equal(A.frase({ visual:'tabela', linhas:L(12, () => ({})), todas:L(12, () => ({})) }), '12 linhas.');
  assert.equal(A.frase({ visual:'tabela', linhas:[{}], todas:[{}] }), '1 linha.');
});

test('frase: barra cortada em 20 soma todas as linhas', () => {
  const todas = L(25, i => ({ d:'d' + i, v:1 })), linhas = todas.slice(0, 20);
  assert.equal(A.frase({ visual:'barra', x:'d', y:'v', linhas, todas }), 'Maior: d0, 1. Total: 25 em 25 categorias.');
});

test('frase: sem Total para média, percentual ou taxa', () => {
  const b = [{ loja:'A', ticket_medio:'50.5' }, { loja:'B', ticket_medio:'40' }];
  assert.equal(A.frase({ visual:'barra', x:'loja', y:'ticket_medio', linhas:b, todas:b }), 'Maior: A, 50,5. 2 categorias.');
});

test('frase com nulo: rótulo (vazio) e valor tratado como zero', () => {
  const b = [{ d:null, v:'7' }, { d:'B', v:null }];
  assert.equal(A.frase({ visual:'barra', x:'d', y:'v', linhas:b, todas:b }), 'Maior: (vazio), 7. Total: 7 em 2 categorias.');
});

test('pickVisual: linha com datas brasileiras fica linha e ordena pelo tempo', () => {
  const t = (xs) => A.pickVisual({ visual:'linha', x:'d', y:'v' }, ['d', 'v'], xs.map((d, i) => ({ d, v:i + 1 })));
  for(const [entrada, esperado] of [
    [['15/02/2026', '15/01/2026'], ['15/01/2026', '15/02/2026']],
    [['02/2026', '01/2026'], ['01/2026', '02/2026']],
    [['fev/2026', 'jan/2026'], ['jan/2026', 'fev/2026']],
    [['mar/26', 'jan/26'], ['jan/26', 'mar/26']]]){
    const r = t(entrada); assert.equal(r.visual, 'linha', entrada.join()); assert.deepEqual(r.linhas.map(l => l.d), esperado);
  }
});

test('frase: MEDIA_RE casa só palavras inteiras', () => {
  const b = [{ d:'A', operate_total:5 }, { d:'B', operate_total:3 }];
  assert.equal(A.frase({ visual:'barra', x:'d', y:'operate_total', linhas:b, todas:b }), 'Maior: A, 5. Total: 8 em 2 categorias.');
  const c = [{ d:'A', taxa_conversao:5 }, { d:'B', taxa_conversao:3 }];
  assert.equal(A.frase({ visual:'barra', x:'d', y:'taxa_conversao', linhas:c, todas:c }), 'Maior: A, 5. 2 categorias.');
});

test('parseModelJson: visual sem diferenciar caixa e acento', () => {
  assert.equal(A.parseModelJson('{"sql":"SELECT 1","visual":"Barra"}').visual, 'barra');
  assert.equal(A.parseModelJson('{"sql":"SELECT 1","visual":"Número"}').visual, 'numero');
});

test('parseRows: ERRO com espaços antes', () => {
  assert.deepEqual(A.parseRows('  ERRO: x'), { ok:false, error:'x' });
});
