'use strict';
// Troca de GPU para CPU no core/start-unix.sh. Num MacBook Air M1 de 8 GB (16/10/2026) a tentativa com GPU
// nao respondeu a tempo, o launcher esperou 1 s fixo depois do kill e subiu a de CPU na mesma porta com a
// primeira ainda viva: "couldn't bind HTTP server socket". E o log da primeira tinha sido apagado. Rodar: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');

const sh = fs.readFileSync(path.join(__dirname, '..', 'core', 'start-unix.sh'), 'utf8');
const funcao = nome => { const i = sh.indexOf(nome + '() {'); assert.ok(i >= 0, 'sem ' + nome); return sh.slice(i, sh.indexOf('\n}\n', i) + 3); };

test('parar_servidor so volta com o processo morto, mesmo se ele demorar a sair do TERM', () => {
  const out = execFileSync('sh', ['-c', funcao('parar_servidor') +
    'sh -c \'trap "" TERM; sleep 4\' & PID=$!; sleep 0.2; ini=$(date +%s); parar_servidor; ' +
    'kill -0 "$PID" 2>/dev/null && echo vivo || echo morto; echo "pid=[$PID]"'], { encoding: 'utf8', timeout: 20000 });
  assert.match(out, /morto/);
  assert.match(out, /pid=\[\]/);
});

test('fallback para CPU para o servidor de GPU antes e guarda o log dele', () => {
  const f = sh.slice(sh.indexOf('if ! robo_esperar'), sh.indexOf('robo_fim ok'));
  assert.match(f, /parar_servidor[\s\S]*start_server --gpu disable/);
  assert.doesNotMatch(f, /kill "\$PID" 2>\/dev\/null; sleep 1/);
  assert.match(f, /server-gpu\.log/);
});
