# @sipflow/fax-wasm

Decode T.30 (G.711 audio pass-through) and T.38 (UDPTL) faxes to TIFF entirely
in the browser or Node.js. Built on [spandsp](https://github.com/freeswitch/spandsp)
compiled to WebAssembly via Emscripten. No server round-trip required.

## Install

```bash
pnpm add @sipflow/fax-wasm
# or: npm install @sipflow/fax-wasm
# or: yarn add @sipflow/fax-wasm
```

### Glue files (browser vs Node)

The package ships two flavors of the Emscripten glue side-by-side in
`dist/`, and the `exports.node` condition in `package.json` routes
consumers to the right one automatically:

* **`dist/fax.js`** — browser-safe variant. The dead-branch
  `require("fs"|"path"|"crypto")` calls have been neutralized so
  bundlers (Webpack, Turbopack, Vite, esbuild) see no Node references.
  Used by the default ESM/CJS bundles (`dist/index.{mjs,cjs}`) and the
  worker (`dist/worker.mjs`).
* **`dist/fax.node.js`** — pristine Emscripten output (with the Node
  `require`s intact). Used by the `node` export condition's bundles
  (`dist/index.node.{mjs,cjs}`) and by the in-repo test suite.

The wasm binary is inlined into both glue files as base64
(`-s SINGLE_FILE=1`), so you don't need to copy or host a separate
`fax.wasm` artifact, and there's no runtime `fetch` for the wasm.

## Quick start (main thread)

### G.711 fax (audio pass-through)

```ts
import { decodeG711Fax } from "@sipflow/fax-wasm";

// pcm: Int16Array of 8 kHz 16-bit LPCM (decoded from G.711 RTP)
const result = await decodeG711Fax(pcm);

if (result.tiff) {
  const blob = new Blob([result.tiff], { type: "image/tiff" });
  // render or download the TIFF
}
```

### T.38 fax (UDPTL)

```ts
import { decodeT38Fax } from "@sipflow/fax-wasm";

// packets: Array<{ payload: Uint8Array, captureTimeMs: number }>
// where payload is the raw UDP payload (UDPTL envelope)
const result = await decodeT38Fax(packets);

if (result.tiff) {
  console.log(`Received ${result.pages} page(s) from ${result.remoteIdent}`);
}
```

### Convenience: decode from RTP packets

```ts
import { decodeFaxFromRtp } from "@sipflow/fax-wasm";

const result = await decodeFaxFromRtp({
  payloadType: 0, // 0 = PCMU, 8 = PCMA
  packets: rtpPackets,
});
```

## Running the decoder in a Web Worker

Fax decoding is CPU-bound (~1.2 MB of WASM, runs spandsp's full T.30
state machine). For any UI-facing app you'll want it off the main
thread. The package ships a worker entrypoint plus a
`FaxWorkerClient` helper that wraps the postMessage protocol with
Promises and `AbortSignal` support.

### Why you need a 1-line worker shim file

Webpack, Turbopack, and Vite all support
`new Worker(new URL("<relative-path>", import.meta.url), { type: "module" })`
as the way to bundle a worker, but **none of them resolve a bare
package specifier inside `new URL(...)`** — so
`new URL("@sipflow/fax-wasm/worker", ...)` doesn't work. The fix is a
tiny consumer-owned file that does a side-effect import; the bundler
sees a relative URL, follows it into your project, and resolves the
bare specifier through normal module resolution from there.

### Recipe: Next.js / Webpack / Turbopack / Vite

Create a one-line worker shim somewhere in your source tree:

```ts
// app/fax-worker.ts  (or wherever)
import "@sipflow/fax-wasm/worker";
```

Then drive it with `FaxWorkerClient`:

```ts
import { FaxWorkerClient } from "@sipflow/fax-wasm";

const worker = new Worker(
  new URL("./fax-worker.ts", import.meta.url),
  { type: "module" },
);
const client = new FaxWorkerClient(worker);

try {
  const result = await client.decodeT38UDPTL(udptlPackets, { signal });
  // result.tiff, result.pages, result.remoteIdent, result.diagnostics
} finally {
  client.terminate(); // frees the worker's ~1.2 MB WASM heap
}
```

`FaxWorkerClient` is reusable — instantiate once, run many decodes, then
`terminate()`. Each call accepts an optional `AbortSignal`; aborting
rejects the pending promise with an `AbortError` (the worker keeps
running so you can issue more requests, matching `fetch` semantics).

### Raw protocol (no helper)

If you'd rather drive the worker yourself, the message protocol is
exported as types:

```ts
import type { WorkerRequest, WorkerResponse } from "@sipflow/fax-wasm";

worker.postMessage({ id: "1", type: "decodeG711", pcm } satisfies WorkerRequest);
worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
  const { id, result, error } = e.data;
};
```

## Node usage

Node consumers get a separate set of bundles
(`dist/index.node.{mjs,cjs}`) via the `node` export condition, with the
un-stripped Emscripten glue. The API is identical to the browser
import:

```ts
// ESM
import { decodeT38Fax } from "@sipflow/fax-wasm";

// CommonJS
const { decodeT38Fax } = require("@sipflow/fax-wasm");

const result = await decodeT38Fax(packets);
```

Requires Node ≥ 18 (for `WebAssembly` + ESM dynamic `import()` of the
Emscripten glue). The Web Worker entrypoint (`@sipflow/fax-wasm/worker`)
is browser-only — for parallel decoding from Node, use the main entry
inside a `node:worker_threads` worker of your own.

## API

### `decodeG711Fax(pcm, opts?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `pcm` | `Int16Array` | Continuous 8 kHz 16-bit signed LPCM (silence-filled for gaps) |
| `opts.signal` | `AbortSignal` | Optional abort signal |
| **Returns** | `Promise<FaxResult>` | |

### `decodeT38Fax(packets, opts?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `packets` | `UdptlPacketLike[]` | Raw UDPTL packets with `{ payload, captureTimeMs }` |
| `opts.signal` | `AbortSignal` | Optional abort signal |
| **Returns** | `Promise<FaxResult>` | |

### `decodeFaxFromRtp(stream)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `stream.payloadType` | `number` | RTP payload type (0 = PCMU, 8 = PCMA) |
| `stream.packets` | `RtpPacketLike[]` | RTP packets with payload, timestamps, SSRC |
| **Returns** | `Promise<FaxResult>` | |

### `unframeUdptl(data)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `Uint8Array` | Raw UDPTL packet bytes |
| **Returns** | `UdptlResult` | Primary IFP + secondary (redundancy) payloads |

### `FaxResult`

```ts
interface FaxResult {
  tiff: Uint8Array | null;  // null if no page completed
  pages: number;
  remoteIdent?: string;     // sender TSI/CSI
  diagnostics: string[];    // T.30 state machine log
}
```

### `FaxWorkerClient`

```ts
class FaxWorkerClient {
  constructor(worker: Worker);
  decodeT38UDPTL(packets: UdptlPacketLike[], opts?: DecodeOptions): Promise<FaxResult>;
  decodeG711(pcm: Int16Array, opts?: DecodeOptions): Promise<FaxResult>;
  decodeFaxFromRtp(payloadType: number, packets: RtpPacketLike[], opts?: DecodeOptions): Promise<FaxResult>;
  terminate(): void;
}

interface DecodeOptions {
  signal?: AbortSignal;
}
```

Promise-flavored wrapper around the worker postMessage protocol. Owns
the `Worker` instance you give it; multiplexes concurrent decodes via
correlation IDs; supports `AbortSignal`. See the Web Worker recipe
above.

## Build from source

The entire build runs inside Docker -- no local Emscripten installation needed.

```bash
git clone https://github.com/cmendes0101/fax-wasm.git
cd fax-wasm
docker compose run --rm build
```

This runs `make all` which:
1. Downloads pinned sources (zlib 1.3.1, libtiff 4.7.0, spandsp)
2. Cross-compiles each to static `.a` archives with Emscripten
3. Links everything into `dist/fax.js` with the wasm binary base64-inlined
   (`-s SINGLE_FILE=1`) so the package ships a single artifact

To also bundle the TypeScript layer:

```bash
pnpm install
pnpm run build:bundle
```

### Makefile targets

| Target | Description |
|--------|-------------|
| `make deps` | Download pinned third-party sources |
| `make libs` | Build zlib, libtiff, spandsp static archives |
| `make wasm` | Compile the C wrapper + link to WASM |
| `make bundle` | Bundle TypeScript (ESM + CJS) |
| `make test` | Run Vitest test suite |
| `make clean` | Remove build/, dist/, third_party/ |

## Architecture

```
                    ┌─────────────────────────────┐
                    │   Your app (browser/Node)    │
                    └──────────┬──────────────────-┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
       decodeG711Fax    decodeT38Fax    decodeFaxFromRtp
              │                │                │
              │         ┌──────┴──────┐         │
              │         │  udptl.ts   │   G.711 decode
              │         │ (pure TS)   │   (pure TS)
              │         └──────┬──────┘         │
              │                │                │
              └────────┬───────┴────────────────┘
                       │
                 ┌─────┴─────┐
                 │  fax.js   │  spandsp + libtiff + zlib (Emscripten)
                 │  (MEMFS)  │  wasm binary base64-inlined (SINGLE_FILE=1)
                 └───────────┘
```

The WASM module uses Emscripten's in-memory filesystem (MEMFS) so spandsp
writes the TIFF to a virtual file, which the TypeScript layer reads back as
a `Uint8Array`.

For G.711, the decoder runs in both calling-party and called-party modes
(since we don't know the fax direction from a PCAP) and returns whichever
produced a valid TIFF.

UDPTL unframing is implemented in pure TypeScript to keep the WASM surface
minimal and allow iterating on UDPTL parsing without rebuilding the binary.

## Size budget

Target: ~400-500 KB for the wasm payload itself (compiled with `-Oz` and
feature-trimmed dependencies). Because `-s SINGLE_FILE=1` base64-encodes
the wasm into `fax.js`, the on-disk artifact is roughly `wasm_bytes * 4/3`
plus ~30-50 KB of glue — expect ~600-700 KB total. The whole thing is
lazy-loaded by `getModule()`, so it never touches your initial bundle.

## License

LGPL-2.1-or-later (inherited from [spandsp](https://github.com/freeswitch/spandsp)).

This package includes compiled code from:
- **spandsp** (LGPL-2.1) -- T.30/T.38 fax processing
- **libtiff** (BSD-like) -- TIFF file I/O
- **zlib** (zlib license) -- compression

See [NOTICE](./NOTICE) for full attribution.

As required by LGPL-2.1, the complete source code for the WASM binary and
build scripts are included in this repository. Users may rebuild the WASM
module from source using `docker compose run --rm build`.
