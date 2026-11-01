/**
 * Error raised by local-path validation.
 *
 * The Python implementation raises four different exception types
 * (``PathTraversalError``, ``FileNotFoundError``, ``ValueError``,
 * ``PermissionError``). A single class is used here — callers discriminate on
 * ``code`` — because Node has no built-in equivalent for most of them.
 */
export type LogPathErrorCode =
  | 'PATH_TRAVERSAL'
  | 'OUTSIDE_SANDBOX'
  | 'NOT_FOUND'
  | 'NOT_A_FILE'
  | 'PERMISSION_DENIED'

export class LogPathError extends Error {
  readonly code: LogPathErrorCode

  constructor(code: LogPathErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'LogPathError'
  }
}
