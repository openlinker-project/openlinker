/**
 * PrestaShop Currency Reads
 *
 * The one place that knows how a PrestaShop currency row is looked up over the
 * WebService - by ISO 4217 code (`filter[iso_code]`) or by row id. Extracted so
 * each lookup shape lives in one place rather than being restated at every site
 * that needs a currency row; caching and failure policy stay with the caller.
 *
 * Both reads answer `PrestashopCurrency | undefined`, where `undefined` means
 * the same thing on either side: the shop carries no currency row for what was
 * asked. Every other error propagates, so the caller decides whether a failed
 * read is a fallback, a retryable exception, or a refusal.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { PrestashopApiException } from '../../domain/exceptions/prestashop-api.exception';
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

/**
 * Read the shop's currency row by its PrestaShop row id (#2277).
 *
 * A missing row answers `undefined` rather than throwing, so the by-id read
 * reports absence the same way the ISO read does (an empty filter result). The
 * WebService signals that absence with a 404, which is why this one status is
 * translated here: it is the read SUCCEEDING and reporting that the id does not
 * exist, not a failed call. Every other `PrestashopApiException` (5xx, timeout,
 * auth) propagates untouched so it keeps its retries - the same split the
 * sibling `PrestashopCurrencyResolver` documents.
 *
 * @param client - PrestaShop WebService client for the connection
 * @param currencyId - PrestaShop `currencies` row id, already normalised
 * @returns The currency row, or `undefined` when the shop has no row with that id
 */
export async function readPrestashopCurrencyById(
  client: IPrestashopWebserviceClient,
  currencyId: string
): Promise<PrestashopCurrency | undefined> {
  try {
    return await client.getResource<PrestashopCurrency>('currencies', currencyId);
  } catch (error) {
    if (error instanceof PrestashopApiException && error.statusCode === 404) {
      return undefined;
    }
    throw error;
  }
}
