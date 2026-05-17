/**
 * Loader regression tests.
 *
 * Guard against future bundler-interop regressions where the Emscripten
 * glue's `.default` export gets dropped by a bundler/minifier. The loader
 * intentionally accepts every callable shape ({default}, namespace-as-fn,
 * or the function directly); these tests prove that path is wired up.
 *
 * See:
 *   src/ts/loader.ts        — defensive factory resolution
 *   scripts/bundle.mjs      — appends `export default createFaxModule`
 *                             to dist/fax.js (browser variant only)
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const wasmPath = resolve(__dirname, "../dist/fax.js");
const wasmAvailable = existsSync(wasmPath);

describe.skipIf(!wasmAvailable)("loader", () => {
  it("getModule() resolves to a usable Emscripten module", async () => {
    const { getModule } = await import("../src/ts/loader.js");

    const mod = await getModule();

    // The factory must have produced a real Emscripten module — these
    // bindings are the ones every decoder leans on. If the loader picked
    // up the wrong namespace shape, `_malloc` is the first thing to break.
    expect(typeof mod._malloc).toBe("function");
    expect(typeof mod._free).toBe("function");
    expect(typeof mod._fax_t38_create).toBe("function");
    expect(typeof mod._fax_audio_create).toBe("function");
    expect(mod.HEAPU8).toBeInstanceOf(Uint8Array);
  });

  it("getModule() is cached across calls", async () => {
    const { getModule } = await import("../src/ts/loader.js");

    const a = await getModule();
    const b = await getModule();

    expect(a).toBe(b);
  });
});
