'use strict';
// Testes do cliente MCP (Streamable HTTP, JSON-RPC) do harness.
// Rodar com: node --test (na raiz do repo)
const test = require('node:test');
const assert = require('node:assert/strict');
const { McpClient, parseSse } = require('../web/mcp.js');

const URL_MCP = 'https://archeo.example/api/mcp';
function res(status, body, headers = {}){
  const h = { 'content-type': 'application/json', ...headers };
  return { ok: status >= 200 && status < 300, status, headers: { get: k => h[k.toLowerCase()] ?? null },
    json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}
function rpcOk(id, result){ return res(200, { jsonrpc:'2.0', id, result }); }
// fetch falso que responde por método JSON-RPC; guarda cada chamada
function fakeFetch(byMethod){
  const calls = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body, headers: init.headers });
    const h = byMethod[body.method];
    if(!h) throw new Error('método não previsto no teste: ' + body.method);
    return typeof h === 'function' ? h(body, init, calls.length) : h;
  };
  f.calls = calls;
  return f;
}
const INIT = b => rpcOk(b.id, { protocolVersion:'2025-06-18', capabilities:{ tools:{} }, serverInfo:{ name:'archeo' } });
const LIST = b => rpcOk(b.id, { tools:[{ name:'db_vendas__resumo', description:'x', inputSchema:{ type:'object' } }] });
function basic(extra = {}){
  return fakeFetch({ initialize: INIT, 'notifications/initialized': res(202, ''), 'tools/list': LIST, ...extra });
}

test('init: negocia protocolVersion 2025-06-18 no corpo do initialize, sem header de versão', async () => {
  const fetch = basic();
  const c = new McpClient(URL_MCP, { fetch, token: async () => null });
  const tools = await c.init();
  assert.equal(tools.length, 1);
  const init = fetch.calls[0];
  assert.equal(init.body.method, 'initialize');
  assert.equal(init.body.params.protocolVersion, '2025-06-18');
  assert.equal(init.headers['MCP-Protocol-Version'], undefined);
});

test('init: depois do initialize todo request leva MCP-Protocol-Version com a versão negociada', async () => {
  const fetch = basic();
  const c = new McpClient(URL_MCP, { fetch, token: async () => null });
  await c.init();
  for(const call of fetch.calls.slice(1)) assert.equal(call.headers['MCP-Protocol-Version'], '2025-06-18', call.body.method);
});

test('init: recusa versão de protocolo que o servidor devolve e o cliente não suporta', async () => {
  const fetch = basic({ initialize: b => rpcOk(b.id, { protocolVersion:'2024-11-05', capabilities:{} }) });
  const c = new McpClient(URL_MCP, { fetch, token: async () => null });
  await assert.rejects(c.init(), /2024-11-05/);
});

test('auth: pede o token ao provedor a cada request e manda como Bearer', async () => {
  let n = 0;
  const fetch = basic();
  const c = new McpClient(URL_MCP, { fetch, token: async () => 'tok' + (++n) });
  await c.init();
  assert.deepEqual(fetch.calls.map(x => x.headers.Authorization), ['Bearer tok1', 'Bearer tok2', 'Bearer tok3']);
});

test('auth: sem token não manda Authorization', async () => {
  const fetch = basic();
  const c = new McpClient(URL_MCP, { fetch, token: async () => null });
  await c.init();
  assert.ok(fetch.calls.every(x => !('Authorization' in x.headers)));
});

test('auth: 401 chama onUnauthorized uma vez e repete o request com o token novo', async () => {
  let listCalls = 0;
  const fetch = basic({ 'tools/list': (b, init) => (++listCalls === 1 ? res(401, { reason:'NOT_FOUND' }, { 'www-authenticate':'Bearer resource_metadata="x"' }) : LIST(b)) });
  let current = 'velho';
  const c = new McpClient(URL_MCP, { fetch, token: async () => current, onUnauthorized: async () => { current = 'novo'; return current; } });
  const tools = await c.init();
  assert.equal(tools.length, 1);
  assert.equal(listCalls, 2);
  const lists = fetch.calls.filter(x => x.body.method === 'tools/list');
  assert.equal(lists[0].headers.Authorization, 'Bearer velho');
  assert.equal(lists[1].headers.Authorization, 'Bearer novo');
});

test('auth: 401 de novo depois do retry vira erro de autenticação, sem laço', async () => {
  const fetch = basic({ 'tools/list': () => res(401, { reason:'TOKEN_REVOKED' }) });
  let n = 0;
  const c = new McpClient(URL_MCP, { fetch, token: async () => 't', onUnauthorized: async () => { n++; return 't2'; } });
  await assert.rejects(c.init(), /autentica/i);
  assert.equal(n, 1);
});

