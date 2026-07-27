/**
 * Erli Fake HTTP Client (#991)
 *
 * Programmable in-process `IErliHttpClient` for the Erli offers vertical-slice
 * int-spec. Faking at the HTTP-transport seam (not the adapter seam) keeps the
 * REAL `ErliOfferManagerAdapter` under test — its `buildCreateBody`, sparse
 * PATCH, frozen-field suppression, variant-group emission, and status mapping
 * all execute, which is exactly what #991 must verify (plan §3, A1).
 *
 * Behaviour:
 *   - records every request as `{ method, path, body }` into `calls[]` so a spec
 *     can assert the wire shape the adapter sent;
 *   - `get` resolves a per-path scripted GET response — either a sticky product
 *     set via `setProduct(externalId, resource)` or a sequenced queue via
 *     `enqueueGet(externalId, [r1, r2, …])` (consumed in order, modelling Erli's
 *     async-settle without any fake timer);
 *   - `rejectNext(status, body?)` arms a one-shot rejection that throws the SAME
 *     typed `ErliApiException(message, statusCode, responseBody, url)` the real
 *     client raises for a deterministic 4xx, so the adapter's
 *     `instanceof ErliApiException` + `statusCode === 404` branches fire;
 *   - `post`/`patch` resolve to a 202-equivalent success unless a rejection is
 *     armed (Erli's accepted-write model, ADR-025).
 *
 * The bearer credential is closed over inside the REAL client in production and
 * never reaches this fake — the spec asserts only paths/bodies, never headers.
 *
 * @module apps/api/test/integration/helpers
 */
import { ErliApiException } from '@openlinker/integrations-erli';
import type { ErliProductResource } from '@openlinker/integrations-erli/infrastructure/adapters/erli-product.types';
import type { IErliHttpClient } from '@openlinker/integrations-erli/infrastructure/http/erli-http-client.interface';
import type {
  ErliHttpResponse,
  ErliRequestOptions,
} from '@openlinker/integrations-erli/infrastructure/http/erli-http-client.types';

/** One recorded outbound request. */
export interface RecordedErliCall {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  path: string;
  body?: unknown;
}

/** A one-shot armed rejection. */
interface ArmedRejection {
  status: number;
  body?: string;
}

export class ErliFakeHttpClient implements IErliHttpClient {
  /** Every outbound request, in call order. Assert against this. */
  readonly calls: RecordedErliCall[] = [];

  /** Sticky GET responses keyed by request path (`products/{encoded}`). */
  private readonly stickyByPath = new Map<string, unknown>();

  /** Sequenced GET responses keyed by request path; shift one per `get`. */
  private readonly queuedByPath = new Map<string, unknown[]>();

  /** Armed one-shot rejections (FIFO) applied to the next request of any kind. */
  private readonly rejections: ArmedRejection[] = [];

  /**
   * Register a sticky GET body for an offer id. Every `get` for this id returns
   * it (unless a sequenced response is queued, which wins). Pass `undefined` to
   * model a bodyless 2xx.
   */
  setProduct(externalId: string, resource: Partial<ErliProductResource> | undefined): void {
    this.stickyByPath.set(this.pathFor(externalId), resource);
  }

  /**
   * Queue an ordered sequence of GET bodies for an offer id (async-settle
   * modelling). Each `get` shifts the next entry; once drained, falls back to a
   * sticky product (if any). Replaces any previously-queued sequence for the id.
   */
  enqueueGet(externalId: string, responses: Array<Partial<ErliProductResource> | undefined>): void {
    this.queuedByPath.set(this.pathFor(externalId), [...responses]);
  }

  /**
   * Register a sticky GET body keyed by the LITERAL request path (#998). Unlike
   * `setProduct`/`enqueueGet` (which key by the offer `products/{id}` convention
   * via the private `pathFor`), the OrderSource adapter requests `/inbox` (inbox
   * listing) and `/orders/{id}` (order resource) — paths the offer-convention
   * keying cannot address. Use this to script those raw paths. The offer methods
   * are deliberately left untouched so the #991 offers int-spec stays green.
   */
  setRawGet(path: string, body: unknown): void {
    this.stickyByPath.set(path, body);
  }

  /**
   * Arm a one-shot rejection for the NEXT request (any method). Throws the same
   * typed `ErliApiException` the real client raises for a deterministic 4xx, so
   * the adapter's failure-mapping branches are exercised.
   */
  rejectNext(status: number, body?: string): void {
    this.rejections.push({ status, body });
  }

  get<T>(path: string, _options?: ErliRequestOptions): Promise<ErliHttpResponse<T>> {
    this.calls.push({ method: 'GET', path });
    this.throwIfArmed(path);

    const queue = this.queuedByPath.get(path);
    if (queue !== undefined && queue.length > 0) {
      const next = queue.shift();
      return Promise.resolve({ status: 200, data: next as T });
    }
    if (this.stickyByPath.has(path)) {
      return Promise.resolve({ status: 200, data: this.stickyByPath.get(path) as T });
    }
    // No script for this path: a real Erli GET of an unknown product 404s. Model
    // it as the typed exception so the adapter's 404 branch fires.
    return Promise.reject(new ErliApiException(`Erli fake: no product for ${path}`, 404, undefined, path));
  }

  post<T>(path: string, body?: unknown, _options?: ErliRequestOptions): Promise<ErliHttpResponse<T>> {
    this.calls.push({ method: 'POST', path, body });
    this.throwIfArmed(path);
    // Erli accepted-write: 202, no read-after-write body (ADR-025).
    return Promise.resolve({ status: 202, data: undefined as T });
  }

  patch<T>(path: string, body?: unknown, _options?: ErliRequestOptions): Promise<ErliHttpResponse<T>> {
    this.calls.push({ method: 'PATCH', path, body });
    this.throwIfArmed(path);
    return Promise.resolve({ status: 202, data: undefined as T });
  }

  put<T>(path: string, body?: unknown, _options?: ErliRequestOptions): Promise<ErliHttpResponse<T>> {
    this.calls.push({ method: 'PUT', path, body });
    this.throwIfArmed(path);
    // Erli accepted-write: 202, no read-after-write body (ADR-025). Used by the
    // #996 webhook provisioner (PUT /hooks) and any idempotent upsert.
    return Promise.resolve({ status: 202, data: undefined as T });
  }

  /** Recorded calls of a single method, in order. */
  callsOf(method: 'GET' | 'POST' | 'PATCH' | 'PUT'): RecordedErliCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  /** Drop all recorded calls + scripted state. */
  reset(): void {
    this.calls.length = 0;
    this.stickyByPath.clear();
    this.queuedByPath.clear();
    this.rejections.length = 0;
  }

  private throwIfArmed(path: string): void {
    const armed = this.rejections.shift();
    if (armed !== undefined) {
      throw new ErliApiException(
        `Erli fake: scripted rejection (HTTP ${armed.status})`,
        armed.status,
        armed.body,
        path,
      );
    }
  }

  private pathFor(externalId: string): string {
    // Mirror the adapter's `productPath` encoding so a `setProduct`/`enqueueGet`
    // key matches the path the adapter actually requests.
    return `products/${encodeURIComponent(externalId)}`;
  }
}
