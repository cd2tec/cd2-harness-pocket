/* Roteiro de relatórios do Harness Pocket (modo Banco de dados): pergunta -> tabelas candidatas
   -> uma chamada ao modelo pedindo JSON -> consulta no toolbox -> visual e frase de molde.
   O modelo nunca vê o resultado: todo número na tela vem do banco. Sem DOM. */
(function(root){
"use strict";
const isNode = typeof module !== 'undefined' && module.exports;
const Chart = isNode ? require('./chart.js') : root.CD2Chart;

const VISUALS = ['barra', 'linha', 'pizza', 'tabela', 'numero'];
const MENSAGENS = {
  sem_tabelas:'Não achei tabelas sobre isso neste banco.',
  sql:'Não consegui montar essa consulta.',
  timeout:'A consulta demorou demais e foi cancelada para proteger o banco.',
  vazio:'A consulta não trouxe nenhuma linha.',
  modelo:'O modelo não respondeu.'
};
// Textos de timeout por motor (PostgreSQL, MariaDB/MySQL, driver Go, Oracle) e o do próprio front.
const TIMEOUT_RE = /statement timeout|max_statement_time|maximum statement execution time|context deadline exceeded|query timeout|invalid connection|ORA-01013|tempo esgotado/i;
const MEDIA_RE = /(^|[^a-z])(media|medio|avg|average|ticket|percent|percentual|pct|taxa|margem|rate|ratio|indice)([^a-z]|$)/;
const semAcento = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const TEMPO_NOME_RE = /^(mes|month|ano|year|dia|day|data|date|periodo|semana|week|trimestre)/i;
const TEMPO_VALOR_RE = /^\d{4}-\d{2}(-\d{2})?([ T].*)?$|^\d{1,2}\/\d{4}$|^\d{1,2}\/\d{1,2}\/\d{4}$|^(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*[\/ -]?\d{2,4}$/i;

function parseRows(text){
  const s = String(text == null ? '' : text);
  const t = s.trim();
  if(t.startsWith('ERRO: ')) return { ok:false, error:t.slice(6) || 'erro sem mensagem' };
  if(!t || t === 'null') return { ok:true, rows:[] };
  const obj = v => v && typeof v === 'object' && !Array.isArray(v);
  const bad = { ok:false, error:'Resposta inesperada do banco: ' + t.slice(0, 200) };
  try{
    const j = JSON.parse(t);
    if(Array.isArray(j)) return { ok:true, rows:j.filter(obj) };
    return obj(j) ? { ok:true, rows:[j] } : bad;
  }catch(e){}
  const rows = [];
  for(const line of t.split(/\r?\n/)){
    if(!line.trim()) continue;
    try{ const j = JSON.parse(line); if(!obj(j)) return bad; rows.push(j); }catch(e){ return bad; }
  }
  return { ok:true, rows };
}
function parseModelJson(text){
  let s = String(text == null ? '' : text);
  const k = s.lastIndexOf('</think>'); if(k >= 0) s = s.slice(k + 8);
  let o = null;
  try{ o = JSON.parse(s.trim()); }catch(e){
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if(a >= 0 && b > a){ try{ o = JSON.parse(s.slice(a, b + 1)); }catch(e2){ o = null; } }
  }
  if(!o || typeof o !== 'object' || typeof o.visual !== 'string' || typeof o.sql !== 'string' || !o.sql.trim() || !VISUALS.includes(semAcento(o.visual))) return null;
  const str = v => typeof v === 'string' ? v.trim() : '';
  return { sql:o.sql.trim(), visual:semAcento(o.visual), x:str(o.x), y:str(o.y), titulo:str(o.titulo) };
}
function isTimeout(msg){ return TIMEOUT_RE.test(String(msg == null ? '' : msg)); }

function findCol(colunas, name){ if(!name) return null; const n = name.toLowerCase(); return colunas.find(c => c.toLowerCase() === n) || null; }
function isNumCol(linhas, c){
  let any = false;
  for(const r of linhas){ const v = r[c]; if(v == null || v === '') continue; if(Chart.num(v) == null) return false; any = true; }
  return any;
}
function isTimeCol(linhas, c){
  const vs = linhas.map(r => r[c]).filter(v => v != null && v !== '');
  if(!vs.length) return false;
  if(vs.every(v => TEMPO_VALOR_RE.test(String(v)))) return true;
  return TEMPO_NOME_RE.test(c) && vs.every(v => Chart.num(v) != null);
}
// Chave ordenável de um rótulo de tempo (ISO, dd/mm/aaaa, mm/aaaa, 'jan/2026', número) ou null.
function timeKey(v){
  const t = String(v).trim();
  if(/^\d{4}-\d{2}/.test(t)) return t;
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  m = t.match(/^(\d{1,2})\/(\d{4})$/);
  if(m) return m[2] + '-' + m[1].padStart(2, '0');
  m = semAcento(t).match(/^([a-z]{3,})[\/ -](\d{2}|\d{4})$/);
  if(m){
    const i = MESES.indexOf(m[1].slice(0, 3));
    if(i >= 0) return (m[2].length === 2 ? '20' + m[2] : m[2]) + '-' + String(i + 1).padStart(2, '0');
  }
  return null;
}
function byTime(linhas, x){
  const out = linhas.slice();
  if(out.every(r => Chart.num(r[x]) != null)) return out.sort((a, b) => Chart.num(a[x]) - Chart.num(b[x]));
  const ks = out.map(r => timeKey(r[x]));
  if(ks.every(k => k != null)){
    const idx = out.map((r, i) => i).sort((i, j) => ks[i].localeCompare(ks[j]) || i - j);
    return idx.map(i => out[i]);
  }
  return out;
}
// O pedido do modelo é ajustado pelo dado que voltou (regras da seção 3, passo 5, da spec).
function pickVisual(req, colunas, linhas){
  const tabela = () => ({ visual:'tabela', x:null, y:null, linhas, aviso:null });
  const x = findCol(colunas, req.x), y = findCol(colunas, req.y);
  const numCols = colunas.filter(c => isNumCol(linhas, c));
  if(linhas.length === 1 && colunas.length === 1 && numCols.length === 1) return { visual:'numero', x:null, y:numCols[0], linhas, aviso:null };
  let v = req.visual;
  if(v === 'numero') return (linhas.length === 1 && numCols.length) ? { visual:'numero', x:null, y:(y && numCols.includes(y)) ? y : numCols[0], linhas, aviso:null } : tabela();
  if(v === 'tabela' || !x || !y || !numCols.includes(y)) return tabela();
  if(v === 'pizza' && (linhas.length > 6 || linhas.some(r => (Chart.num(r[y]) || 0) < 0))) v = 'barra';
  const tempo = isTimeCol(linhas, x);
  if(v === 'linha' && !tempo) v = 'barra';
  let out = (v === 'linha' || (v === 'barra' && tempo)) ? byTime(linhas, x)
    : linhas.slice().sort((a, b) => (Chart.num(b[y]) || 0) - (Chart.num(a[y]) || 0));
  let aviso = null;
  if(v === 'barra' && out.length > 20){ aviso = 'Mostrando os 20 maiores de ' + out.length + '.'; out = byValue(out, y).slice(0, 20); if(tempo) out = byTime(out, x); }
  return { visual:v, x, y, linhas:out, aviso };
}
function byValue(linhas, y){ return linhas.slice().sort((a, b) => (Chart.num(b[y]) || 0) - (Chart.num(a[y]) || 0)); }
// Frase de molde: montada daqui, nunca pelo modelo.
function frase(r){
  const L = r.linhas || [], T = r.todas || L;
  if(r.visual === 'numero') return 'Resultado: ' + Chart.fmt(L[0] && L[0][r.y]) + '.';
  if(r.visual === 'tabela') return T.length === 1 ? '1 linha.' : T.length + ' linhas.';
  const vals = L.map(l => Chart.num(l[r.y]) || 0), labs = Chart.labelsOf(L.map(l => l[r.x]));
  let iMax = 0; vals.forEach((v, i) => { if(v > vals[iMax]) iMax = i; });
  if(r.visual === 'linha') return 'De ' + labs[0] + ' a ' + labs[labs.length - 1] + '. Maior valor em ' + labs[iMax] + ': ' + Chart.fmt(vals[iMax]) + '.';
  const n = T.length + (T.length === 1 ? ' categoria.' : ' categorias.');
  const maior = 'Maior: ' + labs[iMax] + ', ' + Chart.fmt(vals[iMax]) + '. ';
  if(MEDIA_RE.test(semAcento(r.y))) return maior + n;
  const tot = T.reduce((a, l) => a + (Chart.num(l[r.y]) || 0), 0);
  return maior + 'Total: ' + Chart.fmt(tot) + ' em ' + n;
}

const api = { VISUALS, MENSAGENS, parseRows, parseModelJson, isTimeout, pickVisual, frase };
if(isNode) module.exports = api; else root.CD2Ask = api;
})(typeof window !== 'undefined' ? window : globalThis);
