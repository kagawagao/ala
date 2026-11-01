/**
 * Local-path validation for log files.
 *
 * Port of ``LogAnalyzer._validate_path``: reject ``..`` segments before they are
 * normalised away, resolve symlinks, confine the result to an optional sandbox
 * root (``ALA_SANDBOX_ROOT`` by default) and require an existing, readable
 * regular file (or directory, when explicitly allowed).
 */
import fs from 'node:fs'
import path from 'node:path'
import { LogPathError } from './errors.ts'

export interface ValidatePathOptions {
  allowDirectory?: boolean
}

function tryRealpath(target: string): string {
  try {
    return fs.realpathSync(target)
  } catch {
    // Python's os.path.realpath() returns a best-effort absolute path for
    // missing files instead of raising, and the existence check runs later.
    return path.resolve(target)
  }
}

function isInside(real: string, sandboxReal: string): boolean {
  const relative = path.relative(sandboxReal, real)
  if (relative === '') return true
  return !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

/**
 * Validate and resolve a local path for security.
 *
 * @param filePath Path supplied by a caller.
 * @param sandboxRoot Optional sandbox root; defaults to ``ALA_SANDBOX_ROOT``.
 * @param options.allowDirectory Accept directories instead of rejecting them.
 * @throws {LogPathError} For traversal, sandbox escapes, missing files,
 *   non-regular files and unreadable paths (see ``code``).
 */
export function validatePath(
  filePath: string,
  sandboxRoot: string | null = null,
  options: ValidatePathOptions = {},
): string {
  const root = sandboxRoot ?? process.env.ALA_SANDBOX_ROOT ?? null

  // Normalize alternate separators first (e.g. '/' on Windows), then reject
  // traversal tokens before normpath resolves them away.
  const altsep = path.sep === '\\' ? '/' : null
  let pathForCheck = filePath
  if (altsep) pathForCheck = pathForCheck.split(altsep).join(path.sep)

  const segments = pathForCheck.split(path.sep)
  if (segments.includes('..') || pathForCheck.startsWith('..')) {
    throw new LogPathError('PATH_TRAVERSAL', `Path traversal detected: ${filePath}`)
  }

  const normalized = path.normalize(pathForCheck)
  if (normalized.split(path.sep).includes('..')) {
    throw new LogPathError(
      'PATH_TRAVERSAL',
      `Path traversal detected (after normalization): ${normalized}`,
    )
  }

  // Resolve symlinks to the real path.
  const real = tryRealpath(normalized)

  // Check sandbox confinement.
  if (root) {
    const sandboxReal = tryRealpath(path.normalize(root))
    if (!isInside(real, sandboxReal)) {
      throw new LogPathError(
        'OUTSIDE_SANDBOX',
        `Path ${filePath} is outside allowed sandbox root ${root}`,
      )
    }
  }

  // Must exist.
  let stat: fs.Stats
  try {
    stat = fs.statSync(real)
  } catch {
    throw new LogPathError('NOT_FOUND', `File not found: ${filePath}`)
  }

  if (stat.isDirectory()) {
    if (!options.allowDirectory) {
      throw new LogPathError('NOT_A_FILE', `Path is a directory, not a file: ${filePath}`)
    }
  } else if (!stat.isFile()) {
    throw new LogPathError('NOT_A_FILE', `Path is not a regular file: ${filePath}`)
  }

  // Must be readable.
  try {
    fs.accessSync(real, fs.constants.R_OK)
  } catch {
    throw new LogPathError('PERMISSION_DENIED', `Permission denied: cannot read ${filePath}`)
  }

  return real
}
