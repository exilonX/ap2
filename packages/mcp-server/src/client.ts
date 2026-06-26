/**
 * VTEX IO Service Client
 *
 * Makes HTTP calls to the VTEX IO adapter service.
 * Handles authentication, base URL construction, and session persistence.
 *
 * Session management: The client stores the orderFormId in memory and sends
 * it as an X-ACG-Order-Form-Id header with every request. This ensures the
 * same cart is used across all MCP tool calls within a Claude Desktop session.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';

interface VtexConfig {
  vtexAccount: string;
  vtexWorkspace: string;
  vtexAppKey?: string;
  vtexAppToken?: string;
  /**
   * Shared secret matching the adapter's `acgAuthToken` app setting.
   * Sent as X-ACG-Auth-Token on every request — the MCP server is
   * server-to-server (no Origin header), so this is the only path past
   * the adapter's requireOriginOrSecret middleware (issue 0010 item 5).
   */
  acgAuthToken?: string;
  /**
   * Per-USER identity that scopes the cart pointer (see `sharedOrderFormByUser`).
   * INTERIM: the capability token from the connector URL path
   * (`/mcp/<tenant>/<token>`); PHASE-2 OAuth will pass the validated `jwt.sub`
   * here instead — same plumbing, different source. Absent (stdio, tokenless
   * legacy URLs) → `_shared`, which reproduces the old per-tenant behavior.
   */
  userKey?: string;
}

// Process-wide counter so every VtexClient instance has a short, stable tag in
// the logs. Two different tags appearing for one conversation = two sessions =
// the cart-splitting bug.
let vtexClientSeq = 0;

// Per-USER cart pointer, keyed by `${account}/${workspace}:${userKey}` (see the
// ctor). Claude Desktop opens TWO MCP sessions per connection (observed: two
// `initialize`s ~2s apart — one for the request POSTs, one for the SSE stream),
// each with its OWN VtexClient. Keyed by session they'd split the cart in two:
// addToCart lands on session A's cart, getCart reads session B's empty cart.
//
// Both of a user's sessions are opened against the SAME connector URL, so both
// carry the SAME userKey (the URL path token) and converge on ONE cart — while
// two DIFFERENT users on the same tenant get DIFFERENT userKeys and stay
// isolated. That is the whole fix.
//
// Module-level on purpose: the pointer must outlive any single MCP session (and
// survive idle-session eviction) so the cart persists across a conversation.
// CONSTRAINT: in-memory ⇒ correct on a SINGLE node only (or token-sticky LB) and
// wiped on process restart. The durable version keys this by OAuth `sub` and
// backs it with VBase/Redis — see docs/REMOTE_MCP.md.
const sharedOrderFormByUser = new Map<string, string | null>();

export class VtexClient {
  private client: AxiosInstance;
  private readonly tag: string;
  private readonly userScopedKey: string;

  /**
   * The cart pointer lives per-user (shared across that user's sessions), not on
   * the instance — see `sharedOrderFormByUser`. These accessors let the rest of
   * the class (request interceptor, capture, clear/set) read and write it
   * transparently, so a user's two MCP sessions see the same cart.
   */
  private get orderFormId(): string | null {
    return sharedOrderFormByUser.get(this.userScopedKey) ?? null;
  }

  private set orderFormId(value: string | null) {
    sharedOrderFormByUser.set(this.userScopedKey, value);
  }

  constructor(config: VtexConfig) {
    this.tag = `vc${++vtexClientSeq}`;
    const userKey =
      config.userKey && config.userKey.trim() ? config.userKey.trim() : '_shared';
    this.userScopedKey = `${config.vtexAccount}/${config.vtexWorkspace}:${userKey}`;
    // eslint-disable-next-line no-console
    console.error(
      `[VtexClient ${this.tag}] created (account=${config.vtexAccount} ws=${config.vtexWorkspace} userKey=${userKey})`
    );
    const baseURL = `https://${config.vtexWorkspace}--${config.vtexAccount}.myvtex.com/_v/acg`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (config.vtexAppKey && config.vtexAppToken) {
      headers['X-VTEX-API-AppKey'] = config.vtexAppKey;
      headers['X-VTEX-API-AppToken'] = config.vtexAppToken;
    }

    if (config.acgAuthToken) {
      headers['X-ACG-Auth-Token'] = config.acgAuthToken;
    }

    this.client = axios.create({
      baseURL,
      headers,
      timeout: 30000,
    });

    // Request interceptor: inject session header
    this.client.interceptors.request.use((reqConfig) => {
      if (this.orderFormId) {
        reqConfig.headers['X-ACG-Order-Form-Id'] = this.orderFormId;
        // ALSO duplicate the id into the query string on reads. A `public`
        // GET route on VTEX IO is edge-cached BY URL, and the header above
        // does NOT vary the CDN cache key — so two concurrent users hitting
        // the same `/cart` URL get served the first one's cached cart. The
        // query string IS part of the cache key (that's how per-query search
        // caching works), so `?ofid=<id>` gives each cart its own cache entry
        // (and busts any stale bare-URL entry). The adapter reads this with
        // higher priority than the cookie. GET only — POST/PUT/DELETE are
        // never edge-cached, so they isolate already on the header alone.
        if ((reqConfig.method ?? 'get').toLowerCase() === 'get') {
          reqConfig.params = {
            ...(reqConfig.params ?? {}),
            ofid: this.orderFormId,
          };
        }
      }
      // eslint-disable-next-line no-console
      console.error(
        `[VtexClient ${this.tag}] → ${(reqConfig.method ?? 'get').toUpperCase()} ${
          reqConfig.url
        } ofid=${this.orderFormId ?? '<none>'}`
      );
      return reqConfig;
    });

    // Response interceptor: capture orderFormId from response body
    this.client.interceptors.response.use((response) => {
      this.captureOrderFormId(response.data);
      return response;
    });
  }

