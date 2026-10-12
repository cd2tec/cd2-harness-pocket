#!/bin/sh
# Uso: sh iniciar-cd2-linux.sh   (chamar via "sh" evita problemas de pen drive montado como noexec)
cd "$(dirname "$0")" || exit 1
exec sh core/start-unix.sh "$@"
