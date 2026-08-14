/**
 * PrestaShop Conversion-Rate Resolver
 *
 * Resolves the `conversion_rate` an outbound PrestaShop order body must carry:
 * the factor relating the ORDER's currency to the destination shop's DEFAULT
 * currency. PrestaShop recomputes the order header with that factor, so it is
 * destination-shop bookkeeping - not an analytics rate.
 *
 * Three outcomes, and only three (#2102):
 *
 * 1. **Order currency IS the shop default** - the factor is exactly `1`. That is
 *    a derivation, not a placeholder: PrestaShop pins the default currency's own
 *    `conversion_rate` at `1.000000` by definition, so reading `/currencies`
 *    here would spend a request to be told the same thing.
 * 2. **Order currency differs** - read PrestaShop's own
 *    `currencies.conversion_rate` for that currency. The shop's figure is the
 *    only one guaranteed consistent with how PrestaShop will value the order;
 *    an externally-sourced rate (e.g. the ADR-040 analytics FX stamp, which is
 *    anchored on `placedAt` against the *reporting* currency) would disagree
 *    with the shop's own books.
 * 3. **Not resolvable** - throw. A shop that cannot state the rate must not
 *    receive `1.000000`, which would assert parity between two currencies that
 *    are not at parity. The failure is worse than a flat mis-conversion because
 *    the order LINES are pinned separately at the buyer-paid price via
 *    cart-scoped `specific_prices` (#895 / ADR-014), so the header and the lines
 *    would disagree on the same document.
 *
 * The throw is class-split the same way `PrestashopTaxRateResolver`'s caller
 * splits its unknowns (#2052), because the CLASS carries the retry decision: a
 * shop-configuration gap raises the non-retryable
 * `PrestashopConversionRateUnknownException`, while a failed READ stays a
 * retryable `PrestashopApiException` carrying the status code it saw.
 *
 * **Scope note.** The shipped destination-order path creates orders through the
 * OL module's `importorder` endpoint (ADR-016 / #905), where PrestaShop's own
 * `validateOrder` stamps `conversion_rate` from the cart's currency - so this
 * resolver is not on that path. It exists for the raw-webservice order body
 * `PrestashopOrderMapper.mapOrderCreate` builds, which is the surface that
 * carried the hardcoded `1.0` and now requires a resolved rate from its caller.
 *
 * **Nothing is cached here.** A shop's per-currency rate is a moving figure an
 * operator (or a PrestaShop cron) updates, and serving a stale rate would
 * mis-value a real order - so only the shop's DEFAULT-currency ISO is cached,
 * inside the `PrestashopShopCurrencyResolver` this delegates to. That resolver
 * must be a process-singleton for its cache to survive the per-adapter
 * instances the factory creates.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Logger } from '@openlinker/shared/logging';
import { PrestashopApiException } from '../../domain/exceptions/prestashop-api.exception';
import { PrestashopConversionRateUnknownException } from '../../domain/exceptions/prestashop-conversion-rate-unknown.exception';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import type { PrestashopCurrency } from './prestashop-provisioner.types';
import type { PrestashopShopCurrencyResolver } from './prestashop-shop-currency.resolver';

/** The factor PrestaShop pins on the shop's own default currency. */
const SAME_CURRENCY_CONVERSION_RATE = 1;

export class PrestashopConversionRateResolver {
  private readonly logger = new Logger(PrestashopConversionRateResolver.name);

  constructor(private readonly shopCurrencyResolver: PrestashopShopCurrencyResolver) {}

