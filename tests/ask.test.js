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

const Cat = require('../web/catalog.js');
const CAT2 = Cat.buildCatalog([
  { table_name:'venda', table_type:'TABLE', num_rows:100, column_name:'dt_venda', data_type:'date', ordinal:1 },
  { table_name:'venda', table_type:'TABLE', num_rows:100, column_name:'valor', data_type:'numeric', ordinal:2 },
  { table_name:'venda', table_type:'TABLE', num_rows:100, column_name:'loja', data_type:'varchar(20)', ordinal:3 },
  { table_name:'config', table_type:'TABLE', num_rows:5, column_name:'chave', data_type:'text', ordinal:1 }
]);
function fila(respostas){
  const calls = [];
  const fn = async (...args) => { calls.push(args); const r = respostas.shift(); if(r instanceof Error) throw r; return r; };
  fn.calls = calls; return fn;
}
const J = o => JSON.stringify(o);
const BARRA = J({ sql:'SELECT loja, SUM(valor) AS total FROM venda GROUP BY loja', visual:'barra', x:'loja', y:'total', titulo:'Vendas por loja' });
const LINHAS = [{ loja:'A', total:'10' }, { loja:'B', total:'30' }];
const base = o => Object.assign({ pergunta:'vendas por loja', catalog:CAT2, motor:'postgres', versao:'PostgreSQL 16' }, o);

test('ask: caminho feliz com uma chamada ao modelo', async () => {
  const callModel = fila([BARRA]), runSql = fila([{ ok:true, rows:LINHAS }]);
  const r = await A.ask(base({ callModel, runSql }));
  assert.equal(r.ok, true); assert.equal(r.visual, 'barra'); assert.equal(r.titulo, 'Vendas por loja');
  assert.equal(r.frase, 'Maior: B, 30. Total: 40 em 2 categorias.');
  assert.deepEqual(r.colunas, ['loja', 'total']); assert.equal(r.todas.length, 2);
  assert.equal(callModel.calls.length, 1); assert.equal(runSql.calls[0][0], 'SELECT loja, SUM(valor) AS total FROM venda GROUP BY loja');
  const prompt = callModel.calls[0][0].map(m => m.content).join('\n');
  assert.match(prompt, /venda/); assert.doesNotMatch(prompt, /config/);
});

test('ask: sem tabelas não chama o modelo', async () => {
  const callModel = fila([]);
  assert.deepEqual(await A.ask(base({ pergunta:'funcionários admitidos', callModel, runSql:fila([]) })), { ok:false, motivo:'sem_tabelas' });
  assert.equal(callModel.calls.length, 0);
});

test('ask: JSON inválido usa a nova tentativa; duas vezes inválido é motivo modelo', async () => {
  const callModel = fila(['não sei', BARRA]);
  const r = await A.ask(base({ callModel, runSql:fila([{ ok:true, rows:LINHAS }]) }));
  assert.equal(r.ok, true); assert.equal(callModel.calls.length, 2);
  assert.match(callModel.calls[1][0][1].content, /tentativa anterior falhou/);
  assert.deepEqual(await A.ask(base({ callModel:fila(['x', 'y']), runSql:fila([]) })), { ok:false, motivo:'modelo' });
});

test('ask: erro de SQL volta ao modelo com o erro; segundo erro é motivo sql', async () => {
  const callModel = fila([BARRA, BARRA]);
  const r = await A.ask(base({ callModel, runSql:fila([{ ok:false, error:'column "lojaa" does not exist' }, { ok:true, rows:LINHAS }]) }));
  assert.equal(r.ok, true);
  assert.match(callModel.calls[1][0][1].content, /column "lojaa" does not exist/);
  assert.match(callModel.calls[1][0][1].content, /SUM\(valor\)/);
  const r2 = await A.ask(base({ callModel:fila([BARRA, BARRA]), runSql:fila([{ ok:false, error:'e1' }, { ok:false, error:'e2' }]) }));
  assert.deepEqual(r2, { ok:false, motivo:'sql', sql:'SELECT loja, SUM(valor) AS total FROM venda GROUP BY loja' });
});

test('ask: SQL recusado pela guarda conta como erro de SQL e não vai ao banco', async () => {
  const runSql = fila([{ ok:true, rows:LINHAS }]);
  const r = await A.ask(base({ callModel:fila([J({ sql:'DELETE FROM venda', visual:'tabela' }), BARRA]), runSql }));
  assert.equal(r.ok, true); assert.equal(runSql.calls.length, 1);
});

test('ask: timeout não tenta de novo; vazio é motivo vazio', async () => {
  const callModel = fila([BARRA]);
  assert.deepEqual(await A.ask(base({ callModel, runSql:fila([{ ok:false, timeout:true, error:'tempo esgotado' }]) })),
    { ok:false, motivo:'timeout', sql:'SELECT loja, SUM(valor) AS total FROM venda GROUP BY loja' });
  assert.equal(callModel.calls.length, 1);
  assert.equal((await A.ask(base({ callModel:fila([BARRA]), runSql:fila([{ ok:true, rows:[] }]) }))).motivo, 'vazio');
});

test('ask: modelo fora do ar é motivo modelo; Parar propaga o AbortError', async () => {
  assert.deepEqual(await A.ask(base({ callModel:fila([new Error('HTTP 500')]), runSql:fila([]) })), { ok:false, motivo:'modelo' });
  const ab = new Error('parou'); ab.name = 'AbortError';
  await assert.rejects(A.ask(base({ callModel:fila([ab]), runSql:fila([]) })), { name:'AbortError' });
});

