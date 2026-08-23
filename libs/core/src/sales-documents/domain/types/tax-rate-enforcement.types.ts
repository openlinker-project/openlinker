/**
 * Per-line Tax-rate Enforcement Switch (#2245 review, ADR-052 § Consequences)
 *
 * ADR-052 holds a document when a line carries no tax rate. That is the right
 * steady state and the wrong first day: catalogue coverage is zero on deploy
 * (measured 2026-08-21, #2256), so switching every enforcement point on at once
 * refuses 100% of issuance, 100% of receipt registration and 100% of offer
 * publishing - an outage rather than a diagnosis, which is exactly the order
 * `docs/operations/tax-rate-coverage.md` says not to run the rollout in.
 *
 * So enforcement is a switch, and it is OFF by default. With it off every
 * enforcement point behaves as it did before the epic: the three invoicing
 * providers substitute their documented default, the two gates pass, and the
 * two channel adapters publish with the rate omitted. With it on, ADR-052's
 * rules apply.
 *
 * Two answers live here because they are two halves of one question:
 *   - is strict enforcement switched on for this deployment?
 *   - is THIS order exempt because it predates the feature?
 *
 * {@link isTaxRateEnforced} is the single resolution helper every enforcement
 * point calls, so no site can test only one half.
 *
 * WHY HERE. Both document contexts need the answer, and so do the marketplace
 * adapters - a fiscal receipt is not an invoice, so neither `invoicing` nor
 * `fiscalization` could own it for the other. This concern is the shared,
 * dependency-free leaf that exists for exactly that case, which is also why the
 * coercion below reads `process.env` directly instead of importing a config
 * helper: the module imports nothing, and `barrel-purity.spec.ts` enforces it.
 *
 * @module libs/core/src/sales-documents/domain/types
 * @see docs/architecture/adrs/052-per-line-tax-rate-resolution-and-provenance.md
 * @see docs/operations/tax-rate-coverage.md
 */

/**
 * The one environment variable that turns ADR-052's refusals on.
 *
 * Named as a constant so a spec can flip it without repeating the literal, and
 * so the rollout runbook and the code cannot drift on the spelling.
 */
export const TAX_RATE_STRICT_ENV_VAR = 'OL_TAX_RATE_STRICT_ENABLED';

/**
 * Coerce the raw environment value. Pure: it takes the string, never reads the
 * environment itself, mirroring `parseTriggerModel` / `parseIsPrimaryInvoicing`.
 *
 * Only the exact string `true` (case-insensitive, trimmed) enables it. Anything
 * else - absent, empty, `1`, `yes`, a typo - reads as OFF, deliberately: the
 * permissive side is the safe side here, so a mis-typed value must never be the
 * thing that stops a seller invoicing.
 */
export function parseTaxRateStrictEnabled(raw: string | undefined): boolean {
  return (raw ?? '').trim().toLowerCase() === 'true';
}

/**
 * Whether strict per-line tax-rate enforcement is switched on for this process.
 *
 * Read per call rather than cached at module load, so a spec (and an operator
 * restarting a worker with the variable set) sees the current value.
 */
export function isTaxRateStrictEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return parseTaxRateStrictEnabled(env[TAX_RATE_STRICT_ENV_VAR]);
}

/**
 * The eras an order can belong to, as stored on `order_records.taxRateEra`.
 *
 * One value today: `'pre-rollout'`, stamped by the
 * `MarkPreRolloutOrdersHistorical` migration on every order that existed before
 * per-line rates did. `null` (absent from this union) means "ingested after the
 * feature", which is the ordinary case and needs no marker.
 */
export const TaxRateEraValues = ['pre-rollout'] as const;

/** A recognised `order_records.taxRateEra` value. */
export type TaxRateEra = (typeof TaxRateEraValues)[number];

/**
 * Coercion guard for a value read out of the `varchar(16)` column.
 *
 * A value written by an older or newer release must degrade to "no era" rather
 * than reaching a policy decision as an unknown literal - the same reason
 * `isSalesDocumentGateBlockReason` exists.
 */
export function isTaxRateEra(value: unknown): value is TaxRateEra {
  return typeof value === 'string' && (TaxRateEraValues as readonly string[]).includes(value);
}

/**
 * Whether this order predates per-line tax rates.
 *
 * ADR-052 § Consequences: such an order "issues exactly as it does today".
 * Blocking it would stop history nobody is going to retrofit - its lines carry
 * no rate because no rate was ever collected for them, and no catalogue edit
 * changes that after the sale.
 */
export function isPreRolloutOrder(era: string | null | undefined): boolean {
  return era === 'pre-rollout';
}

/**
 * The single question every enforcement point asks: should ADR-052's refusals
 * apply to this order?
 *
 * Both halves must hold - the deployment has opted in, AND the order is not
 * pre-rollout history. Callers with no era in hand (a channel publish, for
 * instance, which is not about one order) pass nothing.
 */
export function isTaxRateEnforced(
  era?: string | null,
  env: Record<string, string | undefined> = process.env
): boolean {
  return isTaxRateStrictEnabled(env) && !isPreRolloutOrder(era);
}