  /**
   * Resolve the `conversion_rate` for an order priced in `orderCurrencyIso`.
   *
   * @param orderCurrencyIso - The order's ISO 4217 currency code
   * @param connectionId - Destination connection (cache key + error context)
   * @param webserviceClient - PrestaShop WebService client for this connection
   * @returns A finite, strictly positive factor - never a fallback `1`
   * @throws PrestashopConversionRateUnknownException when the shop's currency
   *   configuration cannot state the rate (non-retryable)
   * @throws PrestashopApiException when a read failed (retryable)
   */
  async resolveConversionRate(
    orderCurrencyIso: string | undefined,
    connectionId: string,
    webserviceClient: IPrestashopWebserviceClient
  ): Promise<number> {
    const orderIso = orderCurrencyIso?.trim().toUpperCase();
    if (!orderIso) {
      throw new PrestashopConversionRateUnknownException(
        `Order carries no currency code - cannot convert it to the shop's default ` +
          `currency; no order was created.`,
        undefined,
        connectionId
      );
    }

    const shopDefaultIso = await this.resolveShopDefaultIso(orderIso, connectionId, webserviceClient);

    if (orderIso === shopDefaultIso) {
      // The order is priced in the shop's own default currency, so the two are
      // genuinely at parity and PrestaShop's own row for that currency reads
      // 1.000000. See this file's header, outcome 1.
      return SAME_CURRENCY_CONVERSION_RATE;
    }

    const currency = await this.readCurrencyByIso(orderIso, connectionId, webserviceClient);
    return this.parseRate(currency, orderIso, shopDefaultIso, connectionId);
  }

  private async resolveShopDefaultIso(
    orderIso: string,
    connectionId: string,
    webserviceClient: IPrestashopWebserviceClient
  ): Promise<string> {
    const { iso, transient } = await this.shopCurrencyResolver.resolveDefaultCurrency(
      connectionId,
      webserviceClient
    );
    if (iso) {
      return iso;
    }

    if (transient) {
      throw new PrestashopApiException(
        `${orderIso} order: the shop's default currency could not be read, so its ` +
          `conversion rate is unknown. No order was created; the sync job retries on its own.`,
        undefined,
        undefined,
        connectionId
      );
    }

    throw new PrestashopConversionRateUnknownException(
      `${orderIso} order: the shop states no default currency, so its conversion rate ` +
        `is unknown. No order was created. Set the default currency in PrestaShop, then retry.`,
      orderIso,
      connectionId
    );
  }

  private async readCurrencyByIso(
    orderIso: string,
    connectionId: string,
    webserviceClient: IPrestashopWebserviceClient
  ): Promise<PrestashopCurrency | undefined> {
    try {
      const currencies = await webserviceClient.listResources<PrestashopCurrency>(
        'currencies',
        { custom: { iso_code: orderIso } },
        1,
        0
      );
      return currencies?.[0];
    } catch (error) {
      const statusCode = error instanceof PrestashopApiException ? error.statusCode : undefined;
      const detail =
        statusCode !== undefined
          ? `returned ${statusCode}`
          : `failed (${error instanceof Error ? error.message : String(error)})`;
      throw new PrestashopApiException(
        `${orderIso} order: the currency's conversion rate could not be read - ` +
          `GET currencies?iso_code=${orderIso} ${detail}. No order was created; ` +
          `the sync job retries on its own.`,
        statusCode,
        undefined,
        connectionId
      );
    }
  }

  private parseRate(
    currency: PrestashopCurrency | undefined,
    orderIso: string,
    shopDefaultIso: string,
    connectionId: string
  ): number {
    const pair = `${orderIso} to ${shopDefaultIso}`;

    if (!currency) {
      throw new PrestashopConversionRateUnknownException(
        `${pair}: ${orderIso} is not configured in the shop, so its conversion rate is ` +
          `unknown. No order was created. Add the currency in PrestaShop, then retry.`,
        orderIso,
        connectionId
      );
    }

    const raw = currency.conversion_rate;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      throw new PrestashopConversionRateUnknownException(
        `${pair}: the shop's ${orderIso} currency carries no conversion rate. No order was ` +
          `created. Refresh the exchange rates in PrestaShop, then retry.`,
        orderIso,
        connectionId
      );
    }

    const rate = Number.parseFloat(String(raw));
    // A zero or negative factor is as unusable as an absent one - it would value
    // the whole order at nothing - so it is reported as unknown, never applied.
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new PrestashopConversionRateUnknownException(
        `${pair}: the shop reports an unusable ${orderIso} conversion rate '${String(raw)}'. ` +
          `No order was created. Refresh the exchange rates in PrestaShop, then retry.`,
        orderIso,
        connectionId
      );
    }

    this.logger.debug(
      `Resolved PrestaShop conversion rate for connection ${connectionId}: ${pair} = ${rate}`
    );
    return rate;
  }
}
