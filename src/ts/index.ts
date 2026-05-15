/**
 * @sipflow/fax-wasm
 *
 * Decode T.30 (audio pass-through) and T.38 (UDPTL) faxes to TIFF
 * in the browser or Node.js via WebAssembly.
 */

export type {
  FaxResult,
  RtpPacketLike,
  UdptlPacketLike,
  DecodeG711Options,
  DecodeT38Options,
} from "./types.js";

export { decodeG711Fax } from "./audio.js";
export { decodeT38Fax } from "./t38.js";
export { unframeUdptl } from "./udptl.js";
export { resetModule } from "./loader.js";

// Worker-client helper. Pure types/classes — no `Worker` construction
// happens at module load, so this is safe to import from any environment
// (including Node and SSR). The class only touches `Worker` once a
// consumer instantiates it.
export { FaxWorkerClient, type DecodeOptions } from "./client.js";

// Re-export the worker protocol types so consumers who want to drive
// the worker manually (or build their own client) have them at the
// same import path. Type-only — does not pull worker code into the
// main bundle.
export type { WorkerRequest, WorkerResponse } from "./worker.js";

import { decodeG711Fax } from "./audio.js";
import { decodeT38Fax } from "./t38.js";
import type { FaxResult, RtpPacketLike } from "./types.js";

/**
 * Convenience: decode a fax from RTP packets.
 *
 * For G.711 (PT 0 = PCMU, PT 8 = PCMA), decodes the audio to 16-bit LPCM
 * and feeds it to the G.711 fax decoder.
 *
 * For other payload types, returns an error result.
 */
export async function decodeFaxFromRtp(
  rtpStream: { payloadType: number; packets: RtpPacketLike[] },
): Promise<FaxResult> {
  const { payloadType, packets } = rtpStream;

  if (payloadType !== 0 && payloadType !== 8) {
    return {
      tiff: null,
      pages: 0,
      diagnostics: [
        `Unsupported payload type ${payloadType} for fax decoding. ` +
        `Only G.711 µ-law (PT 0) and A-law (PT 8) are supported. ` +
        `For T.38, use decodeT38Fax() directly.`,
      ],
    };
  }

  // Sort by capture time
  const sorted = [...packets].sort((a, b) => a.captureTimeMs - b.captureTimeMs);
  if (sorted.length === 0) {
    return { tiff: null, pages: 0, diagnostics: ["No RTP packets provided"] };
  }

  // Decode G.711 to 16-bit LPCM with silence fill for gaps
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const baseTs = first.rtpTimestamp;
  const span = last.rtpTimestamp - baseTs + last.payload.length;
  const totalSamples = span > 0 ? span : sorted.reduce((a, p) => a + p.payload.length, 0);
  const pcm = new Int16Array(totalSamples);

  const decode = payloadType === 0 ? decodeMuLaw : decodeALaw;

  for (const p of sorted) {
    const offset = p.rtpTimestamp - baseTs;
    if (offset < 0 || offset >= pcm.length) continue;
    const decoded = decode(p.payload);
    const end = Math.min(decoded.length, pcm.length - offset);
    pcm.set(decoded.subarray(0, end), offset);
  }

  return decodeG711Fax(pcm);
}

// Inline G.711 decoders for the convenience function — small enough to not
// warrant a separate dependency, and matches what sipflow already uses.

function decodeMuLaw(data: Uint8Array): Int16Array {
  const out = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = muLawToLinear(data[i]!);
  }
  return out;
}

function decodeALaw(data: Uint8Array): Int16Array {
  const out = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = aLawToLinear(data[i]!);
  }
  return out;
}

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

function muLawToLinear(sample: number): number {
  sample = ~sample & 0xff;
  const sign = sample & 0x80;
  const exponent = (sample >> 4) & 0x07;
  let mantissa = sample & 0x0f;
  mantissa = (mantissa << 4) + 0x08;
  if (exponent !== 0) mantissa += 0x100;
  if (exponent > 1) mantissa <<= exponent - 1;
  return sign !== 0 ? MULAW_BIAS - mantissa : mantissa - MULAW_BIAS;
}

function aLawToLinear(sample: number): number {
  sample ^= 0x55;
  const sign = sample & 0x80;
  const exponent = (sample >> 4) & 0x07;
  let mantissa = sample & 0x0f;
  if (exponent > 0) mantissa = (mantissa << 4) | 0x108;
  else mantissa = (mantissa << 4) | 0x08;
  if (exponent > 1) mantissa <<= exponent - 1;
  return sign === 0 ? mantissa : -mantissa;
}

void MULAW_CLIP; // referenced for completeness, used in encoder (not needed here)
