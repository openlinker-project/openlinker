/**
 * Pricing Rule
 *
 * Per-connection pricing-resolution seam (#1843) — the pluggable markup/margin
 * + rounding formula applied when a destination's `price` is derived from the
 * master catalog price rather than an explicit per-item override. Today's
 * builders (`OfferBuilderService`, `ProductPublishBuilderService`) treat
 * `product.price` as a raw passthrough; this is the seam that replaces it.
 *
 * The rule is read from the connection's `config.pricingRule` (JSONB) and
 * defaults to `null` (passthrough), which preserves the pre-#1843 behaviour —
 * the master price flows through unchanged. Pure helpers (no I/O), mirroring
 * the `stock-safety-buffer.types.ts` config-coercion precedent (#1844).
 *
 * Precedence is owned by the callers: an explicit per-item `input.price`
 * always wins over the connection's pricing rule — the rule only fires when
 * the builder falls back to the master catalog price.
 *
 * @module libs/core/src/identifier-mapping/domain/types
 */
import type { ConnectionConfig } from './connection.types';

/**
 * Pricing formula kinds.
 *
 * - `passthrough`: use the master price unchanged (optionally still rounded).
 * - `markup`: apply `percent` on top of the master price (cost-plus): `price = base * (1 + percent/100)`.
 * - `margin`: solve for the price whose margin over the master price equals
 *   `percent`: `price = base / (1 - percent/100)`. Guarded against `percent >= 100`
 *   (undefined/negative denominator) by falling back to the base price.
 */
export const PricingRuleTypeValues = ['passthrough', 'markup', 'margin'] as const;
export type PricingRuleType = (typeof PricingRuleTypeValues)[number];

/**
 * Rounding applied after the formula.
 *
 * - `none` (default): round to 2 decimal places only (float-precision cleanup).
 * - `nearestWhole`: round to the nearest whole unit.
 * - `endingIn99`: psychological/charm pricing — round up to the next whole unit
 *   and subtract one cent (e.g. 19.30 → 19.99; 20.00 → 19.99).
 */
export const PriceRoundingModeValues = ['none', 'nearestWhole', 'endingIn99'] as const;
export type PriceRoundingMode = (typeof PriceRoundingModeValues)[number];

/**
 * A per-connection pricing rule. `percent` is required for `markup` / `margin`
 * (ignored for `passthrough`); a missing/invalid `percent` coerces to `0`
 * (no-op formula) rather than throwing — config is operator-editable JSONB and
 * must degrade gracefully.
 */
export interface PricingRule {
  type: PricingRuleType;
  percent?: number;
  rounding?: PriceRoundingMode;
}

/** Config key holding the per-connection pricing rule on `Connection.config`. */
export const PRICING_RULE_CONFIG_KEY = 'pricingRule';

/**
 * The default + per-source-override shape of `Connection.config.pricingRule`
 * (#3142, ADR-072 decision 2). Recurring price propagation (#3139) needs a
 * rule per (destination connection, feeding source connection) pair, not one
 * flat rule per connection — a destination is fed by several sources in the
 * common case, and each source may need its own margin (e.g. a second
 * warehouse with different unit economics).
 *
 * `sourceOverrides` is keyed by `sourceConnectionId`. A source absent from the
 * map simply uses `default`.
 */
export interface PricingRuleConfig {
  default: PricingRule | null;
  sourceOverrides: Record<string, PricingRule>;
}

/**
 * Read the per-connection pricing rule CONFIG (default + per-source
 * overrides) from a connection config.
 *
 * Backward-compatible with the pre-#3142 flat shape: `config.pricingRule`
 * holding a bare `{type, percent, rounding}` object (no `default` AND no
 * `sourceOverrides` key) is read as `{ default: <that rule>,
 * sourceOverrides: {} }` — resolved at read time, matching the
 * `readStockSafetyBuffer` config-coercion precedent (#1844). No backfill
 * migration is required; an existing connection's behaviour is unchanged
 * until an operator explicitly edits it.
 */
