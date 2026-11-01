/** Bundled analysis skills, registered from the package's `skills/` directory. */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AlaHostContext } from './context.ts'

const SKILLS = [
  {
    name: 'android-logcat',
    description:
      'Triage an Android logcat capture with ALA tools: overview, targeted search, line-range context, crash and ANR correlation.',
    whenToUse: 'The user asks about an Android log file, a crash, an ANR, or a bugreport logcat.',
  },
  {
    name: 'android-diagnostics',
    description:
      'Interpret ANR traces and native tombstones using ALA’s structured diagnostic parser.',
    whenToUse:
      'The artifact is an ANR trace or a native crash tombstone, or the user asks why an app hung or crashed natively.',
  },
] as const

/** Register the bundled skills; a missing directory only warns so tools stay usable. */
export async function mountSkills(ctx: AlaHostContext): Promise<void> {
  if (!ctx.skills) return
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')
  for (const skill of SKILLS) {
    try {
      const content = await readFile(join(root, skill.name, 'SKILL.md'), 'utf8')
      const register = () =>
        ctx.skills!.register({
          name: skill.name,
          description: skill.description,
          whenToUse: skill.whenToUse,
          content,
          source: 'runtime',
        })
      if (ctx.effect) ctx.effect(() => register())
      else register()
    } catch (error) {
      ctx.logger?.warn(
        'ala-dsh: skill %s unavailable: %s',
        skill.name,
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}
