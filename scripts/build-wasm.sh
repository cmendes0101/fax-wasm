#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PREFIX="$ROOT/build/prefix"
DIST="$ROOT/dist"

mkdir -p "$DIST"

EXPORTED_FUNCTIONS="[
  '_fax_audio_create',
  '_fax_audio_rx',
  '_fax_audio_finish',
  '_fax_audio_get_pages',
  '_fax_audio_get_remote_ident',
  '_fax_audio_is_complete',
  '_fax_audio_destroy',
  '_fax_t38_create',
  '_fax_t38_rx_ifp',
  '_fax_t38_finish',
  '_fax_t38_get_pages',
  '_fax_t38_get_remote_ident',
  '_fax_t38_is_complete',
  '_fax_t38_destroy',
  '_malloc',
  '_free'
]"

EXPORTED_RUNTIME="[
  'ccall',
  'cwrap',
  'FS',
  'UTF8ToString',
  'stringToUTF8',
  'getValue',
  'setValue',
  'HEAPU8',
  'HEAP16'
]"

emcc "$ROOT/src/c/wrapper.c" \
  -I"$PREFIX/include" \
  -L"$PREFIX/lib" \
  -lspandsp -ltiff -ljpeg -lz \
  -o "$DIST/fax.js" \
  -Oz \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="createFaxModule" \
  -s EXPORTED_FUNCTIONS="$EXPORTED_FUNCTIONS" \
  -s EXPORTED_RUNTIME_METHODS="$EXPORTED_RUNTIME" \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=16777216 \
  -s ENVIRONMENT='web,worker,node' \
  -s FILESYSTEM=1 \
  -s FORCE_FILESYSTEM=1 \
  -s SINGLE_FILE=0 \
  --no-entry

echo "[wasm] Built $DIST/fax.js + $DIST/fax.wasm"
ls -lh "$DIST/fax.js" "$DIST/fax.wasm"
