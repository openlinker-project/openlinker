/**
 * PrestaShop Sales-Country Types (ADR-077)
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */

/** Where a connection's sales country came from. */
export const PrestashopSalesCountrySourceValues = ['setting', 'shop-default'] as const;
export type PrestashopSalesCountrySource = (typeof PrestashopSalesCountrySourceValues)[number];

/** The country a PrestaShop connection's gross catalogue prices are stated for. */
export interface PrestashopSalesCountry {
  /** PrestaShop `id_country`. */
  readonly countryId: number;
  /** ISO 3166-1 alpha-2, uppercase. */
  readonly iso2: string;
  /** `setting` = `config.salesCountryIso2`; `shop-default` = `PS_COUNTRY_DEFAULT`. */
  readonly source: PrestashopSalesCountrySource;
  /** `false` when the shop switched taxes off (`PS_TAX = 0`): gross equals net. */
  readonly taxesEnabled: boolean;
}
