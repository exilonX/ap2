/**
 * Mock party DID + retrieval handlers.
 *
 * Routes:
 *   GET /_v/acg/mock-cp/.well-known/did.json         — CP DID document
 *   GET /_v/acg/mock-network/.well-known/did.json    — Network DID document
 *   GET /_v/acg/payment-mandates/:paymentMandateId   — signed PaymentMandate
 *   GET /_v/acg/receipts/:receiptId                  — signed PaymentReceipt
 *
 * Each artifact is independently verifiable: a third-party reader can
 * fetch the relevant DID document, fetch the artifact, and verify the
 * JWS signature against the published public key — same trust beat as
 * the existing `/_v/acg/.well-known/did.json` + `/_v/acg/mandates/:id`
 * pair (per ADR-0001).
 */

import { VBaseKeyStore } from '../identity/vbase-keystore';
import {
  MockCredentialsProvider,
  MockPaymentNetwork,
} from '../mock-payment-network';
import {
  PAYMENT_MANDATE_BUCKET,
  PAYMENT_RECEIPT_BUCKET,
} from '../payments/payment-orchestration';
import {
  verifyPaymentMandate,
  verifyPaymentReceipt,
  type PaymentMandate,
  type PaymentReceipt,
} from '../core';

const MOCK_CP_BUCKET = 'acg-mock-cp';
const MOCK_CP_KEY = 'cp-did';
const MOCK_NETWORK_BUCKET = 'acg-mock-network';
const MOCK_NETWORK_KEY = 'network-did';

function buildDIDDomains(ctx: Context): { cpDomain: string; networkDomain: string } {
  const workspace = ctx.vtex.workspace || 'master';
  const host =
    workspace === 'master'
      ? `${ctx.vtex.account}.myvtex.com`
      : `${workspace}--${ctx.vtex.account}.myvtex.com`;
  return {
    cpDomain: `${host}:mock-cp`,
    networkDomain: `${host}:mock-network`,
  };
}

function buildMockCp(ctx: Context): MockCredentialsProvider {
  const { cpDomain } = buildDIDDomains(ctx);
  return new MockCredentialsProvider({
    keyStore: new VBaseKeyStore(ctx.clients.vbase, MOCK_CP_BUCKET, MOCK_CP_KEY),
    domain: cpDomain,
  });
}

function buildMockNetwork(ctx: Context): MockPaymentNetwork {
  const { networkDomain } = buildDIDDomains(ctx);
  return new MockPaymentNetwork({
    keyStore: new VBaseKeyStore(ctx.clients.vbase, MOCK_NETWORK_BUCKET, MOCK_NETWORK_KEY),
    domain: networkDomain,
  });
}

/** GET /_v/acg/mock-cp/.well-known/did.json */
export async function serveMockCpDIDDocument(ctx: Context): Promise<void> {
  try {
    const cp = buildMockCp(ctx);
    const doc = await cp.getDIDDocument();
    ctx.set('Content-Type', 'application/did+ld+json');
    ctx.set('Cache-Control', 'public, max-age=3600');
    ctx.body = doc;
  } catch (error) {
    ctx.status = 500;
    ctx.body = {
      error: 'Failed to serve mock CP DID document',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/** GET /_v/acg/mock-network/.well-known/did.json */
export async function serveMockNetworkDIDDocument(ctx: Context): Promise<void> {
  try {
    const network = buildMockNetwork(ctx);
    const doc = await network.getDIDDocument();
    ctx.set('Content-Type', 'application/did+ld+json');
    ctx.set('Cache-Control', 'public, max-age=3600');
    ctx.body = doc;
  } catch (error) {
    ctx.status = 500;
    ctx.body = {
      error: 'Failed to serve mock Network DID document',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * GET /_v/acg/payment-mandates/:paymentMandateId
 *
 * Returns the signed PaymentMandate plus a verification result computed
 * against the CP's currently-published public key. Same shape as the
 * existing `/_v/acg/mandates/:id` route for CartMandates.
 */
export async function getPaymentMandate(ctx: Context): Promise<void> {
  const id = ctx.vtex.route?.params?.paymentMandateId as string | undefined;
  if (!id || typeof id !== 'string') {
    ctx.status = 400;
    ctx.body = { error: 'missing paymentMandateId path parameter' };
    return;
  }

  let pm: PaymentMandate | null;
  try {
    pm = await ctx.clients.vbase.getJSON<PaymentMandate>(PAYMENT_MANDATE_BUCKET, id, true);
  } catch {
    pm = null;
  }
  if (!pm) {
    ctx.status = 404;
    ctx.body = { error: `PaymentMandate ${id} not found` };
    return;
  }

  const cp = buildMockCp(ctx);
  const cpPublicKey = await cp.getPublicKey();
  const verification = await verifyPaymentMandate(pm, cpPublicKey);

  const { cpDomain } = buildDIDDomains(ctx);
  const baseUrl = `https://${ctx.vtex.workspace === 'master' ? '' : `${ctx.vtex.workspace}--`}${ctx.vtex.account}.myvtex.com`;

  ctx.body = {
    paymentMandate: pm,
    verification,
    cpDIDDocumentUrl: `${baseUrl}/_v/acg/mock-cp/.well-known/did.json`,
    cpDID: `did:web:${cpDomain}`,
  };
}

/**
 * GET /_v/acg/receipts/:receiptId
 *
 * Returns the signed PaymentReceipt plus a verification result computed
 * against the network's currently-published public key.
 */
export async function getPaymentReceipt(ctx: Context): Promise<void> {
  const id = ctx.vtex.route?.params?.receiptId as string | undefined;
  if (!id || typeof id !== 'string') {
    ctx.status = 400;
    ctx.body = { error: 'missing receiptId path parameter' };
    return;
  }

  let receipt: PaymentReceipt | null;
  try {
    receipt = await ctx.clients.vbase.getJSON<PaymentReceipt>(PAYMENT_RECEIPT_BUCKET, id, true);
  } catch {
    receipt = null;
  }
  if (!receipt) {
    ctx.status = 404;
    ctx.body = { error: `PaymentReceipt ${id} not found` };
    return;
  }

  const network = buildMockNetwork(ctx);
  const networkPublicKey = await network.getPublicKey();
  const verification = await verifyPaymentReceipt(receipt, networkPublicKey);

  const { networkDomain } = buildDIDDomains(ctx);
  const baseUrl = `https://${ctx.vtex.workspace === 'master' ? '' : `${ctx.vtex.workspace}--`}${ctx.vtex.account}.myvtex.com`;

  ctx.body = {
    paymentReceipt: receipt,
    verification,
    networkDIDDocumentUrl: `${baseUrl}/_v/acg/mock-network/.well-known/did.json`,
    networkDID: `did:web:${networkDomain}`,
  };
}
