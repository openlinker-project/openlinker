/**
 * Shipping-Line Label Coercion
 *
 * Single source of truth for narrowing an untrusted per-connection shipping-line
 * label (`config.invoicing.shippingLineName`, #1562) into an issuance override.
 * `config.invoicing` is a passthrough JSONB shape, so a non-string / blank value
 * defers to the mapper's neutral default rather than being forwarded. Shared by
 * both issuance readers (the auto-issue trigger and the HTTP controller) so the
 * two narrowings cannot drift. Country-agnostic (ADR-026) — no language /
 * `platformType` logic; the value is whatever the operator stored.
 *
 * @module libs/core/src/invoicing/domain/types
 */

/**
 * Narrow an untrusted `config.invoicing.shippingLineName` value to a non-empty
 * (trimmed) string, or `undefined` when absent / non-string / blank — in which
 * case the mapper's neutral `SHIPPING_LINE_NAME` default applies. Returns the
 * original (untrimmed) value; the mapper trims at compose time.
 */
export function normalizeShippingLineName(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
