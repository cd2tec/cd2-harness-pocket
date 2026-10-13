'use strict';
// Testes da lógica pura do modo "MCP Nativo para Banco de dados". Rodar: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../web/toolbox.js');

test('urlFor: porta do harness + 1000, sempre 127.0.0.1', () => {
  assert.equal(T.urlFor({ protocol:'http:', hostname:'localhost', port:'8080' }), 'http://127.0.0.1:9080/mcp');
  assert.equal(T.urlFor({ protocol:'http:', hostname:'127.0.0.1', port:'8093' }), 'http://127.0.0.1:9093/mcp');
  assert.equal(T.urlFor({ protocol:'http:', hostname:'127.0.0.1', port:'' }), 'http://127.0.0.1:1080/mcp');
});

test('engineLabel: rótulos e fallback', () => {
  assert.equal(T.engineLabel('postgres'), 'PostgreSQL');
  assert.equal(T.engineLabel('mariadb'), 'MariaDB / MySQL');
  assert.equal(T.engineLabel('xpto'), 'Banco de dados');
  assert.equal(T.ENGINES.oracle.port, 1521);
});

test('guardSql aceita SELECT e WITH, com espaço, comentário e caixa baixa', () => {
  assert.deepEqual(T.guardSql('select 1'), { ok:true, sql:'select 1' });
  assert.deepEqual(T.guardSql('  WITH x AS (SELECT 1 a) SELECT a FROM x'), { ok:true, sql:'WITH x AS (SELECT 1 a) SELECT a FROM x' });
  assert.deepEqual(T.guardSql('-- total\nSELECT count(*) FROM produto'), { ok:true, sql:'SELECT count(*) FROM produto' });
  assert.deepEqual(T.guardSql('/* a */ SELECT 1'), { ok:true, sql:'SELECT 1' });
});

test('guardSql tira um ponto e vírgula final, recusa no meio', () => {
  assert.deepEqual(T.guardSql('SELECT 1;'), { ok:true, sql:'SELECT 1' });
  assert.deepEqual(T.guardSql('SELECT 1; \n'), { ok:true, sql:'SELECT 1' });
  const r = T.guardSql('select 1) q; delete from produto; select (1');
  assert.equal(r.ok, false); assert.match(r.error, /ponto e vírgula/);
});

test('guardSql recusa DML, DDL e vazio com mensagem para o modelo', () => {
  for(const s of ['DELETE FROM produto', 'update produto set x=1', 'DROP TABLE produto', 'EXEC xp_cmdshell', '', '   ', 'SELECT 1 INTO novo FROM t']){
    const r = T.guardSql(s); assert.equal(r.ok, false, s); assert.match(r.error, /só SELECT/i);
  }
  assert.equal(T.guardSql('SELECT update_date FROM t').ok, true);
  assert.equal(T.guardSql(undefined).ok, false);
});

test('guardSql recusa lote T-SQL sem ponto e vírgula e funções com efeito colateral', () => {
  const casos = [
    ['select 1 a) q shutdown with nowait select * from (select 1 b', 'SHUTDOWN'],
    ['SELECT 1 SHUTDOWN', 'SHUTDOWN'],
    ['select 1 a) q waitfor delay \'00:00:10\' select * from (select 1 b', 'WAITFOR'],
    ['select 1 a) q declare @x int set @x = 1 select * from (select 1 b', 'DECLARE'],
    ['select * from openrowset(\'SQLNCLI\', \'x\', \'select 1\')', 'OPENROWSET'],
    ['select pg_terminate_backend(123)', 'PG_TERMINATE_BACKEND'],
    ['SELECT set_config(\'default_transaction_read_only\', \'off\', false)', 'SET_CONFIG'],
    ['select pg_sleep(10)', 'PG_SLEEP'],
    ['select pg_sleep_for(\'10 seconds\')', 'PG_SLEEP_FOR'],
    ['select * from dblink_exec(\'x\', \'delete\')', 'DBLINK_EXEC'],
    ['select nextval(\'s\')', 'NEXTVAL']
  ];
  for(const [s, palavra] of casos){
    const r = T.guardSql(s); assert.equal(r.ok, false, s); assert.match(r.error, new RegExp('palavra ' + palavra), s);
  }
});

test('guardSql não barra nomes que só contêm as palavras proibidas', () => {
  for(const s of [
    'select offset_x from t',
    'select use_count from t',
    'select * from t order by id offset 10 rows fetch next 5 rows only',
    'select settings from t',
    'select copy_count, kill_ratio, backup_date from t',
    'SELECT asset, reset_at FROM t'
  ]){
    assert.equal(T.guardSql(s).ok, true, s);
  }
});

test('parseStatus lê o JSON do toolbox (array com uma linha) e tolera lixo', () => {
  const txt = '[{"engine":"postgres","db_version":"PostgreSQL 16.3 on x86_64\\nmore","host":"db.local","database":"cd2","user":"leitor","schema":"public","visible_tables":42}]';
  const s = T.parseStatus(txt);
  assert.equal(s.engine, 'postgres'); assert.equal(s.visible_tables, 42);
  assert.equal(T.parseStatus('ERRO: x'), null);
  assert.equal(T.parseStatus('[]'), null);
});

test('statusLines: ordem fixa, versão só na primeira linha, tabelas como texto', () => {
  const lines = T.statusLines({ engine:'sqlserver', db_version:'Microsoft SQL Server 2022\n\tCopyright', host:'h', database:'d', user:'u', schema:'dbo', visible_tables:7 });
  assert.deepEqual(lines, [['Motor','SQL Server'],['Versão','Microsoft SQL Server 2022'],['Host','h'],['Base','d'],['Usuário','u'],['Schema','dbo'],['Tabelas visíveis','7']]);
});

test('TOOL_DESCRIPTIONS cobre as seis ferramentas', () => {
  assert.deepEqual(Object.keys(T.TOOL_DESCRIPTIONS).sort(), ['db_connection_status','db_describe_table','db_list_tables','db_read_only_query','db_sample_table','db_search_columns']);
});
