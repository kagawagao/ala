/**
 * Minimal read-only ZIP reader built on ``node:zlib``.
 *
 * Node's standard library can inflate a deflate stream but cannot walk a ZIP
 * container, so this module parses the central directory itself. It supports
 * the two methods that matter for log archives — stored (0) and deflate (8) —
 * and deliberately ignores everything else (encryption, zip64, spanning).
 */
import { inflateRawSync } from 'node:zlib'

export interface ZipEntry {
  name: string
  isDirectory: boolean
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
  encrypted: boolean
}

/** Raised when a single member inflates past the caller's byte budget. */
export class ZipMemberTooLargeError extends Error {
  readonly memberName: string
  readonly limit: number

  constructor(memberName: string, limit: number) {
    super(`ZIP member exceeds ${limit} byte limit: ${memberName}`)
    this.memberName = memberName
    this.limit = limit
    this.name = 'ZipMemberTooLargeError'
  }
}

const EOCD_SIGNATURE = 0x06054b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

const EOCD_MIN_SIZE = 22
const ZIP64_LOCATOR_SIZE = 20
const MAX_COMMENT_SIZE = 0xffff
const LOCAL_HEADER_SIZE = 30
const CENTRAL_HEADER_SIZE = 46

function findEndOfCentralDirectory(data: Buffer): number {
  const lowest = Math.max(0, data.length - EOCD_MIN_SIZE - MAX_COMMENT_SIZE)
  for (let offset = data.length - EOCD_MIN_SIZE; offset >= lowest; offset -= 1) {
    if (data.readUInt32LE(offset) === EOCD_SIGNATURE) return offset
  }
  throw new Error('end of central directory record not found')
}

function hasZip64Locator(data: Buffer, eocd: number): boolean {
  const locatorOffset = eocd - ZIP64_LOCATOR_SIZE
  return locatorOffset >= 0 && data.readUInt32LE(locatorOffset) === ZIP64_LOCATOR_SIGNATURE
}

/**
 * Parse the central directory of `data`.
 *
 * Throws a plain ``Error`` with a descriptive message for malformed archives;
 * callers wrap it into the user-facing "Invalid ZIP file" error.
 */
export function readZipEntries(data: Buffer): ZipEntry[] {
  if (data.length < EOCD_MIN_SIZE) throw new Error('file is too small to be a ZIP archive')

  const eocd = findEndOfCentralDirectory(data)
  const totalEntries = data.readUInt16LE(eocd + 10)
  const centralSize = data.readUInt32LE(eocd + 12)
  const centralOffset = data.readUInt32LE(eocd + 16)

  if (centralOffset === 0xffffffff || centralSize === 0xffffffff || hasZip64Locator(data, eocd)) {
    throw new Error('ZIP64 archives are not supported')
  }
  if (centralOffset + centralSize > data.length) {
    throw new Error('central directory extends past end of file')
  }

  const entries: ZipEntry[] = []
  let cursor = centralOffset
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + CENTRAL_HEADER_SIZE > data.length) {
      throw new Error('truncated central directory')
    }
    if (data.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error('bad central directory entry signature')
    }
    const flags = data.readUInt16LE(cursor + 8)
    const method = data.readUInt16LE(cursor + 10)
    const compressedSize = data.readUInt32LE(cursor + 20)
    const uncompressedSize = data.readUInt32LE(cursor + 24)
    const nameLength = data.readUInt16LE(cursor + 28)
    const extraLength = data.readUInt16LE(cursor + 30)
    const commentLength = data.readUInt16LE(cursor + 32)
    const localHeaderOffset = data.readUInt32LE(cursor + 42)
    const nameStart = cursor + CENTRAL_HEADER_SIZE
    const nameEnd = nameStart + nameLength
    if (nameEnd > data.length) throw new Error('truncated central directory entry name')
    const name = data.toString('utf8', nameStart, nameEnd)
    entries.push({
      name,
      isDirectory: name.endsWith('/'),
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      encrypted: (flags & 0x1) !== 0,
    })
    cursor = nameEnd + extraLength + commentLength
  }
  return entries
}

/**
 * Return the raw contents of one member.
 *
 * `maxBytes` caps the inflated size when given: exceeding it raises
 * {@link ZipMemberTooLargeError} so callers can skip the member rather than
 * aborting the whole archive (the Python implementation does the same).
 */
export function readZipMember(data: Buffer, entry: ZipEntry, maxBytes?: number): Buffer {
  if (entry.encrypted) {
    throw new Error(`encrypted ZIP member is not supported: ${entry.name}`)
  }

  const offset = entry.localHeaderOffset
  if (offset + LOCAL_HEADER_SIZE > data.length) {
    throw new Error(`truncated local header for ${entry.name}`)
  }
  if (data.readUInt32LE(offset) !== LOCAL_SIGNATURE) {
    throw new Error(`bad local header signature for ${entry.name}`)
  }
  const nameLength = data.readUInt16LE(offset + 26)
  const extraLength = data.readUInt16LE(offset + 28)
  const dataStart = offset + LOCAL_HEADER_SIZE + nameLength + extraLength
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > data.length) throw new Error(`truncated contents for ${entry.name}`)

  const raw = data.subarray(dataStart, dataEnd)

  if (entry.method === 0) {
    if (maxBytes !== undefined && raw.length > maxBytes) {
      throw new ZipMemberTooLargeError(entry.name, maxBytes)
    }
    return raw
  }
  if (entry.method !== 8) {
    throw new Error(`unsupported ZIP compression method ${entry.method} for ${entry.name}`)
  }

  if (maxBytes === undefined) return inflateRawSync(raw)

  // Inflate one byte past the budget so "exactly at the limit" still passes.
  let inflated: Buffer
  try {
    inflated = inflateRawSync(raw, { maxOutputLength: maxBytes + 1 })
  } catch (error) {
    if (isBufferTooLarge(error)) throw new ZipMemberTooLargeError(entry.name, maxBytes)
    throw error
  }
  if (inflated.length > maxBytes) throw new ZipMemberTooLargeError(entry.name, maxBytes)
  return inflated
}

function isBufferTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE'
  )
}
