#!/usr/bin/env sh
# tests/ctl/e2e.sh - cd2-ctl de ponta a ponta com o toolbox de verdade e o Postgres do Docker.
# Precisa de: go, curl, jq, o servico postgres no ar
#   (docker compose -f tests/toolbox/docker-compose.yml up -d postgres)
# e bin/toolbox/<plataforma>/toolbox (rode o preparo ou copie de um pen drive preparado).
# Uso: sh tests/ctl/e2e.sh        (CD2_E2E_PORT muda a porta P; padrao 18080)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
WORK=""; CTL_PID=""
fail() {
  printf '[FALHOU] %s\n' "$*" >&2
  [ -n "$WORK" ] && [ -f "$WORK/ctl.log" ] && sed 's/^/   ctl: /' "$WORK/ctl.log" >&2
  exit 1
}
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLAT=darwin-arm64 ;; Darwin-*) PLAT=darwin-amd64 ;;
  Linux-aarch64|Linux-arm64) PLAT=linux-arm64 ;; *) PLAT=linux-amd64 ;;
esac
TB="$ROOT/bin/toolbox/$PLAT/toolbox"
[ -x "$TB" ] || fail "sem $TB (rode o preparo ou copie de um pen drive preparado)"
command -v jq >/dev/null 2>&1 || fail "precisa do jq"
HP="${CD2_E2E_PORT:-18080}"; TP=$((HP + 1000)); CP=$((HP + 2000))
GOOD_PW="cd2 s3nh@'x"               # senha do postgres de tests/toolbox/docker-compose.yml
BAD_PW="errada \"e2e\" \\ \$x'y"    # aspas, barra e cifrao: tem de sumir da resposta e do log
BAD_DQ="$(printf '%s' "$BAD_PW" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/cd2-e2e.XXXXXX")"
cleanup() {
  if [ -n "$CTL_PID" ]; then kill "$CTL_PID" 2>/dev/null; wait "$CTL_PID" 2>/dev/null; fi
  rm -rf "$WORK"
}
trap cleanup EXIT
# raiz de mentira: o cd2-ctl so le bin/toolbox/<plataforma>/toolbox e core/toolbox/
mkdir -p "$WORK/root/bin/toolbox/$PLAT" "$WORK/root/core" "$WORK/cache"
ln -s "$TB" "$WORK/root/bin/toolbox/$PLAT/toolbox"
ln -s "$ROOT/core/toolbox" "$WORK/root/core/toolbox"
( cd "$ROOT/ctl" && go build -o "$WORK/cd2-ctl" . ) || fail "go build"
KEY="$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')"
start_ctl() {
  CD2_CTL_KEY="$KEY" "$WORK/cd2-ctl" --root "$WORK/root" --cache "$WORK/cache" --harness-port "$HP" >> "$WORK/ctl.log" 2>&1 &
  CTL_PID=$!
}
CTL="http://127.0.0.1:$CP"
api()  { curl -s --max-time 40 -H "Authorization: Bearer $KEY" -H "Origin: http://127.0.0.1:$HP" "$@"; }
post() { api -X POST -H 'Content-Type: application/json' --data-binary "$1" "$CTL/config"; }
body() { jq -nc --arg s "$1" '{motor:"postgres", host:"127.0.0.1", porta:55432, base:"cd2", usuario:"cd2", senha:$s, schema:""}'; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
field() { printf '%s' "$1" | jq -r "$2"; }
mcp_engine() {
  curl -s --max-time 5 -X POST "http://127.0.0.1:$TP/mcp" -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' -H 'MCP-Protocol-Version: 2025-06-18' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"db_connection_status","arguments":{}}}' \
    | jq -r '.result.content[0].text' | jq -r '.engine'
}

echo "== arranque sem db.env"
start_ctl
i=0; while [ "$(code "$CTL/status")" != 401 ]; do i=$((i + 1)); [ "$i" -lt 50 ] || fail "cd2-ctl nao subiu"; sleep 0.2; done
[ "$(field "$(api "$CTL/status")" .estado)" = sem_banco ] || fail "estado inicial"

echo "== seguranca"
[ "$(code -H "Authorization: Bearer 0$KEY" "$CTL/status")" = 401 ] || fail "chave errada deveria dar 401"
[ "$(code -H "Authorization: Bearer $KEY" -H 'Origin: http://evil.example' "$CTL/status")" = 403 ] || fail "Origin errada deveria dar 403"
[ "$(code -H "Authorization: Bearer $KEY" -H 'Host: evil.example' "$CTL/status")" = 403 ] || fail "Host errado deveria dar 403"
[ "$(code -X POST -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' --data-binary '{}' "$CTL/config")" = 403 ] || fail "POST sem Origin deveria dar 403"

echo "== configura certo"
R="$(post "$(body "$GOOD_PW")")"
[ "$(field "$R" .estado)" = rodando ] || fail "esperava rodando: $R"
[ "$(field "$R" .schema)" = public ] || fail "schema padrao: $R"
[ "$(field "$R" .senha_salva)" = true ] || fail "senha_salva: $R"
printf '%s' "$R" | grep -qF 's3nh' && fail "senha na resposta"
[ "$(mcp_engine)" = postgres ] || fail "toolbox nao responde db_connection_status"
case "$(uname -s)" in Darwin) PERM="$(stat -f %Lp "$WORK/cache/db.env")" ;; *) PERM="$(stat -c %a "$WORK/cache/db.env")" ;; esac
[ "$PERM" = 600 ] || fail "db.env com permissao $PERM"
cp "$WORK/cache/db.env" "$WORK/db.env.antes"

