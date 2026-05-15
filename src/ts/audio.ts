/**
 * G.711 pass-through fax decoding.
 *
 * Accepts pre-decoded 16-bit LPCM at 8 kHz (as produced by your existing
 * G.711 decoder / RTP-to-PCM pipeline) and feeds it into spandsp's T.30
 * receiver. Runs the decoder in both calling and called-party modes and
 * returns whichever produced a valid TIFF.
 */

import { getModule } from "./loader.js";
import type { FaxWasmModule, FaxResult, DecodeG711Options } from "./types.js";

const CHUNK_SIZE = 160; // 20ms @ 8 kHz — standard RTP frame size

/**
 * Decode a G.711 (audio pass-through) fax from continuous 8 kHz LPCM.
 *
 * The PCM must be continuous with silence-fills for any RTP gaps (which
 * your existing rtp-to-pcm pipeline already handles).
 */
export async function decodeG711Fax(
  pcm: Int16Array,
  opts?: DecodeG711Options,
): Promise<FaxResult> {
  const mod = await getModule();

  // Try both directions — we don't know which side is the sender
  const resultCalled = runAudioDecode(mod, pcm, false, opts);
  const resultCalling = runAudioDecode(mod, pcm, true, opts);

  // Return whichever produced a TIFF; prefer the one with more pages
  if (resultCalled.tiff && resultCalling.tiff) {
    return resultCalled.pages >= resultCalling.pages ? resultCalled : resultCalling;
  }
  return resultCalled.tiff ? resultCalled : resultCalling.tiff ? resultCalling : resultCalled;
}

function runAudioDecode(
  mod: FaxWasmModule,
  pcm: Int16Array,
  callingParty: boolean,
  opts?: DecodeG711Options,
): FaxResult {
  const diagnostics: string[] = [];
  const outPath = callingParty ? "/fax_calling.tif" : "/fax_called.tif";

  const pathBytes = new TextEncoder().encode(outPath + "\0");
  const pathPtr = mod._malloc(pathBytes.length);
  mod.HEAPU8.set(pathBytes, pathPtr);

  const handle = mod._fax_audio_create(pathPtr, callingParty ? 1 : 0);
  mod._free(pathPtr);

  if (!handle) {
    diagnostics.push(`Failed to create ${callingParty ? "calling" : "called"} party decoder`);
    return { tiff: null, pages: 0, diagnostics };
  }

  try {
    // Feed PCM in chunks
    const pcmPtr = mod._malloc(CHUNK_SIZE * 2); // 2 bytes per sample

    for (let offset = 0; offset < pcm.length; offset += CHUNK_SIZE) {
      if (opts?.signal?.aborted) {
        diagnostics.push("Aborted by caller");
        break;
      }

      const remaining = Math.min(CHUNK_SIZE, pcm.length - offset);
      const chunk = pcm.subarray(offset, offset + remaining);
      mod.HEAP16.set(chunk, pcmPtr / 2);
      mod._fax_audio_rx(handle, pcmPtr, remaining);
    }

    mod._free(pcmPtr);

    mod._fax_audio_finish(handle);

    const pages = mod._fax_audio_get_pages(handle);
    const identPtr = mod._fax_audio_get_remote_ident(handle);
    const remoteIdent = identPtr ? mod.UTF8ToString(identPtr) : undefined;
    const complete = mod._fax_audio_is_complete(handle);

    diagnostics.push(`direction=${callingParty ? "calling" : "called"} complete=${complete} pages=${pages}`);

    let tiff: Uint8Array | null = null;
    if (pages > 0) {
      try {
        tiff = mod.FS.readFile(outPath);
        mod.FS.unlink(outPath);
      } catch {
        diagnostics.push(`TIFF file not found at ${outPath}`);
      }
    }

    return {
      tiff: tiff && tiff.length > 0 ? new Uint8Array(tiff) : null,
      pages,
      remoteIdent: remoteIdent || undefined,
      diagnostics,
    };
  } finally {
    mod._fax_audio_destroy(handle);
    // Clean up TIFF file if it exists
    try { mod.FS.unlink(outPath); } catch { /* may already be unlinked */ }
  }
}
