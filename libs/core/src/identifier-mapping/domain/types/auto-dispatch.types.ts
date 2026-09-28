/**
 * Auto-Dispatch Config
 *
 * Per-connection opt-in (#3340/#2729) for buying a shipping label the moment a
 * routed `FulfillmentWork` is ACCEPTED by its holder — the missing half of the
 * invoicing `triggerModel` precedent (`invoicing.triggerModel = 'auto-on-paid'`
 * issues the sales document automatically; nothing did the equivalent for the
 * label, so every parcel reached the pack bench unlabelled unless an operator
 * clicked Generate label first).
 *
 * Pure helper (no I/O) — mirrors the `readStockSafetyBuffer` /
 * `readPricingRule` config-coercion precedent in this same directory. An
 * unrecognised or absent value coerces to DISABLED, never throws: this spends
 * the operator's money per parcel, so the safe failure direction is "do
 * nothing automatically", exactly the reasoning `parseTriggerModel` already
 * applies to auto-issuing a fiscal document.
 *
 * @module libs/core/src/identifier-mapping/domain/types
 */
import type { ConnectionConfig } from './connection.types';

/** Config key holding the per-connection auto-dispatch settings on `Connection.config`. */
export const AUTO_DISPATCH_CONFIG_KEY = 'autoDispatch';

/**
 * Resolved per-connection auto-dispatch settings.
 *
 * `enabled` is the whole gate; the other two fields are meaningless (and never
 * read) when it is `false`.
 */
export interface AutoDispatchConfig {
  /** Whether this connection's accepted work should buy a label automatically. */
  readonly enabled: boolean;
  /**
   * Carrier size-template code (e.g. InPost `'small' | 'medium' | 'large'`) to
   * pass on the parcel when set. Dimensions are deliberately never summed
   * across a work's lines (stacking boxes is not addition, and getting it
   * wrong is a mispriced label) — a carrier that needs a size takes this
   * operator-chosen template instead.
   */
  readonly parcelTemplate?: string;
  /**
   * Fallback per-unit weight (grams) for a line whose variant carries no
   * `weightGrams`. Absent means there is no fallback — such a line REFUSES
   * the whole parcel (`no-weight`) rather than guessing, because the weight
   * decides what the carrier charges.
   */
  readonly defaultWeightGrams?: number;
}

const DISABLED: AutoDispatchConfig = { enabled: false };

/**
 * Read the per-connection auto-dispatch config from a connection config.
 *
 * Coerces defensively, the `readStockSafetyBuffer` rule: a missing config, a
 * missing/malformed `autoDispatch` key, or `enabled` not being exactly `true`
 * all yield the same DISABLED answer — off by default, and no partial
 * "enabled with garbage settings" state is representable. `parcelTemplate` is
 * kept only when it is a non-empty string; `defaultWeightGrams` only when it
 * is a positive finite number (a fractional value is floored, matching the
 * stock-safety-buffer precedent's whole-unit rule).
 */
export function readAutoDispatchConfig(config: ConnectionConfig | null | undefined): AutoDispatchConfig {
  if (!config) {
    return DISABLED;
  }
  const raw = config[AUTO_DISPATCH_CONFIG_KEY];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return DISABLED;
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.enabled !== true) {
    return DISABLED;
  }

  const result: { enabled: true; parcelTemplate?: string; defaultWeightGrams?: number } = {
    enabled: true,
  };
  if (typeof candidate.parcelTemplate === 'string' && candidate.parcelTemplate.trim().length > 0) {
    result.parcelTemplate = candidate.parcelTemplate;
  }
  const defaultWeightGrams = candidate.defaultWeightGrams;
  if (
    typeof defaultWeightGrams === 'number' &&
    Number.isFinite(defaultWeightGrams) &&
    defaultWeightGrams > 0
  ) {
    result.defaultWeightGrams = Math.floor(defaultWeightGrams);
  }
  return result;
}
