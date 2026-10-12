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
  printf '  \033[38;5;179m|\033[0m   \033[1mCD2 Retail Tech\033[0m  Harness    \033[38;5;179m|\033[0m\n'
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

# --- porta livre ------------------------------------------------------------
busy() { curl -s --max-time 1 -o /dev/null "http://127.0.0.1:$1/" 2>/dev/null; }
PORT="$PORT_START"; tries=0
while busy "$PORT" && [ "$tries" -lt 20 ]; do PORT=$((PORT + 1)); tries=$((tries + 1)); done
URL="http://127.0.0.1:$PORT"

LOG="$CACHE/server.log"
PID=""
cleanup() { [ -n "$PID" ] && kill "$PID" 2>/dev/null; }
trap cleanup EXIT INT TERM

start_server() {  # $@ = flags extras (GPU)
  : > "$LOG"
  if [ "$#" -gt 0 ]; then
    "$RUN_BIN" -m "$MODEL" --server --host 127.0.0.1 --port "$PORT" --jinja -c "$CTX" --path "$ROOT/web" "$@" >> "$LOG" 2>&1 &
  else
    "$RUN_BIN" -m "$MODEL" --server --host 127.0.0.1 --port "$PORT" --jinja -c "$CTX" --path "$ROOT/web" >> "$LOG" 2>&1 &
  fi
  PID=$!
}

wait_ready() {  # espera ate 240s; retorna 1 se o processo morrer
  i=0
  while [ "$i" -lt 240 ]; do
    kill -0 "$PID" 2>/dev/null || return 1
    curl -sf --max-time 2 "$URL/health" >/dev/null 2>&1 && return 0
    i=$((i + 1)); sleep 1
  done
  return 1
}

say "Carregando o modelo: $(basename "$MODEL")"
say "(na primeira vez pode levar de 20 a 90 segundos)"
start_server -ngl 999
if ! wait_ready; then
  say "Aceleracao por GPU indisponivel, tentando so com CPU..."
  kill "$PID" 2>/dev/null; sleep 1
  start_server --gpu disable -ngl 0
  wait_ready || { tail -n 25 "$LOG"; die "O servidor nao iniciou. Log completo: $LOG"; }
fi

say ""
say "Pronto: $URL"

# --- abrir como janela de aplicativo quando houver Chrome/Edge ---------------
open_app() {
  if [ "$OS" = "Darwin" ]; then
    for app in "Google Chrome" "Microsoft Edge" "Brave Browser" "Chromium"; do
      if [ -d "/Applications/$app.app" ]; then open -na "$app" --args "--app=$URL" "--window-size=1280,860"; return; fi
    done
    open "$URL"
  else
    for b in google-chrome google-chrome-stable microsoft-edge chromium chromium-browser brave-browser; do
      if command -v "$b" >/dev/null 2>&1; then "$b" "--app=$URL" "--window-size=1280,860" >/dev/null 2>&1 & return; fi
    done
    command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL" >/dev/null 2>&1 || say "Abra no navegador: $URL"
  fi
}
open_app

say ""
say "O harness esta rodando. Para encerrar: feche esta janela ou pressione Ctrl+C."
# mantem o script vivo enquanto o servidor viver
while kill -0 "$PID" 2>/dev/null; do sleep 2; done
say "O servidor foi encerrado."
