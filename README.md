# @sipflow/fax-wasm

Decode T.30 (G.711 audio pass-through) and T.38 (UDPTL) faxes to TIFF entirely
in the browser or Node.js. Built on [spandsp](https://github.com/freeswitch/spandsp)
compiled to WebAssembly via Emscripten. No server round-trip required.

## Install

```bash
npm install @sipflow/fax-wasm
```

## Quick start

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

### Web Worker (off main thread)

```ts
const worker = new Worker(
  new URL("@sipflow/fax-wasm/worker", import.meta.url),
  { type: "module" },
);

worker.postMessage({ id: "1", type: "decodeG711", pcm });
worker.onmessage = (e) => {
  const { result, error } = e.data;
};
```

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
3. Links everything into `dist/fax.wasm` + `dist/fax.js`

To also bundle the TypeScript layer:

```bash
npm install
npm run build:bundle
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
                 │  fax.wasm │  spandsp + libtiff + zlib
                 │  (MEMFS)  │  compiled with Emscripten
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

Target: ~400-500 KB for `fax.wasm` (compiled with `-Oz` and feature-trimmed
dependencies). The Emscripten glue JS (`fax.js`) adds ~30-50 KB.

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
