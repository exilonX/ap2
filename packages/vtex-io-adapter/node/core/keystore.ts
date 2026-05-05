/**
 * Key Store
 *
 * Pluggable storage abstraction for merchant Ed25519 keys.
 *
 * `@acg/core` stays platform-agnostic. The cryptographic primitives
 * (key generation, DID composition) live here; *where* keys are stored
 * is the caller's choice via the `KeyStore` interface.
 *
 * Reference implementations shipped with `@acg/core`:
 *   - `FilesystemKeyStore(path)` — keys persisted to a local file
 *   - `EnvKeyStore()` — keys read from MERCHANT_PUBLIC_KEY /
 *     MERCHANT_PRIVATE_KEY / MERCHANT_DOMAIN env vars (read-only)
 *
 * Platform adapters contribute their own implementations (e.g. the
 * VTEX adapter's `VBaseKeyStore`).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { generateKeyPair, keyPairFromHex, createDIDDocument, type KeyPair, type DIDDocument } from './did';

export interface MerchantIdentity {
  keys: KeyPair;
  domain: string;
  did: string;
  didDocument: DIDDocument;
}

/**
 * The on-disk / on-wire shape of a stored merchant identity.
 *
 * Implementations of `KeyStore` round-trip this object — the keys are
 * serialised as hex strings so the shape is JSON-safe.
 */
export interface StoredKeys {
  publicKeyHex: string;
  privateKeyHex: string;
  domain: string;
  createdAt: string;
}

/**
 * Pluggable storage strategy for the merchant identity.
 *
 * Two methods, deliberately tiny:
 *   - `read()`  → returns the stored keys, or `null` if none exist yet.
 *   - `write(stored)` → persists the stored keys.
 *
 * Read-only stores (e.g. `EnvKeyStore`) throw from `write`.
 */
export interface KeyStore {
  read(): StoredKeys | null | Promise<StoredKeys | null>;
  write(stored: StoredKeys): void | Promise<void>;
}

/**
 * Filesystem-backed `KeyStore`.
 *
 * Keys are stored at the given path as JSON. The parent directory is
 * created on first write if it doesn't already exist.
 */
export class FilesystemKeyStore implements KeyStore {
  constructor(private readonly path: string) {}

  public read(): StoredKeys | null {
    if (!existsSync(this.path)) {
      return null;
    }
    return JSON.parse(readFileSync(this.path, 'utf8')) as StoredKeys;
  }

  public write(stored: StoredKeys): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.path, JSON.stringify(stored, null, 2), 'utf8');
  }
}

/**
 * Env-var backed `KeyStore` (read-only).
 *
 * Reads `MERCHANT_PUBLIC_KEY`, `MERCHANT_PRIVATE_KEY`, and `MERCHANT_DOMAIN`.
 * Returns `null` from `read()` when any of the three are missing — a
 * consumer using this store as the only source then has no keys, which
 * is a deployment misconfiguration that the consumer should surface.
 *
 * `write()` throws — env vars cannot be persisted from the running
 * process. Pair this store with a different write path (e.g. the secrets
 * manager) if you need to provision keys.
 */
export class EnvKeyStore implements KeyStore {
  public read(): StoredKeys | null {
    const publicKeyHex = process.env.MERCHANT_PUBLIC_KEY;
    const privateKeyHex = process.env.MERCHANT_PRIVATE_KEY;
    const domain = process.env.MERCHANT_DOMAIN;
    if (!publicKeyHex || !privateKeyHex || !domain) {
      return null;
    }
    return {
      publicKeyHex,
      privateKeyHex,
      domain,
      createdAt: process.env.MERCHANT_CREATED_AT ?? '',
    };
  }

  public write(_stored: StoredKeys): void {
    throw new Error('EnvKeyStore is read-only — cannot persist keys to environment variables');
  }
}

/**
 * Load or create the merchant identity using the supplied `KeyStore`.
 *
 * If the store already has keys for this merchant, they're loaded.
 * Otherwise a fresh Ed25519 keypair is generated and persisted.
 *
 * Two call shapes — the `string` overload is a backwards-compatibility
 * wrapper kept for callers that still pass a filesystem path. New code
 * should pass a `KeyStore` directly.
 */
export function loadOrCreateIdentity(
  domain: string,
  store: KeyStore
): Promise<MerchantIdentity>;
export function loadOrCreateIdentity(
  domain: string,
  path: string
): MerchantIdentity;
export function loadOrCreateIdentity(
  domain: string,
  storeOrPath: KeyStore | string
): MerchantIdentity | Promise<MerchantIdentity> {
  if (typeof storeOrPath === 'string') {
    // Path-based call: synchronous filesystem I/O for backwards
    // compatibility. Delegates to the new shape.
    return loadOrCreateIdentitySync(domain, new FilesystemKeyStore(storeOrPath));
  }
  return loadOrCreateIdentityAsync(domain, storeOrPath);
}

/**
 * Synchronous variant — used by the legacy filesystem-path code path
 * and exposed for callers that know their store is synchronous.
 */
function loadOrCreateIdentitySync(domain: string, store: KeyStore): MerchantIdentity {
  const existing = store.read();
  if (existing instanceof Promise) {
    throw new Error('loadOrCreateIdentitySync: store.read() returned a Promise; use the async overload instead');
  }
  if (existing) {
    return buildIdentity(existing);
  }
  const stored = generateAndPackage(domain);
  const writeResult = store.write(stored);
  if (writeResult instanceof Promise) {
    throw new Error('loadOrCreateIdentitySync: store.write() returned a Promise; use the async overload instead');
  }
  return buildIdentity(stored);
}

/**
 * Async variant — KeyStores backed by network/IO storage (VBase, KMS,
 * vault) implement `read`/`write` as Promises.
 */
async function loadOrCreateIdentityAsync(domain: string, store: KeyStore): Promise<MerchantIdentity> {
  const existing = await store.read();
  if (existing) {
    return buildIdentity(existing);
  }
  const stored = generateAndPackage(domain);
  await store.write(stored);
  return buildIdentity(stored);
}

function generateAndPackage(domain: string): StoredKeys {
  const keys = generateKeyPair();
  return {
    publicKeyHex: keys.publicKeyHex,
    privateKeyHex: keys.privateKeyHex,
    domain,
    createdAt: new Date().toISOString(),
  };
}

function buildIdentity(stored: StoredKeys): MerchantIdentity {
  if (!stored.publicKeyHex || !stored.privateKeyHex || !stored.domain) {
    throw new Error('KeyStore returned malformed StoredKeys (missing publicKeyHex/privateKeyHex/domain)');
  }
  const keys = keyPairFromHex(stored.publicKeyHex, stored.privateKeyHex);
  const did = `did:web:${stored.domain}`;
  const didDocument = createDIDDocument(stored.domain, keys.publicKey);
  return { keys, domain: stored.domain, did, didDocument };
}

/**
 * Load merchant identity from environment variables.
 *
 * Convenience wrapper around `EnvKeyStore` for callers that don't want
 * to construct the store themselves. Returns null if env vars are not
 * set.
 *
 * Note: this does NOT generate keys — env-var deployments must provision
 * keys separately. The function exists for compatibility with callers
 * that previously used the same shape.
 */
export function loadIdentityFromEnv(): MerchantIdentity | null {
  const stored = new EnvKeyStore().read();
  if (!stored) {
    return null;
  }
  return buildIdentity(stored);
}
