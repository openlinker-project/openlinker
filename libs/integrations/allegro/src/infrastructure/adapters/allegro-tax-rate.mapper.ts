/**
 * Allegro Tax-Rate Mapper (#2249, ADR-052)
 *
 * Translates Allegro's per-line `tax` object and its offer tax settings to and
 * from OpenLinker's neutral percent-as-string code. The platform vocabulary
 * stays here, in the adapter (ADR-026).
 *
 * The one rule that matters: **a null stays a null**. Allegro reports every
 * field of `lineItems[].tax` as nullable, and an offer published without tax
 * settings reports nothing at all. Reading that as `'0'` would state a
 * zero-rated sale that never happened.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 */

/** One country's permitted-rate block from `GET /sale/tax-settings`. */
export interface AllegroTaxSettingsRates {
  countryCode?: string;
  values?: Array<{ value?: string | null }>;
}

/**
 * The rates a category permits in one country, read from Allegro's
 * `/sale/tax-settings` body.
 *
 * Extracted as a pure function precisely because the FIRST version of this
 * parsing was a guess about the response shape and was silently wrong - it read
 * `taxSettings[].rates[]`, produced an empty list against the real body, and the
 * category check never fired. A pure function can be pinned against a captured
 * payload; a private method reached only through an HTTP fake cannot, easily.
 *
 * A `null` `value` is the UI's "Select" placeholder rather than a rate, so it is
 * dropped instead of parsed to NaN. An entry with no `countryCode` is treated as
 * applying everywhere.
 */
export function readPermittedTaxRates(
  rates: readonly AllegroTaxSettingsRates[] | undefined,
  countryCode: string,
): PermittedTaxRate[] {
  return (rates ?? [])
    .filter((entry) => !entry.countryCode || entry.countryCode.toUpperCase() === countryCode)
    .flatMap((entry) => entry.values ?? [])
    .flatMap((entry) => {
      if (entry.value == null) return [];
      const numeric = Number.parseFloat(entry.value);
      return Number.isFinite(numeric) ? [{ numeric, wire: entry.value }] : [];
    });
}

/**
 * One rate a category permits, in both forms the adapter needs.
 *
 * `numeric` compares against OpenLinker's own percent code. `wire` is the
 * string Allegro itself published, and it is what gets sent back - see
 * {@link formatAllegroRate} for why the difference is not cosmetic.
 */
export interface PermittedTaxRate {
  numeric: number;
  wire: string;
}

/**
 * Render a rate the way Allegro's `taxSettings.rates[].rate` expects.
 *
 * **Allegro matches this value against the seller's configured VAT settings as
 * a STRING, and the match is exact.** Sending the number `23` against a setting
 * published as `"23.00"` is rejected:
 *
 *     422 SETTING_NOT_FOUND
 *     "No VAT setting found for the rate: 23 of country: PL"  (path: taxSettings)
 *
 * Verified live on the sandbox, 21 Aug 2026 - and it would have failed EVERY
 * publish with an error an operator could not act on.
 *
 * So the published string is preferred verbatim when the permitted-values
 * listing gave us one; two decimals is the fallback for when that read was
 * unavailable, which matches every value the listing has been observed to
 * return.
 */
export function formatAllegroRate(rate: number, permitted: readonly PermittedTaxRate[]): string {
  const published = permitted.find((entry) => entry.numeric === rate);
  return published ? published.wire : rate.toFixed(2);
}

/** The `tax` object as Allegro reports it on an order line. */
export interface AllegroLineTax {
  rate?: string | null;
  subject?: string | null;
  exemption?: string | null;
}

/**
 * Read Allegro's per-line tax as a neutral code, or `null` when it reported
 * none.
 *
 * A numeric `rate` is normalised from Allegro's `"23.00"` to the bare `'23'`
 * the neutral contract uses (#2247) - the FA(3) map and the Erli enum are both
 * keyed on the bare form. An `exemption` with no rate is passed through
 * lower-cased, which covers Allegro's `zw` / `np` tokens; anything else is
 * `null` rather than a guess.
 */
export function toNeutralTaxRate(tax: AllegroLineTax | null | undefined): string | null {
  if (!tax) return null;

  const rate = tax.rate?.trim();
  if (rate) {
    const parsed = Number.parseFloat(rate);
    if (Number.isFinite(parsed)) {
      const rounded = Math.round(parsed * 100) / 100;
      return String(rounded);
    }
  }

  const exemption = tax.exemption?.trim().toLowerCase();
  if (exemption === 'zw' || exemption === 'np' || exemption === 'oo') return exemption;

  return null;
}

/**
 * Express a neutral code as the numeric rate Allegro's `OfferTaxSettings`
 * expects.
 *
 * Returns `null` for an exemption code: `rates[]` carries numbers, so `zw` /
 * `np` / `oo` have no place in it. The caller must treat that as "cannot
 * publish this rate" rather than as "publish without one" - omitting the
 * setting is what produced the rate-less offers this epic exists to fix.
 */
export function toAllegroRate(neutralTaxRate: string | undefined | null): number | null {
  if (!neutralTaxRate) return null;
  const parsed = Number.parseFloat(neutralTaxRate.trim());
  return Number.isFinite(parsed) ? parsed : null;
}
