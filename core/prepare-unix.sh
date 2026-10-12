#!/usr/bin/env sh
# CD2 Harness - prepara o pen drive (rode UMA vez, com internet, no Mac ou Linux)
# Baixa o llamafile e o modelo para dentro desta pasta. Retoma downloads interrompidos
# e pula o que ja estiver completo, entao pode rodar de novo sem medo.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_URL="${CD2_MODEL_URL:-https://huggingface.co/pramodlohra/Qween3_4B_thinking_finetune/resolve/main/qwen3-4b-thinking-2507.Q4_K_M.gguf}"
MODEL_FILE="${CD2_MODEL_FILE:-qwen3-4b-thinking-2507.Q4_K_M.gguf}"
FALLBACK_BIN_URL="https://huggingface.co/mozilla-ai/llamafile_0.10/resolve/main/llamafile_0.10.1"

# Tamanho do arquivo no servidor (segue redirecionamentos). Vazio se nao der para saber.
remote_size() {
  curl -sIL -H 'User-Agent: cd2-harness' "$1" 2>/dev/null | tr -d '\r' \
    | awk 'tolower($1)=="content-length:"{s=$2} END{print s}'
}

# fetch URL DESTINO: pula se ja estiver completo, retoma se estiver pela metade.
fetch() {
  if [ -s "$2" ]; then
    have="$(wc -c < "$2" | tr -d ' ')"
    want="$(remote_size "$1")"
    if [ -n "$want" ] && [ "$want" = "$have" ]; then
      echo "Ja baixado, pulando: $(basename "$2") ($have bytes)"
      return 0
    fi
    # retoma; se o servidor recusar o retomo (ex.: arquivo ja completo mas sem HEAD), baixa inteiro
    curl -L --fail -C - -o "$2" "$1" || curl -L --fail -o "$2" "$1"
  else
    curl -L --fail -C - -o "$2" "$1"
  fi
}

mkdir -p "$ROOT/bin" "$ROOT/models"
echo "== Motor (llamafile)"
BIN_URL="$(curl -fsSL -H 'User-Agent: cd2-harness' https://api.github.com/repos/mozilla-ai/llamafile/releases/latest \
  | grep -Eo 'https://[^"]+/llamafile-[0-9]+(\.[0-9]+)+"' | tr -d '"' | head -n 1 || true)"
if [ -z "$BIN_URL" ]; then echo "Nao consegui resolver a ultima release; usando a URL de reserva."; BIN_URL="$FALLBACK_BIN_URL"; fi
echo "Origem: $BIN_URL"
fetch "$BIN_URL" "$ROOT/bin/llamafile"
chmod +x "$ROOT/bin/llamafile" 2>/dev/null || true
# Windows exige a extensao .exe; mesma binaria (APE) serve para os tres sistemas
if ! cmp -s "$ROOT/bin/llamafile" "$ROOT/bin/llamafile.exe" 2>/dev/null; then
  cp -f "$ROOT/bin/llamafile" "$ROOT/bin/llamafile.exe"
fi

echo "== Modelo"
echo "Origem: $MODEL_URL"
fetch "$MODEL_URL" "$ROOT/models/$MODEL_FILE"

SIZE="$(wc -c < "$ROOT/models/$MODEL_FILE" | tr -d ' ')"
if [ "$SIZE" -lt 1000000000 ]; then echo "[ERRO] Modelo com tamanho suspeito ($SIZE bytes). Apague e rode de novo."; exit 1; fi

echo ""
echo "== Checksums (anote para conferir depois)"
if command -v shasum >/dev/null 2>&1; then SUM="shasum -a 256"; else SUM="sha256sum"; fi
( cd "$ROOT" && $SUM bin/llamafile "models/$MODEL_FILE" | tee CHECKSUMS.sha256 )
echo ""
echo "Pronto. Pen drive preparado em: $ROOT"
echo "Dica: formate o pen drive em exFAT (FAT32 nao aceita arquivos acima de 4 GB)."
