/**
 * Minimal ZIP archive reader for HCI/BTSnoop uploads.
 *
 * Python's `zipfile` is backed into the standard library, but Node only ships
 * compression primitives (`node:zlib`) without archive parsing. This module
 * implements the small subset of the format needed by `HciAnalyzer.decompress`:
 * read the central directory, pick the first entry whose name matches one of
 * the HCI extensions, and inflate it with `inflateRaw`. Stored (method 0) and
 * deflated (method 8) entries are supported, plus the ZIP64 sizes/offsets that
 * large captures produce.
 */
import { inflateRawSync } from 'node:zlib'

/** Mirrors Python's `zipfile.BadZipFile`: a structurally invalid archive. */
export class ZipFormatError extends Error {
  override name = 'ZipFormatError'
}

export interface ZipEntry {
  filename: string
  content: Buffer
}

const EOCD_SIGNATURE = 0x06054b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const ZIP64_EOCD_SIGNATURE = 0x06064b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const LOCAL_FILE_SIGNATURE = 0x04034b50
const EOCD_MIN_SIZE = 22
const EOCD_MAX_COMMENT = 0xffff

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

/** CRC-32 (IEEE 802.3) used by ZIP to verify entry contents. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

interface CentralDirectoryEntry {
  filename: string
  method: number
  crc: number
  compressed_size: number
  uncompressed_size: number
  local_header_offset: number
}

/**
 * Return the first archive entry whose lower-cased filename ends with one of
 * `extensions`, or `null` when the archive holds no such entry.
 *
 * @throws ZipFormatError when the archive itself is malformed.
 */
export function extractFirstZipEntry(data: Buffer, extensions: readonly string[]): ZipEntry | null {
  try {
    const eocdOffset = findEndOfCentralDirectory(data)
    const { count, offset, size } = readCentralDirectoryLocation(data, eocdOffset)

    const directoryStart = offset
    const directoryEnd = offset + size
    if (directoryStart < 0 || directoryEnd > data.length) {
      throw new ZipFormatError('central directory extends past end of archive')
    }
    const directory = data.subarray(directoryStart, directoryEnd)

    let position = 0
    const wanted = extensions.map((extension) => extension.toLowerCase())

    for (let index = 0; index < count; index += 1) {
      if (position + 46 > directory.length) {
        throw new ZipFormatError('truncated central directory')
      }
      if (directory.readUInt32LE(position) !== CENTRAL_DIRECTORY_SIGNATURE) {
        throw new ZipFormatError('invalid central directory file header signature')
      }

      const flags = directory.readUInt16LE(position + 8)
      const method = directory.readUInt16LE(position + 10)
      const crc = directory.readUInt32LE(position + 16)
      let compressedSize = directory.readUInt32LE(position + 20)
      let uncompressedSize = directory.readUInt32LE(position + 24)
      const nameLength = directory.readUInt16LE(position + 28)
      const extraLength = directory.readUInt16LE(position + 30)
      const commentLength = directory.readUInt16LE(position + 32)
      let localHeaderOffset = directory.readUInt32LE(position + 42)

      const nameStart = position + 46
      const extraStart = nameStart + nameLength
      const nextPosition = extraStart + extraLength + commentLength
      if (nextPosition > directory.length) {
        throw new ZipFormatError('truncated central directory entry')
      }

      if (
        compressedSize === 0xffffffff ||
        uncompressedSize === 0xffffffff ||
        localHeaderOffset === 0xffffffff
      ) {
        const extra = directory.subarray(extraStart, extraStart + extraLength)
        const resolved = resolveZip64Entry(extra, {
          compressed_size: compressedSize,
          uncompressed_size: uncompressedSize,
          local_header_offset: localHeaderOffset,
        })
        compressedSize = resolved.compressed_size
        uncompressedSize = resolved.uncompressed_size
        localHeaderOffset = resolved.local_header_offset
      }

      const filename = decodeFilename(directory.subarray(nameStart, nameStart + nameLength), flags)
      const entry: CentralDirectoryEntry = {
        filename,
        method,
        crc,
        compressed_size: compressedSize,
        uncompressed_size: uncompressedSize,
        local_header_offset: localHeaderOffset,
      }
      position = nextPosition

      const lower = filename.toLowerCase()
      if (!wanted.some((extension) => lower.endsWith(extension))) continue

      return readEntry(data, entry)
    }

    return null
  } catch (error) {
    if (error instanceof ZipFormatError) throw error
    if (error instanceof RangeError) {
      throw new ZipFormatError(`truncated archive (${error.message})`)
    }
    throw error
  }
}

