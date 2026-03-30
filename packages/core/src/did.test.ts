import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, keyPairFromHex, sign, verify, createDIDDocument, didFromDomain } from './did';

describe('did - generateKeyPair', () => {
  it('returns a key pair with all fields', () => {
    const keys = generateKeyPair();
    assert.ok(Buffer.isBuffer(keys.publicKey));
    assert.ok(Buffer.isBuffer(keys.privateKey));
    assert.ok(keys.publicKeyHex.length > 0);
    assert.ok(keys.privateKeyHex.length > 0);
  });

  it('generates different keys each time', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    assert.notEqual(a.publicKeyHex, b.publicKeyHex);
    assert.notEqual(a.privateKeyHex, b.privateKeyHex);
  });

  it('hex encoding roundtrips correctly', () => {
    const keys = generateKeyPair();
    assert.equal(keys.publicKey.toString('hex'), keys.publicKeyHex);
    assert.equal(keys.privateKey.toString('hex'), keys.privateKeyHex);
  });
});

describe('did - keyPairFromHex', () => {
  it('restores key pair from hex strings', () => {
    const original = generateKeyPair();
    const restored = keyPairFromHex(original.publicKeyHex, original.privateKeyHex);

    assert.equal(restored.publicKeyHex, original.publicKeyHex);
    assert.equal(restored.privateKeyHex, original.privateKeyHex);
    assert.ok(restored.publicKey.equals(original.publicKey));
    assert.ok(restored.privateKey.equals(original.privateKey));
  });
});

describe('did - sign and verify', () => {
  it('signs and verifies a message', () => {
    const keys = generateKeyPair();
    const message = Buffer.from('hello world');

    const signature = sign(message, keys.privateKey);
    assert.ok(typeof signature === 'string');
    assert.ok(signature.length > 0);

    const isValid = verify(signature, message, keys.publicKey);
    assert.ok(isValid);
  });

  it('fails verification with wrong public key', () => {
    const keys1 = generateKeyPair();
    const keys2 = generateKeyPair();
    const message = Buffer.from('test message');

    const signature = sign(message, keys1.privateKey);
    const isValid = verify(signature, message, keys2.publicKey);
    assert.equal(isValid, false);
  });

  it('fails verification with tampered message', () => {
    const keys = generateKeyPair();
    const original = Buffer.from('original message');
    const tampered = Buffer.from('tampered message');

    const signature = sign(original, keys.privateKey);
    const isValid = verify(signature, tampered, keys.publicKey);
    assert.equal(isValid, false);
  });

  it('fails verification with tampered signature', () => {
    const keys = generateKeyPair();
    const message = Buffer.from('test');
    const signature = sign(message, keys.privateKey);

    // Flip a character in the signature
    const tampered = signature.slice(0, -2) + 'ff';
    const isValid = verify(tampered, message, keys.publicKey);
    assert.equal(isValid, false);
  });

  it('signature is deterministic for same key + message', () => {
    const keys = generateKeyPair();
    const message = Buffer.from('deterministic test');

    // Ed25519 is deterministic (no random nonce in signing)
    const sig1 = sign(message, keys.privateKey);
    const sig2 = sign(message, keys.privateKey);
    assert.equal(sig1, sig2);
  });

  it('works with restored keys from hex', () => {
    const original = generateKeyPair();
    const message = Buffer.from('roundtrip test');
    const signature = sign(message, original.privateKey);

    const restored = keyPairFromHex(original.publicKeyHex, original.privateKeyHex);
    const isValid = verify(signature, message, restored.publicKey);
    assert.ok(isValid);
  });
});

describe('did - createDIDDocument', () => {
  it('creates a valid DID document', () => {
    const keys = generateKeyPair();
    const doc = createDIDDocument('example.com', keys.publicKey);

    assert.equal(doc.id, 'did:web:example.com');
    assert.ok(doc['@context'].includes('https://www.w3.org/ns/did/v1'));
    assert.equal(doc.verificationMethod.length, 1);
    assert.equal(doc.verificationMethod[0].type, 'Ed25519VerificationKey2020');
    assert.equal(doc.verificationMethod[0].controller, 'did:web:example.com');
    assert.equal(doc.verificationMethod[0].id, 'did:web:example.com#key-1');
    assert.equal(doc.verificationMethod[0].publicKeyHex, keys.publicKeyHex);
  });

  it('uses correct did:web format for subdomains', () => {
    const keys = generateKeyPair();
    const doc = createDIDDocument('ap2--vtexeurope.myvtex.com', keys.publicKey);
    assert.equal(doc.id, 'did:web:ap2--vtexeurope.myvtex.com');
  });

  it('includes authentication and assertionMethod', () => {
    const keys = generateKeyPair();
    const doc = createDIDDocument('test.com', keys.publicKey);

    assert.deepEqual(doc.authentication, ['did:web:test.com#key-1']);
    assert.deepEqual(doc.assertionMethod, ['did:web:test.com#key-1']);
  });
});

describe('did - didFromDomain', () => {
  it('converts domain to did:web format', () => {
    assert.equal(didFromDomain('example.com'), 'did:web:example.com');
    assert.equal(didFromDomain('ap2--vtexeurope.myvtex.com'), 'did:web:ap2--vtexeurope.myvtex.com');
  });
});
