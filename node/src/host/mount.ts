/** Tool mounting shared by the host plugin and its tool modules. */
import type { AlaHostContext, ToolDefinition } from './context.ts'

/** Mount a tool and tie its registration to the plugin lifecycle when Cordis effects exist. */
export function mount(ctx: AlaHostContext, definition: ToolDefinition): void {
  if (ctx.effect) {
    ctx.effect(() => ctx.tools.register(definition))
  } else {
    ctx.tools.register(definition)
  }
}
