/**
 * Erli Tax-Rate Mapper (#2249, ADR-063)
 *
 * Translates between Erli's PL-specific tax-rate enum and OpenLinker's neutral
 * percent-as-string code. The mapping lives here, in the adapter, because the
 * enum is Erli's own vocabulary and core must never learn it (ADR-026).
 *
 * Two asymmetries are deliberate rather than oversights.
 *
 * **`oo` (reverse charge) has no Erli value.** Erli's enum stops at `NP`, so a
 * product OpenLinker holds at `oo` cannot be expressed and the write is refused
 * rather than downgraded to the nearest-looking token - a wrong tax token on a
 * live offer is a real sale taxed wrongly.
 *
 * **Which values a category actually allows is Erli's own rule** and is not
 * modelled here. Erli rejects a disallowed value itself, and its
 * `buyableProblems.missingTaxRate` blocks a rate-less product server-side, so
 * OpenLinker does not attempt to predict the answer.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 */

/** Erli enum -> neutral code. Erli's `TAX_7` / `TAX_19` are historical PL rates. */
const NEUTRAL_BY_ERLI: Readonly<Record<string, string>> = {
  TAX_0: '0',
  TAX_5: '5',
  TAX_7: '7',
  TAX_8: '8',
  TAX_19: '19',
  TAX_23: '23',
  NP: 'np',
  ZW: 'zw',
};

/**
 * Neutral -> Erli. Derived from the table above so the two can never disagree
 * about a value one of them knows.
 */
const ERLI_BY_NEUTRAL: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(NEUTRAL_BY_ERLI).map(([erli, neutral]) => [neutral, erli])
);

/**
 * Read an Erli rate as a neutral code.
 *
 * Returns `null` for an absent or unrecognised value - never a `'0'`. A rate
 * OpenLinker cannot read is not a zero-rated sale, and conflating the two is
 * the failure the whole epic exists to remove.
 */
export function toNeutralTaxRate(erliTaxRate: string | undefined | null): string | null {
  if (!erliTaxRate) return null;
  return NEUTRAL_BY_ERLI[erliTaxRate.trim().toUpperCase()] ?? null;
}

/**
 * Express a neutral code as an Erli enum value.
 *
 * Returns `null` when Erli has no equivalent (today: `oo`), which the caller
 * must treat as "cannot publish this rate" rather than as "publish without
 * one".
 */
export function toErliTaxRate(neutralTaxRate: string | undefined | null): string | null {
  if (!neutralTaxRate) return null;
  return ERLI_BY_NEUTRAL[neutralTaxRate.trim().toLowerCase()] ?? null;
}

/** Every neutral code Erli can express - for an operator-facing error message. */
export function supportedErliTaxRates(): string[] {
  return Object.keys(ERLI_BY_NEUTRAL);
}
