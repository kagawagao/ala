/** Agent tool for structured ANR trace and native tombstone parsing. */
import { parseDiagnosticFile } from '../../core/diagnostic/index.ts'
import type { AlaHostContext } from '../context.ts'
import { requireFile } from '../paths.ts'
import { jsonContent, objectSchema, requiredString, stringArgument } from '../schema.ts'
import { mount } from '../mount.ts'

export function mountDiagnosticTools(ctx: AlaHostContext): void {
  mount(ctx, {
    name: 'ala_parse_diagnostic',
    description:
      'Parse an ANR trace or native crash tombstone into structured JSON (auto-detected flavour): threads and stack frames for ANRs, signal/backtrace/registers for tombstones. Prefer this over reading the raw file.',
    parameters: objectSchema({ path: stringArgument('Path to the ANR trace or tombstone file') }, [
      'path',
    ]),
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => jsonContent(value),
    },
    async execute(args) {
      const path = await requireFile(requiredString(args, 'path'))
      const result = await parseDiagnosticFile(path)
      return { path, ...result }
    },
  })
}
