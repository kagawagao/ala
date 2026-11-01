/** DSH host plugin: registers ALA's Android diagnostics tools and skills. */
import { stat } from 'node:fs/promises'
import { detectFileTypeFromPath } from '../core/file-detect/index.ts'
import type { AlaHostContext, ToolDefinition } from './context.ts'
import { mount } from './mount.ts'
import { requireFile } from './paths.ts'
import { jsonContent, objectSchema, requiredString, stringArgument } from './schema.ts'
import { mountDiagnosticTools } from './tools/diagnostic.ts'
import { mountHciTools } from './tools/hci.ts'
import { mountLogTools } from './tools/log.ts'
import { mountPcapTools } from './tools/pcap.ts'
import { mountSkills } from './skills.ts'

export const name = 'ala-dsh'
export const inject = ['tools', 'skills']

/** Report the header-detected artifact type without parsing it. */
function detectTool(ctx: AlaHostContext): void {
  mount(ctx, {
    name: 'ala_detect_file_type',
    description:
      'Detect an Android diagnostics artifact type from its leading bytes (never the file extension). Returns one of log, pcap, hci, trace, anr, tombstone.',
    parameters: objectSchema(
      { path: stringArgument('Absolute path (or cwd-relative path) to the file') },
      ['path'],
    ),
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => jsonContent(value),
    },
    async execute(args) {
      const path = await requireFile(requiredString(args, 'path'))
      const info = await stat(path)
      return {
        path,
        type: await detectFileTypeFromPath(path),
        size_bytes: info.size,
      }
    },
  })
}

export async function apply(ctx: AlaHostContext): Promise<void> {
  detectTool(ctx)
  mountLogTools(ctx)
  mountDiagnosticTools(ctx)
  mountHciTools(ctx)
  mountPcapTools(ctx)
  await mountSkills(ctx)
  ctx.logger?.info('ala-dsh ready: Android diagnostics tools registered')
}
