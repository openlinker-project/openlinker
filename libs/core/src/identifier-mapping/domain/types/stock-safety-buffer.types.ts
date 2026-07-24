/**
 * Stock Safety Buffer
 *
 * Per-connection stock reserve applied when a master stock level is published or
 * written back to a destination (#1844). The published quantity is
 * `max(0, masterStock - reserve)`, so a fast-moving item keeps a cushion on the
 * destination and cannot oversell between syncs. The reserve is read from the
 * connection's `config.stockSafetyBuffer` (JSONB) and defaults to `0`, which
 * preserves the pre-#1844 pass-through behaviour.
 *
 * Pure helpers (no I/O) — mirrors the `parseTriggerModel` config-coercion
 * precedent in the invoicing context. Consumed cross-context by the listings
 * builders (offer + shop publish) and the inventory write-back path.
 *
 * @module libs/core/src/identifier-mapping/domain/types
 */
import type { ConnectionConfig } from './connection.types';

/**
 * Config key holding the per-connection reserve on `Connection.config`.
 */
export const STOCK_SAFETY_BUFFER_CONFIG_KEY = 'stockSafetyBuffer';

/**
 * Read the per-connection stock safety buffer from a connection config.
 *
 * Coerces defensively: a missing, non-numeric, negative, or non-finite value
 * yields `0` (pass-through). A fractional value is floored so the reserve is a
 * whole number of units.
 */
export function readStockSafetyBuffer(config: ConnectionConfig | null | undefined): number {
  if (!config) {
    return 0;
  }
  const raw = config[STOCK_SAFETY_BUFFER_CONFIG_KEY];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  return Math.floor(raw);
}

/**
 * Apply a stock safety buffer to a master stock level.
 *
 * Returns `max(0, masterStock - reserve)` so the published quantity never goes
 * negative. A `reserve` of `0` (the default) returns `masterStock` unchanged.
 */
export function applyStockSafetyBuffer(masterStock: number, reserve: number): number {
  return Math.max(0, masterStock - reserve);
}
