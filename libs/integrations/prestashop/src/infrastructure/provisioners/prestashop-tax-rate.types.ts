/**
 * PrestaShop Tax-Rate Resolution Types
 *
 * The result shape `PrestashopTaxRateResolver` reports, so its caller can tell
 * "the rate is 0" apart from "the rate is unknown" (#2052). Before this split
 * both answers were the number `0`, and `0` is also the legitimate rate of a
 * genuinely tax-exempt product — so a failed read silently priced a gross line
 * as net and PrestaShop then added its own VAT on top (#895 / ADR-014).
 *
 * `reason` separates the classes of unknown because they need different
 * operator handling: a `configuration` unknown will not fix itself (the shop's
 * tax record is incomplete) and must stop retrying; an `ambiguous` unknown is
 * the shop offering several candidate rules with no unambiguous pick, which
 * likewise needs a human rather than a retry; a `transport` unknown is a failed
 * call to PrestaShop and may well succeed on the next attempt.
 *
 * This file contains types only (per engineering standards).
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */

export const PrestashopTaxRateUnknownReasonValues = [
  /** The shop's tax record is incomplete or unusable. Fixed in the shop's admin. */
  'configuration',
  /**
   * Several candidate rules and no unambiguous pick.
   *
   * A third reason rather than a flavour of `configuration`, because it is the
   * one the neutral `ProductTaxRateReader` contract also names (`ambiguous`,
   * the answer the WooCommerce master gives for the same shape) - and because
   * the shop is not necessarily misconfigured: a group with per-country rules
   * and no catch-all is legitimate, it simply cannot be reduced to one rate
   * without a country to ask for. Picking whichever row the webservice returned
   * first would state a rate the shop never claimed (#2245 review).
   */
  'ambiguous',
  /** A failed call to PrestaShop. Retryable. */
  'transport',
] as const;
export type PrestashopTaxRateUnknownReason = (typeof PrestashopTaxRateUnknownReasonValues)[number];

export interface PrestashopTaxRateResolved {
  readonly kind: 'resolved';
  /** Rate as a fraction, e.g. `0.23` for 23%. `0` means genuinely untaxed. */
  readonly rate: number;
}

export interface PrestashopTaxRateUnknown {
  readonly kind: 'unknown';
  readonly reason: PrestashopTaxRateUnknownReason;
  /**
   * Operator-facing evidence clause naming the read that came up short, e.g.
   * `tax rule 7 in group 2 carries no rate` or `GET products/25 returned 503`.
   * It is embedded verbatim in the exception message the frontend renders, so
   * it must stay short and name a record the operator can open in the shop's
   * admin — never a stack trace or a raw response body. The resolver enforces
   * the "short" half by capping any interpolated error text at
   * {@link TAX_RATE_EVIDENCE_DETAIL_MAX}.
   */
  readonly evidence: string;
  /**
   * HTTP status of the failed read, when the platform reported one. Carried so
   * the caller can re-raise a `PrestashopApiException` that still classifies
   * (auth failure, rate limit) instead of an exception with a blank status.
   * Only ever set for `reason: 'transport'`.
   */
  readonly statusCode?: number;
}

/**
 * Cap on the free-text error detail interpolated into `evidence`. A transport
 * failure with no HTTP status carries the raw `error.message`, which can be an
 * arbitrarily long socket/parse error — and `evidence` is rendered to the
 * operator, not logged.
 */
export const TAX_RATE_EVIDENCE_DETAIL_MAX = 80;

export type PrestashopTaxRateResolution = PrestashopTaxRateResolved | PrestashopTaxRateUnknown;
