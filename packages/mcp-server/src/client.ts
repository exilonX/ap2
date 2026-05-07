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
}

export class VtexClient {
  private client: AxiosInstance;
  private orderFormId: string | null = null;

  constructor(config: VtexConfig) {
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
      }
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
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (typeof obj.orderFormId === 'string') {
        this.orderFormId = obj.orderFormId;
        return;
      }
      // Nested in cart (e.g. { cart: { id: "..." } }) or top-level { id: "..." }
      if (obj.cart && typeof obj.cart === 'object') {
        const cart = obj.cart as Record<string, unknown>;
        if (typeof cart.id === 'string') {
          this.orderFormId = cart.id;
        }
      } else if (typeof obj.id === 'string' && 'items' in obj) {
        // Direct SimpleCart response (getCart returns cart directly)
        this.orderFormId = obj.id as string;
      }
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
}
