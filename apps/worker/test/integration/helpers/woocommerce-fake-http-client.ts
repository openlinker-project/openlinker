/**
 * WooCommerce Fake HTTP Client (#1498)
 *
 * Programmable in-process `IWooCommerceHttpClient` for the ShopProduct
 * inventory write-back vertical-slice int-spec. Faking at the HTTP-transport
 * seam (not the adapter seam) mirrors the Erli offers vertical-slice pattern
 * (#991, `erli-fake-http-client.ts`) — it keeps the REAL
 * `WooCommerceOfferManagerAdapter` under test (id validation, stock body
 * shape, 404-as-clean-skip) while avoiding a live WooCommerce Testcontainer,
 * which is unnecessary here since the vertical slice under test is the
 * fan-out → job → adapter-resolution composition, not the adapter's own
 * request-building logic (already unit-tested).
 *
 * @module apps/worker/test/integration/helpers
 */
import { WooCommerceHttpResponseException } from '@openlinker/integrations-woocommerce/infrastructure/http/woocommerce-http-response.exception';
import type { IWooCommerceHttpClient } from '@openlinker/integrations-woocommerce/infrastructure/http/woocommerce-http-client.interface';

/** One recorded outbound request. */
export interface RecordedWooCommerceCall {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
}

export class WooCommerceFakeHttpClient implements IWooCommerceHttpClient {
  /** Every outbound request, in call order. Assert against this. */
  readonly calls: RecordedWooCommerceCall[] = [];

  /** Paths that should reject the NEXT matching request with a 404 (stale mapping). */
  private readonly notFoundPaths = new Set<string>();

  /** Script a path to 404 on its next request (models a stale `ShopProduct` mapping). */
  rejectNotFound(path: string): void {
    this.notFoundPaths.add(path);
  }

  get<T>(path: string): Promise<T> {
    this.calls.push({ method: 'GET', path });
    return Promise.resolve(undefined as T);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    this.calls.push({ method: 'POST', path, body });
    return Promise.resolve(undefined as T);
  }

  put<T>(path: string, body: unknown): Promise<T> {
    this.calls.push({ method: 'PUT', path, body });
    if (this.notFoundPaths.has(path)) {
      this.notFoundPaths.delete(path);
      return Promise.reject(new WooCommerceHttpResponseException(404, 'Not Found'));
    }
    return Promise.resolve(undefined as T);
  }

  delete<T>(path: string): Promise<T> {
    this.calls.push({ method: 'DELETE', path });
    return Promise.resolve(undefined as T);
  }

  /** Recorded calls of a single method, in order. */
  callsOf(method: 'GET' | 'POST' | 'PUT' | 'DELETE'): RecordedWooCommerceCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  /** Drop all recorded calls + scripted state. */
  reset(): void {
    this.calls.length = 0;
    this.notFoundPaths.clear();
  }
}
