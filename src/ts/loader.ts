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
  //
  // The Emscripten glue is UMD (`module.exports = createFaxModule;
  // module.exports.default = createFaxModule`), and different bundlers
  // surface different shapes when this is dynamically imported from ESM:
  //
  //   - Node ESM             -> `{ default: createFaxModule }`
  //   - Webpack (esModule)   -> `{ default: createFaxModule }` (usually)
  //   - Webpack (terser+UMD) -> the function itself; `.default` is dropped
  //                             because `module.exports` is a function, not
  //                             an object the synthesizer can attach onto
  //   - Turbopack            -> `{ default: createFaxModule }`
  //
  // Pick whichever shape is callable so the loader works under every
  // bundler we ship through. Without this fallback, the webpack-prod
  // worker chunk throws "e is not a function" (the minified identifier
  // for `createFaxModule` after `.default` returned undefined).
  // @ts-expect-error — Emscripten glue has no .d.ts
  const mod = await import("../../dist/fax.node.js");
  const factory: unknown =
    typeof mod === "function"
      ? mod
      : mod && typeof (mod as { default?: unknown }).default === "function"
        ? (mod as { default: unknown }).default
        : mod;
  if (typeof factory !== "function") {
    throw new Error(
      "@sipflow/fax-wasm: Emscripten module factory not resolvable from glue " +
        "(no callable default export found). This usually indicates a bundler " +
        "stripped the CJS→ESM interop wrapper around dist/fax.js.",
    );
  }
  const inst: FaxWasmModule = await (factory as () => Promise<FaxWasmModule>)();
  return inst;
}

/**
 * Reset the cached module instance. Useful for testing or when you need
 * to free all WASM memory and start fresh.
 */
export function resetModule(): void {
  modulePromise = null;
}
