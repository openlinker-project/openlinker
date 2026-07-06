/**
 * Infakt HTTP Client
 *
 * Thin fetch wrapper for Infakt REST API v3. Attaches the `X-inFakt-ApiKey`
 * header on every request. Throws `InfaktApiError` on non-2xx responses so the
 * adapter can distinguish transport errors from provider rejections.
 *
 * @module libs/integrations/infakt/src/infrastructure/http
 * @implements {IInfaktHttpClient}
 */
import type { LoggerPort } from '@openlinker/shared/logging';
import { InfaktApiError } from '../../domain/exceptions/infakt-api.error';
import type { IInfaktHttpClient, InfaktBinaryResponse } from './infakt-http-client.interface';

export interface InfaktHttpClientConfig {
  apiKey: string;
  baseUrl?: string;
}

export const INFAKT_DEFAULT_BASE_URL = 'https://api.infakt.pl/api/v3';

/**
 * Cap on a binary response body (e.g. an invoice PDF). Mirrors the KSeF HTTP
 * client's `MAX_BINARY_RESPONSE_BYTES` — the running total is enforced as
 * chunks stream in, so an oversized or mendacious `Content-Length` can't
 * drive an unbounded buffered read into memory.
 */
const MAX_BINARY_RESPONSE_BYTES = 10 * 1024 * 1024;

export class InfaktHttpClient implements IInfaktHttpClient {
  private readonly baseUrl: string;

  constructor(
    private readonly config: InfaktHttpClientConfig,
    private readonly logger: LoggerPort,
  ) {
    this.baseUrl = config.baseUrl?.replace(/\/$/, '') ?? INFAKT_DEFAULT_BASE_URL;
  }

  async get<T>(path: string, query?: Record<string, string>): Promise<T> {
    const url = this.buildUrl(path, query);
    const res = await fetch(url, { headers: this.headers() });
    return this.parse<T>(res, 'GET', path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const url = this.buildUrl(path);
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.parse<T>(res, 'POST', path);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    const url = this.buildUrl(path);
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.parse<T>(res, 'PUT', path);
  }

  async getBinary(path: string, query?: Record<string, string>): Promise<InfaktBinaryResponse> {
    const url = this.buildUrl(path, query);
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`Infakt API GET ${path} → ${res.status}`);
      throw new InfaktApiError(
        `Infakt API GET ${path} failed with status ${res.status}`,
        res.status,
        text,
      );
    }
    const data = await this.readBinaryBodyCapped(res, url);
    return { data, contentType: res.headers.get('content-type') ?? '' };
  }

  private async readBinaryBodyCapped(res: Response, url: string): Promise<Uint8Array> {
    const body = res.body;
    if (!body) {
      return new Uint8Array(0);
    }
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BINARY_RESPONSE_BYTES) {
        await reader.cancel();
        throw new InfaktApiError(
          `Infakt binary response for ${url} exceeds the ${MAX_BINARY_RESPONSE_BYTES}-byte cap`,
          res.status,
          null,
        );
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  private buildUrl(path: string, query?: Record<string, string>): string {
    const base = `${this.baseUrl}/${path.replace(/^\//, '')}`;
    if (!query || Object.keys(query).length === 0) return base;
    return `${base}?${new URLSearchParams(query).toString()}`;
  }

  private headers(): Record<string, string> {
    return { 'X-inFakt-ApiKey': this.config.apiKey };
  }

  private async parse<T>(res: Response, method: string, path: string): Promise<T> {
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new InfaktApiError(
        `Infakt API ${method} ${path} returned non-JSON (${res.status})`,
        res.status,
        text,
      );
    }
    if (!res.ok) {
      // Don't log the response body — Infakt error payloads can echo back
      // buyer PII (name, NIP, address) submitted in the request. The full
      // body still reaches the caller via InfaktApiError.responseBody.
      this.logger.warn(`Infakt API ${method} ${path} → ${res.status}`);
      throw new InfaktApiError(
        `Infakt API ${method} ${path} failed with status ${res.status}`,
        res.status,
        json,
      );
    }
    return json as T;
  }
}
