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
  assert.equal(D.parse('{"descricao":"linha 1\\nlinha 2","papel":"cadastro"}').descricao, 'linha 1 linha 2');
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
  assert.deepEqual(chamadas, ['mov', 'ind', 'cad']); assert.deepEqual(esperas, [500, 500]);
  assert.deepEqual(r, { feitos:3, parou:null });
  const p = n => c.tables.find(t => t.name === n).perfil;
  assert.equal(p('ind').papel, 'movimento'); assert.equal(p('cad').papel, 'cadastro');
  assert.equal(p('mov').descricao, 'Tabela de 1 coisas'); assert.ok(p('mov').descricaoTokens.includes('coisa'));
});

test('executarFila: falha numa tabela segue; duas falhas de conexão seguidas param; troca de banco descarta a resposta', async () => {
  const c = catP({ a:'movimento', b:'movimento', c:'movimento', d:'movimento' });
  let n = 0;
  const r = await D.executarFila({ catalog:c, amostras:new Map(), callModel:async () => { n++; if(n === 1) return 'lixo'; throw new Error('fora do ar'); } });
  assert.deepEqual(r, { feitos:2, parou:'modelo' }); assert.equal(n, 3);
  const c2 = catP({ a:'movimento', b:'movimento' }); let vivo = true;
  const r2 = await D.executarFila({ catalog:c2, amostras:new Map(), vivo:() => vivo,
    callModel:async () => { vivo = false; return '{"descricao":"X","papel":"cadastro"}'; } });
  assert.deepEqual(r2, { feitos:0, parou:'troca' }); assert.equal(c2.tables[0].perfil.descricao, undefined);
});
