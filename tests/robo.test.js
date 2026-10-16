'use strict';
// Testes do robo de carregamento do terminal (core/robo-unix.sh). Rodar: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const run = (script, env) => new Promise(resolve => {
  execFile('sh', ['-c', '. "$ROOT/core/robo-unix.sh"; robo_init; ' + script], {
    env: Object.assign({ PATH: process.env.PATH, ROOT, LANG: 'C.UTF-8' }, env), encoding: 'utf8', timeout: 20000
  }, (err, stdout, stderr) => resolve({ code: err ? (err.code || 1) : 0, out: stdout, err: stderr }));
});
const FANCY = { CD2_ROBO_FORCAR: '1' };
const SIMPLE = { NO_COLOR: '1' };
const linhas = s => s.split('\n').filter(l => l.length);

test('quadro: 6 linhas de pixel e a linha de status, com cor', async () => {
  const r = await run('robo_quadro lendo 3 62 "Lendo o modelo 62%"', FANCY);
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.includes('\x1b[38;5;'), 'sem cor');
  assert.ok(r.out.includes('▀') || r.out.includes('▄'), 'sem meio-bloco');
  assert.ok(r.out.includes('Lendo o modelo 62%'));
  assert.equal(linhas(r.out.replace(/\x1b\[\?25[lh]/g, '')).length, 7);
});

test('quadro: o cerebro enche com o progresso', async () => {
  const cheio = (await run('robo_quadro lendo 0 100 x', FANCY)).out;
  const vazio = (await run('robo_quadro lendo 0 0 x', FANCY)).out;
  const conta = s => s.split('5;205m').length - 1;
  assert.ok(conta(cheio) > conta(vazio), conta(cheio) + ' <= ' + conta(vazio));
  assert.equal(conta(vazio), 0);
});

test('quadro: segundo quadro sobe o cursor e redesenha no lugar', async () => {
  const r = await run('robo_quadro lendo 0 10 a; robo_quadro lendo 1 10 b', FANCY);
  assert.ok(r.out.includes('\x1b[7A'));
});

test('quadros de todos os estados rodam sem erro', async () => {
  for(const e of ['lendo', 'acordando', 'pronto', 'erro']){
    const r = await run('robo_quadro ' + e + ' 5 50 ok', FANCY);
    assert.equal(r.code, 0, e + ': ' + r.err);
    assert.equal(r.err, '', e);
  }
});

test('acordando: o cerebro dorme soltando zzZ e acorda sorrindo no pronto', async () => {
  const sono = (await run('robo_quadro acordando 9 90 x', FANCY)).out;
  assert.equal((sono.match(/;1;38;5;\d+m[zZ]/g) || []).length, 3, 'sem zzZ');
  const cutucando = (await run('robo_quadro acordando 25 90 x', FANCY)).out;
  assert.ok(!/;1;38;5;\d+m[zZ]/.test(cutucando), 'zzZ durante a cutucada');
  const pronto = (await run('robo_quadro pronto 2 100 x', FANCY)).out;
  assert.ok(!/;1;38;5;\d+m[zZ]/.test(pronto), 'zzZ no pronto');
  assert.ok(pronto.includes('5;255'), 'sem olho branco');
});

test('acordando: a frase muda a cada ciclo de 6 s', async () => {
  const r = await run('robo_frase 0; robo_frase 30; robo_frase 60; robo_frase 90; robo_frase 120', {});
  const f = linhas(r.out);
  assert.equal(new Set(f.slice(0, 4)).size, 4);
  assert.equal(f[4], f[0]);
});

test('modo simples: sem escape de cor nem desenho', async () => {
  const r = await run('robo_quadro lendo 3 62 "Lendo"; robo_fim ok "Pronto"', SIMPLE);
  assert.ok(!r.out.includes('\x1b['), JSON.stringify(r.out));
  assert.ok(r.out.includes('Pronto'));
});

test('robo_ler le o arquivo inteiro em pedacos e chega a 100%', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robo-'));
  const f = path.join(dir, 'modelo.gguf');
  fs.writeFileSync(f, Buffer.alloc(3 * 1048576 + 123, 1));
  const r = await run('robo_ler "' + f + '"; echo "rc=$?"', Object.assign({ CD2_ROBO_BLOCO_MB: '1' }, SIMPLE));
  assert.match(r.out, /rc=0/);
  assert.match(r.out, /100%/);
  fs.rmSync(dir, { recursive:true, force:true });
});

test('robo_ler com arquivo que nao existe devolve erro', async () => {
  const r = await run('robo_ler /nao/existe.gguf; echo "rc=$?"', SIMPLE);
  assert.match(r.out, /rc=1/);
});

test('robo_esperar: processo morto devolve 1 na hora', async () => {
  const r = await run('robo_esperar http://127.0.0.1:9/ 999999 30; echo "rc=$?"', SIMPLE);
  assert.match(r.out, /rc=1/);
});

test('robo_esperar: devolve 0 quando o /health responde', async () => {
  let n = 0;
  const srv = http.createServer((req, res) => { n++; res.statusCode = n < 2 ? 503 : 200; res.end('{}'); });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const vivo = spawn('sleep', ['30']);
  const url = 'http://127.0.0.1:' + srv.address().port;
  const r = await run('robo_esperar ' + url + ' ' + vivo.pid + ' 30; echo "rc=$?"', SIMPLE);
  vivo.kill(); srv.close();
  assert.match(r.out, /rc=0/);
});

test('robo_esperar: prazo estourado devolve 1', async () => {
  const srv = http.createServer((req, res) => { res.statusCode = 503; res.end('{}'); });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const vivo = spawn('sleep', ['30']);
  const r = await run('robo_esperar http://127.0.0.1:' + srv.address().port + ' ' + vivo.pid + ' 2; echo "rc=$?"', SIMPLE);
  vivo.kill(); srv.close();
  assert.match(r.out, /rc=1/);
});

test('robo_restaura devolve o cursor no modo com cor', async () => {
  const r = await run('robo_quadro lendo 0 0 x; robo_restaura', FANCY);
  assert.ok(r.out.includes('\x1b[?25l'));
  assert.ok(r.out.endsWith('\x1b[?25h'));
});

// PowerShell nao diferencia maiusculas em nome de variavel: $T e $t sao a mesma. Em 16/10/2026 o
// $t do pixel apagava o $T das letras zzZ e o Windows quebrava com "ForegroundColor nulo".
test('scripts PowerShell nao usam duas grafias da mesma variavel', () => {
  const dir = path.join(ROOT, 'core');
  for(const f of fs.readdirSync(dir).filter(n => n.endsWith('.ps1'))){
    const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\s*#.*$/gm, '').replace(/'[^'\n]*'/g, "''");
    const grafias = new Map();
    for(const m of src.matchAll(/\$(?:script:|global:|env:)?([A-Za-z_][A-Za-z0-9_]*)/g)){
      const k = m[0].toLowerCase(), s = grafias.get(k) || new Set();
      s.add(m[0]); grafias.set(k, s);
    }
    const ruins = [...grafias.values()].filter(s => s.size > 1).map(s => [...s].join('/'));
    assert.deepEqual(ruins, [], f);
  }
});
