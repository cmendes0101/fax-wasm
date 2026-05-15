/**
 * Tests for the T.38 UDPTL fax decoder.
 *
 * These tests require the WASM module to be built first (make wasm).
 * They are skipped if dist/fax.wasm is not present.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const wasmPath = resolve(__dirname, "../dist/fax.wasm");
const wasmAvailable = existsSync(wasmPath);

describe.skipIf(!wasmAvailable)("decodeT38Fax", () => {
  it("returns empty result for an empty packet list", async () => {
    const { decodeT38Fax } = await import("../src/ts/index.js");

    const result = await decodeT38Fax([]);

    expect(result.tiff).toBeNull();
    expect(result.pages).toBe(0);
  });

  it("handles malformed UDPTL packets gracefully", async () => {
    const { decodeT38Fax } = await import("../src/ts/index.js");

    const result = await decodeT38Fax([
      { payload: new Uint8Array([0x00]), captureTimeMs: 0 },
      { payload: new Uint8Array([0x00, 0x01]), captureTimeMs: 10 },
    ]);

    expect(result.tiff).toBeNull();
    expect(result.diagnostics.some((d) => d.includes("UDPTL unframe error"))).toBe(true);
  });
});
