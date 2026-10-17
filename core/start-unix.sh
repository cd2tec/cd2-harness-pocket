#!/usr/bin/env sh
# CD2 Harness - launcher para macOS e Linux (POSIX sh)
# Uso: sh core/start-unix.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT_START="${CD2_PORT:-8080}"
CTX="${CD2_CTX:-8192}"
OS="$(uname -s)"

say()  { printf '%s\n' "$*"; }
die()  { printf '\n[ERRO] %s\n' "$*" >&2; printf 'Pressione ENTER para sair.'; read -r _ || true; exit 1; }

banner() {
  printf '\n'
  printf '  \033[38;5;179m+-----------------------------+\033[0m\n'
  printf '  \033[38;5;179m|\033[0m   \033[1mCD2 Tech\033[0m  IA de Bolso     \033[38;5;179m|\033[0m\n'
  printf '  \033[38;5;179m+-----------------------------+\033[0m\n'
  printf '  IA local, sem nuvem.\n\n'
}
banner

# --- localizar binario e modelo -------------------------------------------
SRC_BIN="$ROOT/bin/llamafile"
[ -f "$SRC_BIN" ] || die "bin/llamafile nao encontrado. Rode a preparacao do pen drive (core/prepare-unix.sh)."

MODEL="$(ls "$ROOT"/models/*.gguf 2>/dev/null | head -n 1)"
[ -n "$MODEL" ] || die "Nenhum modelo .gguf em models/. Rode a preparacao do pen drive."

# --- pen drives exFAT/FAT nao guardam permissao de execucao (e muitos sao noexec):
# --- por isso o binario roda de uma copia local.
if [ "$OS" = "Darwin" ]; then CACHE="$HOME/Library/Caches/cd2-harness"; else CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/cd2-harness"; fi
mkdir -p "$CACHE" || die "Nao consegui criar $CACHE"
RUN_BIN="$CACHE/llamafile"
if [ ! -x "$RUN_BIN" ] || ! cmp -s "$SRC_BIN" "$RUN_BIN"; then
  say "Preparando o motor de IA (primeira execucao neste computador)..."
  cp "$SRC_BIN" "$RUN_BIN.tmp" && chmod +x "$RUN_BIN.tmp" && mv "$RUN_BIN.tmp" "$RUN_BIN" || die "Falha ao copiar o motor para $CACHE"
  [ "$OS" = "Darwin" ] && xattr -dr com.apple.quarantine "$RUN_BIN" 2>/dev/null
fi

# --- trio de portas livre: P (harness), P+1000 (toolbox) e P+3000 (cd2-ctl) -----
# ocupada = alguem aceitou a conexao; o curl so devolve 7 quando ninguem escuta
busy() { curl -s --max-time 1 -o /dev/null "http://127.0.0.1:$1/" 2>/dev/null; [ "$?" -ne 7 ]; }
PORT="$PORT_START"; tries=0
while { busy "$PORT" || busy "$((PORT + 1000))" || busy "$((PORT + 3000))"; } && [ "$tries" -lt 20 ]; do PORT=$((PORT + 1)); tries=$((tries + 1)); done
URL="http://127.0.0.1:$PORT"
CTL_PORT=$((PORT + 3000))
# chave da sessao: 32 bytes aleatorios em hexadecimal. Vai so para o ambiente do cd2-ctl e para a
# janela (#k=). Nao e exportada: o navegador aberto depois nao a herda pelo ambiente.
CTL_KEY="$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')"

