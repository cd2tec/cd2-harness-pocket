'use strict';
// db-env.sh: grava e le o db.env sem quebrar com senha "dificil". Rodar: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const SH = path.join(__dirname, '..', 'core', 'db-env.sh');
const sh = (script, input, opts) => execFileSync('sh', ['-c', script], { input: input || '', encoding: 'utf8', ...(opts || {}) });

test('db_env_write grava, protege e a senha dificil volta igual', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cd2-')), 'db.env');
  const pw = "se nh@$'x#\\y";
  sh(`. "${SH}"; db_env_write "${f}" postgres db.local 5432 cd2 leitor "$PW" public`, '', { env: { ...process.env, PW: pw } });
  // le de volta com o proprio sh, como o launcher faz
  const back = execFileSync('sh', ['-c', `set -a; . "${f}"; set +a; printf '%s\\n%s\\n%s' "$CD2_DB_ENGINE" "$CD2_DB_PASSWORD" "$CD2_DB_SCHEMA"`], { encoding: 'utf8' });
  assert.deepEqual(back.split('\n'), ['postgres', pw, 'public']);
  assert.equal((fs.statSync(f).mode & 0o777).toString(8), '600');
  const txt = fs.readFileSync(f, 'utf8');
  assert.match(txt, /^CD2_DB_ENGINE='postgres'\n/); assert.equal(txt.split('\n').filter(Boolean).length, 7);
});

test('db_env_defaults por motor', () => {
  assert.equal(sh(`. "${SH}"; db_env_defaults postgres`).trim(), '5432 public');
  assert.equal(sh(`. "${SH}"; db_env_defaults oracle`).trim(), '1521');
  assert.equal(sh(`. "${SH}"; db_env_defaults mariadb`).trim(), '3306');
  assert.equal(sh(`. "${SH}"; db_env_defaults sqlserver`).trim(), '1433 dbo');
});

test('db_env_ask: respostas pelo stdin, defaults por motor, 0 = nenhum', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cd2-')), 'db.env');
  // motor 2 (oracle), host, porta vazia (default 1521), service, usuario, senha, schema vazio (default USUARIO em maiusculas)
  sh(`. "${SH}"; db_env_ask "${f}"`, '2\norasrv\n\nFREEPDB1\nleitor\nsegredo\n\n');
  const txt = fs.readFileSync(f, 'utf8');
  assert.match(txt, /CD2_DB_ENGINE='oracle'/); assert.match(txt, /CD2_DB_PORT='1521'/); assert.match(txt, /CD2_DB_SCHEMA='LEITOR'/);
  // mariadb: schema vazio vira o nome da base
  sh(`. "${SH}"; db_env_ask "${f}"`, '3\nmdb\n\nloja\nleitor\nsegredo\n\n');
  assert.match(fs.readFileSync(f, 'utf8'), /CD2_DB_SCHEMA='loja'/);
  // 0 = nenhum: devolve 1 e nao grava
  fs.unlinkSync(f);
  assert.throws(() => sh(`. "${SH}"; db_env_ask "${f}"`, '0\n'), e => e.status === 1);
  assert.equal(fs.existsSync(f), false);
});