echo "== senha errada: rollback"
R="$(post "$(body "$BAD_PW")")"
[ "$(field "$R" .estado)" = rodando ] || fail "a conexao anterior deveria seguir rodando: $R"
[ -n "$(field "$R" '.erro // empty')" ] || fail "sem erro na resposta: $R"
[ "$(field "$R" '.log | length')" -ge 1 ] || fail "sem log na resposta: $R"
# o JSON escapa " e \ do mesmo jeito que o YAML: procurar BAD_DQ pega a senha dentro do JSON
for s in "$BAD_PW" "$BAD_DQ" "$GOOD_PW"; do
  printf '%s' "$R" | grep -qF -- "$s" && fail "senha na resposta"
  grep -qF -- "$s" "$WORK/cache/toolbox.log" && fail "senha no toolbox.log"
done
grep -qi password "$WORK/cache/toolbox.log" && fail "linha com password no toolbox.log"
cmp -s "$WORK/cache/db.env" "$WORK/db.env.antes" || fail "db.env mudou depois da falha"
[ "$(mcp_engine)" = postgres ] || fail "o toolbox anterior nao voltou"

echo "== senha em branco mantem a salva"
R="$(post '{"motor":"postgres","host":"127.0.0.1","porta":55432,"base":"cd2","usuario":"cd2","schema":"public"}')"
[ "$(field "$R" .estado)" = rodando ] && [ -z "$(field "$R" '.erro // empty')" ] || fail "senha herdada: $R"

echo "== desconectar"
R="$(api -X DELETE "$CTL/config")"
[ "$(field "$R" .estado)" = sem_banco ] || fail "DELETE: $R"
[ ! -e "$WORK/cache/db.env" ] || fail "db.env continua la"
[ "$(code --max-time 2 "http://127.0.0.1:$TP/")" = 000 ] || fail "toolbox continua de pe"

echo "== encerra sem sobrar processo"
post "$(body "$GOOD_PW")" >/dev/null
kill "$CTL_PID"; wait "$CTL_PID" 2>/dev/null; CTL_PID=""
[ "$(code --max-time 2 "http://127.0.0.1:$TP/")" = 000 ] || fail "toolbox sobrou depois do TERM"
pgrep -f "$WORK/cache/toolbox" >/dev/null && fail "processo do toolbox sobrou"

echo "== reabre com o db.env salvo"
start_ctl
i=0; until [ "$(field "$(api "$CTL/status")" .estado 2>/dev/null)" = rodando ]; do
  i=$((i + 1)); [ "$i" -lt 100 ] || fail "nao subiu com o db.env salvo"; sleep 0.2
done
[ "$(mcp_engine)" = postgres ] || fail "toolbox do arranque nao responde"
echo "OK: e2e do cd2-ctl"
