/**
 * T.38 fax decoding.
 *
 * Accepts raw UDPTL packets, unframes them to extract IFP payloads,
 * and feeds them into spandsp's T.38 terminal receiver.
 */

import { getModule } from "./loader.js";
import { unframeUdptl } from "./udptl.js";
import type { FaxWasmModule, FaxResult, DecodeT38Options, UdptlPacketLike } from "./types.js";

/**
 * Decode a T.38 (UDPTL) fax from captured UDPTL packets.
 *
 * Each packet should contain the raw UDP payload (UDPTL envelope).
 * The UDPTL unframing is done in TypeScript; only the IFP payloads
 * are passed to the WASM module.
 */
export async function decodeT38Fax(
  udptlPackets: UdptlPacketLike[],
  opts?: DecodeT38Options,
): Promise<FaxResult> {
  const mod = await getModule();
  const diagnostics: string[] = [];
  const outPath = "/fax_t38.tif";

  // Unframe UDPTL to get IFP payloads with sequence numbers
  const ifpFrames = unframeAllUdptl(udptlPackets, diagnostics);

  const pathBytes = new TextEncoder().encode(outPath + "\0");
  const pathPtr = mod._malloc(pathBytes.length);
  mod.HEAPU8.set(pathBytes, pathPtr);

  const handle = mod._fax_t38_create(pathPtr);
  mod._free(pathPtr);

  if (!handle) {
    diagnostics.push("Failed to create T.38 decoder");
    return { tiff: null, pages: 0, diagnostics };
  }

  try {
    for (const frame of ifpFrames) {
      if (opts?.signal?.aborted) {
        diagnostics.push("Aborted by caller");
        break;
      }

      feedIfpToWasm(mod, handle, frame.ifp, frame.seqNo);
    }

    mod._fax_t38_finish(handle);

    const pages = mod._fax_t38_get_pages(handle);
    const identPtr = mod._fax_t38_get_remote_ident(handle);
    const remoteIdent = identPtr ? mod.UTF8ToString(identPtr) : undefined;
    const complete = mod._fax_t38_is_complete(handle);

    diagnostics.push(`complete=${complete} pages=${pages}`);

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
    mod._fax_t38_destroy(handle);
    try { mod.FS.unlink(outPath); } catch { /* may already be unlinked */ }
  }
}

function feedIfpToWasm(
  mod: FaxWasmModule,
  handle: number,
  ifp: Uint8Array,
  seqNo: number,
): void {
  const ptr = mod._malloc(ifp.length);
  mod.HEAPU8.set(ifp, ptr);
  mod._fax_t38_rx_ifp(handle, ptr, ifp.length, seqNo);
  mod._free(ptr);
}

interface IfpFrame {
  ifp: Uint8Array;
  seqNo: number;
}

function unframeAllUdptl(
  packets: UdptlPacketLike[],
  diagnostics: string[],
): IfpFrame[] {
  const frames: IfpFrame[] = [];

  // Sort by capture time to ensure order
  const sorted = [...packets].sort((a, b) => a.captureTimeMs - b.captureTimeMs);

  for (const pkt of sorted) {
    try {
      const result = unframeUdptl(pkt.payload);
      frames.push({ ifp: result.primaryIfp, seqNo: result.seqNo });

      // Also include recovered redundancy packets (older ones we might have missed)
      for (const secondary of result.secondaryIfps) {
        frames.push({ ifp: secondary.ifp, seqNo: secondary.seqNo });
      }
    } catch (e) {
      diagnostics.push(`UDPTL unframe error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // De-duplicate by seqNo, keep first occurrence
  const seen = new Set<number>();
  const deduped: IfpFrame[] = [];
  for (const f of frames) {
    if (!seen.has(f.seqNo)) {
      seen.add(f.seqNo);
      deduped.push(f);
    }
  }

  // Sort by sequence number for correct feed order
  deduped.sort((a, b) => a.seqNo - b.seqNo);

  diagnostics.push(`UDPTL: ${packets.length} packets -> ${deduped.length} unique IFP frames`);
  return deduped;
}
