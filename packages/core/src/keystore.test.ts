import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  loadOrCreateIdentity,
  loadIdentityFromEnv,
  FilesystemKeyStore,
  EnvKeyStore,
  type KeyStore,
  type StoredKeys,
} from './keystore';
import { createCartMandate, verifyCartMandate } from './mandates';

const TEST_KEYS_DIR = join(__dirname, '..', '.test-keys');
const TEST_KEY_FILE = join(TEST_KEYS_DIR, 'test-merchant.json');
const DOMAIN = 'test.example.com';

// Clean up test keys after each test
afterEach(() => {
  try {
    if (existsSync(TEST_KEY_FILE)) unlinkSync(TEST_KEY_FILE);
    if (existsSync(TEST_KEYS_DIR)) rmSync(TEST_KEYS_DIR, { recursive: true });
  } catch {
    // ignore cleanup errors
  }
});

// Tiny in-memory KeyStore implementation for contract testing.
class MemoryKeyStore implements KeyStore {
  public store: StoredKeys | null = null;

  public read(): StoredKeys | null {
    return this.store;
  }

  public write(stored: StoredKeys): void {
    this.store = stored;
  }
}

class AsyncMemoryKeyStore implements KeyStore {
  public store: StoredKeys | null = null;
  public reads = 0;
  public writes = 0;

  public async read(): Promise<StoredKeys | null> {
    this.reads += 1;
    return this.store;
  }

  public async write(stored: StoredKeys): Promise<void> {
    this.writes += 1;
    this.store = stored;
  }
}

// ─── Backwards-compat: path-based loadOrCreateIdentity ───────────────────

describe('keystore - loadOrCreateIdentity (legacy path arg)', () => {
  it('generates new keys when file does not exist', () => {
    const identity = loadOrCreateIdentity(DOMAIN, TEST_KEY_FILE);

    assert.ok(identity.keys.publicKeyHex.length > 0);
    assert.ok(identity.keys.privateKeyHex.length > 0);
    assert.equal(identity.domain, DOMAIN);
    assert.equal(identity.did, `did:web:${DOMAIN}`);
    assert.ok(identity.didDocument);
    assert.equal(identity.didDocument.id, `did:web:${DOMAIN}`);
  });

  it('saves keys to file', () => {
    loadOrCreateIdentity(DOMAIN, TEST_KEY_FILE);
    assert.ok(existsSync(TEST_KEY_FILE));
  });

  it('creates directory if it does not exist', () => {
    const deepPath = join(TEST_KEYS_DIR, 'deep', 'nested', 'merchant.json');
    loadOrCreateIdentity(DOMAIN, deepPath);
    assert.ok(existsSync(deepPath));

    // Clean up
    rmSync(join(TEST_KEYS_DIR, 'deep'), { recursive: true });
  });

  it('loads existing keys from file', () => {
    const first = loadOrCreateIdentity(DOMAIN, TEST_KEY_FILE);
    const second = loadOrCreateIdentity(DOMAIN, TEST_KEY_FILE);

    assert.equal(first.keys.publicKeyHex, second.keys.publicKeyHex);
    assert.equal(first.keys.privateKeyHex, second.keys.privateKeyHex);
  });

  it('loaded keys can sign and verify mandates', async () => {
    // First run: generate
    const identity1 = loadOrCreateIdentity(DOMAIN, TEST_KEY_FILE);
    const cart = {
      items: [{ sku: '5', name: 'Tricou', quantity: 1, unitPrice: 55.24 }],
      totalAmount: 55.24,
      currency: 'RON',
      orderFormId: 'test-123',
    };
    const mandate = await createCartMandate(cart, identity1.domain, identity1.keys);

    // Second run: load from file
    const identity2 = loadOrCreateIdentity(DOMAIN, TEST_KEY_FILE);
    const result = await verifyCartMandate(mandate, identity2.keys.publicKey);

    assert.equal(result.valid, true);
  });

  it('DID document has correct structure', () => {
    const identity = loadOrCreateIdentity(DOMAIN, TEST_KEY_FILE);
    const doc = identity.didDocument;

    assert.ok(doc['@context'].includes('https://www.w3.org/ns/did/v1'));
    assert.equal(doc.verificationMethod.length, 1);
    assert.equal(doc.verificationMethod[0].type, 'Ed25519VerificationKey2020');
    assert.deepEqual(doc.authentication, [`did:web:${DOMAIN}#key-1`]);
  });
});

