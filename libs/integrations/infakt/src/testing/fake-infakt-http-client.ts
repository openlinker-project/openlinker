/**
 * Fake Infakt HTTP Client — test double
 *
 * In-memory `IInfaktHttpClient` for adapter unit specs: seed a response (or a
 * rejection) per `METHOD path` key and play it back, recording calls for
 * assertions. No real `fetch`, no auth headers, no retries.
 *
 * Consumed only from `*.spec.ts`. Kept off the main barrel — importing it
 * from runtime code would pull test-only logic into the bundle.
 *
 * @module libs/integrations/infakt/src/testing
 */
import type { IInfaktHttpClient } from '../infrastructure/http/infakt-http-client.interface';

type HttpMethod = 'GET' | 'POST' | 'PUT';

interface RecordedCall {
  method: HttpMethod;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

type SeededResult<T> = { kind: 'resolve'; value: T } | { kind: 'reject'; error: Error };

export class FakeInfaktHttpClient implements IInfaktHttpClient {
  readonly calls: RecordedCall[] = [];
  private readonly responses = new Map<string, SeededResult<unknown>>();

  /** Seed a successful JSON response for `GET path` / `POST path` / `PUT path`. */
  seed<T>(method: HttpMethod, path: string, value: T): this {
    this.responses.set(this.key(method, path), { kind: 'resolve', value });
    return this;
  }

  /** Seed a rejection (e.g. `InfaktApiError`) for `GET path` / `POST path` / `PUT path`. */
  seedError(method: HttpMethod, path: string, error: Error): this {
    this.responses.set(this.key(method, path), { kind: 'reject', error });
    return this;
  }

  clear(): void {
    this.calls.length = 0;
    this.responses.clear();
  }

  get<T>(path: string, query?: Record<string, string>): Promise<T> {
    this.calls.push({ method: 'GET', path, query });
    return this.resolve<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    this.calls.push({ method: 'POST', path, body });
    return this.resolve<T>('POST', path);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    this.calls.push({ method: 'PUT', path, body });
    return this.resolve<T>('PUT', path);
  }

  private resolve<T>(method: HttpMethod, path: string): Promise<T> {
    const seeded = this.responses.get(this.key(method, path));
    if (!seeded) {
      return Promise.reject(
        new Error(`FakeInfaktHttpClient: no response seeded for ${method} ${path}`),
      );
    }
    return seeded.kind === 'resolve' ? Promise.resolve(seeded.value as T) : Promise.reject(seeded.error);
  }

  private key(method: HttpMethod, path: string): string {
    return `${method} ${path}`;
  }
}
