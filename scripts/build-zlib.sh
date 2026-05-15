#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
THIRD="$ROOT/third_party"
PREFIX="$ROOT/build/prefix"
ZLIB_VER="1.3.1"
SRC="$THIRD/zlib-${ZLIB_VER}"

if [ -f "$PREFIX/lib/libz.a" ]; then
  echo "[zlib] Already built, skipping."
  exit 0
fi

mkdir -p "$PREFIX"
cd "$SRC"

# zlib uses a custom configure script (not autoconf) that respects CC/CFLAGS
emconfigure ./configure \
  --prefix="$PREFIX" \
  --static

emmake make -j"$(nproc)" install

echo "[zlib] Built and installed to $PREFIX"
