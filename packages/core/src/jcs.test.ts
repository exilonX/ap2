import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeJson, sha256, sha256Bytes, canonicalHash } from './jcs';

describe('jcs - canonicalizeJson', () => {
  it('sorts keys lexicographically', () => {
    const result = canonicalizeJson({ z: 1, a: 2, m: 3 });
    assert.equal(result, '{"a":2,"m":3,"z":1}');
  });

  it('produces identical output regardless of input key order', () => {
    const a = canonicalizeJson({ name: 'Tricou', price: 55.24, sku: '5' });
    const b = canonicalizeJson({ sku: '5', name: 'Tricou', price: 55.24 });
    assert.equal(a, b);
  });

  it('handles nested objects with sorted keys', () => {
    const result = canonicalizeJson({ b: { d: 1, c: 2 }, a: 3 });
    assert.equal(result, '{"a":3,"b":{"c":2,"d":1}}');
  });

  it('handles arrays (order preserved)', () => {
    const result = canonicalizeJson({ items: [3, 1, 2] });
    assert.equal(result, '{"items":[3,1,2]}');
  });

  it('handles empty objects', () => {
    assert.equal(canonicalizeJson({}), '{}');
  });

  it('handles empty arrays', () => {
    assert.equal(canonicalizeJson([]), '[]');
  });

  it('handles null values', () => {
    assert.equal(canonicalizeJson({ a: null }), '{"a":null}');
  });

  it('handles boolean values', () => {
    assert.equal(canonicalizeJson({ t: true, f: false }), '{"f":false,"t":true}');
  });

  it('handles string values with special characters', () => {
    const result = canonicalizeJson({ name: 'Rochița Roz' });
    assert.ok(result.includes('Rochi'));
  });

  it('throws on undefined input', () => {
    assert.throws(() => canonicalizeJson(undefined), /Cannot canonicalize undefined/);
  });

  it('removes no whitespace (compact output)', () => {
    const result = canonicalizeJson({ a: 1, b: 2 });
    assert.ok(!result.includes(' '));
    assert.ok(!result.includes('\n'));
  });
});

describe('jcs - sha256', () => {
  it('returns a 64-character hex string', () => {
    const hash = sha256('hello');
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it('produces consistent hashes for same input', () => {
    assert.equal(sha256('test'), sha256('test'));
  });

  it('produces different hashes for different inputs', () => {
    assert.notEqual(sha256('test1'), sha256('test2'));
  });

  it('matches known SHA-256 value', () => {
    // SHA-256 of "hello" is well-known
    assert.equal(
      sha256('hello'),
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });
});

describe('jcs - sha256Bytes', () => {
  it('returns a Buffer of 32 bytes', () => {
    const bytes = sha256Bytes('hello');
    assert.ok(Buffer.isBuffer(bytes));
    assert.equal(bytes.length, 32);
  });

  it('hex representation matches sha256 string output', () => {
    const hex = sha256('hello');
    const bytes = sha256Bytes('hello');
    assert.equal(bytes.toString('hex'), hex);
  });
});

describe('jcs - canonicalHash', () => {
  it('returns canonical string and hash', () => {
    const result = canonicalHash({ b: 2, a: 1 });
    assert.equal(result.canonical, '{"a":1,"b":2}');
    assert.equal(result.hash.length, 64);
  });

  it('same data in different order produces same hash', () => {
    const a = canonicalHash({ price: 55.24, name: 'Tricou' });
    const b = canonicalHash({ name: 'Tricou', price: 55.24 });
    assert.equal(a.hash, b.hash);
    assert.equal(a.canonical, b.canonical);
  });

  it('different data produces different hash', () => {
    const a = canonicalHash({ price: 55.24 });
    const b = canonicalHash({ price: 55.25 });
    assert.notEqual(a.hash, b.hash);
  });

  it('hash changes if even one field is modified', () => {
    const cart1 = { items: [{ sku: '5', price: 55.24 }], total: 55.24 };
    const cart2 = { items: [{ sku: '5', price: 55.25 }], total: 55.25 };
    assert.notEqual(canonicalHash(cart1).hash, canonicalHash(cart2).hash);
  });
});
