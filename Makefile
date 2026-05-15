SHELL := /bin/bash
.PHONY: all deps libs wasm bundle test clean

PREFIX    := $(CURDIR)/build/prefix
DIST      := $(CURDIR)/dist
THIRD     := $(CURDIR)/third_party
BUILD     := $(CURDIR)/build

ZLIB_VER     := 1.3.1
JPEG_VER     := 3.0.4
LIBTIFF_VER  := 4.7.0
SPANDSP_REPO := https://github.com/freeswitch/spandsp.git
SPANDSP_REF  := 7977601

all: deps libs wasm

# ---------- fetch sources ----------

deps:
	@echo "==> Fetching dependencies..."
	@bash scripts/fetch-deps.sh

# ---------- build static libs for emscripten ----------

libs: $(PREFIX)/lib/libz.a $(PREFIX)/lib/libjpeg.a $(PREFIX)/lib/libtiff.a $(PREFIX)/lib/libspandsp.a

$(PREFIX)/lib/libz.a:
	@echo "==> Building zlib..."
	@bash scripts/build-zlib.sh

$(PREFIX)/lib/libjpeg.a: $(PREFIX)/lib/libz.a
	@echo "==> Building libjpeg-turbo..."
	@bash scripts/build-libjpeg.sh

$(PREFIX)/lib/libtiff.a: $(PREFIX)/lib/libjpeg.a
	@echo "==> Building libtiff..."
	@bash scripts/build-libtiff.sh

$(PREFIX)/lib/libspandsp.a: $(PREFIX)/lib/libtiff.a
	@echo "==> Building spandsp..."
	@bash scripts/build-spandsp.sh

# ---------- compile wasm ----------
#
# Note: emcc is invoked with -s SINGLE_FILE=1, so the wasm binary is
# inlined into dist/fax.js as base64. There is no separate dist/fax.wasm.

wasm: $(DIST)/fax.js

$(DIST)/fax.js: $(PREFIX)/lib/libspandsp.a $(PREFIX)/lib/libtiff.a $(PREFIX)/lib/libjpeg.a $(PREFIX)/lib/libz.a src/c/wrapper.c
	@echo "==> Building WASM module..."
	@bash scripts/build-wasm.sh

# ---------- bundle TypeScript ----------

bundle:
	@echo "==> Bundling TypeScript..."
	@node scripts/bundle.mjs

# ---------- test ----------

test:
	@echo "==> Running tests..."
	@npx vitest run

# ---------- clean ----------

clean:
	rm -rf $(BUILD) $(DIST) $(THIRD)
