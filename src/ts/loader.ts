/**
 * Lazy loader for the fax WASM module.
 *
 * The Emscripten glue ships with the `.wasm` binary inlined as base64
 * (`SINGLE_FILE=1` at build time), so there is no separate runtime fetch
 * — `import("./fax.js")` is the entire bootstrap. The module instance is
 * cached so repeated decodes share one WASM heap.
 *
 * Throws a descriptive error if `WebAssembly` is unavailable (e.g. on an
 * SSR pass without the global). Callers in Next.js / SSR contexts should
 * gate their use behind `typeof window !== "undefined"` or call this
 * only from a client-side dynamic `import()`.
 */

import type { FaxWasmModule } from "./types.js";

let modulePromise: Promise<FaxWasmModule> | null = null;

/**
 * Dynamically import the Emscripten glue JS (which carries the WASM
 * binary inline).
 */
export async function getModule(): Promise<FaxWasmModule> {
  if (typeof WebAssembly === "undefined") {
    throw new Error(
      "@sipflow/fax-wasm: WebAssembly is not available in this environment. " +
        "On the server side (SSR), import this module from a client-only " +
        "code path or guard with `typeof window !== 'undefined'`.",
    );
  }

  if (!modulePromise) {
    modulePromise = initModule();
  }

  return modulePromise;
}

async function initModule(): Promise<FaxWasmModule> {
  // The path here points at the Node-flavored glue used by the test
  // suite (vitest runs this file as-is from src/ts/). `scripts/bundle.mjs`
  // rewrites this literal string per published artifact:
  //
  //   browser bundles (`dist/index.{mjs,cjs}`, `dist/worker.mjs`)
  //     -> `"./fax.js"`           (require("fs"|"path"|"crypto") neutralized)
  //   Node bundles    (`dist/index.node.{mjs,cjs}`)
  //     -> `"./fax.node.js"`      (pristine emcc output)
  //
  // The `node` export condition in package.json routes Node consumers
  // to the latter; everything else gets the former.
  // @ts-expect-error — Emscripten glue has no .d.ts
  const createFaxModule = (await import("../../dist/fax.node.js")).default;
  const mod: FaxWasmModule = await createFaxModule();
  return mod;
}

/**
 * Reset the cached module instance. Useful for testing or when you need
 * to free all WASM memory and start fresh.
 */
export function resetModule(): void {
  modulePromise = null;
}
