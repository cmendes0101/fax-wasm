# Test Fixtures

This directory holds golden test fixtures for fax decode validation.

## Required files

| File | Description |
|------|-------------|
| `g711-pcmu-fax.raw` | 16-bit signed LE PCM @ 8 kHz of a G.711 µ-law fax call (both sides concatenated; the decoder tries both directions) |
| `g711-pcmu-fax.expected.tif` | The TIFF that spandsp should produce from the above |
| `g711-pcmu-fax.sha256` | SHA-256 hex digest of the expected TIFF |
| `t38-udptl-fax.bin` | Concatenated UDPTL payloads (4-byte big-endian length prefix per packet) |
| `t38-udptl-fax.expected.tif` | The TIFF that spandsp should produce from the above |
| `t38-udptl-fax.sha256` | SHA-256 hex digest of the expected TIFF |

## How to generate fixtures

### From a PCAP (recommended)

1. Open a fax PCAP in Wireshark.
2. For G.711: use `tshark` to extract the raw RTP payload, decode G.711 to PCM:
   ```bash
   tshark -r fax.pcap -Y rtp -T fields -e rtp.payload | \
     xxd -r -p | sox -t raw -r 8000 -e mu-law -b 8 -c 1 - -t raw -r 8000 -e signed -b 16 -c 1 g711-pcmu-fax.raw
   ```
3. For T.38: extract UDPTL payloads as length-prefixed binary:
   ```bash
   tshark -r fax.pcap -Y udptl -T fields -e udptl.payload | \
     python3 -c "
   import sys
   for line in sys.stdin:
       b = bytes.fromhex(line.strip().replace(':',''))
       sys.stdout.buffer.write(len(b).to_bytes(4,'big') + b)
   " > t38-udptl-fax.bin
   ```
4. Decode with the built WASM module or native spandsp to get the expected TIFF.
5. Generate SHA-256:
   ```bash
   sha256sum g711-pcmu-fax.expected.tif | awk '{print $1}' > g711-pcmu-fax.sha256
   sha256sum t38-udptl-fax.expected.tif | awk '{print $1}' > t38-udptl-fax.sha256
   ```

### From Wireshark sample captures

The Wireshark wiki has sample fax captures:
- https://wiki.wireshark.org/SampleCaptures#t38
- Search for "T.38" or "fax" in the sample captures list.

## Note

These fixture files are NOT checked into git if they contain real call data.
Add them locally or in CI via a secure artifact store.
