/** Path validation shared by the ALA tools. */
import { realpath, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

/** Resolve a user-supplied path and require an existing regular file. */
export async function requireFile(pathArgument: string): Promise<string> {
  const absolute = resolve(pathArgument)
  const info = await stat(absolute).catch(() => undefined)
  if (!info) throw new Error(`File not found: ${pathArgument}`)
  if (info.isDirectory()) throw new Error(`Path is a directory, not a file: ${pathArgument}`)
  if (!info.isFile()) throw new Error(`Path is not a regular file: ${pathArgument}`)
  return realpath(absolute)
}

/** Truncate long free text for a token-bounded tool result. */
export function clip(text: string, limit = 2000): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}… [${text.length - limit} more chars]`
}
