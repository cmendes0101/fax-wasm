#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
THIRD="$ROOT/third_party"
PREFIX="$ROOT/build/prefix"
LIBTIFF_VER="4.7.0"
SRC="$THIRD/tiff-${LIBTIFF_VER}"
BUILD_DIR="$ROOT/build/libtiff-build"

if [ -f "$PREFIX/lib/libtiff.a" ]; then
  echo "[libtiff] Already built, skipping."
  exit 0
fi

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# libtiff 4.7 uses CMake; cross-compile with emcmake
emcmake cmake "$SRC" \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -Dtiff-tools=OFF \
  -Dtiff-tests=OFF \
  -Dtiff-contrib=OFF \
  -Dtiff-docs=OFF \
  -Djpeg=OFF \
  -Djbig=OFF \
  -Dzstd=OFF \
  -Dwebp=OFF \
  -Dlzma=OFF \
  -Dlerc=OFF \
  -Dlibdeflate=OFF \
  -DZLIB_INCLUDE_DIR="$PREFIX/include" \
  -DZLIB_LIBRARY="$PREFIX/lib/libz.a"

emmake make -j"$(nproc)"
emmake make install

echo "[libtiff] Built and installed to $PREFIX"
