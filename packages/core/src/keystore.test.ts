import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';
import { loadOrCreateIdentity, loadIdentityFromEnv } from './keystore';
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

describe('keystore - loadOrCreateIdentity', () => {
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
    assert.equal(result.domain, 'env-test.com');
    assert.equal(result.did, 'did:web:env-test.com');
    assert.equal(result.keys.publicKeyHex, generated.keys.publicKeyHex);
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
