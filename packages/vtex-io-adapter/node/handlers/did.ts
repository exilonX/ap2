/**
 * DID Document Handler
 *
 * Serves the merchant's DID document at /_v/acg/.well-known/did.json
 * Contains the Ed25519 public key used to verify AP2 mandate signatures.
 *
 * Keys are generated once and persisted in VBase.
 * Anyone can fetch this document to verify mandates signed by this merchant.
 */

import { generateKeyPairSync } from 'crypto';

const VBASE_BUCKET = 'acg-identity';
const VBASE_KEY = 'merchant-did';

interface StoredIdentity {
  publicKeyHex: string;
  privateKeyHex: string;
  domain: string;
  createdAt: string;
}

/**
 * GET /_v/acg/.well-known/did.json
 * Serve the merchant's DID document.
 */
export async function serveDIDDocument(ctx: Context) {
  try {
    const workspace = ctx.vtex.workspace || 'master';
    const domain = workspace === 'master'
      ? `${ctx.vtex.account}.myvtex.com`
      : `${workspace}--${ctx.vtex.account}.myvtex.com`;
    const did = `did:web:${domain}`;

    // Load or create identity from VBase
    let identity: StoredIdentity;
    try {
      identity = await ctx.clients.vbase.getJSON<StoredIdentity>(VBASE_BUCKET, VBASE_KEY, true);
    } catch {
      // First time — generate key pair and store
      const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'pkcs8', format: 'der' },
      });

      identity = {
        publicKeyHex: (publicKey as Buffer).toString('hex'),
        privateKeyHex: (privateKey as Buffer).toString('hex'),
        domain,
        createdAt: new Date().toISOString(),
      };

      await ctx.clients.vbase.saveJSON(VBASE_BUCKET, VBASE_KEY, identity);
      console.log(`[ACG DID] Generated new merchant identity for ${domain}`);
    }

    // Build W3C DID Document
    const didDocument = {
      '@context': [
        'https://www.w3.org/ns/did/v1',
        'https://w3id.org/security/suites/ed25519-2020/v1',
      ],
      id: did,
      verificationMethod: [
        {
          id: `${did}#key-1`,
          type: 'Ed25519VerificationKey2020',
          controller: did,
          publicKeyHex: identity.publicKeyHex,
        },
      ],
      authentication: [`${did}#key-1`],
      assertionMethod: [`${did}#key-1`],
    };

    ctx.set('Content-Type', 'application/did+ld+json');
    ctx.set('Cache-Control', 'public, max-age=3600');
    ctx.body = didDocument;
  } catch (error) {
    console.error('DID document error:', error);
    ctx.status = 500;
    ctx.body = {
      error: 'Failed to serve DID document',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
