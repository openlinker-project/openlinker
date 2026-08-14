/**
 * PrestaShop Currency-By-ISO Read
 *
 * The one place that knows how a PrestaShop currency row is looked up by its
 * ISO 4217 code over the WebService (`filter[iso_code]`). Two resolvers need
 * that row for different reasons - `PrestashopCurrencyResolver` for the
 * currency **id** it puts on a cart, `PrestashopConversionRateResolver` for the
 * **conversion_rate** an order body carries (#2102) - and each owns its own
 * caching and failure policy. Only the filter shape is shared, so the two
 * cannot drift on what the client expects.
 *
 * Errors propagate: the caller decides whether a failed read is a fallback, a
 * retryable exception, or a refusal.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import type { PrestashopCurrency } from './prestashop-provisioner.types';

/**
 * Read the shop's currency row for an ISO 4217 code.
 *
 * @param client - PrestaShop WebService client for the connection
 * @param isoCode - ISO 4217 code, already normalised (uppercase, trimmed)
 * @returns The first matching currency row, or `undefined` when the shop has
 *   no currency configured for that code
 */
export async function readPrestashopCurrencyByIso(
  client: IPrestashopWebserviceClient,
  isoCode: string
): Promise<PrestashopCurrency | undefined> {
  const currencies = await client.listResources<PrestashopCurrency>(
    'currencies',
    { custom: { iso_code: isoCode } },
    1,
    0
  );
  return currencies?.[0];
}
