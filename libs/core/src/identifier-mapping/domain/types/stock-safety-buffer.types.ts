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
 * Report whether `config.stockSafetyBuffer` is present but invalid — i.e. the
 * key is set to a non-null value that `readStockSafetyBuffer` coerces to `0`
 * (a non-numeric, negative, zero-as-typo-adjacent, or non-finite value).
 *
 * A mistyped buffer (e.g. the JSON string `"5"`, or `-3`) silently removes the
 * oversell protection the operator believes they configured, so callers use
 * this to emit a warning. Pure (no I/O). Returns `false` when the key is absent
 * or `null` (the intentional "no buffer" case), and `false` for a valid
 * positive number (which `readStockSafetyBuffer` returns as-is).
 *
 * Note: a literal `0` is treated as present-but-invalid here — `0` is
 * indistinguishable from the default and disables protection, so surfacing it
 * as a likely typo is intentional.
 */
export function isPresentButInvalidStockSafetyBuffer(
  config: ConnectionConfig | null | undefined
): boolean {
  if (!config) {
    return false;
  }
  const raw = config[STOCK_SAFETY_BUFFER_CONFIG_KEY];
  if (raw == null) {
    return false;
  }
  return readStockSafetyBuffer(config) === 0;
}

/**
 * Config key holding the per-connection zero threshold on `Connection.config`.
 */
export const STOCK_ZERO_THRESHOLD_CONFIG_KEY = 'stockZeroThreshold';

/**
 * Read the per-connection zero threshold from a connection config.
 *
 * The second remedy the #1844 design named, for slow-moving stock: below this
 * many units the destination is told `0` rather than the real, low number, so a
 * dwindling line stops selling instead of racing the next sync. `0` (the
 * default) means the threshold is off.
 *
 * Coerces exactly like `readStockSafetyBuffer`: a missing, non-numeric,
 * negative, or non-finite value yields `0`, and a fractional value is floored.
 */
export function readStockZeroThreshold(config: ConnectionConfig | null | undefined): number {
  if (!config) {
    return 0;
  }
  const raw = config[STOCK_ZERO_THRESHOLD_CONFIG_KEY];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  return Math.floor(raw);
}

/**
 * Apply a stock safety buffer, and then the zero threshold, to a master stock
 * level.
 *
 * Returns `max(0, masterStock - reserve)` so the published quantity never goes
 * negative. A `reserve` of `0` (the default) leaves `masterStock` unchanged.
 *
 * `zeroThreshold` is applied AFTER the reserve, to the quantity that would
 * actually be published: a quantity strictly below the threshold publishes as
 * `0`. Ordering matters and this ordering is the operator-legible one - the
 * threshold is a statement about the number the destination sees, not about the
 * master's own count. `0` (the default) disables the threshold, so an existing
 * connection is byte-identical to the pre-threshold behaviour.
 */
export function applyStockSafetyBuffer(
  masterStock: number,
  reserve: number,
  zeroThreshold = 0
): number {
  const published = Math.max(0, masterStock - reserve);
  if (zeroThreshold > 0 && published < zeroThreshold) {
    return 0;
  }
  return published;
}
