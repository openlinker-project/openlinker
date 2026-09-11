/**
 * Price Sync Mode (#3142, ADR-072 decision 3)
 *
 * Whether a (destination connection, feeding source connection) pair reviews
 * a detected price change before publishing it (`manual`, the default) or
 * publishes it straight away with no review (`automatic`). Deliberately two
 * values, not three — a `Digest` mode (auto-apply, batched into a daily
 * summary) was considered and cut: no notification/summary surface exists
 * anywhere in the app to build one on (see the ADR's Alternatives section).
 *
 * Stored as its own key on the operator-authored, untrusted
 * `Connection.config` jsonb — `Connection.config.priceSyncMode` — on the
 * DESTINATION connection: same default + per-source-override shape as
 * `pricing-rule.types.ts`, but kept as a separate key rather than folded into
 * `PricingRule` because "how to compute the price" and "whether to ask before
 * publishing it" are independent axes an operator sets independently on the
 * connection's Pricing & sync settings page (#3149).
 *
 * This is the `parseTriggerModel` config-coercion pattern, registered in
 * `scripts/check-architecture-gates.mjs`'s `KNOWN_CONFIG_KNOBS` — see that
 * file for the #1032 threshold this knob counts toward.
 *
 * @module libs/core/src/identifier-mapping/domain/types
 */
import type { ConnectionConfig } from './connection.types';

export const PriceSyncModeValues = ['manual', 'automatic'] as const;
export type PriceSyncMode = (typeof PriceSyncModeValues)[number];

export const PRICE_SYNC_MODE_CONFIG_KEY = 'priceSyncMode';

/** Every connection defaults to `manual` (ADR-072's migration path). */
export const DEFAULT_PRICE_SYNC_MODE: PriceSyncMode = 'manual';

export interface PriceSyncModeConfig {
  default: PriceSyncMode;
  sourceOverrides: Record<string, PriceSyncMode>;
}

function isPriceSyncMode(value: unknown): value is PriceSyncMode {
  return typeof value === 'string' && (PriceSyncModeValues as readonly string[]).includes(value);
}

/**
 * Read the per-connection price-sync-mode config (default + per-source
 * overrides). An absent/malformed config coerces to the safe default
 * (`manual` everywhere) — a connection that predates this feature, or that
 * was never configured, never auto-publishes.
 */
export function readPriceSyncModeConfig(
  config: ConnectionConfig | null | undefined
): PriceSyncModeConfig {
  const empty: PriceSyncModeConfig = { default: DEFAULT_PRICE_SYNC_MODE, sourceOverrides: {} };
  if (!config) {
    return empty;
  }
  const raw = config[PRICE_SYNC_MODE_CONFIG_KEY];
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return empty;
  }
  const candidate = raw as unknown as Record<string, unknown>;
  const defaultMode = isPriceSyncMode(candidate['default'])
    ? candidate['default']
    : DEFAULT_PRICE_SYNC_MODE;

  const overridesRaw = candidate['sourceOverrides'];
  const sourceOverrides: Record<string, PriceSyncMode> = {};
  if (overridesRaw != null && typeof overridesRaw === 'object' && !Array.isArray(overridesRaw)) {
    for (const [sourceConnectionId, value] of Object.entries(
      overridesRaw as Record<string, unknown>
    )) {
      if (isPriceSyncMode(value)) {
        sourceOverrides[sourceConnectionId] = value;
      }
    }
  }
  return { default: defaultMode, sourceOverrides };
}

/** The effective mode for a specific feeding source: override, then default. */
export function readPriceSyncModeForSource(
  config: ConnectionConfig | null | undefined,
  sourceConnectionId: string
): PriceSyncMode {
  const { default: defaultMode, sourceOverrides } = readPriceSyncModeConfig(config);
  return sourceOverrides[sourceConnectionId] ?? defaultMode;
}
