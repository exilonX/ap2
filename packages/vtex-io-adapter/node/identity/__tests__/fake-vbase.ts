/**
 * In-memory test double for the VBase client surface used by ACG.
 *
 * Mirrors the public methods (`getJSON`, `saveJSON`) shape the Adapter
 * relies on. The `notFoundError` flag controls whether `getJSON` of a
 * missing key throws (matching VTEX's real behaviour) or returns
 * undefined.
 */

import type { VBaseClient } from '../vbase-keystore';

export class FakeVBase implements VBaseClient {
  private store: Map<string, unknown> = new Map();

  /** Mirror VTEX behaviour: getJSON of a missing key throws. */
  public async getJSON<T>(bucket: string, key: string, _conflictsTrigger?: boolean): Promise<T> {
    const composite = `${bucket}::${key}`;
    if (!this.store.has(composite)) {
      const err = new Error(`VBase key not found: ${composite}`);
      (err as Error & { status?: number }).status = 404;
      throw err;
    }
    return JSON.parse(JSON.stringify(this.store.get(composite))) as T;
  }

  public async saveJSON<T>(bucket: string, key: string, value: T): Promise<void> {
    const composite = `${bucket}::${key}`;
    this.store.set(composite, JSON.parse(JSON.stringify(value)));
  }

  /** Test helper: pre-seed a key. */
  public seed<T>(bucket: string, key: string, value: T): void {
    this.store.set(`${bucket}::${key}`, JSON.parse(JSON.stringify(value)));
  }

  /** Test helper: peek at a stored value without going through getJSON. */
  public peek<T>(bucket: string, key: string): T | null {
    const composite = `${bucket}::${key}`;
    if (!this.store.has(composite)) return null;
    return JSON.parse(JSON.stringify(this.store.get(composite))) as T;
  }

  /** Test helper: clear all stored data. */
  public reset(): void {
    this.store.clear();
  }

  /** Test helper: list all keys in a bucket. */
  public listBucket(bucket: string): string[] {
    const prefix = `${bucket}::`;
    return Array.from(this.store.keys())
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  }
}
