/**
 * PrestaShop Shop-Default-Currency Resolution Types
 *
 * The result shape `PrestashopShopCurrencyResolver` reports, so a caller can
 * tell "the shop genuinely has no usable default currency" apart from "the read
 * failed". The distinction is the retry decision: a configuration gap will not
 * fix itself, a transport failure does (#2102, mirroring the tax-rate
 * `PrestashopTaxRateResolution` split from #2052).
 *
 * The `resolveDefaultCurrencyIso` convenience read collapses both to `null`,
 * which is all the product-sync path needs (it emits `currency: null` either
 * way).
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
export interface PrestashopShopCurrencyResolution {
  /** Resolved default ISO 4217 code (e.g. `'PLN'`), or `null` when unresolved. */
  readonly iso: string | null;
  /**
   * `true` only when `iso === null` because a read FAILED (WS timeout / 5xx).
   * A definitive answer - a real ISO, an absent `PS_CURRENCY_DEFAULT`, or a
   * currency row carrying no `iso_code` - reports `false`.
   */
  readonly transient: boolean;
}
