/**
 * Subiekt Fiscalization Adapter (#3192-fiscalization)
 *
 * Implements the core `FiscalizationPort` (ADR-042) over a NEW, self-contained
 * HTTP call to the Windows bridge's `/api/fiscalize` route. Deliberately does
 * NOT reuse the `SubiektBridgeHttpClient` / `SubiektBridgeClient` WRAPPER
 * CLASSES (envelope parsing, base-URL prefixing, header building) - those are
 * the invoicing capability's shared surface, edited by a parallel worktree
 * build; this file owns its own small wire-protocol logic in `post()` so the
 * two capabilities never collide on one file. It STILL receives the exact
 * same connection-bound, rate-limited `FetchLike` every other Subiekt bridge
 * client for this connection receives (`fetchImpl` - the constructor's 4th
 * param, threaded verbatim from `SubiektAdapterFactory.createAdapters`'s own
 * `fetchImpl` argument, which is `host.http.forConnection(connection,
 * defaultRateLimit)` in `subiekt-plugin.ts`). `HttpTransportFactory.forConnection`
 * caches ONE `FetchLike` per connection id and keys its limiter on that same
 * id, so this adapter's `/api/fiscalize` POSTs share the identical
 * `maxConcurrent: 1` / `requestsPerMinute: 60` (and any operator
 * `config.rateLimit` override) limiter instance as the invoicing/inventory/
 * orders/product-master bridge clients for the same connection - they are not
 * a second, unpaced request stream (#3365 review). Mirrors
 * `SubiektInvoicingAdapter`'s error-translation shape.
 *
 * OpenLinker is a PURE MECHANISM here (ADR-042): it never deduplicates and
 * never decides what a rejection means beyond translating the bridge's answer
 * into the neutral vocabulary. The core `FiscalRegistrationService` owns the
 * exactly-once guarantee and the idempotency-key lease.
 *
 * UNVERIFIED LIVE (see this package's `docs/fiscalization-not-live-verified.md`
 * for the full account): this adapter was built without Windows/bridge access.
 * It has NOT been exercised against a running bridge or a physical fiscal
 * printer. Wire-format mismatches of the invoicing adapter's own kind
 * ("previous shapes were rejected with HTTP 400 after a live wire-test") are
 * therefore a known, likely, and NOT-YET-DISCOVERED risk here.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters
 */
import { randomUUID } from 'crypto';
import type { LoggerPort } from '@openlinker/shared/logging';
import type { FetchLike } from '@openlinker/shared/http';
import type {
  FiscalArtefact,
  FiscalizationPort,
  FiscalTransactionLine,
  RegisterTransactionCommand,
  RegisterTransactionResult,
} from '@openlinker/core/fiscalization';
import type {
  BridgeFiscalizeRequest,
  BridgeFiscalizeResponse,
} from '../../bridge/subiekt-bridge-fiscalization.types';
import type { SubiektFiscalizationConnectionConfig } from '../../domain/types/subiekt-fiscalization-connection-config.types';
import {
  SubiektBridgeUnreachableError,
  SubiektRejectedError,
} from '../../bridge/subiekt-bridge.errors';
import { SubiektBridgeTransportError } from '../../domain/exceptions/subiekt-bridge-transport.exception';
import { SubiektBridgeAuthError } from '../../domain/exceptions/subiekt-bridge-auth.exception';
import { SubiektConfigException } from '../../domain/exceptions/subiekt-config.exception';
import { isBridgeUrlSafe } from '../http/subiekt-url-safety';

/** Provider identifier stamped onto the neutral result (mirrors `SUBIEKT_PROVIDER_TYPE`). */
export const SUBIEKT_FISCAL_PROVIDER_TYPE = 'subiekt-gt';

const DEFAULT_TIMEOUT_MS = 30_000;

