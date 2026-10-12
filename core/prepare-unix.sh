#!/usr/bin/env sh
# CD2 Harness - prepara o pen drive (rode UMA vez, com internet, no Mac ou Linux)
# Baixa o llamafile e o modelo para dentro desta pasta. Retoma downloads interrompidos.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_URL="${CD2_MODEL_URL:-https://huggingface.co/pramodlohra/Qween3_4B_thinking_finetune/resolve/main/qwen3-4b-thinking-2507.Q4_K_M.gguf}"
MODEL_FILE="${CD2_MODEL_FILE:-qwen3-4b-thinking-2507.Q4_K_M.gguf}"
FALLBACK_BIN_URL="https://huggingface.co/mozilla-ai/llamafile_0.10/resolve/main/llamafile_0.10.1"

mkdir -p "$ROOT/bin" "$ROOT/models"
echo "== Motor (llamafile)"
BIN_URL="$(curl -fsSL -H 'User-Agent: cd2-harness' https://api.github.com/repos/mozilla-ai/llamafile/releases/latest \
  | grep -Eo 'https://[^"]+/llamafile-[0-9]+(\.[0-9]+)+"' | tr -d '"' | head -n 1 || true)"
if [ -z "$BIN_URL" ]; then echo "Nao consegui resolver a ultima release; usando a URL de reserva."; BIN_URL="$FALLBACK_BIN_URL"; fi
echo "Origem: $BIN_URL"
curl -L --fail -C - -o "$ROOT/bin/llamafile" "$BIN_URL"
chmod +x "$ROOT/bin/llamafile" 2>/dev/null || true
# Windows exige a extensao .exe; mesma binaria (APE) serve para os tres sistemas
cp -f "$ROOT/bin/llamafile" "$ROOT/bin/llamafile.exe"

echo "== Modelo"
echo "Origem: $MODEL_URL"
curl -L --fail -C - -o "$ROOT/models/$MODEL_FILE" "$MODEL_URL"

SIZE="$(wc -c < "$ROOT/models/$MODEL_FILE" | tr -d ' ')"
if [ "$SIZE" -lt 1000000000 ]; then echo "[ERRO] Modelo com tamanho suspeito ($SIZE bytes). Apague e rode de novo."; exit 1; fi

echo ""
echo "== Checksums (anote para conferir depois)"
if command -v shasum >/dev/null 2>&1; then SUM="shasum -a 256"; else SUM="sha256sum"; fi
( cd "$ROOT" && $SUM bin/llamafile "models/$MODEL_FILE" | tee CHECKSUMS.sha256 )
echo ""
echo "Pronto. Pen drive preparado em: $ROOT"
echo "Dica: formate o pen drive em exFAT (FAT32 nao aceita arquivos acima de 4 GB)."
