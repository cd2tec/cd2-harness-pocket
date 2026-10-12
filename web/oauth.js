/* Cliente OAuth 2.1 do CD2 Harness para o MCP do Archeo.
   Authorization Code + PKCE (S256) + registro dinâmico de cliente (RFC 7591),
   como descreve a spec 041 do cd2-graph-agents. Cliente público, sem secret.

   Decisão de 12/10/2026: o consentimento do Archeo só aceita cliente Codex ou
   Claude Code, classificado pelo NOME do cliente. Por isso o nome abaixo leva
   "Claude". É gambiarra consciente; quando o Archeo aceitar um kind próprio,
   troque CLIENT_NAME e nada mais muda.

   Onde cada coisa mora:
   - client_id: localStorage (não é segredo; evita bater no limite de 20
     registros/hora do Archeo a cada recarga).
   - verifier/state do login em andamento e os tokens: sessionStorage. Fechou a
     aba, acabou. O pen drive circula; nada de token gravado nele. */
(function(root){
"use strict";
const CLIENT_NAME = 'CD2 Harness (Claude)';
const SCOPE = 'mcp:tools:read';
const K_PENDING = 'cd2.oauth.pending', K_TOKENS = 'cd2.oauth.tokens', K_CLIENT = 'cd2.oauth.client';
const REFRESH_MARGIN_MS = 60 * 1000;

const noStore = { getItem(){ return null; }, setItem(){}, removeItem(){} };
function safe(s){ // storage pode lançar (modo privado, cota); nunca derrubar o fluxo por isso
  s = s || noStore;
  return {
    get(k){ try{ return s.getItem(k); }catch(e){ return null; } },
    set(k, v){ try{ s.setItem(k, v); }catch(e){} },
    del(k){ try{ s.removeItem(k); }catch(e){} }
  };
}
function b64url(bytes){
  let s = '';
  for(const b of bytes) s += String.fromCharCode(b);
  const b64 = typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pkceVerifier(crypto){
  const bytes = new Uint8Array(48); // 48 bytes -> 64 chars base64url
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}
async function pkceChallenge(verifier, crypto){
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}
function randomState(crypto){ const b = new Uint8Array(24); crypto.getRandomValues(b); return b64url(b); }

class OAuthError extends Error{
  constructor(code, message){ super(message || code); this.code = code; }
}
async function readJson(r){ try{ return await r.json(); }catch(e){ return {}; } }
function oauthMessage(body, fallback){
  const desc = body && (body.error_description || body.error);
  return desc ? String(desc) : fallback;
}

function create(opts){
  const mcpUrl = String(opts.mcpUrl || '');
  const origin = String(opts.origin || '').replace(/\/$/, '');
  const fetchFn = opts.fetch;
  const crypto = opts.crypto;
  const now = opts.now || (() => Date.now());
  const session = safe(opts.session), local = safe(opts.local);
  const redirectUri = origin + '/';
  let meta = null, refreshing = null;

  async function discover(){
    if(meta) return meta;
    let base;
    try{ base = new URL(mcpUrl).origin; }catch(e){ throw new OAuthError('invalid_url', 'URL do MCP inválida'); }
    const prm = await fetchFn(base + '/.well-known/oauth-protected-resource', { headers:{ Accept:'application/json' } });
    if(!prm.ok) throw new OAuthError('no_oauth', 'O servidor MCP não anuncia OAuth (HTTP ' + prm.status + ' no discovery)');
    const pr = await readJson(prm);
    const issuer = (pr.authorization_servers || [])[0];
    if(!issuer || !pr.resource) throw new OAuthError('no_oauth', 'O servidor MCP não anuncia OAuth (metadata incompleto)');
    const asr = await fetchFn(issuer.replace(/\/$/, '') + '/.well-known/oauth-authorization-server', { headers:{ Accept:'application/json' } });
    if(!asr.ok) throw new OAuthError('no_oauth', 'O servidor MCP não anuncia OAuth (HTTP ' + asr.status + ' no authorization server)');
    const as = await readJson(asr);
    if(!as.authorization_endpoint || !as.token_endpoint) throw new OAuthError('no_oauth', 'O servidor MCP não anuncia OAuth (sem endpoints)');
    meta = { resource: pr.resource, issuer: as.issuer || issuer, authorization_endpoint: as.authorization_endpoint,
      token_endpoint: as.token_endpoint, registration_endpoint: as.registration_endpoint || null, revocation_endpoint: as.revocation_endpoint || null };
    return meta;
  }

  async function register(){
    const m = await discover();
    const key = K_CLIENT + ':' + origin + '|' + m.issuer;
    const cached = local.get(key);
    if(cached) return cached;
    if(!m.registration_endpoint) throw new OAuthError('no_dcr', 'O Archeo não aceita registro dinâmico de cliente');
    const r = await fetchFn(m.registration_endpoint, { method:'POST', headers:{ 'Content-Type':'application/json', Accept:'application/json' },
      body: JSON.stringify({ client_name: CLIENT_NAME, redirect_uris:[redirectUri], application_type:'web', token_endpoint_auth_method:'none',
        grant_types:['authorization_code', 'refresh_token'], response_types:['code'], scope: SCOPE }) });
    const body = await readJson(r);
    if(!r.ok || !body.client_id) throw new OAuthError(body.error || 'registration_failed', oauthMessage(body, 'Registro do cliente recusado (HTTP ' + r.status + ')'));
    local.set(key, body.client_id);
    return body.client_id;
  }

  async function beginLogin(){
    const m = await discover();
    const clientId = await register();
    const verifier = pkceVerifier(crypto), state = randomState(crypto);
    const challenge = await pkceChallenge(verifier, crypto);
    session.set(K_PENDING, JSON.stringify({ verifier, state, client_id: clientId, token_endpoint: m.token_endpoint, resource: m.resource }));
    const u = new URL(m.authorization_endpoint);
    const p = { response_type:'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method:'S256', resource: m.resource, scope: SCOPE, state };
    for(const k in p) u.searchParams.set(k, p[k]);
    return u.toString();
  }

  async function tokenRequest(endpoint, form){
    const r = await fetchFn(endpoint, { method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded', Accept:'application/json' }, body: new URLSearchParams(form).toString() });
    const body = await readJson(r);
    if(!r.ok || !body.access_token) throw new OAuthError(body.error || 'token_failed', oauthMessage(body, 'Troca de token recusada (HTTP ' + r.status + ')'));
    return body;
  }
  function saveTokens(body, clientId, tokenEndpoint, resource){
    const ttl = Number(body.expires_in) > 0 ? Number(body.expires_in) * 1000 : 15 * 60 * 1000;
    session.set(K_TOKENS, JSON.stringify({ access: body.access_token, refresh: body.refresh_token || null, exp: now() + ttl, client_id: clientId, token_endpoint: tokenEndpoint, resource }));
  }
  function loadTokens(){ try{ return JSON.parse(session.get(K_TOKENS) || 'null'); }catch(e){ return null; } }

  async function handleCallback(search){
    const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    if(!q.has('code') && !q.has('error')) return false;
    let pending = null; try{ pending = JSON.parse(session.get(K_PENDING) || 'null'); }catch(e){}
    session.del(K_PENDING);
    if(!pending) throw new OAuthError('no_pending', 'Voltou do Archeo sem um login em andamento nesta aba. Tente entrar de novo.');
    if(q.get('state') !== pending.state) throw new OAuthError('state_mismatch', 'O state da resposta não confere com o do login iniciado. Tente entrar de novo.');
    if(q.has('error')) throw new OAuthError(q.get('error'), q.get('error_description') || ('O Archeo recusou o login (' + q.get('error') + ')'));
    const body = await tokenRequest(pending.token_endpoint, { grant_type:'authorization_code', code: q.get('code'), redirect_uri: redirectUri, client_id: pending.client_id, code_verifier: pending.verifier, resource: pending.resource });
    saveTokens(body, pending.client_id, pending.token_endpoint, pending.resource);
    return true;
  }

  async function refresh(t){
    if(refreshing) return refreshing;
    refreshing = (async () => {
      try{
        const body = await tokenRequest(t.token_endpoint, { grant_type:'refresh_token', refresh_token: t.refresh, client_id: t.client_id, resource: t.resource });
        saveTokens(body, t.client_id, t.token_endpoint, t.resource);
        return body.access_token;
      }catch(e){
        session.del(K_TOKENS); // grant revogado, família reusada ou expirada: volta ao botão de entrar
        return null;
      }finally{ refreshing = null; }
    })();
    return refreshing;
  }
  async function getToken(){
    const t = loadTokens();
    if(!t) return null;
    if(t.exp - now() > REFRESH_MARGIN_MS) return t.access;
    if(!t.refresh){ session.del(K_TOKENS); return null; }
    return refresh(t);
  }
  async function forceRefresh(){
    const t = loadTokens();
    if(!t || !t.refresh){ session.del(K_TOKENS); return null; }
    return refresh(t);
  }
  function isLoggedIn(){ return !!loadTokens(); }
  function logout(){ session.del(K_TOKENS); session.del(K_PENDING); }

  return { discover, register, beginLogin, handleCallback, getToken, forceRefresh, isLoggedIn, logout, clientName: CLIENT_NAME };
}

const api = { create, pkceVerifier, pkceChallenge, OAuthError, CLIENT_NAME };
if(typeof module !== 'undefined' && module.exports) module.exports = api;
else root.CD2OAuth = api;
})(typeof window !== 'undefined' ? window : globalThis);
