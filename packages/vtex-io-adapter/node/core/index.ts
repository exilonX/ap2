/**
 * @acg/core — vendored copy.
 *
 * VTEX IO can't reach `file:` deps, so the AP2 cryptographic primitives
 * from `packages/core/src/*` are vendored here. The source of truth
 * remains `packages/core/`; this directory mirrors its public surface.
 *
 * If you change anything in `packages/core/src/`, run the vendor sync
 * (or, until the script lands, manually copy the relevant files).
 *
 * Public surface re-exported from this index matches `@acg/core`:
 *   - `loadOrCreateIdentity`, `KeyStore`, `MerchantIdentity`
 *   - `createCartMandate`, `verifyCartMandate`, `mandateMatchesCart`
 *   - `extractEvidenceBundle`, `EvidenceBundle`
 *   - DID and JCS primitives
 */

export {
  generateKeyPair,
  keyPairFromHex,
  sign,
  verify,
  createDIDDocument,
  didFromDomain,
  type KeyPair,
  type DIDDocument,
} from './did';

export {
  canonicalizeJson,
  sha256,
  sha256Bytes,
  canonicalHash,
} from './jcs';

export {
  loadOrCreateIdentity,
  loadIdentityFromEnv,
  FilesystemKeyStore,
  EnvKeyStore,
  type KeyStore,
  type StoredKeys,
  type MerchantIdentity,
} from './keystore';

export {
  createCartMandate,
  verifyCartMandate,
  mandateMatchesCart,
  type PaymentAmount,
  type PaymentItem,
  type CartContents,
  type CartMandate,
  type MandateJWTPayload,
  type MandateVerification,
  type CartLineItem,
  type CartData,
} from './mandates';

export {
  extractEvidenceBundle,
  type EvidenceBundle,
  type PaymentMandate,
} from './evidence';