test('auth: 401 sem onUnauthorized vira erro de autenticação', async () => {
  const fetch = basic({ 'tools/list': () => res(401, { reason:'NOT_FOUND' }) });
  const c = new McpClient(URL_MCP, { fetch, token: async () => null });
  await assert.rejects(c.init(), /autentica/i);
});

test('erros: 403 ORIGIN_REJECTED explica que o Archeo precisa liberar a origem', async () => {
  const fetch = basic({ initialize: () => res(403, { reason:'ORIGIN_REJECTED' }) });
  const c = new McpClient(URL_MCP, { fetch, token: async () => 't', origin:'http://127.0.0.1:8080' });
  await assert.rejects(c.init(), /origem http:\/\/127\.0\.0\.1:8080/);
});

test('erros: HTTP inesperado inclui o status', async () => {
  const fetch = basic({ initialize: () => res(502, 'bad gateway', { 'content-type':'text/plain' }) });
  const c = new McpClient(URL_MCP, { fetch, token: async () => null });
  await assert.rejects(c.init(), /HTTP 502/);
});

test('erros: erro JSON-RPC vira Error com a mensagem do servidor', async () => {
  const fetch = basic({ 'tools/list': b => res(200, { jsonrpc:'2.0', id:b.id, error:{ code:-32601, message:'método desconhecido' } }) });
  const c = new McpClient(URL_MCP, { fetch, token: async () => null });
  await assert.rejects(c.init(), /método desconhecido/);
});

test('sessão: devolve Mcp-Session-Id nos requests seguintes quando o servidor emitir', async () => {
  const fetch = basic({ initialize: b => rpcOk(b.id, { protocolVersion:'2025-06-18', capabilities:{} }) });
  fetch.calls; // apenas para clareza
  const withSid = async (url, init) => { const r = await fetch(url, init); if(JSON.parse(init.body).method === 'initialize') r.headers = { get: k => (k.toLowerCase() === 'mcp-session-id' ? 'S1' : 'application/json') }; return r; };
  const c = new McpClient(URL_MCP, { fetch: withSid, token: async () => null });
  await c.init();
  assert.equal(fetch.calls[0].headers['Mcp-Session-Id'], undefined);
  assert.equal(fetch.calls[1].headers['Mcp-Session-Id'], 'S1');
  assert.equal(fetch.calls[2].headers['Mcp-Session-Id'], 'S1');
});

test('sse: lê a resposta text/event-stream e pega a mensagem com o id certo', async () => {
  const fetch = basic({ 'tools/list': b => res(200, 'event: message\ndata: {"jsonrpc":"2.0","id":999,"result":{}}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":' + b.id + ',"result":{"tools":[{"name":"a"},{"name":"b"}]}}\n\n', { 'content-type':'text/event-stream' }) });
  const c = new McpClient(URL_MCP, { fetch, token: async () => null });
  const tools = await c.init();
  assert.deepEqual(tools.map(t => t.name), ['a', 'b']);
});

test('parseSse: ignora blocos sem data e JSON inválido', () => {
  const m = parseSse(': comentário\n\ndata: não é json\n\ndata: {"id":3,"result":1}\n\n', 3);
  assert.deepEqual(m, { id:3, result:1 });
});

test('call: junta o conteúdo de texto e prefixa ERRO quando isError', async () => {
  const fetch = basic({ 'tools/call': b => rpcOk(b.id, { content:[{ type:'text', text:'linha 1' }, { type:'image' }, { type:'text', text:'linha 2' }], isError:true }) });
  const c = new McpClient(URL_MCP, { fetch, token: async () => null });
  await c.init();
  const out = await c.call('db_vendas__resumo', { mes:'2026-09' });
  assert.equal(out, 'ERRO: linha 1\n[image]\nlinha 2');
  const call = fetch.calls.at(-1);
  assert.deepEqual(call.body.params, { name:'db_vendas__resumo', arguments:{ mes:'2026-09' } });
  assert.equal(call.headers['MCP-Protocol-Version'], '2025-06-18');
});

test('call: o signal de Parar chega ao fetch; sem signal continua igual', async () => {
  const fetch = basic({ 'tools/call': b => rpcOk(b.id, { content:[{ type:'text', text:'ok' }] }) });
  const c = new McpClient(URL_MCP, { fetch, token: async () => null });
  await c.init();
  const ctl = new AbortController();
  assert.equal(await c.call('db_read_only_query', { sql:'SELECT 1' }, ctl.signal), 'ok');
  assert.equal(fetch.calls.at(-1).init.signal, ctl.signal);
  await c.call('db_read_only_query', { sql:'SELECT 1' });
  assert.equal(fetch.calls.at(-1).init.signal, undefined);
});
