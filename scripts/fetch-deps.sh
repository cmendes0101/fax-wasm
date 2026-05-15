#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
THIRD="$ROOT/third_party"

ZLIB_VER="1.3.1"
ZLIB_URL="https://github.com/madler/zlib/releases/download/v${ZLIB_VER}/zlib-${ZLIB_VER}.tar.gz"
ZLIB_SHA256="9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23"

JPEG_VER="3.0.4"
JPEG_URL="https://github.com/libjpeg-turbo/libjpeg-turbo/releases/download/${JPEG_VER}/libjpeg-turbo-${JPEG_VER}.tar.gz"
JPEG_SHA256="99130559e7d62e8d695f2c0eaeef912c5828d5b84a0537dcb24c9678c9d5b76b"

LIBTIFF_VER="4.7.0"
LIBTIFF_URL="https://download.osgeo.org/libtiff/tiff-${LIBTIFF_VER}.tar.gz"
LIBTIFF_SHA256="67160e3457365ab96c5b3286a0903aa6e78bdc44c4bc737d2e486bcecb6ba976"

SPANDSP_REPO="https://github.com/freeswitch/spandsp.git"
SPANDSP_REF="7977601"

git config --global --add safe.directory '*' >/dev/null 2>&1 || true

mkdir -p "$THIRD"

# --- zlib ---
if [ ! -d "$THIRD/zlib-${ZLIB_VER}" ]; then
  echo "[fetch] Downloading zlib ${ZLIB_VER}..."
  curl -fsSL "$ZLIB_URL" -o "$THIRD/zlib.tar.gz"
  echo "$ZLIB_SHA256  $THIRD/zlib.tar.gz" | sha256sum -c -
  tar -xzf "$THIRD/zlib.tar.gz" -C "$THIRD"
  rm "$THIRD/zlib.tar.gz"
else
  echo "[fetch] zlib ${ZLIB_VER} already present, skipping."
fi

# --- libjpeg-turbo ---
if [ ! -d "$THIRD/libjpeg-turbo-${JPEG_VER}" ]; then
  echo "[fetch] Downloading libjpeg-turbo ${JPEG_VER}..."
  curl -fsSL "$JPEG_URL" -o "$THIRD/jpeg.tar.gz"
  echo "$JPEG_SHA256  $THIRD/jpeg.tar.gz" | sha256sum -c -
  tar -xzf "$THIRD/jpeg.tar.gz" -C "$THIRD"
  rm "$THIRD/jpeg.tar.gz"
else
  echo "[fetch] libjpeg-turbo ${JPEG_VER} already present, skipping."
fi

# --- libtiff ---
if [ ! -d "$THIRD/tiff-${LIBTIFF_VER}" ]; then
  echo "[fetch] Downloading libtiff ${LIBTIFF_VER}..."
  curl -fsSL "$LIBTIFF_URL" -o "$THIRD/libtiff.tar.gz"
  echo "$LIBTIFF_SHA256  $THIRD/libtiff.tar.gz" | sha256sum -c -
  tar -xzf "$THIRD/libtiff.tar.gz" -C "$THIRD"
  rm "$THIRD/libtiff.tar.gz"
else
  echo "[fetch] libtiff ${LIBTIFF_VER} already present, skipping."
fi

# --- spandsp ---
if [ -d "$THIRD/spandsp/.git" ] && [ ! -f "$THIRD/spandsp/configure.ac" ]; then
  echo "[fetch] spandsp clone has no working tree, removing..."
  rm -rf "$THIRD/spandsp"
fi

if [ ! -d "$THIRD/spandsp" ]; then
  echo "[fetch] Cloning spandsp at ${SPANDSP_REF}..."
  git clone "$SPANDSP_REPO" "$THIRD/spandsp"
  cd "$THIRD/spandsp"
  git checkout "$SPANDSP_REF"
else
  echo "[fetch] spandsp already present, skipping."
fi

echo "[fetch] All dependencies fetched into $THIRD"
