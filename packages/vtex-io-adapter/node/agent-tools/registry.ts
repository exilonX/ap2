/**
 * AgentTool registry.
 *
 * The chat handler dispatches by name: try the registry first, fall
 * through to the legacy switch for unmigrated tools. Coexistence model
 * resolved during Issue 03 grilling (Q6).
 *
 * Definitions for the LLM are assembled from
 * `[...CHAT_TOOLS_LEGACY, ...registry.getDefinitions()]` so the LLM
 * sees the complete tool surface in a single list.
 */

import type { LLMTool } from '../clients/llm'
import type { AgentTool, ToolContext, ToolEffect } from './types'

// ─── Built-in registry (module-scoped) ─────────────────────────────

const tools = new Map<string, AgentTool>()

/**
 * Register an AgentTool. Idempotent — re-registering the same name
 * overwrites the prior entry (useful for testing).
 */
export function register(tool: AgentTool): void {
  tools.set(tool.definition.name, tool)
}

/**
 * Return the LLM-facing definitions for every registered tool.
 * Used by the chat handler to build the tool list it sends to the LLM.
 */
export function getDefinitions(): LLMTool[] {
  return Array.from(tools.values()).map((t) => t.definition)
}

/**
 * Dispatch a tool call by name.
 *
 * Returns the tool's `ToolEffect` if registered, or `null` to signal
 * fallthrough to the legacy switch. The chat handler treats null as
 * "I don't know this tool, try the switch."
 */
export async function dispatch(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolEffect | null> {
  const tool = tools.get(name)

  if (!tool) return null

  return tool.execute(args, ctx)
}

/**
 * Test/debug helper — list registered tool names. Not used at runtime.
 */
export function listRegistered(): string[] {
  return Array.from(tools.keys())
}

/**
 * Test helper — clear the registry. Used by tests to start from a
 * clean state. Not exported as part of the public API.
 *
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function _clear(): void {
  tools.clear()
}
