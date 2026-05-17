/**
 * Tests for the T.38 UDPTL fax decoder.
 *
 * These tests require the WASM module to be built first (make wasm).
 * They are skipped if dist/fax.js is not present (wasm is inlined).
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const wasmPath = resolve(__dirname, "../dist/fax.js");
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

  // Regression: spandsp's t38_terminal_init() returns NULL when its
  // tx_packet_handler argument is NULL, which made `_fax_t38_create`
  // always return 0 and surface as the diagnostic below. The previous
  // empty/malformed cases didn't catch it because they passed `tiff === null`
  // either way. See wrapper.c::fax_t38_create.
  it("initializes the T.38 terminal even with no input packets", async () => {
    const { decodeT38Fax } = await import("../src/ts/index.js");

    const result = await decodeT38Fax([]);

    expect(
      result.diagnostics.some((d) => d.includes("Failed to create T.38 decoder")),
    ).toBe(false);
  });
});