export class SubiektFiscalizationAdapter implements FiscalizationPort {
  constructor(
    private readonly bridgeBaseUrl: string,
    private readonly config: SubiektFiscalizationConnectionConfig,
    private readonly logger: LoggerPort,
    private readonly fetchImpl: FetchLike,
    private readonly token?: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {
    // Defense-in-depth SSRF guard, same predicate the invoicing transport uses.
    if (!isBridgeUrlSafe(bridgeBaseUrl)) {
      throw new SubiektConfigException(
        'bridgeBaseUrl is not a safe bridge address',
        'bridgeBaseUrl',
        bridgeBaseUrl,
      );
    }
  }

  /**
   * Register one completed sale (a fiscal receipt). See ADR-042: `idempotencyKey`
   * is mandatory on the command; it travels on the bridge request body so the
   * bridge's `FindByIdempotencyKey`-shaped dedup (mirroring the invoicing path)
   * can honour a retry with the SAME document rather than a second one.
   */
  async registerTransaction(cmd: RegisterTransactionCommand): Promise<RegisterTransactionResult> {
    const request: BridgeFiscalizeRequest = {
      idempotencyKey: cmd.idempotencyKey,
      orderId: cmd.orderId,
      currency: cmd.currency,
      lines: cmd.lines.map((line: FiscalTransactionLine) => ({
        ...(line.sku ? { towarSymbol: line.sku } : { nazwa: line.name }),
        ilosc: line.quantity,
        cenaBrutto: line.unitPriceGross,
        stawkaVAT: line.taxRate,
      })),
      drukarkaFiskalnaId: this.config.drukarkaFiskalnaId,
      ...(this.config.stanowiskoKasoweId !== undefined
        ? { stanowiskoKasoweId: this.config.stanowiskoKasoweId }
        : {}),
    };

    let response: BridgeFiscalizeResponse;
    try {
      response = await this.post('/api/fiscalize', request);
    } catch (error: unknown) {
      throw this.translateBridgeError(error);
    }

    if (response.status === 'rejected') {
      // The provider definitely created nothing — terminal, safe to re-attempt
      // under the SAME idempotency key (ADR-042 `failureMode: 'rejected'`).
      const rejected = new Error(
        `Subiekt fiscal printer rejected the registration for order ${cmd.orderId}`,
      ) as Error & { failureMode: 'rejected' };
      rejected.failureMode = 'rejected';
      throw rejected;
    }

    if (response.status === 'unknown') {
      // Fiscal-safe: the call completed with no thrown error, but the bridge
      // could not confirm success off `StatusFiskalny` (unverified enum — see
      // module docblock). Core's ADR-042 default is `in-doubt` for anything it
      // cannot read as `rejected`; we throw a plain Error with no
      // `failureMode`, which the core service reads exactly that way.
      this.logger.warn('Subiekt bridge reported an unconfirmed fiscal status', {
        orderId: cmd.orderId,
        rawStatusFiskalny: response.rawStatusFiskalny,
      });
      throw new Error(
        `Subiekt fiscal registration outcome could not be confirmed for order ${cmd.orderId} ` +
          `(rawStatusFiskalny=${String(response.rawStatusFiskalny)})`,
      );
    }

    // `status === 'registered'` — the bridge read a confirmed success.
    const artefacts: FiscalArtefact[] = [];
    return {
      providerType: SUBIEKT_FISCAL_PROVIDER_TYPE,
      providerReference: String(response.documentId),
      documentReference: response.documentNumber,
      signingIdentity: String(this.config.drukarkaFiskalnaId),
      // The bridge does not report the device's own timestamp for this
      // registration — never fabricate one with `new Date()` (ADR-042 /
      // the #2336 rule: OL's clock is not a witness to a third party's act).
      registeredAt: null,
      regimeExtras:
        response.rawStatusFiskalny !== null
          ? { rawStatusFiskalny: String(response.rawStatusFiskalny) }
          : undefined,
      artefacts,
    };
  }

  private async post(path: string, body: unknown): Promise<BridgeFiscalizeResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token !== undefined && this.token.length > 0) {
      headers.authorization = `Bearer ${this.token}`;
      headers['x-bridge-token'] = this.token;
    }

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.bridgeBaseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      throw new SubiektBridgeUnreachableError(
        error instanceof Error ? error.message : 'Subiekt bridge is unreachable',
      );
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 401 || res.status === 403) {
      throw new SubiektBridgeAuthError(res.status);
    }

    const envelope = (await res.json().catch(() => null)) as {
      success?: boolean;
      data?: BridgeFiscalizeResponse;
      error?: string;
    } | null;

    if (!res.ok || envelope === null || envelope.success !== true || envelope.data === undefined) {
      throw new SubiektRejectedError(
        envelope?.error ?? `Subiekt bridge returned HTTP ${res.status} with no usable body`,
      );
    }

    return envelope.data;
  }

  /**
   * Mirrors `SubiektInvoicingAdapter.translateBridgeError` — same taxonomy,
   * same fiscal-safe default for anything unrecognised.
   */
  private translateBridgeError(error: unknown): Error {
    if (error instanceof SubiektRejectedError) {
      const rejected = new Error(error.reason) as Error & { failureMode: 'rejected' };
      rejected.failureMode = 'rejected';
      return rejected;
    }
    if (error instanceof SubiektBridgeUnreachableError) {
      return new SubiektBridgeTransportError(error.message, 'indeterminate');
    }
    if (error instanceof SubiektBridgeAuthError || error instanceof SubiektConfigException) {
      return error;
    }
    return new SubiektBridgeTransportError(
      error instanceof Error ? error.message : 'Unknown Subiekt bridge error',
      'indeterminate',
      { cause: error },
    );
  }
}

/** Helper for callers that want a fresh idempotency key when the caller has none (tests only — core always supplies one). */
export function generateFiscalIdempotencyKey(): string {
  return randomUUID();
}