export function readPricingRuleConfig(
  config: ConnectionConfig | null | undefined
): PricingRuleConfig {
  const empty: PricingRuleConfig = { default: null, sourceOverrides: {} };
  if (!config) {
    return empty;
  }
  const raw = config[PRICING_RULE_CONFIG_KEY];
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return empty;
  }
  const candidate = raw as unknown as Record<string, unknown>;

  // New shape: `{ default: PricingRule, sourceOverrides?: {...} }`. A legacy
  // flat rule (`PricingRule = {type, percent, rounding}`) can never carry
  // either `default` or `sourceOverrides` as a key, so testing for BOTH
  // (rather than only `'default' in candidate`) cannot misclassify one — and
  // it is what makes a headless `{ sourceOverrides: {...} }` container (no
  // `default` key) resolve through this branch instead of silently falling
  // through to the legacy branch below, where `coercePricingRule` would see
  // no valid `type` on the container itself and discard every override.
  if ('default' in candidate || 'sourceOverrides' in candidate) {
    const defaultRule = coercePricingRule(candidate['default']);
    const overridesRaw = candidate['sourceOverrides'];
    const sourceOverrides: Record<string, PricingRule> = {};
    if (overridesRaw != null && typeof overridesRaw === 'object' && !Array.isArray(overridesRaw)) {
      for (const [sourceConnectionId, value] of Object.entries(
        overridesRaw as Record<string, unknown>
      )) {
        const rule = coercePricingRule(value);
        if (rule) {
          sourceOverrides[sourceConnectionId] = rule;
        }
      }
    }
    return { default: defaultRule, sourceOverrides };
  }

  // Legacy flat shape — the whole value IS the default rule.
  return { default: coercePricingRule(candidate), sourceOverrides: {} };
}

/**
 * Read the per-connection DEFAULT pricing rule from a connection config.
 *
 * Returns `null` when no default rule is configured — the caller then treats
 * it as pure passthrough (identical to the pre-#1843 behaviour). Unchanged
 * behaviour for every existing call site (`OfferBuilderService`,
 * `ProductPublishBuilderService`): both predate the per-source dimension and
 * have no source-connection context to resolve against, so they keep
 * resolving the connection's default rule exactly as before #3142.
 */
export function readPricingRule(config: ConnectionConfig | null | undefined): PricingRule | null {
  return readPricingRuleConfig(config).default;
}

/**
 * Read the EFFECTIVE pricing rule for a specific feeding source connection
 * (#3142): the source's override when one is configured, otherwise the
 * connection's default rule. Used by the price-change detection service
 * (#3143), which always knows which source connection produced the change.
 */
export function readPricingRuleForSource(
  config: ConnectionConfig | null | undefined,
  sourceConnectionId: string
): PricingRule | null {
  const { default: defaultRule, sourceOverrides } = readPricingRuleConfig(config);
  return sourceOverrides[sourceConnectionId] ?? defaultRule;
}

function coercePricingRule(value: unknown): PricingRule | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const type = candidate['type'];
  if (!isPricingRuleType(type)) {
    return null;
  }
  const rawPercent = candidate['percent'];
  const percent = typeof rawPercent === 'number' && Number.isFinite(rawPercent) ? rawPercent : 0;
  const rawRounding = candidate['rounding'];
  const rounding = isPriceRoundingMode(rawRounding) ? rawRounding : 'none';
  return { type, percent, rounding };
}

function isPricingRuleType(value: unknown): value is PricingRuleType {
  return typeof value === 'string' && (PricingRuleTypeValues as readonly string[]).includes(value);
}

function isPriceRoundingMode(value: unknown): value is PriceRoundingMode {
  return typeof value === 'string' && (PriceRoundingModeValues as readonly string[]).includes(value);
}

/**
 * Apply a pricing rule to a base (master catalog) price, returning the
 * resolved destination price. `rule === null` (no configured rule) returns
 * `basePrice` completely unchanged — no rounding, no float cleanup — so a
 * connection with no `pricingRule` is byte-identical to the pre-#1843
 * passthrough. Once a rule is configured (even `type: 'passthrough'`),
 * rounding applies.
 */
export function applyPricingRule(basePrice: number, rule: PricingRule | null): number {
  if (!rule) {
    return basePrice;
  }
  const percent = rule.percent ?? 0;
  let resolved = basePrice;
  if (rule.type === 'markup') {
    resolved = basePrice * (1 + percent / 100);
  } else if (rule.type === 'margin') {
    // percent >= 100 makes the denominator <= 0 (undefined margin formula);
    // degrade to the base price rather than producing Infinity/a negative price.
    resolved = percent >= 100 ? basePrice : basePrice / (1 - percent / 100);
  }
  return applyRounding(resolved, rule.rounding ?? 'none');
}

function applyRounding(value: number, mode: PriceRoundingMode): number {
  switch (mode) {
    case 'nearestWhole':
      return Math.round(value);
    case 'endingIn99': {
      const roundedUp = Math.max(0, Math.ceil(value));
      return round2dp(roundedUp - 0.01);
    }
    case 'none':
    default:
      return round2dp(value);
  }
}

function round2dp(value: number): number {
  return Math.max(0, Math.round((value + Number.EPSILON) * 100) / 100);
}
