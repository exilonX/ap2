/**
 * Checkout Handlers
 *
 * Handle checkout initiation, payment page, and order execution.
 */

import { json } from 'co-body';
import { mapOrderFormToCart } from '../mappers/cart';
import { getOrderFormIdFromRequest, generateSessionId } from '../utils/session';
import type { CheckoutSession } from '../types/shared';

const VBASE_BUCKET = 'acg-sessions';

interface CheckoutExecuteRequest {
  customerData?: {
    email: string;
    firstName: string;
    lastName: string;
    documentType?: string;
    document?: string;
    phone?: string;
  };
  shippingAddress?: {
    receiverName?: string;
    postalCode: string;
    city: string;
    state: string;
    country?: string;
    street: string;
    number: string;
    neighborhood: string;
    complement?: string;
    selectedSla?: string;
  };
  paymentData?: {
    paymentSystem?: number;
    installments?: number;
    cardNumber: string;
    cardHolder: string;
    cardExpiration: string;
    cardCvv: string;
  };
}

/**
 * POST /_v/acg/checkout/initiate
 * Start checkout and return payment page URL
 */
export async function initiateCheckout(ctx: Context) {
  try {
    console.log('[ACG Checkout] INITIATE request');

    const orderFormId = getOrderFormIdFromRequest(ctx);

    if (!orderFormId) {
      ctx.status = 400;
      ctx.body = { error: 'No cart found. Add items first.' };
      return;
    }

    const orderForm = await ctx.clients.checkout.getOrderForm(orderFormId);

    if (orderForm.items.length === 0) {
      ctx.status = 400;
      ctx.body = { error: 'Cart is empty. Add items first.' };
      return;
    }

    // Create checkout session
    const sessionId = generateSessionId();
    const now = Date.now();
    const expiresIn = 10 * 60 * 1000; // 10 minutes

    const session: CheckoutSession = {
      id: sessionId,
      orderFormId,
      createdAt: now,
      expiresAt: now + expiresIn,
      status: 'pending',
    };

    // Store session in VBase
    await ctx.clients.vbase.saveJSON(VBASE_BUCKET, sessionId, session);

    const cart = mapOrderFormToCart(orderForm);
    const workspace = ctx.vtex.workspace || 'master';
    const host = workspace === 'master'
      ? `${ctx.vtex.account}.myvtex.com`
      : `${workspace}--${ctx.vtex.account}.myvtex.com`;

    // Redirect URL: sets cookie + redirects to VTEX native checkout
    const checkoutRedirectUrl = `https://${host}/_v/acg/checkout/redirect/${sessionId}`;

    // Direct VTEX checkout URL (fallback if redirect doesn't work)
    const checkoutDirectUrl = `https://${host}/checkout/?orderFormId=${orderFormId}#/cart`;

    const response = {
      sessionId,
      checkoutUrl: checkoutRedirectUrl,
      directCheckoutUrl: checkoutDirectUrl,
      expiresAt: new Date(session.expiresAt).toISOString(),
      cart: {
        total: cart.total,
        currency: cart.currency,
        itemCount: cart.itemCount,
      },
      message: 'Click the checkout link to complete your purchase.',
    };

    console.log('[ACG Checkout] INITIATE Response:', JSON.stringify(response, null, 2));
    ctx.body = response;
  } catch (error) {
    console.error('[ACG Checkout] Initiate error:', error);
    ctx.status = 500;
    ctx.body = {
      error: 'Failed to initiate checkout',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * GET /_v/acg/checkout/redirect/:sessionId
 * Set the checkout.vtex.com cookie and redirect to VTEX native checkout.
 * This is the recommended way to hand off from agent to human checkout.
 */
export async function redirectToCheckout(ctx: Context) {
  try {
    const sessionId = ctx.vtex.route?.params?.sessionId ?? ctx.params?.sessionId;

    if (!sessionId) {
      ctx.status = 400;
      ctx.body = 'Missing session ID.';
      return;
    }

    // Get session from VBase
    let session: CheckoutSession;
    try {
      session = await ctx.clients.vbase.getJSON(VBASE_BUCKET, sessionId, true);
    } catch {
      ctx.status = 404;
      ctx.body = 'Checkout session not found or expired.';
      return;
    }

    // Check expiration
    if (Date.now() > session.expiresAt) {
      ctx.status = 410;
      ctx.body = 'This checkout session has expired. Please start a new checkout.';
      return;
    }

    const { orderFormId } = session;

    // Set the checkout.vtex.com cookie so VTEX native checkout loads this cart
    ctx.cookies.set('checkout.vtex.com', `__ofid=${orderFormId}`, {
      httpOnly: false,
      secure: true,
      path: '/',
    });

    console.log(`[ACG Checkout] Redirecting to VTEX checkout with orderFormId: ${orderFormId}`);

    // Redirect to VTEX native checkout with orderFormId as query param (belt-and-suspenders)
    const workspace = ctx.vtex.workspace || 'master';
    const host = workspace === 'master'
      ? `${ctx.vtex.account}.myvtex.com`
      : `${workspace}--${ctx.vtex.account}.myvtex.com`;

    ctx.redirect(`https://${host}/checkout/?orderFormId=${orderFormId}#/cart`);
    ctx.status = 302;
  } catch (error) {
    console.error('Checkout redirect error:', error);
    ctx.status = 500;
    ctx.body = 'An error occurred redirecting to checkout.';
  }
}

/**
 * GET /_v/acg/checkout/pay/:sessionId
 * Render the payment page HTML (legacy — kept as fallback)
 */
export async function renderPaymentPage(ctx: Context) {
  try {
    const sessionId = ctx.vtex.route?.params?.sessionId ?? ctx.params?.sessionId;

    if (!sessionId) {
      ctx.status = 400;
      ctx.body = 'Missing session ID.';
      return;
    }

    // Get session from VBase
    let session: CheckoutSession;
    try {
      session = await ctx.clients.vbase.getJSON(VBASE_BUCKET, sessionId, true);
    } catch {
      ctx.status = 404;
      ctx.body = 'Checkout session not found or expired.';
      return;
    }

    // Check expiration
    if (Date.now() > session.expiresAt) {
      ctx.status = 410;
      ctx.body = 'This checkout session has expired. Please start a new checkout.';
      return;
    }

    // Check status
    if (session.status === 'completed') {
      ctx.status = 200;
      ctx.type = 'text/html';
      ctx.body = renderConfirmationPage(session.orderId || 'Unknown');
      return;
    }

    // Get cart details
    const orderForm = await ctx.clients.checkout.getOrderForm(session.orderFormId);
    const cart = mapOrderFormToCart(orderForm);

    ctx.type = 'text/html';
    ctx.body = renderPaymentPageHTML(cart, sessionId, ctx.vtex.account);
  } catch (error) {
    console.error('Render payment page error:', error);
    ctx.status = 500;
    ctx.body = 'An error occurred loading the payment page.';
  }
}

/**
 * POST /_v/acg/checkout/execute/:sessionId
 * Execute the payment and create order using VTEX headless checkout flow
 *
 * Request body should include:
 * - customerData: { email, firstName, lastName, document, phone }
 * - shippingAddress: { postalCode, city, state, country, street, number, neighborhood, receiverName }
 * - paymentData: { paymentSystem, installments, cardNumber, cardHolder, cardExpiration, cardCvv }
 */
export async function executeCheckout(ctx: Context) {
  try {
    const sessionId = ctx.vtex.route?.params?.sessionId ?? ctx.params?.sessionId;
    let body: CheckoutExecuteRequest | undefined;
    try {
      body = await json(ctx.req);
    } catch {
      // No body provided - will use demo mode
    }

    // Get session from VBase
    let session: CheckoutSession;
    try {
      session = await ctx.clients.vbase.getJSON(VBASE_BUCKET, sessionId, true);
    } catch {
      ctx.status = 404;
      ctx.body = { success: false, error: 'Checkout session not found' };
      return;
    }

    // Check expiration
    if (Date.now() > session.expiresAt) {
      ctx.status = 410;
      ctx.body = { success: false, error: 'Checkout session expired' };
      return;
    }

    // Check status
    if (session.status !== 'pending') {
      ctx.status = 400;
      ctx.body = {
        success: false,
        error: `Checkout already ${session.status}`,
        orderId: session.orderId,
      };
      return;
    }

    // Update status to processing
    session.status = 'processing';
    await ctx.clients.vbase.saveJSON(VBASE_BUCKET, sessionId, session);

    const { checkout, payments } = ctx.clients;
    const { orderFormId } = session;

    try {
      // For demo mode (no real payment data), simulate order creation
      if (!body?.customerData || !body?.paymentData) {
        // Demo mode - simulate order
        const orderId = `ACG-DEMO-${Date.now()}`;
        session.status = 'completed';
        session.orderId = orderId;
        await ctx.clients.vbase.saveJSON(VBASE_BUCKET, sessionId, session);

        ctx.body = {
          success: true,
          orderId,
          message: 'Demo order placed successfully!',
          note: 'This is a simulated order. Provide customerData and paymentData for real checkout.',
        };
        return;
      }

      // Step 1: Add client profile data
      await checkout.addClientProfileData(orderFormId, {
        email: body.customerData.email,
        firstName: body.customerData.firstName,
        lastName: body.customerData.lastName,
        documentType: body.customerData.documentType || 'cpf',
        document: body.customerData.document,
        phone: body.customerData.phone,
        isCorporate: false,
      });

      // Step 2: Add shipping data
      if (body.shippingAddress) {
        const orderForm = await checkout.getOrderForm(orderFormId);
        const logisticsInfo = orderForm.items.map((_, index) => ({
          itemIndex: index,
          selectedSla: body.shippingAddress?.selectedSla || 'Normal',
          selectedDeliveryChannel: 'delivery',
        }));

        await checkout.addShippingData(orderFormId, {
          clearAddressIfPostalCodeNotFound: false,
          selectedAddresses: [
            {
              addressType: 'residential',
              receiverName: body.shippingAddress.receiverName || `${body.customerData.firstName} ${body.customerData.lastName}`,
              postalCode: body.shippingAddress.postalCode,
              city: body.shippingAddress.city,
              state: body.shippingAddress.state,
              country: body.shippingAddress.country || 'BRA',
              street: body.shippingAddress.street,
              number: body.shippingAddress.number,
              neighborhood: body.shippingAddress.neighborhood,
              complement: body.shippingAddress.complement,
            },
          ],
          logisticsInfo,
        });
      }

      // Step 3: Add payment data to orderForm
      const currentOrderForm = await checkout.getOrderForm(orderFormId);
      const orderValue = currentOrderForm.value;

      await checkout.addPaymentData(orderFormId, {
        payments: [
          {
            paymentSystem: body.paymentData.paymentSystem || 2, // Default to credit card
            installments: body.paymentData.installments || 1,
            referenceValue: orderValue,
            value: orderValue,
          },
        ],
      });

      // Step 4: Place order (create transaction)
      const referenceId = `ACG-${sessionId.substring(0, 8)}`;
      const placeOrderResponse = await checkout.placeOrder(orderFormId, referenceId, false);

      const order = placeOrderResponse.orders[0];
      const transactionId = placeOrderResponse.transactionData?.merchantTransactions?.[0]?.transactionId;

      if (!transactionId) {
        throw new Error('No transaction ID received from place order');
      }

      // Step 5: Send payment to gateway
      const merchantTransaction = placeOrderResponse.transactionData.merchantTransactions[0];
      await payments.sendPayments(transactionId, [
        {
          paymentSystem: body.paymentData.paymentSystem || 2,
          paymentSystemName: 'Visa', // This should come from the payment system config
          group: 'creditCard',
          installments: body.paymentData.installments || 1,
          installmentsInterestRate: 0,
          installmentsValue: orderValue,
          value: orderValue,
          referenceValue: orderValue,
          fields: {
            holderName: body.paymentData.cardHolder,
            cardNumber: body.paymentData.cardNumber,
            validationCode: body.paymentData.cardCvv,
            dueDate: body.paymentData.cardExpiration, // MM/YY format
          },
          transaction: {
            id: transactionId,
            merchantName: merchantTransaction.merchantName,
          },
        },
      ]);

      // Step 6: Authorize payment
      const authResponse = await payments.authorizeTransaction(
        transactionId,
        order.orderId
      );

      // Update session with success
      session.status = 'completed';
      session.orderId = order.orderId;
      await ctx.clients.vbase.saveJSON(VBASE_BUCKET, sessionId, session);

      ctx.body = {
        success: true,
        orderId: order.orderId,
        orderGroup: placeOrderResponse.orderGroup,
        transactionId,
        status: authResponse.status,
        message: 'Order placed successfully!',
      };
    } catch (checkoutError) {
      // Revert session status on failure
      session.status = 'failed';
      session.error = checkoutError instanceof Error ? checkoutError.message : 'Checkout failed';
      await ctx.clients.vbase.saveJSON(VBASE_BUCKET, sessionId, session);

      throw checkoutError;
    }
  } catch (error) {
    console.error('Execute checkout error:', error);
    ctx.status = 500;
    ctx.body = {
      success: false,
      error: 'Failed to execute checkout',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * GET /_v/acg/orders/:orderId
 * Get order status
 */
export async function getOrderStatus(ctx: Context) {
  try {
    const orderId = ctx.vtex.route?.params?.orderId ?? ctx.params?.orderId;

    // TODO: Implement actual VTEX OMS lookup
    // For demo, return mock data

    ctx.body = {
      orderId,
      status: 'payment-approved',
      total: 159.99,
      createdAt: new Date().toISOString(),
      message: 'Order is being processed',
    };
  } catch (error) {
    console.error('Get order status error:', error);
    ctx.status = 500;
    ctx.body = {
      error: 'Failed to get order status',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// HTML rendering helpers

function renderPaymentPageHTML(
  cart: ReturnType<typeof mapOrderFormToCart>,
  sessionId: string,
  _account: string
): string {
  const itemsHtml = cart.items
    .map(
      (item) => `
      <div class="item">
        <span class="item-name">${item.name} &times; ${item.quantity}</span>
        <span class="item-price">$${item.totalPrice.toFixed(2)}</span>
      </div>
    `
    )
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Complete Your Purchase</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 420px;
      width: 100%;
      overflow: hidden;
    }
    .header {
      background: #1a1a2e;
      color: white;
      padding: 24px;
      text-align: center;
    }
    .header h1 {
      font-size: 20px;
      font-weight: 600;
    }
    .header p {
      font-size: 14px;
      opacity: 0.8;
      margin-top: 4px;
    }
    .content {
      padding: 24px;
    }
    .section-title {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #666;
      margin-bottom: 12px;
    }
    .cart-summary {
      background: #f8f9fa;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 20px;
    }
    .item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #eee;
    }
    .item:last-child {
      border-bottom: none;
    }
    .item-name {
      color: #333;
      font-size: 14px;
    }
    .item-price {
      color: #333;
      font-weight: 600;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      padding: 16px 0 0;
      margin-top: 12px;
      border-top: 2px solid #1a1a2e;
    }
    .total-label {
      font-size: 16px;
      font-weight: 600;
    }
    .total-amount {
      font-size: 24px;
      font-weight: 700;
      color: #1a1a2e;
    }
    .pay-button {
      width: 100%;
      padding: 18px;
      font-size: 16px;
      font-weight: 600;
      color: white;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border: none;
      border-radius: 12px;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .pay-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
    }
    .pay-button:disabled {
      opacity: 0.7;
      cursor: not-allowed;
      transform: none;
    }
    .secure-note {
      text-align: center;
      margin-top: 16px;
      font-size: 12px;
      color: #888;
    }
    .secure-note span {
      color: #28a745;
    }
    .success-container {
      text-align: center;
      padding: 40px;
    }
    .success-icon {
      font-size: 64px;
      margin-bottom: 16px;
    }
    .error-message {
      background: #fee;
      color: #c00;
      padding: 12px;
      border-radius: 8px;
      margin-top: 16px;
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Complete Your Purchase</h1>
      <p>Powered by Agent Commerce Gateway</p>
    </div>

    <div class="content" id="checkout-content">
      <div class="section-title">Order Summary</div>
      <div class="cart-summary">
        ${itemsHtml}
        <div class="total-row">
          <span class="total-label">Total</span>
          <span class="total-amount">$${cart.total.toFixed(2)}</span>
        </div>
      </div>

      <button class="pay-button" id="pay-btn" onclick="completePurchase()">
        Pay $${cart.total.toFixed(2)}
      </button>

      <div class="error-message" id="error-msg"></div>

      <p class="secure-note">
        <span>&#128274;</span> Secured checkout
      </p>
    </div>
  </div>

  <script>
    async function completePurchase() {
      const btn = document.getElementById('pay-btn');
      const errorMsg = document.getElementById('error-msg');

      btn.textContent = 'Processing...';
      btn.disabled = true;
      errorMsg.style.display = 'none';

      try {
        const response = await fetch('/_v/acg/checkout/execute/${sessionId}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        const result = await response.json();

        if (result.success) {
          document.getElementById('checkout-content').innerHTML = \`
            <div class="success-container">
              <div class="success-icon">&#10004;</div>
              <h2>Order Confirmed!</h2>
              <p style="margin-top: 16px; color: #666;">
                Order ID: <strong>\${result.orderId}</strong>
              </p>
              <p style="margin-top: 8px; color: #666;">
                Thank you for your purchase.
              </p>
            </div>
          \`;
        } else {
          throw new Error(result.error || 'Payment failed');
        }
      } catch (error) {
        btn.textContent = 'Pay $${cart.total.toFixed(2)}';
        btn.disabled = false;
        errorMsg.textContent = error.message;
        errorMsg.style.display = 'block';
      }
    }
  </script>
</body>
</html>
  `;
}

function renderConfirmationPage(orderId: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order Confirmed</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 48px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .icon { font-size: 64px; margin-bottom: 16px; }
    h1 { color: #1a1a2e; margin-bottom: 8px; }
    p { color: #666; }
    strong { color: #1a1a2e; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#10004;</div>
    <h1>Order Confirmed!</h1>
    <p>Order ID: <strong>${orderId}</strong></p>
    <p style="margin-top: 16px;">Thank you for your purchase.</p>
  </div>
</body>
</html>
  `;
}
