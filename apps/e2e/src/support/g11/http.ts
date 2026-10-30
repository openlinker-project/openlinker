/**
 * Raw HTTP client for the G11 suite (#3591)
 *
 * The shared `ApiClient` throws on a non-2xx and hides headers and bytes, and
 * G11 asserts exactly those: a 403 for a role, a `text/csv` content type, a
 * BOM, an `EXPORT_RANGE_TOO_WIDE` code. So this client returns the whole
 * response and never throws on status. One instance per role.
 *
 * @module support/g11
 */
import type { G11Credentials } from './setup';

export interface G11Response {
  status: number;
  ok: boolean;
  headers: Headers;
  buffer: Buffer;
  text: string;
  json<T>(): T;
}

export interface G11RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Extra headers (e.g. a bogus Accept). */
  headers?: Record<string, string>;
  timeoutMs?: number;
}

function withVersion(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return normalized.startsWith('/v1/') || normalized === '/v1' ? normalized : `/v1${normalized}`;
}

export function buildQuery(query: G11RequestOptions['query']): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text.length > 0 ? `?${text}` : '';
}

export class G11Http {
  private token: string | null = null;

  constructor(
    readonly baseUrl: string,
    private readonly credentials: G11Credentials,
  ) {}

  async login(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(this.credentials),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`G11 login failed for ${this.credentials.username}: HTTP ${response.status} ${raw}`);
    }
    const parsed = JSON.parse(raw) as { access_token: string };
    this.token = parsed.access_token;
  }

  static async as(baseUrl: string, credentials: G11Credentials): Promise<G11Http> {
    const client = new G11Http(baseUrl.replace(/\/$/, ''), credentials);
    await client.login();
    return client;
  }

  async request(
    method: string,
    path: string,
    options: G11RequestOptions = {},
    isRetry = false,
  ): Promise<G11Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);
    try {
      const headers: Record<string, string> = { Accept: '*/*', ...(options.headers ?? {}) };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(`${this.baseUrl}${withVersion(path)}${buildQuery(options.query)}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      if (response.status === 401 && !isRetry) {
        await response.arrayBuffer();
        await this.login();
        return await this.request(method, path, options, true);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const text = buffer.toString('utf8');
      return {
        status: response.status,
        ok: response.ok,
        headers: response.headers,
        buffer,
        text,
        json: <T>(): T => JSON.parse(text) as T,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Read a response as a stream and report when the first chunk arrived and
   * when the last did. A streamed export shows a first byte long before the
   * end; a buffered one shows both at nearly the same moment.
   */
  async streamTiming(
    path: string,
    options: G11RequestOptions = {},
  ): Promise<{ status: number; ttfbMs: number; totalMs: number; bytes: number; chunks: number }> {
    const started = Date.now();
    const headers: Record<string, string> = { Accept: '*/*' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await fetch(`${this.baseUrl}${withVersion(path)}${buildQuery(options.query)}`, { headers });
    const reader = response.body?.getReader();
    let ttfbMs = -1;
    let bytes = 0;
    let chunks = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (ttfbMs < 0) ttfbMs = Date.now() - started;
        bytes += value.byteLength;
        chunks += 1;
      }
    }
    return { status: response.status, ttfbMs, totalMs: Date.now() - started, bytes, chunks };
  }

  get(path: string, options?: G11RequestOptions): Promise<G11Response> {
    return this.request('GET', path, options);
  }

  patch(path: string, body: unknown): Promise<G11Response> {
    return this.request('PATCH', path, { body });
  }

  put(path: string, body: unknown): Promise<G11Response> {
    return this.request('PUT', path, { body });
  }
}

/** The role-keyed clients a spec uses, built once per worker. */
export type G11Clients = Record<'admin' | 'operator' | 'viewer' | 'packer', G11Http>;
