#!/usr/bin/env sh
# Sobe o banco de avaliacao, o toolbox e o llamafile (so CPU por padrao), roda a avaliacao e derruba tudo.
#   sh tests/eval/rodar.sh                      modelo padrao em models/, so CPU
#   CD2_EVAL_GPU=1 sh tests/eval/rodar.sh       usa a GPU (mais rapido, nao vale para o portao)
#   CD2_EVAL_MODEL=/caminho/outro.gguf sh tests/eval/rodar.sh
#   CD2_EVAL_BANCO=erp2 sh tests/eval/rodar.sh  segundo banco (ingles, sem prefixo); CD2_EVAL_DESCRICAO=0 pula a fila do modelo
#   CD2_EVAL_PORT=18080 muda a porta do llamafile; o toolbox usa essa porta + 1000
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLAT=darwin-arm64 ;; Darwin-*) PLAT=darwin-amd64 ;; *) PLAT=linux-amd64 ;;
esac
MODEL="${CD2_EVAL_MODEL:-$(ls "$ROOT"/models/*.gguf 2>/dev/null | head -n 1)}"
[ -n "$MODEL" ] || { echo "Sem modelo em models/"; exit 1; }
NGL="-ngl 0"; [ "${CD2_EVAL_GPU:-0}" = 1 ] && NGL=""
PORT="${CD2_EVAL_PORT:-18080}"; TBPORT=$((PORT + 1000))
export CD2_EVAL_MODEL_URL="http://127.0.0.1:$PORT/v1/chat/completions"
export CD2_EVAL_TOOLBOX_URL="http://127.0.0.1:$TBPORT/mcp"
LOG="${TMPDIR:-/tmp}/cd2-eval"; mkdir -p "$LOG"
COMPOSE="docker compose -p cd2eval -f $HERE/docker-compose.yml"
BANCO="${CD2_EVAL_BANCO:-erp}"
[ -f "$HERE/$BANCO.env" ] || { echo "Banco de avaliacao desconhecido: $BANCO (use erp ou erp2)"; exit 1; }
if [ "$BANCO" = erp ]; then export CD2_EVAL_PERGUNTAS="$HERE/perguntas.json"; else export CD2_EVAL_PERGUNTAS="$HERE/perguntas-$BANCO.json"; fi

TB=''; LL=''
trap 'kill $TB $LL 2>/dev/null; $COMPOSE down >/dev/null 2>&1' EXIT
trap 'exit 130' INT TERM
$COMPOSE up -d --wait || exit 1
set -a; . "$HERE/$BANCO.env"; set +a
"$ROOT/bin/toolbox/$PLAT/toolbox" --config "$ROOT/core/toolbox/postgres.yaml" --address 127.0.0.1 --port "$TBPORT" \
  --allowed-origins "http://127.0.0.1:$PORT" --disable-reload > "$LOG/toolbox.log" 2>&1 &
TB=$!
"$ROOT/bin/llamafile" -m "$MODEL" --server --host 127.0.0.1 --port "$PORT" --jinja -c 8192 $NGL > "$LOG/llama.log" 2>&1 &
LL=$!
i=0; until curl -sf "http://127.0.0.1:$PORT/health" >/dev/null; do i=$((i+1)); kill -0 $LL 2>/dev/null || { echo "llamafile morreu (log em $LOG/llama.log)"; exit 1; }; [ $i -gt 180 ] && { echo "llamafile nao subiu (log em $LOG/llama.log)"; exit 1; }; sleep 1; done
i=0; until curl -s -o /dev/null "http://127.0.0.1:$TBPORT/"; do i=$((i+1)); [ $i -gt 30 ] && { echo "toolbox nao subiu (log em $LOG/toolbox.log)"; exit 1; }; sleep 1; done
echo "Modelo: $(basename "$MODEL")  ${NGL:-GPU}"
node "$HERE/run-eval.mjs"
