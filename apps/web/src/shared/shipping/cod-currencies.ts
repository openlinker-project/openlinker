/**
 * COD currency capability, per shipping carrier (#1569)
 *
 * FE mirror of the backend per-carrier cash-on-delivery currency support. Two
 * backend sources of truth this must stay in sync with (a test pins the sets):
 *   - DPD:    `DpdCodCurrencyValues`
 *             (libs/integrations/dpd-polska/src/domain/types/dpd-rest.types.ts)
 *   - InPost: `SHIPX_COD_CURRENCIES`
 *             (libs/integrations/inpost/src/infrastructure/mappers/inpost-shipx.mapper.ts)
 *
 * Lives in `shared/` (not a feature) because both the orders feature
 * (generate-label COD field) and the connections feature (carrier setup) read
 * it, and neither should depend on the other. Same FE<->BE value-drift
 * discipline as `SHIPPING_METHOD_VALUES` (#966).
 *
 * @module shared/shipping
 */

/**
 * Every COD currency any supported carrier accepts — the union, used as the
 * fallback set when the routed carrier can't be predicted (see
 * {@link codCurrenciesForPlatform}) and as the Zod validation vocabulary.
 */
export const COD_CURRENCY_VALUES = ['PLN', 'EUR', 'RON', 'CZK'] as const;
export type CodCurrency = (typeof COD_CURRENCY_VALUES)[number];

/**
 * Supported COD currencies keyed by connection `platformType`. A carrier absent
 * here (or an unknown platformType) falls back to the union via
 * {@link codCurrenciesForPlatform} — the backstop is the adapter preflight,
 * which rejects an unsupported currency server-side.
 */
export const COD_CURRENCIES_BY_PLATFORM: Record<string, readonly CodCurrency[]> = {
  dpd: ['PLN', 'EUR', 'RON', 'CZK'],
  inpost: ['PLN'],
};

/**
 * Allowed COD currencies for a routed carrier's `platformType`. Returns the
 * full union when the carrier is unknown / unpredictable (no routing rule,
 * OMP-fulfilled, null processor, or a platformType with no declared set), so
 * the picker never falsely restricts a currency the carrier might accept.
 */
export function codCurrenciesForPlatform(platformType?: string): readonly CodCurrency[] {
  if (platformType !== undefined && platformType in COD_CURRENCIES_BY_PLATFORM) {
    return COD_CURRENCIES_BY_PLATFORM[platformType];
  }
  return COD_CURRENCY_VALUES;
}

/**
 * Clamp a desired currency to a carrier's allowed set: keep it if allowed,
 * otherwise fall back to the set's first entry (PLN for every carrier today).
 * Used to default the field from the order currency and to coerce a stale
 * selection when the routed carrier narrows the set.
 */
export function clampCodCurrency(
  desired: string | undefined,
  allowed: readonly CodCurrency[],
): CodCurrency {
  const normalized = desired?.toUpperCase();
  if (normalized !== undefined && (allowed as readonly string[]).includes(normalized)) {
    return normalized as CodCurrency;
  }
  return allowed[0] ?? 'PLN';
}
