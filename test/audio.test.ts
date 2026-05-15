/**
 * Tests for the G.711 audio fax decoder.
 *
 * These tests require the WASM module to be built first (make wasm).
 * They are skipped if dist/fax.wasm is not present.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const wasmPath = resolve(__dirname, "../dist/fax.wasm");
const wasmAvailable = existsSync(wasmPath);

describe.skipIf(!wasmAvailable)("decodeG711Fax", () => {
  it("returns empty result for silence (no fax tones)", async () => {
    const { decodeG711Fax } = await import("../src/ts/index.js");

    // 2 seconds of silence at 8 kHz
    const silence = new Int16Array(16000);
    const result = await decodeG711Fax(silence);

    expect(result.tiff).toBeNull();
    expect(result.pages).toBe(0);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("accepts AbortSignal and aborts cleanly", async () => {
    const { decodeG711Fax } = await import("../src/ts/index.js");

    const controller = new AbortController();
    controller.abort();

    const silence = new Int16Array(8000);
    const result = await decodeG711Fax(silence, { signal: controller.signal });

    expect(result.diagnostics.some((d) => d.includes("Aborted"))).toBe(true);
  });
});

describe.skipIf(!wasmAvailable)("decodeFaxFromRtp", () => {
  it("rejects unsupported payload types", async () => {
    const { decodeFaxFromRtp } = await import("../src/ts/index.js");

    const result = await decodeFaxFromRtp({
      payloadType: 96,
      packets: [],
    });

    expect(result.tiff).toBeNull();
    expect(result.diagnostics[0]).toContain("Unsupported payload type");
  });

  it("handles empty packet list", async () => {
    const { decodeFaxFromRtp } = await import("../src/ts/index.js");

    const result = await decodeFaxFromRtp({
      payloadType: 0,
      packets: [],
    });

    expect(result.tiff).toBeNull();
    expect(result.diagnostics[0]).toContain("No RTP packets");
  });
});
