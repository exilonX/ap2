/**
 * Mandate Handlers
 *
 * Serves stored AP2 mandates for third-party verification.
 * Anyone with the merchant's public key (from DID document) can verify.
 */

const MANDATE_BUCKET = 'acg-mandates';

interface StoredMandate {
  mandate: {
    contents: {
      id: string;
      merchant_name: string;
      payment_items: unknown[];
      total: { currency: string; value: string };
      cart_expiry: string;
      order_reference?: string;
    };
    merchant_authorization: string;
  };
  sessionId: string;
  orderFormId: string;
  storedAt: string;
}

/**
 * GET /_v/acg/mandates/:mandateId
 * Retrieve a stored mandate for verification.
 *
 * Returns the full mandate (contents + JWT) so any verifier can:
 * 1. Fetch the DID document from /_v/acg/.well-known/did.json
 * 2. Extract the merchant's public key
 * 3. Verify the JWT signature
 * 4. Check the cart_hash matches the canonical contents
 */
export async function getMandate(ctx: Context) {
  try {
    const mandateId = ctx.vtex.route?.params?.mandateId ?? ctx.params?.mandateId;

    if (!mandateId) {
      ctx.status = 400;
      ctx.body = { error: 'Missing mandate ID' };
      return;
    }

    let stored: StoredMandate;
    try {
      stored = await ctx.clients.vbase.getJSON<StoredMandate>(MANDATE_BUCKET, mandateId, true);
    } catch {
      ctx.status = 404;
      ctx.body = { error: 'Mandate not found' };
      return;
    }

    // Build verification info
    const workspace = ctx.vtex.workspace || 'master';
    const host = workspace === 'master'
      ? `${ctx.vtex.account}.myvtex.com`
      : `${workspace}--${ctx.vtex.account}.myvtex.com`;

    ctx.body = {
      mandate: stored.mandate,
      metadata: {
        storedAt: stored.storedAt,
        sessionId: stored.sessionId,
        orderFormId: stored.orderFormId,
      },
      verification: {
        didDocumentUrl: `https://${host}/_v/acg/.well-known/did.json`,
        instructions: 'Fetch the DID document to get the merchant public key. Use it to verify the JWT in merchant_authorization. Then verify cart_hash matches SHA-256 of JCS-canonicalized contents.',
      },
    };
  } catch (error) {
    console.error('Get mandate error:', error);
    ctx.status = 500;
    ctx.body = {
      error: 'Failed to retrieve mandate',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * POST /_v/acg/mandates
 * Store a mandate (called by MCP server at checkout time).
 */
export async function storeMandate(ctx: Context) {
  try {
    const body = await require('co-body').json(ctx.req);
    const { mandate } = body;

    if (!mandate?.contents?.id) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid mandate — missing contents.id' };
      return;
    }

    const mandateId = mandate.contents.id;

    await ctx.clients.vbase.saveJSON(MANDATE_BUCKET, mandateId, {
      mandate,
      storedAt: new Date().toISOString(),
    });

    console.log(`[ACG Mandate] Stored: ${mandateId}`);

    ctx.body = {
      success: true,
      mandateId,
      message: `Mandate ${mandateId} stored successfully.`,
    };
  } catch (error) {
    console.error('Store mandate error:', error);
    ctx.status = 500;
    ctx.body = {
      error: 'Failed to store mandate',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