LOG="$CACHE/server.log"
PID=""
CTL_PID=""
# idempotente: Ctrl+C roda cleanup e sai; o EXIT roda de novo sem efeito.
# O cd2-ctl recebe TERM e derruba o toolbox antes de sair.
cleanup() {
  [ -n "$PID" ] && kill "$PID" 2>/dev/null; PID=""
  [ -n "$CTL_PID" ] && kill "$CTL_PID" 2>/dev/null; CTL_PID=""
  [ -t 0 ] && stty echo 2>/dev/null
  command -v robo_restaura >/dev/null 2>&1 && robo_restaura
  return 0
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

start_server() {  # $@ = flags extras (GPU)
  : > "$LOG"
  if [ "$#" -gt 0 ]; then
    "$RUN_BIN" -m "$MODEL" --server --host 127.0.0.1 --port "$PORT" --jinja -c "$CTX" --path "$ROOT/web" "$@" >> "$LOG" 2>&1 &
  else
    "$RUN_BIN" -m "$MODEL" --server --host 127.0.0.1 --port "$PORT" --jinja -c "$CTX" --path "$ROOT/web" >> "$LOG" 2>&1 &
  fi
  PID=$!
}

# So volta com o servidor morto: a tentativa seguinte usa a mesma porta. Num Mac de 8 GB o llamafile
# carregando pode levar mais que 1 s para sair do TERM; depois de 10 s vai KILL.
parar_servidor() {
  [ -n "$PID" ] || return 0
  kill "$PID" 2>/dev/null
  n=0
  while kill -0 "$PID" 2>/dev/null; do
    n=$((n + 1))
    [ "$n" -eq 20 ] && kill -9 "$PID" 2>/dev/null
    [ "$n" -ge 30 ] && break
    sleep 0.5
  done
  PID=""
}

# robo de carregamento: le o modelo em pedacos (progresso real) e anima enquanto o servidor sobe
. "$ROOT/core/robo-unix.sh"
robo_init
# Para quem usa, o modelo e so "o modelo de IA": o nome do arquivo nao aparece no terminal.
say "Carregando o modelo de IA..."
robo_ler "$MODEL" || say "[AVISO] Nao consegui ler o modelo antes de subir o servidor; seguindo assim mesmo."
start_server -ngl 999
if ! robo_esperar "$URL" "$PID" 240; then
  robo_aviso "Aceleracao por GPU indisponivel, tentando so com CPU..."
  parar_servidor
  cp "$LOG" "$CACHE/server-gpu.log" 2>/dev/null  # o start_server zera o log; o da GPU explica a troca
  start_server --gpu disable -ngl 0
  robo_esperar "$URL" "$PID" 240 || { robo_fim erro "O modelo nao subiu."; die "O servidor nao iniciou. Logs: $LOG e $CACHE/server-gpu.log"; }
fi
robo_fim ok "Pronto: $URL"
say ""

# --- controle do banco (cd2-ctl): sobe, troca e derruba o MCP Toolbox pela tela Configuracoes ---
case "$(uname -m)" in arm64|aarch64) ARCH=arm64 ;; *) ARCH=amd64 ;; esac
if [ "$OS" = "Darwin" ]; then PLAT="darwin-$ARCH"; else PLAT="linux-$ARCH"; fi
CTL_SRC="$ROOT/bin/ctl/$PLAT/cd2-ctl"
start_ctl() {
  if [ ! -f "$CTL_SRC" ]; then say "bin/ctl/$PLAT nao encontrado: banco de dados indisponivel neste pen drive"; return 1; fi
  CTL_RUN="$CACHE/cd2-ctl"
  if [ ! -x "$CTL_RUN" ] || ! cmp -s "$CTL_SRC" "$CTL_RUN"; then
    cp "$CTL_SRC" "$CTL_RUN.tmp" && chmod +x "$CTL_RUN.tmp" && mv "$CTL_RUN.tmp" "$CTL_RUN" || { say "Falha ao copiar o cd2-ctl para $CACHE"; return 1; }
    [ "$OS" = "Darwin" ] && xattr -dr com.apple.quarantine "$CTL_RUN" 2>/dev/null
  fi
  CTL_LOG="$CACHE/ctl.log"; : > "$CTL_LOG"
  CD2_CTL_KEY="$CTL_KEY" "$CTL_RUN" --root "$ROOT" --cache "$CACHE" --harness-port "$PORT" --parent-pid $$ >> "$CTL_LOG" 2>&1 &
  CTL_PID=$!
  i=0
  while [ "$i" -lt 10 ]; do
    kill -0 "$CTL_PID" 2>/dev/null || break
    # 401 = esta no ar. O teste vai sem a chave, para ela nao aparecer na lista de processos.
    code="$(curl -s --max-time 1 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$CTL_PORT/status" 2>/dev/null)"
    [ "$code" = 401 ] && return 0
    i=$((i + 1)); sleep 1
  done
  kill "$CTL_PID" 2>/dev/null; CTL_PID=""
  say "[AVISO] O controle do banco (cd2-ctl) nao subiu. Ultimas linhas de $CTL_LOG:"
  tail -n 5 "$CTL_LOG" | sed 's/^/   /'
  say "Seguindo sem banco de dados (Demonstracao e Archeo continuam)."
  return 1
}
start_ctl && say "Controle do banco em 127.0.0.1:$CTL_PORT. Configure o banco pela tela Configuracoes."
# ?v=<versao> muda o endereco a cada versao: o navegador nao reaproveita o front antigo do cache.
VER="$(tr -d ' \r\n' < "$ROOT/VERSION" 2>/dev/null)"
APP_URL="$URL/?v=$VER#k=$CTL_KEY"

# --- abrir como janela de aplicativo quando houver Chrome/Edge ---------------
# A janela ocupa a tela toda, para o campo de pergunta caber em tela pequena. No Mac o Chrome ignora
# --start-maximized, entao o tamanho vem da area util da tela (sem barra de menu e Dock), sem pedir permissao.
tela_mac() {
  osascript -l JavaScript -e 'ObjC.import("AppKit"); var f = $.NSScreen.mainScreen.visibleFrame; Math.floor(f.size.width) + "," + Math.floor(f.size.height)' 2>/dev/null
}
open_app() {
  if [ "$OS" = "Darwin" ]; then
    TAM="$(tela_mac)"
    for app in "Google Chrome" "Microsoft Edge" "Brave Browser" "Chromium"; do
      if [ -d "/Applications/$app.app" ]; then
        if [ -n "$TAM" ]; then open -na "$app" --args "--app=$APP_URL" "--start-maximized" "--window-position=0,0" "--window-size=$TAM"
        else open -na "$app" --args "--app=$APP_URL" "--start-maximized"; fi
        return
      fi
    done
    open "$APP_URL"
  else
    for b in google-chrome google-chrome-stable microsoft-edge chromium chromium-browser brave-browser; do
      if command -v "$b" >/dev/null 2>&1; then "$b" "--app=$APP_URL" "--start-maximized" >/dev/null 2>&1 & return; fi
    done
    command -v xdg-open >/dev/null 2>&1 && xdg-open "$APP_URL" >/dev/null 2>&1 || say "Abra no navegador: $APP_URL"
  fi
}
open_app

say ""
say "A IA de Bolso esta rodando. Para encerrar: feche esta janela ou pressione Ctrl+C."
# mantem o script vivo enquanto o servidor viver
while kill -0 "$PID" 2>/dev/null; do sleep 2; done
say "O servidor foi encerrado."
