/**
 * CLI progress bar with ETA. Uses terminal carriage return for in-place updates.
 *
 * Format:  [████████░░░░░░░] 2,400 / 10,000 · 24% · 180 errors · 2.1s/batch · ETA 12m
 */

import { formatDuration } from './utils.ts'

export class Progress {
  private total = 0
  private processed = 0
  private errors = 0
  private startTime = 0
  private lastBatchDurationMs = 0
  private barWidth = 20
  private isTTY: boolean

  constructor() {
    this.isTTY = Boolean(process.stdout.isTTY)
  }

  start(total: number): void {
    this.total = total
    this.processed = 0
    this.errors = 0
    this.startTime = Date.now()
    this.render()
  }

  update(params: {
    processed?: number
    delta?: number
    errors?: number
    errorDelta?: number
    batchDurationMs?: number
  }): void {
    if (params.processed !== undefined) this.processed = params.processed
    if (params.delta !== undefined) this.processed += params.delta
    if (params.errors !== undefined) this.errors = params.errors
    if (params.errorDelta !== undefined) this.errors += params.errorDelta
    if (params.batchDurationMs !== undefined) this.lastBatchDurationMs = params.batchDurationMs

    this.render()
  }

  finish(): void {
    this.render()
    process.stdout.write('\n')
  }

  private render(): void {
    if (!this.isTTY || this.total === 0) {
      // Non-TTY (CI, pipe): print simple line per update, throttled to every 10%
      const pct = Math.floor((this.processed / Math.max(this.total, 1)) * 100)

      if (pct % 10 === 0 && pct !== this.lastLoggedPct) {
        this.lastLoggedPct = pct
        console.log(`  ${this.processed}/${this.total} (${pct}%) · ${this.errors} errors`)
      }

      return
    }

    const pct = this.total > 0 ? Math.min(100, (this.processed / this.total) * 100) : 0
    const filled = Math.floor((pct / 100) * this.barWidth)
    const bar = '█'.repeat(filled) + '░'.repeat(this.barWidth - filled)

    const elapsed = Date.now() - this.startTime
    const rate = this.processed > 0 ? elapsed / this.processed : 0
    const remaining = Math.max(0, this.total - this.processed) * rate
    const etaStr = this.processed > 10 ? `ETA ${formatDuration(remaining)}` : 'ETA ?'
    const batchStr = this.lastBatchDurationMs > 0 ? `· ${(this.lastBatchDurationMs / 1000).toFixed(1)}s/batch ` : ''

    const line = `  [${bar}] ${this.processed.toLocaleString()} / ${this.total.toLocaleString()} · ${pct.toFixed(1)}% · ${this.errors} errors ${batchStr}· ${etaStr}`

    process.stdout.write(`\r${line.padEnd(100, ' ')}`)
  }

  private lastLoggedPct = -1
}
