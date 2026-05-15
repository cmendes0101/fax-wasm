/**
 * UDPTL unframer — extracts IFP (Internet Facsimile Protocol) payloads
 * from UDPTL (UDP Transport Layer) envelopes as defined in ITU-T T.38
 * Annex D.
 *
 * UDPTL packet structure:
 *   - 2 bytes: sequence number (big-endian)
 *   - primary IFP payload (length-prefixed)
 *   - error recovery:
 *       bit 7 of first byte = 0 → redundancy mode
 *       bit 7 of first byte = 1 → FEC mode
 *
 * Redundancy mode carries older IFP copies so lost packets can be recovered.
 * FEC mode carries parity data (not decoded here — we rely on redundancy).
 *
 * Pure TypeScript, no WASM dependency.
 */

export interface UdptlResult {
  /** Sequence number of this UDPTL packet. */
  seqNo: number;
  /** The primary IFP payload in this packet. */
  primaryIfp: Uint8Array;
  /** Older IFP payloads carried as redundancy (may be empty). */
  secondaryIfps: Array<{ ifp: Uint8Array; seqNo: number }>;
}

/**
 * Parse a single UDPTL envelope and extract IFP payload(s).
 *
 * @param data Raw UDP payload bytes (the full UDPTL packet).
 * @returns Parsed primary and any secondary (redundancy) IFP payloads.
 * @throws If the packet is too short or malformed.
 */
export function unframeUdptl(data: Uint8Array): UdptlResult {
  if (data.length < 4) {
    throw new Error(`UDPTL packet too short: ${data.length} bytes`);
  }

  let offset = 0;

  // Sequence number: 2 bytes big-endian
  const seqNo = (data[offset]! << 8) | data[offset + 1]!;
  offset += 2;

  // Primary IFP: length-determinant encoded payload
  const { value: primaryIfp, bytesRead: primaryRead } = readLengthDeterminant(data, offset);
  offset += primaryRead;

  // Error recovery section
  const secondaryIfps: Array<{ ifp: Uint8Array; seqNo: number }> = [];

  if (offset < data.length) {
    const recoveryByte = data[offset]!;
    const isFec = (recoveryByte & 0x80) !== 0;

    if (isFec) {
      // FEC mode — we don't decode parity, just skip
      // (in practice most T.38 deployments use redundancy, not FEC)
    } else {
      // Redundancy mode: a sequence of older IFP copies
      try {
        const { count, bytesRead: countRead } = readRedundancyCount(data, offset);
        offset += countRead;

        for (let i = 0; i < count; i++) {
          if (offset >= data.length) break;
          const { value: ifp, bytesRead: read } = readLengthDeterminant(data, offset);
          offset += read;
          // Redundancy packets are in reverse order: seqNo-1, seqNo-2, etc.
          secondaryIfps.push({
            ifp,
            seqNo: seqNo - (i + 1),
          });
        }
      } catch {
        // Malformed redundancy section — still return the primary
      }
    }
  }

  return { seqNo, primaryIfp, secondaryIfps };
}

/**
 * Read a T.38 / ASN.1 PER length determinant.
 *
 * Short form:  if high bit = 0, length is in lower 7 bits (0..127).
 * Long form:   if high bit = 1, lower 6 bits of first byte << 8 | next byte (0..16383).
 *              (bit 6 = 0 for two-byte form)
 *
 * This covers all realistic IFP sizes (max ~64 bytes typically).
 */
function readLengthDeterminant(
  data: Uint8Array,
  offset: number,
): { value: Uint8Array; bytesRead: number } {
  if (offset >= data.length) {
    throw new Error(`Length determinant: offset ${offset} out of bounds (len=${data.length})`);
  }

  const first = data[offset]!;
  let length: number;
  let headerSize: number;

  if ((first & 0x80) === 0) {
    // Short form: 7-bit length
    length = first & 0x7f;
    headerSize = 1;
  } else if ((first & 0x40) === 0) {
    // Long form: 14-bit length
    if (offset + 1 >= data.length) {
      throw new Error("Length determinant: truncated long-form length");
    }
    length = ((first & 0x3f) << 8) | data[offset + 1]!;
    headerSize = 2;
  } else {
    // Fragment form (bit 6 = 1) — extremely rare in T.38, treat as error
    throw new Error("Length determinant: fragment form not supported");
  }

  const payloadStart = offset + headerSize;
  const payloadEnd = payloadStart + length;

  if (payloadEnd > data.length) {
    throw new Error(
      `Length determinant: payload extends past packet ` +
      `(need ${payloadEnd}, have ${data.length})`,
    );
  }

  return {
    value: data.slice(payloadStart, payloadEnd),
    bytesRead: headerSize + length,
  };
}

/**
 * Read the redundancy count field.
 *
 * In UDPTL redundancy mode the error recovery section starts with a
 * count of how many secondary IFP copies follow. This is encoded the
 * same way as a small length determinant.
 */
function readRedundancyCount(
  data: Uint8Array,
  offset: number,
): { count: number; bytesRead: number } {
  if (offset >= data.length) {
    return { count: 0, bytesRead: 0 };
  }

  const first = data[offset]!;

  if ((first & 0x80) === 0) {
    return { count: first & 0x7f, bytesRead: 1 };
  }

  if (offset + 1 >= data.length) {
    return { count: 0, bytesRead: 1 };
  }

  const count = ((first & 0x3f) << 8) | data[offset + 1]!;
  return { count, bytesRead: 2 };
}
