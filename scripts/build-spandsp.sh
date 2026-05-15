#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
THIRD="$ROOT/third_party"
PREFIX="$ROOT/build/prefix"
SRC="$THIRD/spandsp"

if [ -f "$PREFIX/lib/libspandsp.a" ]; then
  echo "[spandsp] Already built, skipping."
  exit 0
fi

cd "$SRC"

# Bootstrap autotools using spandsp's own helper (handles m4/ macros)
if [ ! -f configure ]; then
  echo "[spandsp] Bootstrapping autotools..."
  if [ -x ./bootstrap.sh ]; then
    ./bootstrap.sh
  elif [ -x ./autogen.sh ]; then
    NOCONFIGURE=1 ./autogen.sh
  else
    autoreconf -fi
  fi
fi

# Neuter spandsp's "Cannot make tests without X" fatal errors. These checks
# require host-arch libs/binaries that don't exist under cross-compile
# (emconfigure uses emcc for linking, so AC_CHECK_LIB cannot find host libs).
# We only build the library (src/), never the tests, so the checks are spurious.
# Clean any cached failure state from prior runs
rm -f config.cache config.log config.status

echo "[spandsp] Patching configure to skip test-only dep checks..."
python3 - <<'PY'
import re, pathlib
p = pathlib.Path("configure")
src = p.read_text()
# Replace any whole line containing as_fn_error ... "Cannot make tests without ..."
# with a harmless warning that does not exit.
pat = re.compile(
    r'^[ \t]*as_fn_error[^\n]*Cannot make tests without[^\n]*$',
    re.MULTILINE,
)
n_before = len(pat.findall(src))
src = pat.sub(
    '{ printf "configure: WARNING: skipping test-dep check (cross-compile)\\n" >&2; }',
    src,
)
p.write_text(src)
print(f"[spandsp] Patched {n_before} fatal test-dep check(s) in configure")
PY

export CFLAGS="-I${PREFIX}/include -Oz"
export LDFLAGS="-L${PREFIX}/lib"
export LIBS="-ltiff -ljpeg -lz"
export PKG_CONFIG_PATH="${PREFIX}/lib/pkgconfig"
export TIFF_CFLAGS="-I${PREFIX}/include"
export TIFF_LIBS="-L${PREFIX}/lib -ltiff -ljpeg -lz"

emconfigure ./configure \
  --prefix="$PREFIX" \
  --host=wasm32-unknown-emscripten \
  --enable-static \
  --disable-shared \
  --disable-doc \
  --disable-tests \
  --without-fixed-point \
  ac_cv_func_malloc_0_nonnull=yes \
  ac_cv_func_realloc_0_nonnull=yes

# Build only the library; tests/ doc/ tools/ have native-only deps.
# Use -j1 for the spandsp build so any failure is easy to read in the log.
LOG="$ROOT/build/spandsp-build.log"
mkdir -p "$ROOT/build"
echo "[spandsp] Building (output -> $LOG)..."
if ! emmake make -j1 -C src 2>&1 | tee "$LOG"; then
  echo ""
  echo "[spandsp] Build failed. First error in log:"
  grep -nE 'error:|undefined symbol|undefined reference|fatal:' "$LOG" | head -30 || true
  exit 1
fi
emmake make -C src install

# Belt-and-suspenders header install in case Makefile.am missed any
if [ -d spandsp ]; then
  mkdir -p "$PREFIX/include/spandsp"
  cp -r spandsp/*.h "$PREFIX/include/spandsp/" 2>/dev/null || true
fi
if [ -d src/spandsp ]; then
  mkdir -p "$PREFIX/include/spandsp"
  cp -r src/spandsp/*.h "$PREFIX/include/spandsp/" 2>/dev/null || true
  if [ -d src/spandsp/private ]; then
    mkdir -p "$PREFIX/include/spandsp/private"
    cp -r src/spandsp/private/*.h "$PREFIX/include/spandsp/private/" 2>/dev/null || true
  fi
fi

echo "[spandsp] Built and installed to $PREFIX"
