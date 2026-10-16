/* Perfil das tabelas do Harness Pocket: lê as colunas e uma amostra de linhas e diz o papel de
   cada tabela (movimento, itens, cadastro, parametro, vazia ou indefinida) e as colunas úteis.
   Lógica pura e determinística, sem modelo e sem DOM. Só sinais genéricos de ERP (tipo, formato
   dos valores, auditoria, nomes comuns em português e inglês), nunca o nome de um ERP específico. */
(function(root){
"use strict";
const isNode = typeof module !== 'undefined' && module.exports;
const Cat = isNode ? require('./catalog.js') : root.CD2Catalog;

const LINHAS = 10, MAX_VIEWS = 30;
const PAPEIS = ['movimento', 'itens', 'cadastro', 'parametro', 'vazia', 'indefinida'];
// Palavras no formato de Cat.tokens: sem acento, minúsculas, sem plural.
const AUDITORIA = new Set(['cadastro', 'cad', 'inclusao', 'criacao', 'created', 'alteracao', 'alt', 'atualizacao', 'updated', 'modified', 'inserted', 'ultima', 'ult']);
// Datas de atributo da entidade (nascimento, validade...): nunca são a data de um movimento.
const ATRIBUTO = new Set(['nascimento', 'nasc', 'validade', 'admissao', 'demissao', 'expiracao', 'expiration', 'expiry', 'birth', 'birthday', 'vigencia', 'fundacao']);
const VALOR = new Set(['vlr', 'valor', 'vl', 'tot', 'total', 'amount', 'amt', 'preco', 'price', 'prc', 'custo', 'cost', 'receita', 'revenue']);
const UNITARIO = new Set(['preco', 'price', 'prc', 'unit', 'unitario', 'custo', 'cost']);
const TOTAL = new Set(['tot', 'total']);
const QUANTIDADE = new Set(['qtd', 'qtde', 'quant', 'quantidade', 'qty', 'quantity']);
const USUARIO = new Set(['usuario', 'usu', 'user', 'by', 'operador']);
const DESCRICAO = new Set(['ds', 'nm', 'descricao', 'desc', 'nome', 'name', 'description', 'title', 'titulo', 'razao', 'fantasia']);
const CHAVE = new Set(['chave', 'key', 'parametro', 'param', 'setting', 'config', 'cfg', 'opcao', 'option', 'propriedade', 'property']);
const CONTEUDO = new Set(['valor', 'value', 'conteudo', 'content']);
const NOME_PARAMETRO = new Set(['param', 'parametro', 'config', 'cfg', 'setting', 'configuracao']);

const tem = (c, set) => c.tokens.some(t => set.has(t));
const preenchidos = v => v.filter(x => x != null && x !== '');
function lower(r){ const o = {}; for(const k in r) o[k.toLowerCase()] = r[k]; return o; }

// Sinais de uma coluna. vals é a lista de valores da amostra, ou null sem amostra.
function sinaisColuna(c, vals){
  const distintos = vals ? new Set(preenchidos(vals).map(String)).size : 0;
  const varia = !vals || vals.length < 2 || distintos > 1;
  const chave = Cat.isKey(c);
  const valor = c.kind === 'numero' && !chave && tem(c, VALOR);
  const unitario = valor && tem(c, UNITARIO) && !tem(c, TOTAL);
  return {
    dataMov: c.kind === 'data' && !tem(c, AUDITORIA) && !tem(c, ATRIBUTO) && varia,
    dataAud: c.kind === 'data' && tem(c, AUDITORIA),
    valorTotal: valor && !unitario,
    unitario,
    quantidade: c.kind === 'numero' && !chave && tem(c, QUANTIDADE),
    chave,
    idRegistro: chave && !!vals && vals.length >= 2 && distintos === vals.length,
    usuario: tem(c, USUARIO),
    descricao: c.kind === 'texto' && tem(c, DESCRICAO),
    chaveNome: tem(c, CHAVE),
    conteudo: c.kind === 'texto' && tem(c, CONTEUDO)
  };
}

// Papel de uma tabela. A ordem importa: vazia, parâmetro, movimento, cadastro, indefinida.
// O identificador por linha reforça o movimento, mas não é exigido: view agregada não tem.
function analisarTabela(t, linhas){
  const amostra = Array.isArray(linhas);
  const L = amostra ? linhas.slice(0, LINHAS).map(lower) : null;
  if(amostra && L.length === 0) return { papel:'vazia', colunas:{}, amostra:true, chave:null };
  const s = t.columns.map(c => ({ c, x:sinaisColuna(c, L ? L.map(r => r[String(c.name).toLowerCase()]) : null) }));
  const primeiro = k => { const f = s.find(e => e.x[k]); return f ? f.c.name : null; };
  const algum = k => s.some(e => e.x[k]);
  const colunas = {};
  if(primeiro('dataMov')) colunas.data = primeiro('dataMov');
  if(primeiro('valorTotal')) colunas.valor = primeiro('valorTotal');
  if(primeiro('quantidade')) colunas.quantidade = primeiro('quantidade');
  const chave = primeiro('idRegistro') || (L ? null : primeiro('chave'));
  const dataMov = algum('dataMov');
  const nome = Cat.tokens(t.name);
  let papel = 'indefinida';
  if(!dataMov && t.columns.length <= 8 && ((algum('chaveNome') && algum('conteudo')) || nome.some(x => NOME_PARAMETRO.has(x)))) papel = 'parametro';
  else if(dataMov && (algum('valorTotal') || algum('quantidade'))) papel = 'movimento';
  else if(!dataMov && !(algum('quantidade') && !algum('descricao')) && (algum('descricao') || (algum('usuario') && algum('dataAud')) || algum('unitario'))) papel = 'cadastro';
  return { papel, colunas, amostra, chave };
}

function resumo(catalog){
  const r = Object.fromEntries(PAPEIS.map(p => [p, 0]));
  for(const t of (catalog && catalog.tables) || []) if(t.perfil) r[t.perfil.papel]++;
  return r;
}

// Perfil de todas as tabelas. Segunda passada: tabela com valor ou quantidade que se liga a uma
// tabela de movimento pela chave do registro dela vira itens (mov_venda_item pelo nr_cupom,
// order_lines pelo order_id -> sales_orders.id). Movimento só vira itens se tiver item no nome; cadastro só se tiver quantidade.
function analisarCatalogo(catalog, amostras){
  const tabs = (catalog && catalog.tables) || [];
  for(const t of tabs) t.perfil = analisarTabela(t, amostras ? amostras.get(t.name) : null);
  const movs = tabs.filter(t => t.perfil.papel === 'movimento' && t.perfil.chave);
  for(const t of tabs){
    const p = t.perfil;
    if(p.papel !== 'indefinida' && p.papel !== 'movimento' && !(p.papel === 'cadastro' && p.colunas.quantidade)) continue;
    if(!p.colunas.valor && !p.colunas.quantidade) continue;
    if(p.papel === 'movimento' && !Cat.tokens(t.name).some(x => Cat.NOME_ITEM.has(x))) continue;
    const liga = movs.some(m => m !== t && Cat.links([m, t]).some(l => (l.a === m.name ? l.col : l.colB) === m.perfil.chave));
    if(liga) p.papel = 'itens';
  }
  return resumo(catalog);
}

const api = { PAPEIS, LINHAS, MAX_VIEWS, analisarTabela, analisarCatalogo, resumo };
if(isNode) module.exports = api; else root.CD2Perfil = api;
})(typeof window !== 'undefined' ? window : globalThis);
