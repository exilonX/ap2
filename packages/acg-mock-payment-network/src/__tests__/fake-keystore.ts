/**
 * In-memory KeyStore for tests. Same shape as @acg/core's KeyStore
 * interface; just a Map under the hood.
 */

import type { KeyStore, StoredKeys } from '@acg/core';

export class FakeKeyStore implements KeyStore {
  private stored: StoredKeys | null = null;

  public read(): StoredKeys | null {
    return this.stored ? JSON.parse(JSON.stringify(this.stored)) : null;
  }

  public write(stored: StoredKeys): void {
    this.stored = JSON.parse(JSON.stringify(stored));
  }
}
