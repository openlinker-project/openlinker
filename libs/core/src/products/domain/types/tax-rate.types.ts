/**
 * Neutral Product Tax Rate (#2054, ADR-052)
 *
 * The vocabulary a ProductMaster answers "what tax does this product carry?"
 * in, and the shape OpenLinker stores that answer as.
 *
 * Three properties of the shape are load-bearing, and each exists because
 * collapsing it loses a distinction the operator can act on.
 *
 * **A code, not a number.** `0`, exempt, reverse charge and intra-EU zero all
 * look like zero to arithmetic but are four different things on a document,
 * so the answer is the same string vocabulary `InvoiceLine.taxRate` already
 * carries: `'23'`, `'8'`, `'5'`, `'0'`, `'zw'`, `'np'`, `'oo'`. Notation is
 * percent-as-string (#2247) - `'23'` is twenty-three percent, never `'0.23'`.
 *
 * **Unknown is not zero.** A master that cannot state the rate reports
 * `kind: 'unknown'`, never `'0'`. PrestaShop already draws this line - a
 * product whose tax-rules group is `0` is the operator's own "No tax" choice,
 * while an unparseable group means the read said nothing - and reading the
 * second as the first silently mis-taxes the sale.
 *
 * **Never-read is not no-rate.** That fourth state is not in this union,
 * because it is a fact about OpenLinker rather than an answer from the master:
 * it is encoded in storage as a null read timestamp. Without it, the day the
 * feature deploys every product reads as "the shop has no rate" and the
 * pre-rollout coverage count measures nothing.
 *
 * @module libs/core/src/products/domain/types
 */

/** Why a master could not state a rate. Provenance for the operator, not control flow. */
export const TaxRateUnknownReasonValues = [
  /** The shop has no tax configuration for this product at all. */
  'not-configured',
  /** Several candidate rates and no unambiguous pick (e.g. two rows for one country). */
  'ambiguous',
  /** The read itself did not state the tax status - unparseable or partial. */
  'unreadable',
] as const;
export type TaxRateUnknownReason = (typeof TaxRateUnknownReasonValues)[number];

/** The master stated a rate - including a deliberate zero or an exemption. */
export interface ResolvedTaxRate {
  kind: 'resolved';
  /**
   * Percent-as-string, or an exemption code. `'23'`, `'8'`, `'5'`, `'0'`,
   * `'zw'`, `'np'`, `'oo'`.
   */
  code: string;
  /**
   * ISO 3166-1 alpha-2 the master resolved the code against, when it knows.
   *
   * **Provenance only.** It is never compared with the buyer's country and it
   * blocks nothing - OSS and distance-selling rules are out of scope
   * (ADR-052 § 7). It exists so an operator reading a surprising rate can see
   * which country's table produced it.
   */
  countryIso2: string | null;
}

/** The master could not state a rate. Distinct from a zero rate. */
export interface UnknownTaxRate {
  kind: 'unknown';
  reason: TaxRateUnknownReason;
  /** Short, PII-free elaboration for logs and the operator surface. */
  detail?: string;
}

/**
 * This level of the catalogue defers to the product's rate.
 *
 * A distinct answer from both *resolved* and *unknown*, and only reachable on
 * a variant read. WooCommerce variations carry `tax_class: 'parent'`, meaning
 * "whatever the product says" - which is neither a rate of its own nor a gap.
 * Recording it as `unknown` would show the variant as rate-less on an operator
 * surface, and copying the product's code down would leave a duplicate that
 * goes stale the moment the product changes. Storing nothing is the honest
 * answer, and `effectiveTaxRate` already reads an absent override as
 * "no opinion".
 */
export interface InheritedTaxRate {
  kind: 'inherited';
}

export type TaxRateResolution = ResolvedTaxRate | UnknownTaxRate | InheritedTaxRate;

/** Where the rate on a stored line came from. Absent means it was never read. */
export const TaxRateSourceValues = ['shop', 'channel'] as const;
export type TaxRateSource = (typeof TaxRateSourceValues)[number];

/** Narrow a resolution to the resolved arm. */
export function isResolvedTaxRate(resolution: TaxRateResolution): resolution is ResolvedTaxRate {
  return resolution.kind === 'resolved';
}

/**
 * The rate as OpenLinker holds it for one catalogue row, with the read state
 * made explicit so a consumer cannot mistake "never checked" for "no rate".
 *
 * `readAt === null` is *never checked*; `readAt` set with `code === null` is
 * *checked, and the shop has no rate*. Those are the two states a single
 * nullable rate column cannot tell apart.
 */
export interface StoredTaxRate {
  code: string | null;
  countryIso2: string | null;
  readAt: Date | null;
}

/** The three states a stored rate can be in, derived rather than stored. */
export const TaxRateStateValues = ['not-checked', 'no-rate', 'known'] as const;
export type TaxRateState = (typeof TaxRateStateValues)[number];

/** Pure: classify a stored rate. */
export function taxRateState(stored: StoredTaxRate | null | undefined): TaxRateState {
  if (!stored || stored.readAt === null) return 'not-checked';
  return stored.code === null || stored.code.trim() === '' ? 'no-rate' : 'known';
}

/**
 * Resolve the rate that applies to a specific variant.
 *
 * **A variant override always wins where the shop carries one** (#2054, the
 * question the epic left open). It is not a conflict to arbitrate: a
 * variant-level value is the more specific statement of the same fact, and the
 * shop had to be edited deliberately for the two to differ. So an invoice line
 * carrying a variant id is taxed at the variant's rate, and offer propagation -
 * which is per-variant, because offers are variant-keyed - carries the same
 * value. A line with no variant id falls back to the product's rate.
 *
 * The product value is *not* consulted to validate the variant one. Doing so
 * would make a legitimate per-variant rate (a book at 5% inside a product whose
 * other variants are 23%) look like a defect.
 */
export function effectiveTaxRate(
  product: StoredTaxRate | null | undefined,
  variant: StoredTaxRate | null | undefined
): StoredTaxRate {
  if (variant && taxRateState(variant) === 'known') return variant;
  // A variant explicitly read as having no rate does NOT mask the product's:
  // PrestaShop keys tax on the product alone, so every variant there reads
  // `no-rate` and masking would blank a catalogue that is correctly configured.
  return product ?? { code: null, countryIso2: null, readAt: null };
}
