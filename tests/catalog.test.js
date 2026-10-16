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

test('tokens: plurais em português', () => {
  assert.deepEqual(C.tokens('itens'), ['item']);
  assert.deepEqual(C.tokens('cupons'), ['cupom']);
  assert.deepEqual(C.tokens('meses'), ['mes']);
  assert.deepEqual(C.tokens('promoções'), ['promocao']);
  assert.deepEqual(C.tokens('totais'), ['total']);
});

test('rankTables: cupons emitidos acha cupom_fiscal', () => {
  const cat = C.buildCatalog([{ table_name:'cupom_fiscal', table_type:'TABLE', num_rows:10, column_name:'valor', data_type:'numeric', ordinal:1 },
    { table_name:'loja', table_type:'TABLE', num_rows:2, column_name:'nome', data_type:'text', ordinal:1 }]);
  assert.equal(C.rankTables(cat, 'cupons emitidos')[0].name, 'cupom_fiscal');
});

test('rankTables: stop words com s final são filtradas depois do stem', () => {
  const cat = C.buildCatalog([{ table_name:'menos', table_type:'TABLE', num_rows:10, column_name:'x', data_type:'int', ordinal:1 }]);
  assert.deepEqual(C.rankTables(cat, 'menos vendas'), []);
});

test('humanize não faz stem nem separa prefixos', () => {
  assert.equal(C.humanize('status_pedidos'), 'status pedidos');
  assert.equal(C.humanize('itens'), 'itens');
  assert.equal(C.humanize('ValorTotal'), 'valor total');
});

test('tokens: prefixos e palavras inteiras', () => {
  assert.deepEqual(C.tokens('codigo'), ['codigo']);
  assert.deepEqual(C.tokens('nrocupom'), ['nro', 'cupom']);
  assert.deepEqual(C.tokens('totvenda'), ['tot', 'venda']);
  assert.deepEqual(C.tokens('idade'), ['idade']);
});

test('tokens: sufixo id só em palavras com 6+ letras', () => {
  assert.deepEqual(C.tokens('valid'), ['valid']);
  assert.deepEqual(C.tokens('pedidoid'), ['pedido', 'id']);
});

test('kindOf: texto antes de número, serial é número', () => {
  assert.equal(C.kindOf('enum'), 'texto');
  assert.equal(C.kindOf("enum('a','b')"), 'texto');
  assert.equal(C.kindOf('serial'), 'numero');
  assert.equal(C.kindOf('bigserial'), 'numero');
});

const MARCA = C.buildCatalog(ROWS.concat([
  { table_name:'marca', table_type:'TABLE', num_rows:30, column_name:'cd_marca', data_type:'integer', ordinal:1 },
  { table_name:'marca', table_type:'TABLE', num_rows:30, column_name:'ds_marca', data_type:'varchar(40)', ordinal:2 }
]));

test('rankTables: ticket médio acha a tabela de vendas', () => {
  assert.equal(C.rankTables(CAT, 'Qual o ticket médio?')[0].name, 'mov_venda');
});

test('rankTables: vendemos e vendeu casam com venda pelo sinônimo', () => {
  assert.equal(C.rankTables(CAT, 'Quanto vendemos em março de 2026?')[0].name, 'mov_venda');
  assert.equal(C.rankTables(CAT, 'Qual loja vendeu mais?')[0].name, 'mov_venda');
});

test('rankTables: março casa com coluna de data, não com a tabela marca', () => {
  const nomes = C.rankTables(MARCA, 'março').map(t => t.name);
  assert.ok(nomes.includes('mov_venda'), nomes.join());
  assert.ok(!nomes.includes('marca'), nomes.join());
});

test('rankTables: mov sozinho não é sinônimo de venda', () => {
  const cat = C.buildCatalog([{ table_name:'mov_estoque', table_type:'TABLE', num_rows:10, column_name:'qtd', data_type:'int', ordinal:1 }]);
  assert.deepEqual(C.rankTables(cat, 'vendas'), []);
});

test('rankTables: tabela com cara de log perde metade da nota, mas continua elegível', () => {
  const cat = C.buildCatalog([
    { table_name:'venda_log', table_type:'TABLE', num_rows:10, column_name:'valor', data_type:'numeric', ordinal:1 },
    { table_name:'venda', table_type:'TABLE', num_rows:10, column_name:'valor', data_type:'numeric', ordinal:1 }]);
  const r = C.rankTables(cat, 'vendas');
  assert.deepEqual(r.map(t => t.name), ['venda', 'venda_log']);
  assert.equal(r[1].score * 2, r[0].score);
});

test('questionTokens: stop words saem antes do stem (mais não vira mal)', () => {
  assert.deepEqual(C.questionTokens('Qual loja vendeu mais?'), ['loja', 'vendeu']);
  assert.deepEqual(C.questionTokens('Quais produtos temos?'), ['produto']);
});

test('suggest: não usa seq, ano, cep, mes, dia nem chave como medida', () => {
  const cat = C.buildCatalog(['seq', 'ano', 'cep', 'mes', 'dia', 'produto_id', 'nro_nota'].map((c, i) => ({ table_name:'item_nota', table_type:'TABLE', num_rows:100, column_name:c, data_type:'integer', ordinal:i + 1 }))
    .concat([{ table_name:'item_nota', table_type:'TABLE', num_rows:100, column_name:'ds_item', data_type:'varchar(40)', ordinal:9 }]));
  assert.deepEqual(C.suggest(cat), ['Quantos registros tem item nota']);
});

