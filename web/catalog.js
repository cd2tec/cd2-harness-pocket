/* Mapa do banco para o roteiro de relatórios do Harness Pocket: monta o catálogo a partir
   do db_catalog, escolhe as tabelas que combinam com a pergunta e sugere perguntas tiradas
   do próprio esquema. Lógica pura, sem modelo e sem DOM. */
(function(root){
"use strict";
const MAX_COLS_TABLE = 60;
// Prefixos comuns de coluna em ERP. Separados só quando o resto tem 3 letras ou mais.
const PREFIXES = ['vlr', 'qtd', 'dt', 'cod', 'cd', 'tot', 'nr', 'ds', 'nm'];
const STOP = new Set(['de','da','do','das','dos','por','e','o','a','os','as','em','no','na','nos','nas','qual','quai','quanto',
  'quantos','quanta','quantas','mostre','mostra','me','um','uma','com','para','pelo','pela','cada','todo','todos','the','of','by',
  'per','what','how','many','show','list','liste','foram','tem','temo','ha','sao','que','mai','menos','maior','menor','meu','minha']);
const SYN = [
  ['venda','sale','pedido','order','cupom','movimento','mov','vend','vendido','vendida','faturamento','fatura','receita'],
  ['produto','product','item','sku','mercadoria','prod','artigo'],
  ['cliente','customer','client','cli','consumidor'],
  ['data','date','dt','dia','mes','ano','periodo','day','month','year','time','semana'],
  ['valor','vlr','total','tot','amount','price','preco','faturamento','receita','custo'],
  ['quantidade','qtd','qty','quant'],
  ['loja','store','filial','branch','unidade'],
  ['departamento','depto','dept','department','secao','categoria','category'],
  ['estado','uf','state']
];
const NOISE = new Set(['log','tmp','temp','aux','bkp','backup','audit','auditoria','old','hist']);

function stem(t){ return t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t; }
function tokens(s){
  const base = String(s == null ? '' : s).replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out = [];
  for(let t of base){
    let p;
    while((p = PREFIXES.find(x => t.length >= x.length + 3 && t.startsWith(x)))){ out.push(p); t = t.slice(p.length); }
    if(t.length > 4 && t.endsWith('id')){ out.push(stem(t.slice(0, -2)), 'id'); continue; }
    out.push(stem(t));
  }
  return out;
}
const SYN_INDEX = new Map();
for(const g of SYN){ const set = g.map(stem); for(const w of set){ const cur = SYN_INDEX.get(w) || new Set(); set.forEach(x => cur.add(x)); SYN_INDEX.set(w, cur); } }
function syn(q){ return SYN_INDEX.get(q) || new Set([q]); }
function match(q, x){
  if(q === x || syn(q).has(x)) return true;
  return q.length >= 4 && x.length >= 4 && (x.startsWith(q) || q.startsWith(x));
}
function questionTokens(p){ return [...new Set(tokens(p).filter(t => t.length >= 2 && !STOP.has(t)))]; }

function kindOf(type){
  const t = String(type || '').toLowerCase();
  if(/interval/.test(t)) return 'outro';
  if(/date|time/.test(t)) return 'data';
  if(/^(bit|bool)/.test(t)) return 'outro';
  if(/int|num|dec|float|double|real|money/.test(t)) return 'numero';
  if(/char|text|clob|string|enum/.test(t)) return 'texto';
  return 'outro';
}
function lowerKeys(r){ const o = {}; for(const k in r) o[k.toLowerCase()] = r[k]; return o; }

function buildCatalog(rows){
  const by = new Map();
  for(const raw of rows || []){
    if(!raw || typeof raw !== 'object') continue;
    const r = lowerKeys(raw);
    if(r.table_name == null || r.column_name == null) continue;
    const name = String(r.table_name);
    let t = by.get(name);
    if(!t){
      t = { name, type:String(r.table_type).toUpperCase() === 'VIEW' ? 'VIEW' : 'TABLE', rows:Math.max(0, Number(r.num_rows) || 0), tokens:tokens(name), columns:[] };
      by.set(name, t);
    }
    if(t.columns.length >= MAX_COLS_TABLE) continue;
    t.columns.push({ name:String(r.column_name), type:String(r.data_type == null ? '' : r.data_type), kind:kindOf(r.data_type), tokens:tokens(r.column_name) });
  }
  return { tables:[...by.values()] };
}

function pickColumns(cols, hit, n){
  const rank = c => hit.has(c.name) ? 0 : c.kind === 'data' ? 1 : c.kind === 'numero' ? 2 : 3;
  return cols.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).slice(0, n)
    .sort((a, b) => a.i - b.i).map(({ c }) => ({ name:c.name, type:c.type, kind:c.kind }));
}
// Nota: +3 por palavra no nome da tabela, +1 por palavra em coluna (até 5), +1 com data, +1 com
// número, desempate pelo volume. Só entra quem tem ao menos uma palavra em comum com a pergunta.
function rankTables(catalog, pergunta, opts){
  opts = opts || {};
  const max = opts.max || 5, maxCols = opts.maxCols || 25, qs = questionTokens(pergunta), scored = [];
  for(const t of (catalog && catalog.tables) || []){
    let tableHits = 0, colHits = 0; const hitCols = new Set();
    for(const q of qs){
      if(t.tokens.some(x => match(q, x))) tableHits++;
      let hit = false;
      for(const c of t.columns) if(c.tokens.some(x => match(q, x))){ hitCols.add(c.name); hit = true; }
      if(hit) colHits++;
    }
    if(!tableHits && !colHits) continue;
    const hasData = t.columns.some(c => c.kind === 'data'), hasNum = t.columns.some(c => c.kind === 'numero');
    const score = 3 * tableHits + Math.min(5, colHits) + (hasData ? 1 : 0) + (hasNum ? 1 : 0) + Math.log10(t.rows + 1) / 100;
    scored.push({ t, score, hitCols });
  }
  scored.sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name));
  return scored.slice(0, max).map(({ t, score, hitCols }) => ({ name:t.name, type:t.type, rows:t.rows, score, columns:pickColumns(t.columns, hitCols, maxCols) }));
}

