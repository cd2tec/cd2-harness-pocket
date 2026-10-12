'use strict';
// Testes do cliente OAuth 2.1 (PKCE + registro dinâmico) usado pelo harness
// para entrar no MCP do Archeo. Rodar com: node --test (na raiz do repo)
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const CD2OAuth = require('../web/oauth.js');

const MCP = 'https://archeo.example/api/mcp';
const ORIGIN = 'http://127.0.0.1:8081';
const PRM = { resource: MCP, authorization_servers: ['https://archeo.example'], scopes_supported: ['mcp:tools:read'] };
const ASM = {
  issuer: 'https://archeo.example',
  authorization_endpoint: 'https://archeo.example/api/oauth/authorize',
  token_endpoint: 'https://archeo.example/api/oauth/token',
  registration_endpoint: 'https://archeo.example/api/oauth/register',
  code_challenge_methods_supported: ['S256']
};

function memStorage(){
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m };
}
function jsonRes(status, body){
  return { ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
}
// fetch falso: routes = { 'METHOD url': (init) => response }, registra as chamadas
function fakeFetch(routes){
  const calls = [];
  const f = async (url, init = {}) => {
    const key = (init.method || 'GET') + ' ' + url;
    calls.push({ url, init, key });
    const h = routes[key];
    if(!h) throw new TypeError('rota não prevista no teste: ' + key);
    return typeof h === 'function' ? h(init, calls.length) : h;
  };
  f.calls = calls;
  return f;
}
function discoveryRoutes(){
  return {
    'GET https://archeo.example/.well-known/oauth-protected-resource': jsonRes(200, PRM),
    'GET https://archeo.example/.well-known/oauth-authorization-server': jsonRes(200, ASM)
  };
}
function make(routes, extra = {}){
  const fetch = fakeFetch(routes);
  const session = memStorage(), local = memStorage();
  const now = extra.now || (() => 1_000_000_000_000);
  const c = CD2OAuth.create({ mcpUrl: MCP, origin: ORIGIN, fetch, session, local, crypto: webcrypto, now, ...extra.opts });
  return { c, fetch, session, local };
}
async function registered(routes, extra){
  const env = make({ ...discoveryRoutes(), 'POST https://archeo.example/api/oauth/register': jsonRes(201, { client_id: 'ar_client_abc' }), ...routes }, extra);
  return env;
}
function formOf(init){ return new URLSearchParams(init.body); }

test('PKCE: challenge S256 bate com o vetor da RFC 7636', async () => {
  const ch = await CD2OAuth.pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', webcrypto);
  assert.equal(ch, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('PKCE: verifier gerado tem 43 a 128 caracteres só de base64url', () => {
  const v = CD2OAuth.pkceVerifier(webcrypto);
  assert.match(v, /^[A-Za-z0-9\-._~]{43,128}$/);
  assert.notEqual(v, CD2OAuth.pkceVerifier(webcrypto));
});

test('discover: lê o protected resource na origem do MCP e depois o authorization server', async () => {
  const { c, fetch } = make(discoveryRoutes());
  const d = await c.discover();
  assert.equal(d.resource, MCP);
  assert.equal(d.issuer, 'https://archeo.example');
  assert.equal(d.authorization_endpoint, ASM.authorization_endpoint);
  assert.equal(d.token_endpoint, ASM.token_endpoint);
  assert.equal(d.registration_endpoint, ASM.registration_endpoint);
  assert.deepEqual(fetch.calls.map(x => x.key), [
    'GET https://archeo.example/.well-known/oauth-protected-resource',
    'GET https://archeo.example/.well-known/oauth-authorization-server'
  ]);
});

test('discover: falha clara quando o servidor não anuncia OAuth', async () => {
  const { c } = make({ 'GET https://archeo.example/.well-known/oauth-protected-resource': jsonRes(404, {}) });
  await assert.rejects(c.discover(), /não anuncia OAuth/);
});

test('register: registra cliente público com nome "CD2 Harness (Claude)" e redirect exato na origem atual', async () => {
  const { c, fetch } = await registered();
  const id = await c.register();
  assert.equal(id, 'ar_client_abc');
  const reg = fetch.calls.find(x => x.key.startsWith('POST') && x.url.endsWith('/register'));
  const body = JSON.parse(reg.init.body);
  assert.equal(body.client_name, 'CD2 Harness (Claude)');
  assert.deepEqual(body.redirect_uris, [ORIGIN + '/']);
  assert.equal(body.application_type, 'web');
  assert.equal(body.token_endpoint_auth_method, 'none');
  assert.deepEqual(body.grant_types, ['authorization_code', 'refresh_token']);
  assert.equal(reg.init.headers['Content-Type'], 'application/json');
});

test('register: reaproveita o client_id guardado para a mesma origem e issuer, sem novo POST', async () => {
  const { c, fetch, local } = await registered();
  await c.register();
  const posts = () => fetch.calls.filter(x => x.key.startsWith('POST')).length;
  assert.equal(posts(), 1);
  const c2 = CD2OAuth.create({ mcpUrl: MCP, origin: ORIGIN, fetch, session: memStorage(), local, crypto: webcrypto, now: () => 1 });
  assert.equal(await c2.register(), 'ar_client_abc');
  assert.equal(posts(), 1);
});

test('beginLogin: monta a URL de autorização com PKCE S256, resource e scope, e guarda verifier e state na sessão', async () => {
  const { c, session } = await registered();
  const url = new URL(await c.beginLogin());
  assert.equal(url.origin + url.pathname, ASM.authorization_endpoint);
  const p = url.searchParams;
  assert.equal(p.get('response_type'), 'code');
  assert.equal(p.get('client_id'), 'ar_client_abc');
  assert.equal(p.get('redirect_uri'), ORIGIN + '/');
  assert.equal(p.get('code_challenge_method'), 'S256');
  assert.equal(p.get('resource'), MCP);
  assert.equal(p.get('scope'), 'mcp:tools:read');
  assert.ok(p.get('state').length >= 16);
  const pend = JSON.parse(session.getItem('cd2.oauth.pending'));
  assert.equal(pend.state, p.get('state'));
  assert.equal(await CD2OAuth.pkceChallenge(pend.verifier, webcrypto), p.get('code_challenge'));
  assert.equal(pend.token_endpoint, ASM.token_endpoint);
});

test('handleCallback: sem code na URL não faz nada e devolve false', async () => {
  const { c, fetch } = make({});
  assert.equal(await c.handleCallback('?foo=bar'), false);
  assert.equal(fetch.calls.length, 0);
});

test('handleCallback: troca o code pelo token com o verifier e guarda access, refresh e validade', async () => {
  let form;
  const { c, fetch, session } = await registered({
    'POST https://archeo.example/api/oauth/token': init => { form = formOf(init); return jsonRes(200, { access_token: 'ar_oauth_A1', token_type: 'Bearer', expires_in: 900, refresh_token: 'R1', scope: 'mcp:tools:read' }); }
  });
  const url = new URL(await c.beginLogin());
  const state = url.searchParams.get('state');
  const verifier = JSON.parse(session.getItem('cd2.oauth.pending')).verifier;
  assert.equal(await c.handleCallback('?code=C0DE&state=' + state), true);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('code'), 'C0DE');
  assert.equal(form.get('redirect_uri'), ORIGIN + '/');
  assert.equal(form.get('client_id'), 'ar_client_abc');
  assert.equal(form.get('code_verifier'), verifier);
  assert.equal(form.get('resource'), MCP);
  const tok = fetch.calls.find(x => x.url.endsWith('/token'));
  assert.equal(tok.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(session.getItem('cd2.oauth.pending'), null);
  assert.equal(await c.getToken(), 'ar_oauth_A1');
  assert.equal(c.isLoggedIn(), true);
});

test('handleCallback: state diferente do guardado recusa sem chamar o token endpoint', async () => {
  const { c, fetch } = await registered({ 'POST https://archeo.example/api/oauth/token': jsonRes(200, {}) });
  await c.beginLogin();
  await assert.rejects(c.handleCallback('?code=X&state=errado'), /state/);
  assert.equal(fetch.calls.some(x => x.url.endsWith('/token')), false);
});

test('handleCallback: erro vindo do Archeo vira mensagem legível e limpa o pendente', async () => {
  const { c, session } = await registered();
  const url = new URL(await c.beginLogin());
  const state = url.searchParams.get('state');
  await assert.rejects(c.handleCallback('?error=access_denied&error_description=sem%20permiss%C3%A3o&state=' + state), /sem permissão/);
  assert.equal(session.getItem('cd2.oauth.pending'), null);
});

test('getToken: sem login devolve null', async () => {
  const { c } = make({});
  assert.equal(await c.getToken(), null);
  assert.equal(c.isLoggedIn(), false);
});

test('getToken: renova com o refresh token quando faltam menos de 60 s e guarda o refresh rotacionado', async () => {
  let t = 1_000_000_000_000;
  const forms = [];
  const { c } = await registered({
    'POST https://archeo.example/api/oauth/token': (init, n) => { forms.push(formOf(init)); return jsonRes(200, { access_token: 'A' + forms.length, expires_in: 900, refresh_token: 'R' + forms.length }); }
  }, { now: () => t });
  const url = new URL(await c.beginLogin());
  await c.handleCallback('?code=C&state=' + url.searchParams.get('state'));
  assert.equal(await c.getToken(), 'A1');
  t += 850_000;                       // faltam 50 s
  assert.equal(await c.getToken(), 'A2');
  assert.equal(forms[1].get('grant_type'), 'refresh_token');
  assert.equal(forms[1].get('refresh_token'), 'R1');
  assert.equal(forms[1].get('client_id'), 'ar_client_abc');
  assert.equal(forms[1].get('resource'), MCP);
  t += 850_000;
  assert.equal(await c.getToken(), 'A3');
  assert.equal(forms[2].get('refresh_token'), 'R2');
});

test('getToken: refresh recusado (grant revogado) apaga a sessão e devolve null', async () => {
  let t = 1_000_000_000_000, n = 0;
  const { c, session } = await registered({
    'POST https://archeo.example/api/oauth/token': () => (++n === 1 ? jsonRes(200, { access_token: 'A1', expires_in: 900, refresh_token: 'R1' }) : jsonRes(400, { error: 'invalid_grant' }))
  }, { now: () => t });
  const url = new URL(await c.beginLogin());
  await c.handleCallback('?code=C&state=' + url.searchParams.get('state'));
  t += 900_000;
  assert.equal(await c.getToken(), null);
  assert.equal(c.isLoggedIn(), false);
  assert.equal(session.getItem('cd2.oauth.tokens'), null);
});

test('forceRefresh: um 401 do gateway força renovação mesmo com token dentro do prazo', async () => {
  let n = 0;
  const { c } = await registered({
    'POST https://archeo.example/api/oauth/token': () => jsonRes(200, { access_token: 'A' + (++n), expires_in: 900, refresh_token: 'R' + n })
  });
  const url = new URL(await c.beginLogin());
  await c.handleCallback('?code=C&state=' + url.searchParams.get('state'));
  assert.equal(await c.getToken(), 'A1');
  assert.equal(await c.forceRefresh(), 'A2');
});

test('logout: esquece tokens da sessão mas mantém o client_id registrado', async () => {
  const { c, session, local } = await registered({
    'POST https://archeo.example/api/oauth/token': jsonRes(200, { access_token: 'A1', expires_in: 900, refresh_token: 'R1' })
  });
  const url = new URL(await c.beginLogin());
  await c.handleCallback('?code=C&state=' + url.searchParams.get('state'));
  c.logout();
  assert.equal(await c.getToken(), null);
  assert.equal(session.getItem('cd2.oauth.tokens'), null);
  assert.ok([...local._m.keys()].some(k => k.startsWith('cd2.oauth.client')));
});

test('tokens ficam só na sessão: nada de access ou refresh no localStorage', async () => {
  const { c, local } = await registered({
    'POST https://archeo.example/api/oauth/token': jsonRes(200, { access_token: 'SECRETA', expires_in: 900, refresh_token: 'SECRETR' })
  });
  const url = new URL(await c.beginLogin());
  await c.handleCallback('?code=C&state=' + url.searchParams.get('state'));
  const dump = JSON.stringify([...local._m.entries()]);
  assert.ok(!dump.includes('SECRETA') && !dump.includes('SECRETR'));
});