// ─── New: KeyStore contract round-trip ────────────────────────────────────

describe('keystore - KeyStore contract (sync MemoryKeyStore)', () => {
  it('generates and persists when store is empty', async () => {
    const store = new MemoryKeyStore();
    const identity = await loadOrCreateIdentity(DOMAIN, store);
    assert.equal(identity.domain, DOMAIN);
    assert.ok(store.store, 'KeyStore should have been written');
    assert.equal(store.store!.publicKeyHex, identity.keys.publicKeyHex);
    assert.equal(store.store!.domain, DOMAIN);
  });

  it('loads existing keys when store already has them', async () => {
    const store = new MemoryKeyStore();
    const first = await loadOrCreateIdentity(DOMAIN, store);
    const second = await loadOrCreateIdentity(DOMAIN, store);
    assert.equal(first.keys.publicKeyHex, second.keys.publicKeyHex);
    assert.equal(first.keys.privateKeyHex, second.keys.privateKeyHex);
  });

  it('signed mandate verifies after store round-trip', async () => {
    const store = new MemoryKeyStore();
    const identity1 = await loadOrCreateIdentity(DOMAIN, store);
    const cart = {
      items: [{ sku: '7', name: 'Pantaloni', quantity: 1, unitPrice: 100 }],
      totalAmount: 100,
      currency: 'RON',
      orderFormId: 'mem-1',
    };
    const mandate = await createCartMandate(cart, identity1.domain, identity1.keys);

    // "Restart": same store, fresh identity load
    const identity2 = await loadOrCreateIdentity(DOMAIN, store);
    const result = await verifyCartMandate(mandate, identity2.keys.publicKey);
    assert.equal(result.valid, true);
  });

  it('rejects when store returns malformed StoredKeys', async () => {
    const store: KeyStore = {
      read: () => ({ publicKeyHex: '', privateKeyHex: '', domain: '', createdAt: '' }),
      write: () => {
        throw new Error('should not be called');
      },
    };
    await assert.rejects(() => loadOrCreateIdentity(DOMAIN, store), /malformed/i);
  });
});

describe('keystore - KeyStore contract (async store)', () => {
  it('round-trips through async read/write', async () => {
    const store = new AsyncMemoryKeyStore();
    const identityP = loadOrCreateIdentity(DOMAIN, store);
    assert.ok(identityP instanceof Promise, 'async store should return a Promise');
    const identity = await identityP;
    assert.equal(identity.domain, DOMAIN);
    assert.equal(store.writes, 1);

    // Subsequent load reads, doesn't write
    const second = await loadOrCreateIdentity(DOMAIN, store);
    assert.equal(store.writes, 1, 'should not write a second time');
    assert.equal(second.keys.publicKeyHex, identity.keys.publicKeyHex);
  });

  it('async-stored keys can sign and verify mandates', async () => {
    const store = new AsyncMemoryKeyStore();
    const identity1 = await loadOrCreateIdentity(DOMAIN, store);
    const cart = {
      items: [{ sku: '5', name: 'Tricou', quantity: 1, unitPrice: 55.24 }],
      totalAmount: 55.24,
      currency: 'RON',
      orderFormId: 'async-1',
    };
    const mandate = await createCartMandate(cart, identity1.domain, identity1.keys);

    // Reload — should pick up the same keys
    const identity2 = await loadOrCreateIdentity(DOMAIN, store);
    const result = await verifyCartMandate(mandate, identity2.keys.publicKey);
    assert.equal(result.valid, true);
  });
});

// ─── FilesystemKeyStore ─────────────────────────────────────────────────

