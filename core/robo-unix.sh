# CD2 Harness - robo de carregamento do terminal (POSIX sh). Carregado por core/start-unix.sh.
# Enquanto o modelo sobe, um robo em pixel art leva blocos do pen drive ate um cerebro que enche.
# O progresso e real: robo_ler le o .gguf em pedacos e conta os bytes (a parte lenta da primeira
# vez, e o arquivo ainda fica no cache de disco para o llamafile), e robo_esperar so anda enquanto
# o processo esta vivo e o /health ainda nao respondeu. Sem terminal, sem cor (NO_COLOR, TERM=dumb)
# ou com CD2_SIMPLES=1, cai para linhas de texto. Quadros em core/robo.txt.

ROBO_SPRITES="${ROBO_SPRITES:-$ROOT/core/robo.txt}"
ROBO_FANCY=0
ROBO_DESENHADO=0
ROBO_LEITOR=""
ROBO_T0=0

# Desenha a cena 44x12 pixels em 6 linhas de meio-bloco. Entradas: E (estado), F (quadro), P (0-100).
ROBO_AWK='
function poe(nome, ox, oy, olho,   r, c, ch, linha, yy, xx) {
  for (r = 0; r < n[nome]; r++) {
    linha = S[nome, r]
    for (c = 0; c < length(linha); c++) {
      ch = substr(linha, c + 1, 1)
      if (ch == ".") continue
      if (ch == "c") ch = olho
      if (ch == "i") ch = (r > 6 - cheias) ? "m" : "k"
      yy = oy + r; xx = ox + c
      if (yy >= 0 && yy < H && xx >= 0 && xx < W) G[yy, xx] = ch
    }
  }
}
BEGIN {
  W = 44; H = 12; ESC = sprintf("%c", 27)
  cor["g"] = 250; cor["k"] = 238; cor["b"] = 21; cor["w"] = 255; cor["c"] = 45
  cor["y"] = 191; cor["p"] = 213; cor["m"] = 205; cor["r"] = 196
  for (y = 0; y < H; y++) for (x = 0; x < W; x++) G[y, x] = "."
}
/^#/ { next }
/^\[/ { sec = substr($0, 2, length($0) - 2); n[sec] = 0; next }
NF { S[sec, n[sec]++] = $0 }
END {
  f = F + 0; p = P + 0; if (p < 0) p = 0; if (p > 100) p = 100
  cheias = int(p * 6 / 100 + 0.5)
  poe("pen", 1, 4, "c")
  poe("cerebro", 33, 3, "c")
  carrega = 0; dy = 0; olho = "c"; x = 25; corpo = "roboA"
  if (E == "lendo") {
    c = f % 32
    if (c < 16) { x = 10 + c; carrega = 1 } else x = 25 - (c - 16)
    corpo = (f % 2) ? "roboA" : "roboB"
  } else if (E == "acordando") {
    corpo = (int(f / 3) % 2) ? "roboA" : "roboB"
    if (f % 15 == 0) olho = "g"
  } else if (E == "pronto") {
    olho = "y"; dy = (f % 2) ? -1 : 0
    G[0, 34] = "y"; G[1, 42] = "y"; G[2, 31] = "y"; G[0, 39] = "y"
  } else if (E == "erro") {
    olho = "r"; corpo = "roboB"
  }
  poe(corpo, x, 2 + dy, olho)
  if (carrega) poe("bloco", x + 2, dy, "c")
  for (y = 0; y < H; y += 2) {
    linha = "  "
    for (x = 0; x < W; x++) {
      t = G[y, x]; b = G[y + 1, x]
      if (t == "." && b == ".") linha = linha ESC "[0m "
      else if (b == ".") linha = linha ESC "[0;38;5;" cor[t] "m\342\226\200"
      else if (t == ".") linha = linha ESC "[0;38;5;" cor[b] "m\342\226\204"
      else linha = linha ESC "[38;5;" cor[t] ";48;5;" cor[b] "m\342\226\200"
    }
    print linha ESC "[0m" ESC "[K"
  }
}'

robo_init() {
  ROBO_T0=$(date +%s)
  ROBO_FANCY=0
  if [ "${CD2_ROBO_FORCAR:-}" = 1 ]; then ROBO_FANCY=1
  elif [ -t 1 ] && [ "${TERM:-dumb}" != dumb ] && [ -z "${NO_COLOR:-}" ] && [ "${CD2_SIMPLES:-}" != 1 ]; then ROBO_FANCY=1
  fi
}

robo_seg() { echo $(( $(date +%s) - ROBO_T0 )); }

robo_gb() { awk -v b="$1" 'BEGIN { s = sprintf("%.1f", b / 1073741824); sub(/\./, ",", s); print s }'; }

robo_quadro() {  # estado quadro pct texto
  [ "$ROBO_FANCY" = 1 ] || return 0
  if [ "$ROBO_DESENHADO" = 1 ]; then printf '\033[7A'; else printf '\033[?25l'; ROBO_DESENHADO=1; fi
  awk -v E="$1" -v F="$2" -v P="$3" "$ROBO_AWK" "$ROBO_SPRITES"
  printf '\033[2K  %s\n' "$4"
}

robo_ler() {  # arquivo: le em pedacos de CD2_ROBO_BLOCO_MB (32) MB e anima ate o fim
  [ -f "$1" ] || return 1
  total=$(ls -ln "$1" | awk '{ print $5 }')
  mb="${CD2_ROBO_BLOCO_MB:-32}"
  prog="${TMPDIR:-/tmp}/cd2-robo-$$.prog"
  : > "$prog"
  (
    k=0
    while :; do
      dd if="$1" of=/dev/null bs=1048576 skip="$k" count="$mb" 2>/dev/null || { echo erro > "$prog"; exit 1; }
      k=$((k + mb))
      [ $((k * 1048576)) -ge "$total" ] && { printf '%s\nfim\n' "$k" > "$prog"; exit 0; }
      echo "$k" > "$prog"
    done
  ) &
  ROBO_LEITOR=$!
  q=0; feito=0; dec=-1
  while :; do
    lido=$(head -n 1 "$prog" 2>/dev/null)
    [ "$lido" = erro ] && { wait "$ROBO_LEITOR" 2>/dev/null; ROBO_LEITOR=""; rm -f "$prog"; return 1; }
    [ -n "$lido" ] && feito="$lido"
    bytes=$((feito * 1048576)); [ "$bytes" -gt "$total" ] && bytes="$total"
    pct=100; [ "$total" -gt 0 ] && pct=$((bytes * 100 / total))
    fim=0; grep -q fim "$prog" 2>/dev/null && fim=1
    if [ "$ROBO_FANCY" = 1 ]; then
      robo_quadro lendo "$q" $((pct * 90 / 100)) "Lendo o modelo do pen drive  $pct%  $(robo_gb "$bytes") de $(robo_gb "$total") GB  $(robo_seg) s"
    elif [ $((pct / 10)) -ne "$dec" ]; then
      dec=$((pct / 10)); printf '  Lendo o modelo do pen drive: %s%%\n' "$pct"
    fi
    [ "$fim" = 1 ] && break
    q=$((q + 1)); sleep 0.2
  done
  wait "$ROBO_LEITOR" 2>/dev/null; ROBO_LEITOR=""; rm -f "$prog"
  return 0
}

robo_esperar() {  # url pid prazo_s: 0 quando o /health responde; 1 se o processo morrer ou o prazo estourar
  q=0; ini=$(date +%s)
  [ "$ROBO_FANCY" = 1 ] || printf '  Acordando o modelo...\n'
  while :; do
    kill -0 "$2" 2>/dev/null || return 1
    if [ $((q % 5)) -eq 0 ]; then curl -sf --max-time 1 "$1/health" >/dev/null 2>&1 && return 0; fi
    [ $(( $(date +%s) - ini )) -ge "$3" ] && return 1
    robo_quadro acordando "$q" 90 "Acordando o modelo  $(robo_seg) s"
    q=$((q + 1)); sleep 0.2
  done
}

robo_aviso() {  # texto: mostra na linha de status (ou como linha comum)
  if [ "$ROBO_FANCY" = 1 ]; then robo_quadro acordando 1 90 "$1"; sleep 1; else printf '  %s\n' "$1"; fi
}

robo_fim() {  # ok|erro texto
  if [ "$ROBO_FANCY" = 1 ]; then
    if [ "$1" = ok ]; then
      for q in 1 2 3 4 5 6; do robo_quadro pronto "$q" 100 "$2"; sleep 0.15; done
    else
      robo_quadro erro 0 90 "$2"
    fi
    printf '\033[?25h'; ROBO_DESENHADO=0
  else
    printf '  %s\n' "$2"
  fi
}

robo_restaura() {  # para o Ctrl+C: para a leitura e devolve o cursor
  [ -n "${ROBO_LEITOR:-}" ] && kill "$ROBO_LEITOR" 2>/dev/null; ROBO_LEITOR=""
  [ "${ROBO_FANCY:-0}" = 1 ] && printf '\033[?25h'
  return 0
}
