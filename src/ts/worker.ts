/**
 * Web Worker entry point for @sipflow/fax-wasm.
 *
 * Offloads fax decoding to a worker thread so the main thread stays
 * responsive. The main thread posts messages with the decode request
 * and receives the result asynchronously.
 *
 * Usage from main thread:
 *
 *   const worker = new Worker(
 *     new URL('@sipflow/fax-wasm/worker', import.meta.url),
 *     { type: 'module' }
 *   );
 *
 *   worker.postMessage({ type: 'decodeG711', pcm: int16Array });
 *   worker.onmessage = (e) => {
 *     const result: FaxResult = e.data;
 *   };
 */

import { decodeG711Fax } from "./audio.js";
import { decodeT38Fax } from "./t38.js";
import { decodeFaxFromRtp } from "./index.js";
import type { FaxResult, RtpPacketLike, UdptlPacketLike } from "./types.js";

export type WorkerRequest =
  | { id: string; type: "decodeG711"; pcm: Int16Array }
  | { id: string; type: "decodeT38"; packets: UdptlPacketLike[] }
  | { id: string; type: "decodeFaxFromRtp"; payloadType: number; packets: RtpPacketLike[] };

export interface WorkerResponse {
  id: string;
  result?: FaxResult;
  error?: string;
}

const ctx = globalThis as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  let result: FaxResult;

  try {
    switch (req.type) {
      case "decodeG711":
        result = await decodeG711Fax(req.pcm);
        break;
      case "decodeT38":
        result = await decodeT38Fax(req.packets);
        break;
      case "decodeFaxFromRtp":
        result = await decodeFaxFromRtp({
          payloadType: req.payloadType,
          packets: req.packets,
        });
        break;
      default:
        ctx.postMessage({
          id: req.id,
          error: `Unknown request type: ${(req as { type: string }).type}`,
        } satisfies WorkerResponse);
        return;
    }

    ctx.postMessage({ id: req.id, result } satisfies WorkerResponse);
  } catch (e) {
    ctx.postMessage({
      id: req.id,
      error: e instanceof Error ? e.message : String(e),
    } satisfies WorkerResponse);
  }
};
