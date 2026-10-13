/* Modo "MCP Nativo para Banco de dados" do CD2 Harness: lógica sem DOM.
   O toolbox (googleapis/mcp-toolbox) sobe pelo launcher em 127.0.0.1 na porta
   do harness + 1000; o front só deriva a URL. A guarda de SELECT é a terceira
   camada de leitura (conta do banco e excludedValues do YAML são as outras). */
(function(root){
"use strict";
const ENGINES = {
  postgres:  { label:'PostgreSQL',      port:5432 },
  oracle:    { label:'Oracle',          port:1521 },
  mariadb:   { label:'MariaDB / MySQL', port:3306 },
  sqlserver: { label:'SQL Server',      port:1433 }
};
const TOOL_DESCRIPTIONS = {
  db_connection_status: 'Verifica se o banco está acessível e se a conexão está pronta para uso.',
  db_describe_table:    'Apresenta as colunas, os tipos e a estrutura de uma tabela.',
  db_list_tables:       'Lista as tabelas e views disponíveis no banco de dados.',
  db_search_columns:    'Encontra colunas pelo nome em todas as tabelas e schemas.',
  db_read_only_query:   'Executa uma consulta SELECT avulsa em modo somente leitura.',
  db_sample_table:      'Mostra uma amostra de até 20 linhas para entender o conteúdo de uma tabela.'
};
// Uniao das listas dos YAML (base + SQL Server + PostgreSQL). \b protege nomes
// como offset, settings e use_count. T-SQL aceita varios comandos sem ";".
const FORBIDDEN = new RegExp('\\b(' + [
  'insert','update','delete','drop','alter','truncate','create','grant','revoke','merge','exec','execute','call','into',
  'backup','restore','kill','shutdown','dbcc','deny','reconfigure','waitfor','declare','set','use','openrowset','openquery','opendatasource',
  'copy','pg_terminate_backend','pg_cancel_backend','set_config','nextval','setval','dblink\\w*','lo_import','lo_export',
  'pg_read_file','pg_read_binary_file','pg_write\\w*','pg_sleep\\w*'
].join('|') + ')\\b', 'i');

function engineLabel(e){ return (ENGINES[e] && ENGINES[e].label) || 'Banco de dados'; }
function urlFor(loc){ const p = parseInt(loc.port, 10) || 80; return 'http://127.0.0.1:' + (p + 1000) + '/mcp'; }

function guardSql(sql){
  const bad = m => ({ ok:false, error:'Consulta recusada: só SELECT é permitido (' + m + '). Reescreva como um único SELECT, sem ponto e vírgula.' });
  if(typeof sql !== 'string') return bad('texto vazio');
  let s = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  s = s.replace(/;\s*$/, '').trim();
  if(!s) return bad('texto vazio');
  if(s.includes(';')) return bad('ponto e vírgula no meio da consulta');
  if(!/^(select|with)\b/i.test(s)) return bad('não começa com SELECT ou WITH');
  const m = s.match(FORBIDDEN); if(m) return bad('palavra ' + m[1].toUpperCase());
  return { ok:true, sql:s };
}

function parseStatus(text){
  try{
    const j = JSON.parse(text);
    const row = Array.isArray(j) ? j[0] : j;
    if(!row || typeof row !== 'object' || !row.engine) return null;
    return row;
  }catch(e){ return null; }
}
function statusLines(s){
  const v = x => (x == null ? '' : String(x));
  return [
    ['Motor', engineLabel(s.engine)],
    ['Versão', v(s.db_version).split('\n')[0].trim()],
    ['Host', v(s.host)], ['Base', v(s.database)], ['Usuário', v(s.user)], ['Schema', v(s.schema)],
    ['Tabelas visíveis', v(s.visible_tables)]
  ];
}

/* ---------- cd2-ctl: controle do banco na porta do harness + 2000 ---------- */
function ctlUrlFor(loc){ const p = parseInt(loc.port, 10) || 80; return 'http://127.0.0.1:' + (p + 2000); }
// A chave da sessão chega uma vez no endereço (#k=<64 hex>), posta pelo launcher.
function readKeyFromHash(hash){
  const m = /(?:^#|&)k=([0-9a-fA-F]{64})(?=&|$)/.exec(String(hash || ''));
  return m ? m[1] : null;
}
// Mesmas regras do cd2-ctl (e da v0.5.0): Oracle usa o usuário em maiúsculas, MariaDB a base.
function defaultsFor(motor, usuario, base){
  const e = ENGINES[motor];
  if(!e) return { porta:'', schema:'' };
  const schema = { postgres:'public', oracle:String(usuario || '').toUpperCase(), mariadb:String(base || ''), sqlserver:'dbo' }[motor];
  return { porta:e.port, schema };
}
// Corpo de POST /config. A senha não é aparada (espaço pode fazer parte dela) e só vai se
// foi digitada: vazia significa "manter a salva".
function configPayload(form){
  const t = v => String(v == null ? '' : v).trim();
  const out = { motor:t(form.motor), host:t(form.host), base:t(form.base), usuario:t(form.usuario), schema:t(form.schema) };
  const p = t(form.porta);
  if(p) out.porta = /^\d+$/.test(p) ? Number(p) : p;
  const s = form.senha == null ? '' : String(form.senha);
  if(s) out.senha = s;
  return out;
}
function ctlStatusLines(cs){
  const v = x => (x == null ? '' : String(x));
  return [
    ['Motor', engineLabel(cs.motor)], ['Host', v(cs.host)], ['Porta', v(cs.porta)],
    ['Base', v(cs.base)], ['Usuário', v(cs.usuario)], ['Schema', v(cs.schema)]
  ];
}

const api = { ENGINES, TOOL_DESCRIPTIONS, engineLabel, urlFor, guardSql, parseStatus, statusLines,
  ctlUrlFor, readKeyFromHash, defaultsFor, configPayload, ctlStatusLines };
if(typeof module !== 'undefined' && module.exports) module.exports = api; else root.CD2Toolbox = api;
})(typeof window !== 'undefined' ? window : globalThis);
