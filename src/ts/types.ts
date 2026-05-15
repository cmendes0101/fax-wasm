/**
 * Public types for @sipflow/fax-wasm.
 */

export interface FaxResult {
  /** The decoded TIFF bytes, or null if no page was completed. */
  tiff: Uint8Array | null;
  /** Number of pages received. */
  pages: number;
  /** Remote station identifier (TSI/CSI) if provided by the sender. */
  remoteIdent?: string;
  /** Diagnostic messages from the T.30 state machine. */
  diagnostics: string[];
}

export interface RtpPacketLike {
  payload: Uint8Array;
  rtpTimestamp: number;
  captureTimeMs: number;
  ssrc: number;
  payloadType: number;
}

export interface UdptlPacketLike {
  payload: Uint8Array;
  captureTimeMs: number;
}

export interface DecodeG711Options {
  signal?: AbortSignal;
}

export interface DecodeT38Options {
  signal?: AbortSignal;
}

/** Internal Emscripten module interface (not exported to consumers). */
export interface FaxWasmModule {
  _fax_audio_create(pathPtr: number, callingParty: number): number;
  _fax_audio_rx(handle: number, pcmPtr: number, numSamples: number): number;
  _fax_audio_finish(handle: number): number;
  _fax_audio_get_pages(handle: number): number;
  _fax_audio_get_remote_ident(handle: number): number;
  _fax_audio_is_complete(handle: number): number;
  _fax_audio_destroy(handle: number): void;

  _fax_t38_create(pathPtr: number): number;
  _fax_t38_rx_ifp(handle: number, ifpPtr: number, len: number, seqNo: number): number;
  _fax_t38_finish(handle: number): number;
  _fax_t38_get_pages(handle: number): number;
  _fax_t38_get_remote_ident(handle: number): number;
  _fax_t38_is_complete(handle: number): number;
  _fax_t38_destroy(handle: number): void;

  _malloc(size: number): number;
  _free(ptr: number): void;

  HEAPU8: Uint8Array;
  HEAP16: Int16Array;

  FS: {
    readFile(path: string, opts?: { encoding?: string }): Uint8Array;
    unlink(path: string): void;
    stat(path: string): { size: number };
  };

  UTF8ToString(ptr: number): string;
  stringToUTF8(str: string, outPtr: number, maxBytes: number): void;
}
