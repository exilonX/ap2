/**
 * MerchantIdentity tests.
 *
 * Covers:
 *   - `getDID()` returns `did:web:{domain}` after first load
 *   - `getDIDDocument()` shape (key-1, EdDSA verification method)
 *   - sign-then-verify round-trip using the public half exposed via getPublicKey
 *   - private key never escapes (no public method exposes it)
 *   - idempotency: multiple `getDID()` calls do not regenerate
 *   - rejects when KeyStore returns malformed StoredKeys
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MerchantIdentity } from '../merchant-identity';
import { VBaseKeyStore } from '../vbase-keystore';
import { FakeVBase } from './fake-vbase';
import { verifyCartMandate, type CartData } from '../../core';

const DOMAIN = 'merchant-id.example.com';

function freshIdentity() {
  const fake = new FakeVBase();
  const keyStore = new VBaseKeyStore(fake);
  const identity = new MerchantIdentity({ keyStore, domain: DOMAIN });
  return { fake, keyStore, identity };
}

const cart: CartData = {
  items: [{ sku: '5', name: 'Tricou', quantity: 1, unitPrice: 55.24 }],
  totalAmount: 55.24,
  currency: 'RON',
  orderFormId: 'mi-of-1',
};

describe('MerchantIdentity', () => {
  it('getDID returns did:web:{domain}', async () => {
    const { identity } = freshIdentity();
    const did = await identity.getDID();
    assert.equal(did, `did:web:${DOMAIN}`);
  });

  it('getDIDDocument returns a well-formed W3C DID document', async () => {
    const { identity } = freshIdentity();
    const doc = await identity.getDIDDocument();
    assert.equal(doc.id, `did:web:${DOMAIN}`);
    assert.equal(doc.verificationMethod.length, 1);
    assert.equal(doc.verificationMethod[0].type, 'Ed25519VerificationKey2020');
    assert.equal(doc.verificationMethod[0].id, `did:web:${DOMAIN}#key-1`);
    assert.deepEqual(doc.authentication, [`did:web:${DOMAIN}#key-1`]);
    assert.deepEqual(doc.assertionMethod, [`did:web:${DOMAIN}#key-1`]);
  });

  it('sign-then-verify round-trip succeeds', async () => {
    const { identity } = freshIdentity();
    const mandate = await identity.signCartMandate(cart);
    const publicKey = await identity.getPublicKey();
    const result = await verifyCartMandate(mandate, publicKey);
    assert.equal(result.valid, true);
    assert.equal(result.checks.signatureValid, true);
    assert.equal(result.checks.notExpired, true);
    assert.equal(result.checks.hashMatches, true);
  });

  it('multiple getDID calls do not regenerate keys (idempotent)', async () => {
    const { fake, identity } = freshIdentity();
    await identity.getDID();
    const stored1 = fake.peek<{ publicKeyHex: string }>('acg-identity', 'merchant-did');
    await identity.getDID();
    await identity.getDIDDocument();
    await identity.signCartMandate(cart);
    const stored2 = fake.peek<{ publicKeyHex: string }>('acg-identity', 'merchant-did');
    assert.ok(stored1);
    assert.ok(stored2);
    assert.equal(stored1!.publicKeyHex, stored2!.publicKeyHex);
  });

  it('uses keys already present in the KeyStore', async () => {
    const fake = new FakeVBase();
    // Pre-seed valid keys (32 hex chars = 16 bytes — not a real Ed25519
    // key, but we'll generate a real one through a different identity to
    // get a valid pair).
    const tempIdentity = new MerchantIdentity({
      keyStore: new VBaseKeyStore(fake),
      domain: DOMAIN,
    });
    await tempIdentity.getDID();
    const seeded = fake.peek<{ publicKeyHex: string }>('acg-identity', 'merchant-did');
    assert.ok(seeded);

    // Fresh instance: should pick up the seeded keys without rewriting
    const fresh = new MerchantIdentity({
      keyStore: new VBaseKeyStore(fake),
      domain: DOMAIN,
    });
    const did = await fresh.getDID();
    const doc = await fresh.getDIDDocument();
    assert.equal(did, `did:web:${DOMAIN}`);
    assert.equal(doc.verificationMethod[0].publicKeyHex, seeded!.publicKeyHex);
  });

  it('rejects when KeyStore returns malformed keys', async () => {
    const fake = new FakeVBase();
    fake.seed('acg-identity', 'merchant-did', {
      publicKeyHex: '',
      privateKeyHex: '',
      domain: '',
      createdAt: '',
    });
    const identity = new MerchantIdentity({
      keyStore: new VBaseKeyStore(fake),
      domain: DOMAIN,
    });
    await assert.rejects(() => identity.getDID(), /malformed/i);
  });

  it('does not expose the private key as a public method', () => {
    // Defensive — guard against accidental future regression.
    const { identity } = freshIdentity();
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(identity));
    assert.ok(!surface.includes('getPrivateKey'));
    assert.ok(!surface.includes('privateKey'));
    assert.ok(!surface.includes('keys'));
  });
});
