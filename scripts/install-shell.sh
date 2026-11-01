#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo $0" >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install -m 755 "$SCRIPT_DIR/codex-nas" /usr/local/bin/codex-nas
echo "Installed /usr/local/bin/codex-nas"
