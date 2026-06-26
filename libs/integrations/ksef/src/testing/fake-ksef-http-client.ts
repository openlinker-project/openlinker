/**
 * Fake KSeF HTTP Client — test double
 *
 * In-memory `IKsefHttpClient` for service/adapter unit specs: seed a response
 * per `METHOD path` key and play it back, recording calls for assertions. No
 * real `fetch`, no auth, no retries. Consumed only from `*.spec.ts`.
 *
 * Kept off the main barrel (exposed via `@openlinker/integrations-ksef/testing`)
 * so test-only logic never enters the runtime bundle.
 *
 * @module libs/integrations/ksef/src/testing
 */
import type { IKsefHttpClient } from '../infrastructure/http/ksef-http-client.interface';
import type {
  KsefBinaryResponse,
  KsefHttpRequestOptions,
  KsefHttpResponse,
} from '../infrastructure/http/ksef-http-client.types';

interface RecordedCall {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  options?: KsefHttpRequestOptions;
}

export class FakeKsefHttpClient implements IKsefHttpClient {
  readonly calls: RecordedCall[] = [];
  private readonly jsonResponses = new Map<string, KsefHttpResponse<unknown>>();
  private readonly binaryResponses = new Map<string, KsefBinaryResponse>();

  /** Seed a JSON response for `GET path` / `POST path`. */
  seed(method: 'GET' | 'POST', path: string, response: KsefHttpResponse<unknown>): this {
    this.jsonResponses.set(this.key(method, path), response);
    return this;
  }

  /** Seed a binary response for `POST path` (postExpectingBinary). */
  seedBinary(path: string, response: KsefBinaryResponse): this {
    this.binaryResponses.set(this.key('POST', path), response);
    return this;
  }

  clear(): void {
    this.calls.length = 0;
    this.jsonResponses.clear();
    this.binaryResponses.clear();
  }

  get<T = unknown>(path: string, options?: KsefHttpRequestOptions): Promise<KsefHttpResponse<T>> {
    this.calls.push({ method: 'GET', path, options });
    return Promise.resolve(this.lookup<T>('GET', path));
  }

  post<T = unknown>(
    path: string,
    body?: Record<string, unknown> | string,
    options?: KsefHttpRequestOptions,
  ): Promise<KsefHttpResponse<T>> {
    this.calls.push({ method: 'POST', path, body, options });
    return Promise.resolve(this.lookup<T>('POST', path));
  }

  postExpectingBinary(
    path: string,
    body?: Record<string, unknown> | string,
    options?: KsefHttpRequestOptions,
  ): Promise<KsefBinaryResponse> {
    this.calls.push({ method: 'POST', path, body, options });
    const response = this.binaryResponses.get(this.key('POST', path));
    if (!response) {
      return Promise.reject(new Error(`FakeKsefHttpClient: no binary response seeded for POST ${path}`));
    }
    return Promise.resolve(response);
  }

  private lookup<T>(method: 'GET' | 'POST', path: string): KsefHttpResponse<T> {
    const response = this.jsonResponses.get(this.key(method, path));
    if (!response) {
      throw new Error(`FakeKsefHttpClient: no response seeded for ${method} ${path}`);
    }
    return response as KsefHttpResponse<T>;
  }

  private key(method: 'GET' | 'POST', path: string): string {
    return `${method} ${path}`;
  }
}
