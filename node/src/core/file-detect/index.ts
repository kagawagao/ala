/** Header-based file-type detection for Android diagnostics artifacts. */
import { open } from 'node:fs/promises'

export type AlaFileType = 'log' | 'pcap' | 'hci' | 'trace' | 'anr' | 'tombstone'

const BTSNOOP_MAGIC = Buffer.from('btsnoop\u0000', 'latin1')

const PCAP_MAGICS = new Set([
  0xd4c3b2a1, // pcap le
  0xa1b2c3d4, // pcap be
  0x4d3cb2a1, // pcap ns le
  0xa1b23c4d, // pcap ns be
  0x0a0d0d0a, // pcapng
])

const TRACE_MARKERS = ['"traceEvents"', '"systemTraceEvents"', '"displayTimeUnit"', '"ph"']

const ANR_HEADER_PATTERN = /----- pid \d+ at .* -----/
const TOMBSTONE_HEADER_PATTERN = /\*{3} \*{3} \*{3} \*{3}/

/**
 * Detect the artifact type from its leading bytes. Detection never consults
 * the file extension, matching the Python implementation and its callers.
 */
export function detectFileTypeFromHeader(header: Uint8Array): AlaFileType {
  if (header.length === 0) return 'log'

  if (header.length >= 4) {
    const magic = ((header[0]! << 24) | (header[1]! << 16) | (header[2]! << 8) | header[3]!) >>> 0
    if (PCAP_MAGICS.has(magic)) return 'pcap'
  }

  if (header.length >= 8 && BTSNOOP_MAGIC.every((byte, index) => header[index] === byte)) {
    return 'hci'
  }

  // Archives are decompressed downstream and treated as logs.
  if (header[0] === 0x1f && header[1] === 0x8b) return 'log'
  if (header[0] === 0x50 && header[1] === 0x4b) return 'log'
  if (
    header.length >= 7 &&
    Buffer.from(header.subarray(0, 6)).equals(Buffer.from('Rar!\u001a\u0007', 'latin1')) &&
    (header[6] === 0x00 || header[6] === 0x01)
  ) {
    return 'log'
  }
  if (
    header.length >= 6 &&
    Buffer.from(header.subarray(0, 6)).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))
  ) {
    return 'log'
  }

  // Binary density: more than four control bytes (excluding TAB/LF/CR) in the
  // first 256 bytes means a binary artifact, and only traces are binary here.
  const scanLength = Math.min(header.length, 256)
  let controlBytes = 0
  for (let index = 0; index < scanLength; index += 1) {
    const byte = header[index]!
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) controlBytes += 1
  }
  if (controlBytes > 4) return 'trace'

  const text = Buffer.from(header).toString('utf8')
  const scanWindow = text.slice(0, 8192)

  if (TOMBSTONE_HEADER_PATTERN.test(scanWindow)) return 'tombstone'
  if (ANR_HEADER_PATTERN.test(scanWindow) && scanWindow.includes('"main" prio=')) return 'anr'

  const trimmed = text.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    if (TRACE_MARKERS.some((marker) => text.includes(marker))) return 'trace'
  }

  return 'log'
}

/** Read up to 8 KiB from `filePath` and detect its artifact type. */
export async function detectFileTypeFromPath(filePath: string): Promise<AlaFileType> {
  try {
    const handle = await open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(8192)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      return detectFileTypeFromHeader(buffer.subarray(0, bytesRead))
    } finally {
      await handle.close()
    }
  } catch {
    return 'log'
  }
}
