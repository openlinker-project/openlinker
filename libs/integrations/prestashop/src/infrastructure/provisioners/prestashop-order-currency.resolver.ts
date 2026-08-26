/**
 * PrestaShop Order-Currency Resolver
 *
 * Answers "what currency was this PrestaShop order actually placed in?" (#2277).
 * Until this resolver existed the order mapper emitted a literal `'EUR'` on
 * every ingested order, so a PLN shop reported PLN amounts under a EUR
 * denomination - and the ADR-040 FX stamp, issued invoices and fiscal
 * registrations all inherit that denomination without self-healing.
 *
 * Resolution chain, first answer wins:
 *   1. the order's own `id_currency`, read as `GET /currencies/{id}`;
 *   2. the shop default (`PS_CURRENCY_DEFAULT`), via
 *      `PrestashopShopCurrencyResolver`;
 *   3. refuse - `PrestashopCurrencyUnknownException`.
 *
 * `Connection.config.currency` is deliberately NOT in the chain. It means
 * "product-sync default" today (`prestashop-config.types.ts`), and PrestaShop
 * is multi-currency per ORDER, so a connection-level value would be a fourth
 * source of truth and still wrong for a shop selling in two currencies. The
 * shop-default read is a strictly better fallback because it cannot drift from
 * the shop.
 *
 * Refusing is the correct third rung rather than substituting a default:
 * `IncomingOrderTotals.currency` is a required non-nullable string, the amounts
 * are the buyer-paid source numerals, and a substituted code books the right
 * numbers under the wrong denomination while reporting the ingest as a success
 * - the same reasoning #2139 applied on the order-CREATE side. A refusal is
 * classified non-retryable by `PrestashopRetryClassifierAdapter`, so the job
 * dies on its first attempt carrying the operator-facing message rather than
 * burning its retry budget re-reading the same rows.
 *
 * Caching mirrors `PrestashopCurrencyResolver`: only RESOLVED codes are cached,
 * keyed `${connectionId}:${id_currency}` with a 24h TTL. A refusal is never
 * cached, so an operator who fixes the currency in the PrestaShop back office
 * is picked up by the very next attempt. As wired today the owning
 * `PrestashopAdapterFactory` is rebuilt per `createCapabilityAdapter`, so the
 * cache is per-build - the same caveat `PrestashopShopCurrencyResolver`
 * documents, and it becomes load-bearing the moment the factory is genuinely
 * held as a process singleton.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Logger } from '@openlinker/shared/logging';
import { PrestashopCurrencyUnknownException } from '../../domain/exceptions/prestashop-currency-unknown.exception';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import { readPrestashopCurrencyById } from './prestashop-currency-read';
import type { PrestashopShopCurrencyResolver } from './prestashop-shop-currency.resolver';

/**
 * Cache TTL (24h). Currency rows are rarely edited, but the entry expires so a
 * back-office change eventually surfaces without a process restart.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  iso: string;
  timestamp: number;
}

/** What the resolver needs to answer, and to name the order if it cannot. */
export interface ResolveOrderCurrencyInput {
  connectionId: string;
  client: IPrestashopWebserviceClient;
  /** The order's `id_currency`, as PrestaShop serialized it (absent is legal). */
  idCurrency?: string | number;
  /**
   * Order reference (or id) for the refusal message. That message is operator
   * interface copy, not a log line, so it has to name the order the operator is
   * actually looking at.
   */
  orderRef: string;
}

export class PrestashopOrderCurrencyResolver {
  private readonly logger = new Logger(PrestashopOrderCurrencyResolver.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly shopCurrencyResolver: PrestashopShopCurrencyResolver) {}

  /**
   * Resolve the ISO 4217 code an order is denominated in.
   *
   * @throws PrestashopCurrencyUnknownException when the order's `id_currency`
   *   resolves to no usable ISO code, or when the order carries none and the
   *   shop default is unavailable (non-retryable)
   * @throws PrestashopApiException when the `GET /currencies` read itself fails
   *   (retryable - raised by the WebService client and propagated unchanged)
   */
  async resolveOrderCurrencyIso(input: ResolveOrderCurrencyInput): Promise<string> {
    const currencyId = this.normalizeCurrencyId(input.idCurrency);

    // An order with no `id_currency` is a shop-default case, not a refusal: an
    // absent field says nothing is wrong with the shop's configuration, whereas
    // an id that resolves to nothing does.
    if (currencyId === null) {
      return this.resolveShopDefault(input);
    }

    const cacheKey = `${input.connectionId}:${currencyId}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.iso;
      }
      this.cache.delete(cacheKey);
    }

    // Deliberately NOT wrapped in a try/catch: a failed READ is a different
    // failure kind from an unresolvable currency and must keep the retryable
    // `PrestashopApiException` the client raises. A 404 - the read succeeding
    // and reporting that the id does not exist - is already folded into
    // `undefined` by the shared read.
    const currency = await readPrestashopCurrencyById(input.client, currencyId);
    const iso = currency?.iso_code?.trim().toUpperCase();

    if (!iso) {
      this.logger.error(
        `Order currency ${currencyId} unresolvable in PrestaShop ` +
          `(connection: ${input.connectionId}, order: ${input.orderRef})`
      );
      throw new PrestashopCurrencyUnknownException(
        `Currency id ${currencyId} unknown in PrestaShop - order ${input.orderRef} is ` +
          `denominated in a currency the shop has no usable row for, so the order was ` +
          `not ingested. Check that currency in PrestaShop (International > Locations > ` +
          `Currencies), then retry.`,
        undefined,
        input.connectionId
      );
    }

    this.cache.set(cacheKey, { iso, timestamp: Date.now() });
    return iso;
  }

  /** Clear the cache for one connection, or all connections when omitted. */
  clearCache(connectionId?: string): void {
    if (connectionId === undefined) {
      this.cache.clear();
      return;
    }
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(`${connectionId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  private async resolveShopDefault(input: ResolveOrderCurrencyInput): Promise<string> {
    const iso = await this.shopCurrencyResolver.resolveDefaultCurrencyIso(
      input.connectionId,
      input.client
    );
    if (iso) {
      return iso;
    }

    this.logger.error(
      `Order carries no id_currency and the shop default is unavailable ` +
        `(connection: ${input.connectionId}, order: ${input.orderRef})`
    );
    throw new PrestashopCurrencyUnknownException(
      `Currency unknown for order ${input.orderRef} - the order carries no currency ` +
        `and the shop reports no default one, so the order was not ingested. Set the ` +
        `default currency in PrestaShop (Shop Parameters > General), then retry.`,
      undefined,
      input.connectionId
    );
  }

  /**
   * `null` for anything that cannot address a `currencies` row. PrestaShop
   * serializes an unset foreign key as `0` (and the WS hands ids back as either
   * a string or a number), which addresses nothing - treating it as an id would
   * turn a plain shop-default case into a spurious refusal.
   */
  private normalizeCurrencyId(raw: string | number | undefined): string | null {
    if (raw === undefined || raw === null) {
      return null;
    }
    const asString = String(raw).trim();
    if (asString === '') {
      return null;
    }
    const asNumber = Number(asString);
    if (!Number.isInteger(asNumber) || asNumber <= 0) {
      return null;
    }
    return String(asNumber);
  }
}
