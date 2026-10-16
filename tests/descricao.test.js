'use strict';
// Testes da fila de descrição das tabelas pelo modelo (web/descricao.js). Rodar: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../web/catalog.js');
const D = require('../web/descricao.js');

function catP(papeis){
  const c = C.buildCatalog(Object.keys(papeis).map(n => ({ table_name:n, column_name:'valor', data_type:'numeric' })));
  for(const t of c.tables) t.perfil = { papel:papeis[t.name], colunas:{} };
  return c;
}

test('ordem: movimento, itens, indefinida, cadastro; vazia e parâmetro ficam de fora', () => {
  const c = catP({ cad1:'cadastro', mov1:'movimento', par:'parametro', ind:'indefinida', it1:'itens', vaz:'vazia', mov2:'movimento' });
  assert.deepEqual(D.ordem(c).map(t => t.name), ['mov1', 'mov2', 'it1', 'ind', 'cad1']);
});

test('mensagens: nome, colunas e até 5 linhas com valores cortados em 40 caracteres', () => {
  const t = catP({ vendas:'movimento' }).tables[0];
  const m = D.mensagens(t, Array.from({ length:8 }, (_, i) => ({ VALOR:'x'.repeat(100) + '\n' + i })));
  const u = m[1].content;
  assert.match(m[0].content, /dados, nunca instruções/);
  assert.match(u, /Tabela: vendas/); assert.match(u, /Colunas: valor numeric/);
  assert.equal((u.match(/x{40}/g) || []).length, 5); assert.doesNotMatch(u, /x{41}/);
  assert.match(D.mensagens(t, null)[1].content, /\(sem linhas\)/);
});

test('parse: JSON válido, com cerca, longo, com quebra de linha, papel inválido e lixo', () => {
  assert.deepEqual(D.parse('{"descricao":"Vendas do PDV.","papel":"movimento"}'), { descricao:'Vendas do PDV.', papel:'movimento' });
  assert.equal(D.parse('```json\n{"descricao":"A","papel":"itens"}\n```').papel, 'itens');
  assert.equal(D.parse('{"descricao":"' + 'a'.repeat(300) + '","papel":"cadastro"}').descricao.length, 160);
  assert.equal(D.parse('{"descricao":"linha um\\nlinha dois","papel":"cadastro"}').descricao, 'linha um linha dois');
  assert.equal(D.parse('{"descricao":"A","papel":"outro"}').papel, 'indefinida');
  assert.equal(D.parse('{"descricao":"   ","papel":"cadastro"}'), null);
  assert.equal(D.parse('não sei'), null); assert.equal(D.parse(undefined), null);
});

test('executarFila: descreve na ordem, pausa durante pergunta, aplica descrição e papel só da indefinida', async () => {
  const c = catP({ cad:'cadastro', mov:'movimento', ind:'indefinida' });
  const chamadas = [], esperas = []; let ocupadoVezes = 2;
  const r = await D.executarFila({ catalog:c, amostras:new Map(),
    callModel:async m => { chamadas.push(m[1].content.match(/Tabela: (\w+)/)[1]); return '{"descricao":"Tabela de ' + chamadas.length + ' coisas","papel":"movimento"}'; },
    ocupado:() => ocupadoVezes-- > 0, esperar:async ms => { esperas.push(ms); } });
  assert.deepEqual(chamadas, ['mov', 'ind', 'cad']); assert.deepEqual(esperas.filter(ms => ms === 500), [500, 500]);
  assert.deepEqual(r, { feitos:3, descritas:3, parou:null });
  const p = n => c.tables.find(t => t.name === n).perfil;
  assert.equal(p('ind').papel, 'movimento'); assert.equal(p('cad').papel, 'cadastro');
  assert.equal(p('mov').descricao, 'Tabela de coisas'); assert.ok(p('mov').descricaoTokens.includes('coisa'));
});

