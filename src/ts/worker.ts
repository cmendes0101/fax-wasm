/**
 * Web Worker entry point for @sipflow/fax-wasm.
 *
 * This module is **side-effectful**: importing it installs `onmessage`
 * on `globalThis`, turning whatever context is evaluating it into a
 * fax-decoding worker. It exports types (`WorkerRequest`,
 * `WorkerResponse`) but no runtime symbols.
 *
 * Usage: see the "Web Worker" section in the package README. The short
 * version, because bundlers (Webpack/Turbopack/Vite) won't resolve a
 * bare package specifier inside `new URL(...)`:
 *
 *   // 1. Tiny consumer-owned shim — relative path the bundler can
 *   //    resolve. Side-effect import does the rest.
 *   // app/fax-worker.ts
 *   import "@sipflow/fax-wasm/worker";
 *
 *   // 2. Main thread:
 *   import { FaxWorkerClient } from "@sipflow/fax-wasm";
 *   const worker = new Worker(
 *     new URL("./fax-worker.ts", import.meta.url),
 *     { type: "module" },
 *   );
 *   const client = new FaxWorkerClient(worker);
 *   const result = await client.decodeT38UDPTL(packets, { signal });
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
      default: {
        // Exhaustive-match: TS narrows `req` to `never` here, but at
        // runtime an out-of-protocol message could still arrive (e.g.
        // mismatched package versions across main/worker). Cast back to
        // the protocol shape just to read `id` + `type` defensively.
        const unknown = req as { id: string; type: string };
        ctx.postMessage({
          id: unknown.id,
          error: `Unknown request type: ${unknown.type}`,
        } satisfies WorkerResponse);
        return;
      }
    }

    ctx.postMessage({ id: req.id, result } satisfies WorkerResponse);
  } catch (e) {
    ctx.postMessage({
      id: req.id,
      error: e instanceof Error ? e.message : String(e),
    } satisfies WorkerResponse);
  }
};
