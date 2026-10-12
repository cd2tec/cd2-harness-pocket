#!/bin/sh
# CD2 Harness - grava um pen drive pronto (Linux). Uso: sh gravar-pendrive-linux.sh
cd "$(dirname "$0")" || exit 1
exec sh core/make-usb-unix.sh
