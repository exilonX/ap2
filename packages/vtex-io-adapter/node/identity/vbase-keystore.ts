/**
 * VBase-backed implementation of `KeyStore`.
 *
 * The Adapter's contribution to the @acg/core `KeyStore` abstraction.
 * `@acg/core` doesn't know VTEX exists — this file is the seam where
 * the VBase storage strategy meets the platform-agnostic core.
 *
 * Storage layout:
 *   bucket: 'acg-identity'
 *   key:    'merchant-did'
 *
 * These match the bucket/key the legacy `did.ts` handler used, so
 * existing keys are picked up unchanged.
 */

import type { KeyStore, StoredKeys } from '../core';

/**
 * Minimal interface of `ctx.clients.vbase` used by the keystore. Kept
 * here so tests can supply a fake without pulling in `@vtex/api`.
 *
 * `saveJSON`'s return type is `Promise<unknown>` rather than
 * `Promise<void>` because the real VTEX `VBase.saveJSON` resolves to a
 * `VBaseSaveResponse`. We don't depend on that response, but the
 * structural type must stay assignable from the real client.
 */
export interface VBaseClient {
  getJSON<T>(bucket: string, key: string, conflictsTrigger?: boolean): Promise<T>;
  saveJSON<T>(bucket: string, key: string, value: T): Promise<unknown>;
}

const DEFAULT_BUCKET = 'acg-identity';
const DEFAULT_KEY = 'merchant-did';

export class VBaseKeyStore implements KeyStore {
  constructor(
    private readonly vbase: VBaseClient,
    private readonly bucket: string = DEFAULT_BUCKET,
    private readonly key: string = DEFAULT_KEY
  ) {}

  public async read(): Promise<StoredKeys | null> {
    try {
      // `conflictsTrigger: true` matches the previous handler behavior;
      // we read through any concurrent writes.
      const stored = await this.vbase.getJSON<StoredKeys>(this.bucket, this.key, true);
      // VBase returns the value when it exists; surface-level shape
      // validation lives in @acg/core's `loadOrCreateIdentity`.
      return stored ?? null;
    } catch {
      // VBase throws when the key doesn't exist yet. The KeyStore
      // contract distinguishes "missing" from errors via `null`.
      return null;
    }
  }

  public async write(stored: StoredKeys): Promise<void> {
    await this.vbase.saveJSON<StoredKeys>(this.bucket, this.key, stored);
  }
}