function findEndOfCentralDirectory(data: Buffer): number {
  if (data.length < EOCD_MIN_SIZE) {
    throw new ZipFormatError('file is shorter than the minimum ZIP size')
  }
  const earliest = Math.max(0, data.length - EOCD_MIN_SIZE - EOCD_MAX_COMMENT)
  for (let offset = data.length - EOCD_MIN_SIZE; offset >= earliest; offset -= 1) {
    if (data.readUInt32LE(offset) === EOCD_SIGNATURE) return offset
  }
  throw new ZipFormatError('end of central directory record not found')
}

function readCentralDirectoryLocation(
  data: Buffer,
  eocdOffset: number,
): { count: number; offset: number; size: number } {
  let count = data.readUInt16LE(eocdOffset + 10)
  let size = data.readUInt32LE(eocdOffset + 12)
  let offset = data.readUInt32LE(eocdOffset + 16)

  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    const locatorOffset = eocdOffset - 20
    if (locatorOffset >= 0 && data.readUInt32LE(locatorOffset) === ZIP64_LOCATOR_SIGNATURE) {
      const zip64Offset = Number(data.readBigUInt64LE(locatorOffset + 8))
      if (
        zip64Offset + 56 <= data.length &&
        data.readUInt32LE(zip64Offset) === ZIP64_EOCD_SIGNATURE
      ) {
        count = Number(data.readBigUInt64LE(zip64Offset + 32))
        size = Number(data.readBigUInt64LE(zip64Offset + 40))
        offset = Number(data.readBigUInt64LE(zip64Offset + 48))
      }
    }
  }

  return { count, offset, size }
}

function resolveZip64Entry(
  extra: Buffer,
  fields: {
    compressed_size: number
    uncompressed_size: number
    local_header_offset: number
  },
): {
  compressed_size: number
  uncompressed_size: number
  local_header_offset: number
} {
  const resolved = { ...fields }
  let position = 0
  while (position + 4 <= extra.length) {
    const headerId = extra.readUInt16LE(position)
    const dataSize = extra.readUInt16LE(position + 2)
    let fieldOffset = position + 4
    if (headerId === 0x0001) {
      if (resolved.uncompressed_size === 0xffffffff) {
        resolved.uncompressed_size = Number(extra.readBigUInt64LE(fieldOffset))
        fieldOffset += 8
      }
      if (resolved.compressed_size === 0xffffffff) {
        resolved.compressed_size = Number(extra.readBigUInt64LE(fieldOffset))
        fieldOffset += 8
      }
      if (resolved.local_header_offset === 0xffffffff) {
        resolved.local_header_offset = Number(extra.readBigUInt64LE(fieldOffset))
        fieldOffset += 8
      }
    }
    position += 4 + dataSize
  }
  return resolved
}

/**
 * Decode an entry name. Python's `zipfile` decodes CP437 unless the UTF-8 flag
 * (general purpose bit 11) is set; filenames in HCI captures are ASCII, for
 * which both decoders agree, so a latin1 fallback is used for the legacy path.
 */
function decodeFilename(bytes: Buffer, flags: number): string {
  if (flags & 0x0800) return bytes.toString('utf8')
  return bytes.toString('latin1')
}

function readEntry(data: Buffer, entry: CentralDirectoryEntry): ZipEntry {
  const offset = entry.local_header_offset
  if (offset + 30 > data.length) {
    throw new ZipFormatError('truncated local file header')
  }
  if (data.readUInt32LE(offset) !== LOCAL_FILE_SIGNATURE) {
    throw new ZipFormatError('invalid local file header signature')
  }

  const nameLength = data.readUInt16LE(offset + 26)
  const extraLength = data.readUInt16LE(offset + 28)
  const dataStart = offset + 30 + nameLength + extraLength
  const dataEnd = dataStart + entry.compressed_size
  if (dataEnd > data.length) {
    throw new ZipFormatError(`truncated entry data for '${entry.filename}'`)
  }

  const compressed = data.subarray(dataStart, dataEnd)
  let content: Buffer
  if (entry.method === 0) {
    content = Buffer.from(compressed)
  } else if (entry.method === 8) {
    content = inflateRawSync(compressed)
  } else {
    throw new Error(`unsupported compression method ${entry.method}`)
  }

  // Python's zipfile verifies the CRC-32, not the declared uncompressed size.
  if (crc32(content) !== entry.crc) {
    throw new ZipFormatError(`bad CRC-32 for file '${entry.filename}'`)
  }

  return { filename: entry.filename, content }
}
