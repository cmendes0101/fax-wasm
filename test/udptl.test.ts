/**
 * Unit tests for the UDPTL unframer.
 * These run without WASM — pure TypeScript.
 */

import { describe, it, expect } from "vitest";
import { unframeUdptl } from "../src/ts/udptl.js";

describe("unframeUdptl", () => {
  it("rejects packets shorter than 4 bytes", () => {
    expect(() => unframeUdptl(new Uint8Array([0x00, 0x01]))).toThrow("too short");
  });

  it("parses a minimal UDPTL packet with no redundancy", () => {
    // seq=1, primary IFP = [0xAA, 0xBB], no error recovery
    const pkt = new Uint8Array([
      0x00, 0x01, // seq = 1
      0x02,       // length determinant: 2 bytes (short form)
      0xaa, 0xbb, // IFP payload
      0x00,       // redundancy mode, 0 secondary packets
    ]);

    const result = unframeUdptl(pkt);
    expect(result.seqNo).toBe(1);
    expect(result.primaryIfp).toEqual(new Uint8Array([0xaa, 0xbb]));
    expect(result.secondaryIfps).toHaveLength(0);
  });

  it("parses a UDPTL packet with one redundancy copy", () => {
    // seq=5, primary IFP = [0x01], 1 secondary (seq=4) = [0x02]
    const pkt = new Uint8Array([
      0x00, 0x05, // seq = 5
      0x01,       // primary length: 1
      0x01,       // primary IFP
      0x01,       // redundancy count: 1
      0x01,       // secondary length: 1
      0x02,       // secondary IFP
    ]);

    const result = unframeUdptl(pkt);
    expect(result.seqNo).toBe(5);
    expect(result.primaryIfp).toEqual(new Uint8Array([0x01]));
    expect(result.secondaryIfps).toHaveLength(1);
    expect(result.secondaryIfps[0]!.seqNo).toBe(4);
    expect(result.secondaryIfps[0]!.ifp).toEqual(new Uint8Array([0x02]));
  });

  it("parses long-form length determinant (14-bit)", () => {
    // Build a packet with a 200-byte IFP payload using long-form length
    const ifpLen = 200;
    const ifp = new Uint8Array(ifpLen).fill(0x42);

    const pkt = new Uint8Array(2 + 2 + ifpLen + 1);
    pkt[0] = 0x00; // seq high
    pkt[1] = 0x0a; // seq = 10
    // Long-form: bit 7 set, bit 6 clear, 14-bit length
    pkt[2] = 0x80 | ((ifpLen >> 8) & 0x3f);
    pkt[3] = ifpLen & 0xff;
    pkt.set(ifp, 4);
    pkt[4 + ifpLen] = 0x00; // no redundancy

    const result = unframeUdptl(pkt);
    expect(result.seqNo).toBe(10);
    expect(result.primaryIfp.length).toBe(200);
    expect(result.primaryIfp[0]).toBe(0x42);
  });

  it("handles high sequence numbers (wrapping at 16 bits)", () => {
    const pkt = new Uint8Array([
      0xff, 0xfe, // seq = 65534
      0x01,       // length: 1
      0xcc,       // IFP
      0x00,       // no redundancy
    ]);

    const result = unframeUdptl(pkt);
    expect(result.seqNo).toBe(65534);
  });

  it("parses multiple redundancy copies", () => {
    // seq=10, primary=[0x01], 3 secondaries
    const pkt = new Uint8Array([
      0x00, 0x0a,             // seq = 10
      0x01, 0x01,             // primary: len=1, data=0x01
      0x03,                   // redundancy count: 3
      0x01, 0xaa,             // secondary 1 (seq=9): len=1, data=0xAA
      0x01, 0xbb,             // secondary 2 (seq=8): len=1, data=0xBB
      0x01, 0xcc,             // secondary 3 (seq=7): len=1, data=0xCC
    ]);

    const result = unframeUdptl(pkt);
    expect(result.seqNo).toBe(10);
    expect(result.secondaryIfps).toHaveLength(3);
    expect(result.secondaryIfps[0]!.seqNo).toBe(9);
    expect(result.secondaryIfps[1]!.seqNo).toBe(8);
    expect(result.secondaryIfps[2]!.seqNo).toBe(7);
  });

  it("skips FEC mode gracefully", () => {
    // seq=3, primary=[0xFF], FEC recovery (bit 7 of recovery byte set)
    const pkt = new Uint8Array([
      0x00, 0x03,
      0x01, 0xff,
      0x80, 0x00, 0x00, // FEC header (bit 7 set)
    ]);

    const result = unframeUdptl(pkt);
    expect(result.seqNo).toBe(3);
    expect(result.primaryIfp).toEqual(new Uint8Array([0xff]));
    expect(result.secondaryIfps).toHaveLength(0);
  });
});
