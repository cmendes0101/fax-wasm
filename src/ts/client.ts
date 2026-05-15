/**
 * Promise-flavored client for the `@sipflow/fax-wasm` Web Worker.
 *
 * Wraps the raw postMessage protocol from `./worker.ts` with:
 *
 *   - Correlation-ID multiplexing (many concurrent decodes per worker).
 *   - `AbortSignal` support (pending decode rejects with `AbortError`;
 *     subsequent worker responses for that id are ignored).
 *   - Worker `error` events fan out to all pending promises.
 *
 * The class owns a single `Worker` instance — caller constructs it (because
 * only the caller's bundler knows how to resolve the worker entrypoint
 * URL) and passes it in. See README for the recommended worker-construction
 * pattern across bundlers.
 *
 * Reuse is cheap; tear down with `terminate()` when you're done to free the
 * worker's WASM heap (~1.2 MB).
 *
 * @example
 * ```ts
 * import { FaxWorkerClient } from "@sipflow/fax-wasm";
 *
 * // Consumer-owned worker shim (see README for why):
 * //   // fax-worker.ts
 * //   import "@sipflow/fax-wasm/worker";
 * const worker = new Worker(
 *   new URL("./fax-worker.ts", import.meta.url),
 *   { type: "module" },
 * );
 * const client = new FaxWorkerClient(worker);
 *
 * const result = await client.decodeT38UDPTL(packets, { signal });
 * client.terminate();
 * ```
 */

import type { FaxResult, RtpPacketLike, UdptlPacketLike } from "./types.js";
import type { WorkerRequest, WorkerResponse } from "./worker.js";

export interface DecodeOptions {
  /**
   * Cancels the pending decode. The returned Promise rejects with an
   * `AbortError`. The worker keeps running — call `terminate()` if you
   * also want to tear it down. This matches `fetch`'s `AbortSignal`
   * semantics: aborting unsubscribes the caller, it doesn't stop the
   * server.
   */
  signal?: AbortSignal;
}

interface PendingEntry {
  resolve: (r: FaxResult) => void;
  reject: (e: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class FaxWorkerClient {
  #worker: Worker;
  #pending = new Map<string, PendingEntry>();
  #seq = 0;
  #terminated = false;

  constructor(worker: Worker) {
    this.#worker = worker;
    worker.addEventListener("message", this.#onMessage);
    worker.addEventListener("error", this.#onError);
  }

  /** Decode a T.38 fax from UDPTL packets. */
  decodeT38UDPTL(
    packets: UdptlPacketLike[],
    opts: DecodeOptions = {},
  ): Promise<FaxResult> {
    return this.#run(
      { id: this.#nextId(), type: "decodeT38", packets },
      opts,
    );
  }

  /** Decode a T.30 fax from 16-bit, 8 kHz LPCM audio. */
  decodeG711(pcm: Int16Array, opts: DecodeOptions = {}): Promise<FaxResult> {
    return this.#run(
      { id: this.#nextId(), type: "decodeG711", pcm },
      opts,
    );
  }

  /**
   * Decode a T.30 fax directly from G.711 RTP packets (PT 0 = µ-law,
   * PT 8 = A-law). The worker handles G.711 → LPCM conversion.
   */
  decodeFaxFromRtp(
    payloadType: number,
    packets: RtpPacketLike[],
    opts: DecodeOptions = {},
  ): Promise<FaxResult> {
    return this.#run(
      { id: this.#nextId(), type: "decodeFaxFromRtp", payloadType, packets },
      opts,
    );
  }

  /**
   * Reject every pending decode, detach listeners, and terminate the
   * underlying worker. Idempotent; safe to call from cleanup paths.
   */
  terminate(): void {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#worker.removeEventListener("message", this.#onMessage);
    this.#worker.removeEventListener("error", this.#onError);
    const err = new Error("FaxWorkerClient terminated");
    for (const entry of this.#pending.values()) {
      this.#detachAbort(entry);
      entry.reject(err);
    }
    this.#pending.clear();
    this.#worker.terminate();
  }

  #nextId(): string {
    this.#seq = (this.#seq + 1) >>> 0;
    return `fax-${Date.now().toString(36)}-${this.#seq.toString(36)}`;
  }

  #run(req: WorkerRequest, opts: DecodeOptions): Promise<FaxResult> {
    return new Promise<FaxResult>((resolve, reject) => {
      if (this.#terminated) {
        reject(new Error("FaxWorkerClient is terminated"));
        return;
      }
      const signal = opts.signal;
      if (signal?.aborted) {
        reject(makeAbortError());
        return;
      }
      const entry: PendingEntry = { resolve, reject, signal };
      if (signal) {
        entry.onAbort = () => {
          this.#pending.delete(req.id);
          this.#detachAbort(entry);
          reject(makeAbortError());
        };
        signal.addEventListener("abort", entry.onAbort, { once: true });
      }
      this.#pending.set(req.id, entry);
      this.#worker.postMessage(req);
    });
  }

  #detachAbort(entry: PendingEntry): void {
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener("abort", entry.onAbort);
    }
  }

  #onMessage = (evt: MessageEvent<WorkerResponse>): void => {
    const data = evt.data;
    if (!data?.id) return;
    const entry = this.#pending.get(data.id);
    if (!entry) return;
    this.#pending.delete(data.id);
    this.#detachAbort(entry);
    if (data.error) {
      entry.reject(new Error(data.error));
    } else if (data.result) {
      entry.resolve(data.result);
    } else {
      entry.reject(new Error("Fax worker returned an empty response"));
    }
  };

  #onError = (evt: ErrorEvent): void => {
    const err = new Error(evt.message || "Fax worker errored");
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const entry of pending) {
      this.#detachAbort(entry);
      entry.reject(err);
    }
  };
}

function makeAbortError(): Error {
  // DOMException is a global in browsers, dedicated workers, and Node 17+.
  // Fall back to a plain Error with `.name = "AbortError"` for older
  // runtimes — `AbortSignal`-aware code checks `.name`, not the type.
  if (typeof DOMException !== "undefined") {
    return new DOMException("Fax decode aborted", "AbortError");
  }
  const err = new Error("Fax decode aborted");
  err.name = "AbortError";
  return err;
}
