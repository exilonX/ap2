/**
 * VTEX IO Service Client
 *
 * Makes HTTP calls to the VTEX IO adapter service.
 * Handles authentication and base URL construction.
 */

interface VtexConfig {
  vtexAccount: string;
  vtexWorkspace: string;
  vtexAppKey?: string;
  vtexAppToken?: string;
}

export class VtexClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(config: VtexConfig) {
    // VTEX IO service URL pattern
    this.baseUrl = `https://${config.vtexWorkspace}--${config.vtexAccount}.myvtex.com/_v/acg`;

    this.headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    // Add auth headers if provided
    if (config.vtexAppKey && config.vtexAppToken) {
      this.headers['X-VTEX-API-AppKey'] = config.vtexAppKey;
      this.headers['X-VTEX-API-AppToken'] = config.vtexAppToken;
    }
  }

  /**
   * GET request to VTEX IO service
   */
  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`VTEX API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * POST request to VTEX IO service
   */
  async post<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`VTEX API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * DELETE request to VTEX IO service
   */
  async delete<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`VTEX API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get the base URL (for constructing payment page links)
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}
