#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
THIRD="$ROOT/third_party"
PREFIX="$ROOT/build/prefix"
JPEG_VER="3.0.4"
SRC="$THIRD/libjpeg-turbo-${JPEG_VER}"
BUILD_DIR="$ROOT/build/libjpeg-build"

if [ -f "$PREFIX/lib/libjpeg.a" ]; then
  echo "[libjpeg] Already built, skipping."
  exit 0
fi

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# libjpeg-turbo uses CMake. We disable the SIMD path (no x86/ARM intrinsics
# under wasm) and only build the static library.
emcmake cmake "$SRC" \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DCMAKE_BUILD_TYPE=Release \
  -DENABLE_SHARED=OFF \
  -DENABLE_STATIC=ON \
  -DWITH_SIMD=OFF \
  -DWITH_TURBOJPEG=OFF \
  -DWITH_JAVA=OFF \
  -DWITH_JPEG8=ON

emmake make -j"$(nproc)"
emmake make install

echo "[libjpeg] Built and installed to $PREFIX"
