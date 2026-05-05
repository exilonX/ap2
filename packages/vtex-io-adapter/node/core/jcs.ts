/**
 * JSON Canonicalization Scheme (JCS) — RFC 8785
 *
 * Produces a deterministic, byte-perfect JSON serialization.
 * This ensures that the same data always produces the same signature,
 * regardless of key ordering, whitespace, or serialization quirks.
 *
 * Used by AP2 to create a canonical representation of cart contents
 * before signing — if the cart changes by even one byte, the signature
 * is invalid.
 */

import canonicalize from 'canonicalize';
import { createHash } from 'crypto';

/**
 * Canonicalize a JSON object per RFC 8785.
 * Returns a deterministic string representation.
 *
 * Key properties:
 * - Keys are sorted lexicographically
 * - No whitespace
 * - Numbers use shortest representation
 * - Unicode escaping is normalized
 */
export function canonicalizeJson(data: unknown): string {
  const result = canonicalize(data);
  if (result === undefined) {
    throw new Error('Cannot canonicalize undefined value');
  }
  return result;
}

/**
 * SHA-256 hash of a string.
 * Returns the hash as a hex string.
 */
export function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * SHA-256 hash as a Buffer (for signing operations).
 */
export function sha256Bytes(data: string): Buffer {
  return createHash('sha256').update(data, 'utf8').digest();
}

/**
 * Canonicalize and hash a JSON object.
 * This is the standard operation before signing: data → canonical JSON → SHA-256.
 */
export function canonicalHash(data: unknown): { canonical: string; hash: string } {
  const canonical = canonicalizeJson(data);
  const hash = sha256(canonical);
  return { canonical, hash };
}
