/**
 * Registry tests.
 *
 * Covers:
 *   - register adds a tool by `definition.name`
 *   - getDefinitions returns the LLM-facing definitions for everything registered
 *   - dispatch returns the tool's effect for a registered name
 *   - dispatch returns null for unknown names (signals fallthrough to legacy switch)
 */

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  _clear,
  dispatch,
  getDefinitions,
  listRegistered,
  register,
} from '../registry'
import type { AgentTool, ToolEffect } from '../types'

const stubTool = (name: string, result: string): AgentTool => ({
  definition: {
    name,
    description: `stub tool: ${name}`,
    parameters: { type: 'object', properties: {} },
  },
  execute: async (): Promise<ToolEffect> => ({ result }),
})

describe('registry', () => {
  beforeEach(() => {
    _clear()
  })

  it('register adds the tool keyed by definition.name', () => {
    register(stubTool('alpha', 'hello'))
    assert.deepEqual(listRegistered(), ['alpha'])
  })

  it('register is idempotent — re-registering overwrites', () => {
    register(stubTool('alpha', 'first'))
    register(stubTool('alpha', 'second'))
    assert.deepEqual(listRegistered(), ['alpha'])
  })

  it('getDefinitions returns each tool definition', () => {
    register(stubTool('alpha', 'a'))
    register(stubTool('beta', 'b'))
    const defs = getDefinitions()

    assert.equal(defs.length, 2)
    const names = defs.map((d) => d.name).sort((a, b) => a.localeCompare(b))

    assert.deepEqual(names, ['alpha', 'beta'])
  })

  it('dispatch returns the tool effect for a registered name', async () => {
    register(stubTool('alpha', 'returned'))
    const fakeCtx = {
      vtex: { workspace: 'master', account: 'x' },
      clients: {},
      config: {},
      orderFormId: null,
    } as Parameters<typeof dispatch>[2]

    const effect = await dispatch('alpha', {}, fakeCtx)

    assert.ok(effect)
    assert.equal(effect!.result, 'returned')
  })

  it('dispatch returns null for unknown tool names', async () => {
    register(stubTool('alpha', 'a'))
    const fakeCtx = {
      vtex: { workspace: 'master', account: 'x' },
      clients: {},
      config: {},
      orderFormId: null,
    } as Parameters<typeof dispatch>[2]

    const effect = await dispatch('does-not-exist', {}, fakeCtx)

    assert.equal(effect, null)
  })
})
