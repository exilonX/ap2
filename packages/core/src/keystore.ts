/**
 * Key Store
 *
 * Manages merchant Ed25519 key persistence.
 * Generates keys once, saves to file, loads on subsequent starts.
 *
 * For production, replace file-based storage with:
 * - VTEX App Settings (encrypted)
 * - AWS KMS / GCP KMS / Azure Key Vault
 * - Environment variables
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

interface StoredKeys {
  publicKeyHex: string;
  privateKeyHex: string;
  domain: string;
  createdAt: string;
}

/**
 * Load or create merchant identity.
 *
 * If a key file exists at the given path, loads it.
 * Otherwise generates a new key pair and saves it.
 *
 * @param domain - The merchant's domain (e.g., "ap2--vtexeurope.myvtex.com")
 * @param keyFilePath - Path to the key file (e.g., "./keys/merchant.json")
 */
export function loadOrCreateIdentity(domain: string, keyFilePath: string): MerchantIdentity {
  let keys: KeyPair;

  if (existsSync(keyFilePath)) {
    // Load existing keys
    const stored: StoredKeys = JSON.parse(readFileSync(keyFilePath, 'utf8'));
    keys = keyPairFromHex(stored.publicKeyHex, stored.privateKeyHex);
    console.error(`[ACG] Loaded merchant identity from ${keyFilePath}`);
    console.error(`[ACG] DID: did:web:${stored.domain}`);
  } else {
    // Generate new keys and save
    keys = generateKeyPair();
    const stored: StoredKeys = {
      publicKeyHex: keys.publicKeyHex,
      privateKeyHex: keys.privateKeyHex,
      domain,
      createdAt: new Date().toISOString(),
    };

    // Ensure directory exists
    const dir = dirname(keyFilePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(keyFilePath, JSON.stringify(stored, null, 2), 'utf8');
    console.error(`[ACG] Generated new merchant identity, saved to ${keyFilePath}`);
    console.error(`[ACG] DID: did:web:${domain}`);
    console.error(`[ACG] Public key: ${keys.publicKeyHex}`);
  }

  const did = `did:web:${domain}`;
  const didDocument = createDIDDocument(domain, keys.publicKey);

  return { keys, domain, did, didDocument };
}

/**
 * Load merchant identity from environment variables.
 * Useful for production deployments where keys are in secrets manager.
 *
 * Expects:
 *   MERCHANT_PUBLIC_KEY  — hex-encoded Ed25519 public key (DER/SPKI)
 *   MERCHANT_PRIVATE_KEY — hex-encoded Ed25519 private key (DER/PKCS8)
 *   MERCHANT_DOMAIN      — the merchant's domain
 */
export function loadIdentityFromEnv(): MerchantIdentity | null {
  const publicKeyHex = process.env.MERCHANT_PUBLIC_KEY;
  const privateKeyHex = process.env.MERCHANT_PRIVATE_KEY;
  const domain = process.env.MERCHANT_DOMAIN;

  if (!publicKeyHex || !privateKeyHex || !domain) {
    return null;
  }

  const keys = keyPairFromHex(publicKeyHex, privateKeyHex);
  const did = `did:web:${domain}`;
  const didDocument = createDIDDocument(domain, keys.publicKey);

  return { keys, domain, did, didDocument };
}
