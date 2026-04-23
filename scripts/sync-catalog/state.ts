/**
 * Sync state persistence — survives crashes so we can resume.
 *
 * State semantics:
 *   - allProductIds:       full list from GetProductAndSkuIds (active + inactive)
 *   - cursor:              next index to process
 *   - processedProductIds: successfully embedded + upserted
 *   - inactiveProductIds:  skipped because public search returned [] (not active/visible)
 *
 * VTEX has no "active products" bulk endpoint — active-ness is discovered
 * during the hydration phase by observing empty responses from pub/products/search.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

import type { SyncState } from './types.ts'
import { atomicWriteJson } from './utils.ts'

const STATE_DIR = resolve(process.cwd(), '.sync-state')
const STATE_FILE = resolve(STATE_DIR, 'state.json')

export async function loadState(): Promise<SyncState | null> {
  try {
    const content = await readFile(STATE_FILE, 'utf-8')

    return JSON.parse(content) as SyncState
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return null
    }

    throw error
  }
}

export async function saveState(state: SyncState): Promise<void> {
  const updated: SyncState = {
    ...state,
    lastUpdatedAt: new Date().toISOString(),
  }

  await atomicWriteJson(STATE_FILE, updated)
}

export async function clearState(): Promise<void> {
  try {
    const { unlink } = await import('node:fs/promises')

    await unlink(STATE_FILE)
  } catch {
    // Ignore — file may not exist
  }
}

export function newState(allProductIds: string[], salesChannel: number): SyncState {
  return {
    syncId: randomUUID(),
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    salesChannel,
    allProductIds,
    processedProductIds: [],
    inactiveProductIds: [],
    cursor: 0,
    batchCount: 0,
  }
}

export interface BatchOutcome {
  processed: string[]     // embedded + upserted
  inactive: string[]      // skipped (empty response)
  errorCount: number      // added to error queue
}

export function applyBatchOutcome(
  state: SyncState,
  batchSize: number,
  outcome: BatchOutcome
): SyncState {
  const processedSet = new Set(state.processedProductIds)
  const inactiveSet = new Set(state.inactiveProductIds)

  for (const id of outcome.processed) processedSet.add(id)
  for (const id of outcome.inactive) inactiveSet.add(id)

  return {
    ...state,
    processedProductIds: [...processedSet],
    inactiveProductIds: [...inactiveSet],
    cursor: Math.min(state.cursor + batchSize, state.allProductIds.length),
    batchCount: state.batchCount + 1,
  }
}

export function remainingProductIds(state: SyncState): string[] {
  return state.allProductIds.slice(state.cursor)
}

export function isDone(state: SyncState): boolean {
  return state.cursor >= state.allProductIds.length
}