const tab = (...nomes) => CAT.tables.filter(t => nomes.includes(t.name));
test('links: liga as tabelas candidatas pela coluna-chave de mesmo nome', () => {
  const l = C.links(tab('mov_venda', 'mov_venda_item', 'produto', 'loja', 'cliente')).map(x => x.a + '.' + x.col + ' = ' + x.b + '.' + x.col);
  assert.ok(l.includes('mov_venda.nr_cupom = mov_venda_item.nr_cupom'), l.join('; '));
  assert.ok(l.includes('mov_venda_item.cd_prod = produto.cd_prod'), l.join('; '));
  assert.ok(l.includes('mov_venda.cd_loja = loja.cd_loja'), l.join('; '));
  assert.ok(l.includes('mov_venda.cd_cli = cliente.cd_cli'), l.join('; '));
  assert.ok(!l.some(x => /\.uf /.test(x)), 'uf não é chave: ' + l.join('; '));
  assert.ok(!l.some(x => /\.seq /.test(x)), 'seq não é chave');
  assert.deepEqual(C.links(tab('produto')), []);
  assert.deepEqual(C.links([]), []);
});

test('itemPairs: acha a tabela de itens do cabeçalho, nos dois jeitos de nomear', () => {
  assert.deepEqual(C.itemPairs(tab('mov_venda', 'mov_venda_item', 'produto')), [{ cab:'mov_venda', itens:'mov_venda_item', col:'nr_cupom' }]);
  const cat = C.buildCatalog([
    { table_name:'pedido', column_name:'nr_pedido', data_type:'int' }, { table_name:'pedido', column_name:'vlr_total', data_type:'numeric' },
    { table_name:'itens_pedido', column_name:'nr_pedido', data_type:'int' }, { table_name:'itens_pedido', column_name:'vlr_item', data_type:'numeric' }
  ]);
  assert.deepEqual(C.itemPairs(cat.tables), [{ cab:'pedido', itens:'itens_pedido', col:'nr_pedido' }]);
  assert.deepEqual(C.itemPairs(tab('mov_venda', 'produto')), []);
});

test('links: id ou codigo sozinho, presente em toda tabela, não vira ligação', () => {
  const cat = C.buildCatalog([
    { table_name:'pedido', column_name:'id', data_type:'int' }, { table_name:'pedido', column_name:'cliente_id', data_type:'int' },
    { table_name:'cliente', column_name:'id', data_type:'int' }, { table_name:'cliente', column_name:'codigo', data_type:'int' },
    { table_name:'fornecedor', column_name:'codigo', data_type:'int' }, { table_name:'fornecedor', column_name:'cliente_id', data_type:'int' }
  ]);
  assert.deepEqual(C.links(cat.tables).map(x => x.a + '.' + x.col + ' = ' + x.b + '.' + x.colB), [
    'pedido.cliente_id = fornecedor.cliente_id', 'pedido.cliente_id = cliente.id', 'fornecedor.cliente_id = cliente.id']);
});

test('links: <entidade>_id e id_<entidade> apontam para o id da tabela da entidade, no singular ou plural', () => {
  const cat = C.buildCatalog([
    { table_name:'sales_orders', column_name:'id', data_type:'int' }, { table_name:'sales_orders', column_name:'store_id', data_type:'int' },
    { table_name:'order_lines', column_name:'order_id', data_type:'int' }, { table_name:'order_lines', column_name:'product_id', data_type:'int' },
    { table_name:'stores', column_name:'id', data_type:'int' }, { table_name:'products', column_name:'id', data_type:'int' },
    { table_name:'products', column_name:'category_id', data_type:'int' }, { table_name:'categories', column_name:'id', data_type:'int' },
    { table_name:'vendas', column_name:'id_cliente', data_type:'int' }, { table_name:'clientes', column_name:'id', data_type:'int' }
  ]);
  const l = C.links(cat.tables).map(x => x.a + '.' + x.col + ' = ' + x.b + '.' + x.colB);
  for(const e of ['sales_orders.store_id = stores.id', 'order_lines.order_id = sales_orders.id', 'order_lines.product_id = products.id',
    'products.category_id = categories.id', 'vendas.id_cliente = clientes.id'])
    assert.ok(l.includes(e), e + ' | ' + l.join('; '));
  assert.ok(!l.some(x => /\.id = \w+\.id$/.test(x)), 'id com id não liga: ' + l.join('; '));
});

test('itemPairs: order_lines é itens de sales_orders pela referência order_id', () => {
  const cat = C.buildCatalog([
    { table_name:'sales_orders', column_name:'id', data_type:'int' }, { table_name:'sales_orders', column_name:'total_amount', data_type:'numeric' },
    { table_name:'order_lines', column_name:'order_id', data_type:'int' }, { table_name:'order_lines', column_name:'line_total', data_type:'numeric' },
    { table_name:'customers', column_name:'id', data_type:'int' }
  ]);
  assert.deepEqual(C.itemPairs(cat.tables), [{ cab:'sales_orders', itens:'order_lines', col:'order_id' }]);
});