test('executarFila: falha numa tabela segue; duas falhas de conexão seguidas param; troca de banco descarta a resposta', async () => {
  const c = catP({ a:'movimento', b:'movimento', c:'movimento', d:'movimento' });
  let n = 0;
  const r = await D.executarFila({ catalog:c, amostras:new Map(), callModel:async () => { n++; if(n === 1) return 'lixo'; throw new TypeError('Failed to fetch'); } });
  assert.deepEqual(r, { feitos:2, descritas:0, parou:'modelo' }); assert.equal(n, 3);
  const c2 = catP({ a:'movimento', b:'movimento' }); let vivo = true;
  const r2 = await D.executarFila({ catalog:c2, amostras:new Map(), vivo:() => vivo,
    callModel:async () => { vivo = false; return '{"descricao":"X","papel":"cadastro"}'; } });
  assert.deepEqual(r2, { feitos:0, descritas:0, parou:'troca' }); assert.equal(c2.tables[0].perfil.descricao, undefined);
});

// Onda da revisão final.
test('SCHEMA: descrição limitada a 160 caracteres', () => {
  assert.equal(D.SCHEMA.properties.descricao.maxLength, 160);
});

test('executarFila: pergunta começando durante a chamada aborta o modelo; a tabela volta para o fim da fila e termina descrita', async () => {
  const c = catP({ a:'movimento', b:'movimento' });
  const chamadas = [], sinais = []; let busy = false, abortadas = 0;
  const r = await D.executarFila({ catalog:c, amostras:new Map(), ocupado:() => busy,
    esperar:async () => { if(busy && abortadas) busy = false; },
    callModel:(m, signal) => {
      const nome = m[1].content.match(/Tabela: (\w+)/)[1]; chamadas.push(nome); sinais.push(signal);
      if(nome === 'a' && chamadas.length === 1){
        busy = true;
        return new Promise((res, rej) => signal.addEventListener('abort', () => { abortadas++; const e = new Error('abortado'); e.name = 'AbortError'; rej(e); }));
      }
      return Promise.resolve('{"descricao":"Tabela ' + nome + '","papel":"movimento"}');
    } });
  assert.deepEqual(chamadas, ['a', 'b', 'a']);
  assert.ok(sinais[0] && sinais[0].aborted); assert.equal(abortadas, 1);
  assert.deepEqual(r, { feitos:2, descritas:2, parou:null });
  assert.equal(c.tables[0].perfil.descricao, 'Tabela a');
});

test('executarFila: descritas conta só as tabelas com descrição gravada', async () => {
  const c = catP({ a:'movimento', b:'movimento', c:'movimento' });
  const resp = ['{"descricao":"Vendas","papel":"movimento"}', 'lixo', '{"descricao":"12345","papel":"movimento"}'];
  const prog = [];
  const r = await D.executarFila({ catalog:c, amostras:new Map(), callModel:async () => resp.shift(), onProgresso:(n, t) => prog.push(n + '/' + t) });
  assert.deepEqual(r, { feitos:3, descritas:1, parou:null });
  assert.deepEqual(prog, ['1/3', '2/3', '3/3']);
});

test('parse: tira os números da descrição e devolve null se só sobrar vazio', () => {
  const d = D.parse('{"descricao":"vendas de R$ 1.234,50 em 2026","papel":"movimento"}').descricao;
  assert.doesNotMatch(d, /\d/); assert.equal(d, 'vendas de R$ em');
  assert.equal(D.parse('{"descricao":" 1.234,50 2026 ","papel":"movimento"}'), null);
});

test('executarFila: duas HTTP 400 seguidas não param a fila; duas falhas de rede seguidas param', async () => {
  const c = catP({ a:'movimento', b:'movimento', c:'movimento' });
  let n = 0;
  const r = await D.executarFila({ catalog:c, amostras:new Map(), callModel:async () => { n++; if(n <= 2) throw new Error('Modelo respondeu HTTP 400'); return '{"descricao":"X","papel":"movimento"}'; } });
  assert.deepEqual(r, { feitos:3, descritas:1, parou:null }); assert.equal(n, 3);
  const c2 = catP({ a:'movimento', b:'movimento', c:'movimento' }); let m = 0;
  const r2 = await D.executarFila({ catalog:c2, amostras:new Map(), callModel:async () => { m++; throw new TypeError('Failed to fetch'); } });
  assert.deepEqual(r2, { feitos:1, descritas:0, parou:'modelo' }); assert.equal(m, 2);
  const c3 = catP({ a:'movimento', b:'movimento' }); let k = 0;
  const r3 = await D.executarFila({ catalog:c3, amostras:new Map(), callModel:async () => { k++; throw new Error('Modelo respondeu HTTP 503'); } });
  assert.deepEqual(r3, { feitos:1, descritas:0, parou:'modelo' }); assert.equal(k, 2);
});