test('ask: no SQL Server o ORDER BY sem TOP ganha OFFSET 0 ROWS', async () => {
  const runSql = fila([{ ok:true, rows:LINHAS }]);
  await A.ask(base({ motor:'sqlserver', callModel:fila([J({ sql:'SELECT loja, SUM(valor) AS total FROM venda GROUP BY loja ORDER BY total DESC', visual:'barra', x:'loja', y:'total', titulo:'t' })]), runSql }));
  assert.match(runSql.calls[0][0], /OFFSET 0 ROWS$/);
});

test('buildMessages: dialeto e exemplos por motor, tabelas listadas, tentativa anterior', () => {
  const tabelas = Cat.rankTables(CAT2, 'vendas');
  const sys = m => A.buildMessages({ pergunta:'p', tabelas, motor:m })[0].content;
  assert.match(sys('postgres'), /LIMIT 10/); assert.match(sys('sqlserver'), /TOP \(10\)/); assert.match(sys('oracle'), /FETCH FIRST 10 ROWS ONLY/);
  assert.match(sys('mariadb'), /DATE_FORMAT/); assert.match(sys('postgres'), /venda \(cerca de 100 linhas\): dt_venda date, valor numeric, loja varchar\(20\)/);
  const u = A.buildMessages({ pergunta:'p', tabelas, motor:'postgres', anterior:{ sql:'SELECT x', erro:'boom' } })[1].content;
  assert.match(u, /SQL anterior: SELECT x/); assert.match(u, /Erro: boom/);
});

test('modelCaller: temperatura zero, schema opcional, conteúdo da resposta e erro HTTP', async () => {
  let pedido;
  const ok = async (url, init) => { pedido = { url, init }; return { ok:true, status:200, json:async () => ({ choices:[{ message:{ content:'{"a":1}' } }] }) }; };
  const c = A.modelCaller({ fetch:ok, url:'/v1/chat/completions', useSchema:true });
  assert.equal(await c([{ role:'user', content:'oi' }]), '{"a":1}');
  const body = JSON.parse(pedido.init.body);
  assert.equal(pedido.url, '/v1/chat/completions'); assert.equal(body.temperature, 0); assert.equal(body.stream, false); assert.equal(body.max_tokens, 1024);
  assert.equal(body.response_format.type, 'json_schema'); assert.deepEqual(body.response_format.json_schema.schema, A.SCHEMA);
  await A.modelCaller({ fetch:ok, url:'/x', useSchema:false })([]);
  assert.equal(JSON.parse(pedido.init.body).response_format, undefined);
  const falha = A.modelCaller({ fetch:async () => ({ ok:false, status:500, json:async () => ({}) }), url:'/x' });
  await assert.rejects(falha([]), /HTTP 500/);
});

test('toolRunner: linhas, erro de timeout do banco e prazo do front', async () => {
  const cli = t => ({ call:async (name, args) => { assert.equal(name, 'db_read_only_query'); assert.equal(args.sql, 'SELECT 1'); return t; } });
  assert.deepEqual(await A.toolRunner(cli('[{"n":1}]'), { timeoutMs:1000 })('SELECT 1'), { ok:true, rows:[{ n:1 }] });
  const t = await A.toolRunner(cli('ERRO: canceling statement due to statement timeout'), { timeoutMs:1000 })('SELECT 1');
  assert.equal(t.ok, false); assert.equal(t.timeout, true);
  const lento = await A.toolRunner({ call:() => new Promise(() => {}) }, { timeoutMs:20 })('SELECT 1');
  assert.equal(lento.timeout, true);
  const caiu = await A.toolRunner({ call:async () => { throw new Error('MCP respondeu HTTP 502'); } }, { timeoutMs:1000 })('SELECT 1');
  assert.deepEqual(caiu, { ok:false, error:'MCP respondeu HTTP 502' });
});

test('toolRunner: o prazo aborta o signal passado ao cliente', async () => {
  let visto;
  const cli = { call:(name, args, signal) => { visto = signal; return new Promise(() => {}); } };
  const r = await A.toolRunner(cli, { timeoutMs:20 })('SELECT 1');
  assert.equal(r.ok, false); assert.equal(r.timeout, true); assert.equal(r.front, true);
  assert.ok(visto && visto.aborted);
});

test('toolRunner: Parar aborta o fetch e rejeita com AbortError', async () => {
  let visto;
  const cli = { call:(name, args, signal) => { visto = signal; return new Promise(() => {}); } };
  const ctl = new AbortController();
  const p = A.toolRunner(cli, { timeoutMs:5000 })('SELECT 1', ctl.signal);
  setTimeout(() => ctl.abort(), 10);
  await assert.rejects(p, { name:'AbortError' });
  assert.ok(visto.aborted);
});

test('ask: Parar depois de a consulta voltar não mostra resposta', async () => {
  const ctl = new AbortController();
  const runSql = async () => { ctl.abort(); return { ok:true, rows:LINHAS }; };
  await assert.rejects(A.ask(base({ callModel:fila([BARRA]), runSql, signal:ctl.signal })), { name:'AbortError' });
  const ctl2 = new AbortController();
  const callModel = async () => { ctl2.abort(); return BARRA; };
  const rs = fila([{ ok:true, rows:LINHAS }]);
  await assert.rejects(A.ask(base({ callModel, runSql:rs, signal:ctl2.signal })), { name:'AbortError' });
  assert.equal(rs.calls.length, 0);
});
