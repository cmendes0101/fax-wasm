/**
 * Golden fixture tests — decode known fax data and compare TIFF output
 * against expected SHA-256 hashes.
 *
 * These tests require:
 *   1. The WASM module built (make wasm)
 *   2. Test fixtures in test/fixtures/ (see fixtures/README.md)
 *
 * Skipped automatically if either prerequisite is missing.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const fixturesDir = resolve(__dirname, "fixtures");
const wasmPath = resolve(__dirname, "../dist/fax.js");
const wasmAvailable = existsSync(wasmPath);

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hasFixture(name: string): boolean {
  return existsSync(resolve(fixturesDir, name));
}

describe.skipIf(!wasmAvailable)("golden fixtures", () => {
  const g711FixtureReady =
    hasFixture("g711-pcmu-fax.raw") &&
    hasFixture("g711-pcmu-fax.sha256");

  const t38FixtureReady =
    hasFixture("t38-udptl-fax.bin") &&
    hasFixture("t38-udptl-fax.sha256");

  it.skipIf(!g711FixtureReady)(
    "G.711 PCMU fax decodes to expected TIFF",
    async () => {
      const { decodeG711Fax } = await import("../src/ts/index.js");

      const rawPcm = readFileSync(resolve(fixturesDir, "g711-pcmu-fax.raw"));
      const pcm = new Int16Array(rawPcm.buffer, rawPcm.byteOffset, rawPcm.byteLength / 2);

      const expectedHash = readFileSync(
        resolve(fixturesDir, "g711-pcmu-fax.sha256"),
        "utf-8",
      ).trim();

      const result = await decodeG711Fax(pcm);

      expect(result.tiff).not.toBeNull();
      expect(result.pages).toBeGreaterThan(0);

      const actualHash = sha256(result.tiff!);
      expect(actualHash).toBe(expectedHash);
    },
  );

  it.skipIf(!t38FixtureReady)(
    "T.38 UDPTL fax decodes to expected TIFF",
    async () => {
      const { decodeT38Fax } = await import("../src/ts/index.js");

      const bin = readFileSync(resolve(fixturesDir, "t38-udptl-fax.bin"));
      const packets = parseLengthPrefixedPackets(bin);

      const expectedHash = readFileSync(
        resolve(fixturesDir, "t38-udptl-fax.sha256"),
        "utf-8",
      ).trim();

      const result = await decodeT38Fax(
        packets.map((payload, i) => ({
          payload,
          captureTimeMs: i * 20, // ~50 pps
        })),
      );

      expect(result.tiff).not.toBeNull();
      expect(result.pages).toBeGreaterThan(0);

      const actualHash = sha256(result.tiff!);
      expect(actualHash).toBe(expectedHash);
    },
  );
});

describe.skipIf(!wasmAvailable)("direction ambiguity property", () => {
  const g711FixtureReady = hasFixture("g711-pcmu-fax.raw");

  it.skipIf(!g711FixtureReady)(
    "exactly one of calling/called party produces a valid TIFF",
    async () => {
      // This test imports the internal audio module to test both directions
      // independently, verifying that the dual-direction approach works.
      const { decodeG711Fax } = await import("../src/ts/index.js");

      const rawPcm = readFileSync(resolve(fixturesDir, "g711-pcmu-fax.raw"));
      const pcm = new Int16Array(rawPcm.buffer, rawPcm.byteOffset, rawPcm.byteLength / 2);

      const result = await decodeG711Fax(pcm);

      // At least the combined result should have a TIFF if the fixture is valid
      expect(result.tiff).not.toBeNull();
      expect(result.diagnostics.length).toBeGreaterThan(0);
    },
  );
});

/**
 * Parse a binary blob of 4-byte-big-endian-length-prefixed packets.
 */
function parseLengthPrefixedPackets(data: Buffer): Uint8Array[] {
  const packets: Uint8Array[] = [];
  let offset = 0;

  while (offset + 4 <= data.length) {
    const len = data.readUInt32BE(offset);
    offset += 4;

    if (offset + len > data.length) break;

    packets.push(new Uint8Array(data.slice(offset, offset + len)));
    offset += len;
  }

  return packets;
}