function humanize(name){ const t = tokens(name).filter(x => x !== 'id'); return t.length ? t.join(' ') : String(name == null ? '' : name).toLowerCase(); }
function isKey(c){ return c.tokens.includes('id') || ['cod', 'cd', 'nr'].includes(c.tokens[0]); }
function suggest(catalog){
  const tables = ((catalog && catalog.tables) || []).filter(t => t.type === 'TABLE' && !t.tokens.some(x => NOISE.has(x)))
    .slice().sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
  const out = [], used = new Set();
  const add = (s, t) => { if(out.length < 4 && !out.includes(s)){ out.push(s); used.add(t.name); } };
  const val = t => t.columns.find(c => c.kind === 'numero' && !isKey(c));
  const txt = t => t.columns.find(c => c.kind === 'texto' && !isKey(c));
  const fato = tables.find(t => t.columns.some(c => c.kind === 'data') && val(t));
  if(fato) add('Total por mês em ' + humanize(fato.name), fato);
  const top = tables.find(t => t !== fato && val(t) && txt(t));
  if(top) add('Top 10 de ' + humanize(top.name) + ' por ' + humanize(val(top).name), top);
  if(fato && txt(fato)) add('Distribuição de ' + humanize(fato.name) + ' por ' + humanize(txt(fato).name), fato);
  for(const t of tables){ if(out.length >= 4) break; if(!used.has(t.name)) add('Quantos registros tem ' + humanize(t.name), t); }
  return out;
}

const api = { tokens, kindOf, buildCatalog, rankTables, suggest, humanize };
if(typeof module !== 'undefined' && module.exports) module.exports = api; else root.CD2Catalog = api;
})(typeof window !== 'undefined' ? window : globalThis);
