/**
 * Fetch HTTP Client Adapter
 *
 * Default `HttpClientPort` implementation over the global `fetch` (Node 18+).
 * The `fetch` reference is injectable so tests can pass a stub and a future
 * host can wrap it with retries / rate-limiting without changing the client.
 *
 * Binary responses (PDF labels) are returned as `Uint8Array`, but an error
 * status on a binary request is re-read as JSON so the error body survives.
 *
 * @module adapters
 */

import type {
  HttpClientPort,
  HttpRequest,
  HttpResponse,
} from '../domain/ports/http-client.port.ts';

type FetchLike = typeof fetch;

export class FetchHttpClientAdapter implements HttpClientPort {
  readonly #fetch: FetchLike;

  constructor(fetchImpl: FetchLike = globalThis.fetch) {
    if (typeof fetchImpl !== 'function') {
      throw new Error('FetchHttpClientAdapter: no fetch implementation available');
    }
    this.#fetch = fetchImpl;
  }

  async send<T>(request: HttpRequest): Promise<HttpResponse<T>> {
    const responseType = request.responseType ?? 'json';
    const res = await this.#fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });

    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });

    let body: unknown;
    if (responseType === 'binary' && res.ok) {
      body = new Uint8Array(await res.arrayBuffer());
    } else {
      const text = await res.text();
      if (responseType === 'text') {
        body = text;
      } else {
        body = text.length > 0 ? safeJsonParse(text) : null;
      }
    }

    return { status: res.status, headers, body: body as T };
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