describe('keystore - FilesystemKeyStore', () => {
  it('returns null when file does not exist', () => {
    const fs = new FilesystemKeyStore(TEST_KEY_FILE);
    assert.equal(fs.read(), null);
  });

  it('writes and reads back the same shape', () => {
    const fs = new FilesystemKeyStore(TEST_KEY_FILE);
    const stored: StoredKeys = {
      publicKeyHex: 'aa',
      privateKeyHex: 'bb',
      domain: 'fs.example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    fs.write(stored);

    assert.ok(existsSync(TEST_KEY_FILE));
    const onDisk = JSON.parse(readFileSync(TEST_KEY_FILE, 'utf8'));
    assert.equal(onDisk.publicKeyHex, 'aa');

    const fs2 = new FilesystemKeyStore(TEST_KEY_FILE);
    assert.deepEqual(fs2.read(), stored);
  });

  it('creates the directory tree on first write', () => {
    const deepPath = join(TEST_KEYS_DIR, 'deep', 'nested', 'merchant.json');
    const fs = new FilesystemKeyStore(deepPath);
    fs.write({
      publicKeyHex: 'aa',
      privateKeyHex: 'bb',
      domain: 'd.com',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    assert.ok(existsSync(deepPath));
    rmSync(join(TEST_KEYS_DIR, 'deep'), { recursive: true });
  });
});

// ─── EnvKeyStore ────────────────────────────────────────────────────────

describe('keystore - EnvKeyStore', () => {
  afterEach(() => {
    delete process.env.MERCHANT_PUBLIC_KEY;
    delete process.env.MERCHANT_PRIVATE_KEY;
    delete process.env.MERCHANT_DOMAIN;
    delete process.env.MERCHANT_CREATED_AT;
  });

  it('returns null when no env vars are set', () => {
    const env = new EnvKeyStore();
    assert.equal(env.read(), null);
  });

  it('returns null when only some env vars are set', () => {
    process.env.MERCHANT_DOMAIN = 'env.example.com';
    const env = new EnvKeyStore();
    assert.equal(env.read(), null);
  });

  it('reads StoredKeys from env vars when all are set', () => {
    process.env.MERCHANT_PUBLIC_KEY = 'aa';
    process.env.MERCHANT_PRIVATE_KEY = 'bb';
    process.env.MERCHANT_DOMAIN = 'env.example.com';

    const env = new EnvKeyStore();
    const result = env.read();
    assert.ok(result);
    assert.equal(result!.publicKeyHex, 'aa');
    assert.equal(result!.privateKeyHex, 'bb');
    assert.equal(result!.domain, 'env.example.com');
  });

  it('throws on write (read-only)', () => {
    const env = new EnvKeyStore();
    assert.throws(
      () =>
        env.write({
          publicKeyHex: 'aa',
          privateKeyHex: 'bb',
          domain: 'd.com',
          createdAt: '',
        }),
      /read-only/i
    );
  });
});

// ─── loadIdentityFromEnv (legacy convenience wrapper) ───────────────────

describe('keystore - loadIdentityFromEnv', () => {
  afterEach(() => {
    delete process.env.MERCHANT_PUBLIC_KEY;
    delete process.env.MERCHANT_PRIVATE_KEY;
    delete process.env.MERCHANT_DOMAIN;
  });

  it('returns null when env vars are not set', () => {
    const result = loadIdentityFromEnv();
    assert.equal(result, null);
  });

  it('returns null when only some env vars are set', () => {
    process.env.MERCHANT_DOMAIN = 'test.com';
    const result = loadIdentityFromEnv();
    assert.equal(result, null);
  });

  it('loads identity from env vars', () => {
    // Generate keys to get valid hex values
    const generated = loadOrCreateIdentity(DOMAIN, TEST_KEY_FILE);

    process.env.MERCHANT_PUBLIC_KEY = generated.keys.publicKeyHex;
    process.env.MERCHANT_PRIVATE_KEY = generated.keys.privateKeyHex;
    process.env.MERCHANT_DOMAIN = 'env-test.com';

    const result = loadIdentityFromEnv();

    assert.ok(result);
    assert.equal(result!.domain, 'env-test.com');
    assert.equal(result!.did, 'did:web:env-test.com');
    assert.equal(result!.keys.publicKeyHex, generated.keys.publicKeyHex);
  });

  it('env-loaded keys can sign and verify', async () => {
    const generated = loadOrCreateIdentity(DOMAIN, TEST_KEY_FILE);

    process.env.MERCHANT_PUBLIC_KEY = generated.keys.publicKeyHex;
    process.env.MERCHANT_PRIVATE_KEY = generated.keys.privateKeyHex;
    process.env.MERCHANT_DOMAIN = 'env-test.com';

    const identity = loadIdentityFromEnv()!;
    const cart = {
      items: [{ sku: '1', name: 'Test', quantity: 1, unitPrice: 10 }],
      totalAmount: 10,
      currency: 'USD',
      orderFormId: 'env-test-of',
    };

    const mandate = await createCartMandate(cart, identity.domain, identity.keys);
    const result = await verifyCartMandate(mandate, identity.keys.publicKey);
    assert.equal(result.valid, true);
  });
});
