/**
 * Structured NDJSON logger.
 *
 * Writes one JSON object per line to logs/sync-<timestamp>.ndjson.
 * Mirrors selected entries to the console for operator visibility.
 *
 * Query with jq:
 *   tail -f logs/sync-*.ndjson | jq .
 *   cat logs/sync-*.ndjson | jq 'select(.level == "error")'
 *   cat logs/sync-*.ndjson | jq 'select(.phase == "upsert") | .productIds | length'
 */

import { createWriteStream, WriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

type Level = 'info' | 'warn' | 'error' | 'debug'

interface LogEntry {
  ts: string
  level: Level
  msg: string
  [key: string]: unknown
}

export class Logger {
  private stream: WriteStream | null = null
  private logPath = ''

  async init(syncId: string): Promise<void> {
    const dir = resolve(process.cwd(), 'logs')

    await mkdir(dir, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

    this.logPath = resolve(dir, `sync-${timestamp}-${syncId.slice(0, 8)}.ndjson`)
    this.stream = createWriteStream(this.logPath, { flags: 'a' })

    this.info('sync_started', { syncId, logPath: this.logPath })
  }

  private write(level: Level, msg: string, data: Record<string, unknown> = {}): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...data,
    }
    const line = JSON.stringify(entry)

    if (this.stream) this.stream.write(`${line}\n`)
  }

  info(msg: string, data: Record<string, unknown> = {}): void {
    this.write('info', msg, data)
  }

  warn(msg: string, data: Record<string, unknown> = {}): void {
    this.write('warn', msg, data)
    console.warn(`⚠ ${msg}`, data)
  }

  error(msg: string, data: Record<string, unknown> = {}): void {
    this.write('error', msg, data)
    console.error(`✗ ${msg}`, data)
  }

  debug(msg: string, data: Record<string, unknown> = {}): void {
    this.write('debug', msg, data)
  }

  async close(): Promise<void> {
    return new Promise((resolveFn) => {
      if (!this.stream) return resolveFn()

      this.stream.end(() => {
        this.stream = null
        resolveFn()
      })
    })
  }

  getLogPath(): string {
    return this.logPath
  }
}