  /**
   * Capture orderFormId from response body if present.
   */
  private captureOrderFormId(data: unknown): void {
    const before = this.orderFormId;

    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (typeof obj.orderFormId === 'string') {
        this.orderFormId = obj.orderFormId;
      } else if (obj.cart && typeof obj.cart === 'object') {
        // Nested in cart (e.g. { cart: { id: "..." } }).
        const cart = obj.cart as Record<string, unknown>;
        if (typeof cart.id === 'string') {
          this.orderFormId = cart.id;
        }
      } else if (typeof obj.id === 'string' && 'items' in obj) {
        // Direct SimpleCart response (getCart returns cart directly).
        this.orderFormId = obj.id as string;
      }
    }

    if (this.orderFormId !== before) {
      // eslint-disable-next-line no-console
      console.error(
        `[VtexClient ${this.tag}] captured ofid ${before ?? '<none>'} -> ${this.orderFormId}`
      );
    }
  }

  /**
   * Format axios errors into readable messages.
   */
  private formatError(error: unknown): string {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      const statusText = error.response?.statusText;
      const body = error.response?.data;
      const message = typeof body === 'object' && body?.message
        ? body.message
        : typeof body === 'object' && body?.error
          ? body.error
          : statusText;
      return `VTEX API error: ${status} ${message}`;
    }
    return error instanceof Error ? error.message : 'Unknown error';
  }

  /**
   * GET request to VTEX IO service
   */
  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    try {
      const response = await this.client.get<T>(path, { params });
      return response.data;
    } catch (error) {
      throw new Error(this.formatError(error));
    }
  }

  /**
   * POST request to VTEX IO service
   */
  async post<T>(path: string, body?: unknown): Promise<T> {
    try {
      const response = await this.client.post<T>(path, body);
      return response.data;
    } catch (error) {
      throw new Error(this.formatError(error));
    }
  }

  /**
   * PUT request to VTEX IO service
   */
  async put<T>(path: string, body?: unknown): Promise<T> {
    try {
      const response = await this.client.put<T>(path, body);
      return response.data;
    } catch (error) {
      throw new Error(this.formatError(error));
    }
  }

  /**
   * DELETE request to VTEX IO service
   */
  async delete<T>(path: string): Promise<T> {
    try {
      const response = await this.client.delete<T>(path);
      return response.data;
    } catch (error) {
      throw new Error(this.formatError(error));
    }
  }

  /**
   * Get the base URL (for constructing payment page links)
   */
  getBaseUrl(): string {
    return this.client.defaults.baseURL || '';
  }

  /**
   * Forget the cached orderFormId so the next cart-modifying tool call
   * provisions a fresh VTEX orderForm.
   *
   * Why this exists: the MCP server is a long-lived child process of
   * Claude Desktop, not of any individual conversation. Without explicit
   * reset, an in-memory orderFormId leaks across chat conversations
   * within the same Claude Desktop launch. Callers reset after:
   *   - successful checkoutInChat (mandate signed → cart is committed)
   *   - successful executePayment (order placed)
   *   - explicit clearCart user action
   */
  clearOrderFormId(): void {
    this.orderFormId = null;
  }

  /**
   * Re-anchor the session to an explicit orderFormId.
   *
   * The checkout iframe is the authority on WHICH cart it is showing — it
   * was populated with a concrete cart id. When it drives the Pay Now chain
   * (placeOrder → sendPaymentInfo → authorizeTransaction) it passes that id
   * back, and the tools call this so the request carries the right cart in
   * the X-ACG-Order-Form-Id header — even if this client's in-memory id had
   * drifted to a stale cart (e.g. a different MCP session). Idempotent.
   */
  setOrderFormId(id: string): void {
    if (id) {
      this.orderFormId = id;
    }
  }

  /**
   * Returns the currently cached orderFormId, or null if none cached.
   * Useful for tools that want to display "starting a new cart" feedback.
   */
  getOrderFormId(): string | null {
    return this.orderFormId;
  }
}
