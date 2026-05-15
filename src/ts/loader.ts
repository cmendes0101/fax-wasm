/**
 * SSR-safe lazy loader for the fax WASM module.
 *
 * Guards against server-side import (Next.js SSR) by checking for
 * WebAssembly support. Caches the module singleton so repeated calls
 * don't re-instantiate.
 */

import type { FaxWasmModule } from "./types.js";

let modulePromise: Promise<FaxWasmModule> | null = null;

function isWasmAvailable(): boolean {
  if (typeof WebAssembly === "undefined") return false;
  if (typeof window === "undefined" && typeof globalThis.process !== "undefined") {
    return true; // Node.js — fine for tests
  }
  return true;
}

/**
 * Dynamically import the Emscripten glue JS (which itself fetches fax.wasm).
 *
 * By default the .wasm file is expected next to fax.js. In bundlers like
 * webpack/Next.js you may need to configure wasm asset handling or pass
 * `locateFile` to override the path.
 */
export async function getModule(): Promise<FaxWasmModule> {
  if (!isWasmAvailable()) {
    throw new Error(
      "@sipflow/fax-wasm: WebAssembly is not available in this environment. " +
      "If you are importing this on the server side (SSR), use a dynamic import " +
      "guarded by typeof window !== 'undefined'."
    );
  }

  if (!modulePromise) {
    modulePromise = initModule();
  }

  return modulePromise;
}

async function initModule(): Promise<FaxWasmModule> {
  // Dynamic import so the glue JS is not pulled into SSR bundles
  // @ts-expect-error — Emscripten glue has no .d.ts
  const createFaxModule = (await import("../../dist/fax.js")).default;
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
