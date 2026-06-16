/**
 * DID (Decentralized Identifier) Management
 *
 * Manages the merchant's cryptographic identity for AP2.
 * Uses Ed25519 key pairs for fast, compact signatures.
 *
 * Uses Node.js built-in crypto module (Ed25519 support since Node 16).
 */

import {
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  createPublicKey,
  createPrivateKey,
} from 'crypto'

export interface KeyPair {
  publicKey: Buffer
  privateKey: Buffer
  publicKeyHex: string
  privateKeyHex: string
}

export interface DIDDocument {
  '@context': string[]
  id: string
  verificationMethod: Array<{
    id: string
    type: string
    controller: string
    publicKeyHex: string
  }>
  authentication: string[]
  assertionMethod: string[]
}

/**
 * Generate a new Ed25519 key pair for merchant identity.
 */
export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  })

  return {
    publicKey: publicKey as Buffer,
    privateKey: privateKey as Buffer,
    publicKeyHex: (publicKey as Buffer).toString('hex'),
    privateKeyHex: (privateKey as Buffer).toString('hex'),
  }
}

/**
 * Restore a key pair from hex-encoded keys.
 */
export function keyPairFromHex(
  publicKeyHex: string,
  privateKeyHex: string
): KeyPair {
  const publicKey = Buffer.from(publicKeyHex, 'hex')
  const privateKey = Buffer.from(privateKeyHex, 'hex')

  return {
    publicKey,
    privateKey,
    publicKeyHex,
    privateKeyHex,
  }
}

/**
 * Sign data with Ed25519 private key.
 * @param message - The data to sign (typically a SHA-256 hash)
 * @param privateKeyDer - The private key in DER (PKCS#8) format
 */
export function sign(message: Uint8Array, privateKeyDer: Buffer): string {
  const keyObject = createPrivateKey({
    key: privateKeyDer,
    format: 'der',
    type: 'pkcs8',
  })

  const signature = cryptoSign(null, Buffer.from(message), keyObject)

  return signature.toString('hex')
}

/**
 * Verify an Ed25519 signature.
 * @param signature - Hex-encoded signature
 * @param message - The original message that was signed
 * @param publicKeyDer - The public key in DER (SPKI) format
 */
export function verify(
  signature: string,
  message: Uint8Array,
  publicKeyDer: Buffer
): boolean {
  const keyObject = createPublicKey({
    key: publicKeyDer,
    format: 'der',
    type: 'spki',
  })

  return cryptoVerify(
    null,
    Buffer.from(message),
    keyObject,
    Buffer.from(signature, 'hex')
  )
}

/**
 * Create a DID Document for the merchant.
 *
 * Uses did:web method — the DID resolves to a URL where the document is hosted.
 * Example: did:web:ap2--vtexeurope.myvtex.com
 *        → https://ap2--vtexeurope.myvtex.com/.well-known/did.json
 */
export function createDIDDocument(
  domain: string,
  publicKey: Buffer
): DIDDocument {
  const did = `did:web:${domain}`

  return {
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
        publicKeyHex: publicKey.toString('hex'),
      },
    ],
    authentication: [`${did}#key-1`],
    assertionMethod: [`${did}#key-1`],
  }
}

/**
 * Get the DID string from a domain.
 */
export function didFromDomain(domain: string): string {
  return `did:web:${domain}`
}
