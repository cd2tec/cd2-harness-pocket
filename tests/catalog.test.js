'use strict';
// Testes do mapa do banco (web/catalog.js). Rodar: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../web/catalog.js');

const ROWS = [
  ['mov_venda','TABLE',6000,'nr_cupom','integer',1], ['mov_venda','TABLE',6000,'cd_loja','integer',2],
  ['mov_venda','TABLE',6000,'cd_cli','integer',3], ['mov_venda','TABLE',6000,'dt_mov','date',4],
  ['mov_venda','TABLE',6000,'vlr_tot','numeric(12,2)',5],
  ['mov_venda_item','TABLE',18000,'nr_cupom','integer',1], ['mov_venda_item','TABLE',18000,'seq','integer',2],
  ['mov_venda_item','TABLE',18000,'cd_prod','integer',3], ['mov_venda_item','TABLE',18000,'qtd_it','integer',4],
  ['mov_venda_item','TABLE',18000,'vlr_tot_it','numeric(12,2)',5],
  ['produto','TABLE',120,'cd_prod','integer',1], ['produto','TABLE',120,'ds_prod','varchar(80)',2],
  ['produto','TABLE',120,'cd_depto','integer',3], ['produto','TABLE',120,'vlr_custo','numeric(10,2)',4],
  ['loja','TABLE',4,'cd_loja','integer',1], ['loja','TABLE',4,'nm_loja','varchar(40)',2], ['loja','TABLE',4,'uf','char(2)',3],
  ['cliente','TABLE',300,'cd_cli','integer',1], ['cliente','TABLE',300,'nm_cli','varchar(80)',2],
  ['cliente','TABLE',300,'uf','char(2)',3], ['cliente','TABLE',300,'dt_cad','date',4],
  ['log_integracao','TABLE',50000,'id','bigint',1], ['log_integracao','TABLE',50000,'dt_log','timestamp without time zone',2],
  ['log_integracao','TABLE',50000,'msg','text',3],
  ['v_resumo','VIEW',0,'mes','text',1]
].map(([table_name, table_type, num_rows, column_name, data_type, ordinal]) => ({ table_name, table_type, num_rows, column_name, data_type, ordinal }));
const CAT = C.buildCatalog(ROWS);

test('tokens: separa _, camelCase e prefixos de ERP, tira acento e plural', () => {
  assert.deepEqual(C.tokens('VLR_TOT_IT'), ['vlr', 'tot', 'it']);
  assert.deepEqual(C.tokens('DtMov'), ['dt', 'mov']);
  assert.deepEqual(C.tokens('dtmov'), ['dt', 'mov']);
  assert.deepEqual(C.tokens('codprod'), ['cod', 'prod']);
  assert.deepEqual(C.tokens('produtoid'), ['produto', 'id']);
  assert.deepEqual(C.tokens('Vendas Ação'), ['venda', 'acao']);
  assert.deepEqual(C.tokens('total'), ['total']);
  assert.deepEqual(C.tokens(null), []);
});

test('kindOf: tipos dos quatro motores', () => {
  const casos = { 'numeric(12,2)':'numero', 'NUMBER':'numero', 'bigint':'numero', 'decimal':'numero', 'money':'numero', 'float':'numero',
    'date':'data', 'DATE':'data', 'timestamp without time zone':'data', 'datetime2':'data', 'TIMESTAMP(6)':'data',
    'varchar(80)':'texto', 'nvarchar':'texto', 'text':'texto', 'CLOB':'texto', 'char(2)':'texto',
    'interval':'outro', 'bit':'outro', 'boolean':'outro', 'bytea':'outro', '':'outro' };
  for(const [t, k] of Object.entries(casos)) assert.equal(C.kindOf(t), k, t);
});

test('buildCatalog agrupa por tabela, marca view, converte num_rows e aceita chaves em maiúsculas', () => {
  assert.equal(CAT.tables.length, 7);
  const v = CAT.tables.find(t => t.name === 'mov_venda');
  assert.equal(v.rows, 6000); assert.equal(v.type, 'TABLE');
  assert.deepEqual(v.columns.map(c => c.kind), ['numero', 'numero', 'numero', 'data', 'numero']);
  assert.equal(CAT.tables.find(t => t.name === 'v_resumo').type, 'VIEW');
  const up = C.buildCatalog([{ TABLE_NAME:'PEDIDO', TABLE_TYPE:'TABLE', NUM_ROWS:'42', COLUMN_NAME:'VALOR', DATA_TYPE:'NUMBER', ORDINAL:1 }]);
  assert.equal(up.tables[0].name, 'PEDIDO'); assert.equal(up.tables[0].rows, 42); assert.equal(up.tables[0].columns[0].kind, 'numero');
  assert.equal(C.buildCatalog(null).tables.length, 0);
});

test('buildCatalog corta em 60 colunas por tabela', () => {
  const rows = Array.from({ length:70 }, (_, i) => ({ table_name:'larga', table_type:'TABLE', num_rows:1, column_name:'c' + i, data_type:'int', ordinal:i + 1 }));
  assert.equal(C.buildCatalog(rows).tables[0].columns.length, 60);
});

test('rankTables: faturamento por mês escolhe a tabela de vendas com data', () => {
  const r = C.rankTables(CAT, 'Qual o faturamento por mês?');
  assert.equal(r[0].name, 'mov_venda');
  assert.ok(r.findIndex(t => t.name === 'log_integracao') !== 0);
  assert.ok(r.length <= 5);
  assert.deepEqual(Object.keys(r[0]).sort(), ['columns', 'name', 'rows', 'score', 'type']);
});

test('rankTables: produtos mais vendidos traz produto e itens de venda', () => {
  const nomes = C.rankTables(CAT, 'produtos mais vendidos').slice(0, 3).map(t => t.name);
  assert.ok(nomes.includes('produto'), nomes.join());
  assert.ok(nomes.includes('mov_venda_item'), nomes.join());
});

test('rankTables: sem nenhuma palavra em comum devolve lista vazia', () => {
  assert.deepEqual(C.rankTables(CAT, 'quantos funcionários'), []);
  assert.deepEqual(C.rankTables({ tables:[] }, 'vendas'), []);
});

test('rankTables: até 25 colunas, priorizando a que bateu com a pergunta, na ordem original', () => {
  const rows = Array.from({ length:40 }, (_, i) => ({ table_name:'pedido', table_type:'TABLE', num_rows:10, column_name:i === 38 ? 'vlr_frete' : 'campo' + i, data_type:'varchar(10)', ordinal:i + 1 }));
  const r = C.rankTables(C.buildCatalog(rows), 'frete dos pedidos');
  assert.equal(r[0].columns.length, 25);
  assert.ok(r[0].columns.some(c => c.name === 'vlr_frete'));
  assert.equal(r[0].columns[r[0].columns.length - 1].name, 'vlr_frete');
});

test('suggest: quatro perguntas tiradas do esquema, sem tabela de log', () => {
  assert.deepEqual(C.suggest(CAT), [
    'Total por mês em mov venda',
    'Top 10 de produto por vlr custo',
    'Quantos registros tem mov venda item',
    'Quantos registros tem cliente'
  ]);
  assert.deepEqual(C.suggest({ tables:[] }), []);
  assert.deepEqual(C.suggest(null), []);
});

test('humanize', () => {
  assert.equal(C.humanize('MOV_VENDA'), 'mov venda');
  assert.equal(C.humanize('cd_prod'), 'cd prod');
  assert.equal(C.humanize('id'), 'id');
});
