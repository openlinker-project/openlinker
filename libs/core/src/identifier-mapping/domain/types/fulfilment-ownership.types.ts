/**
 * Fulfilment Owned By Destination
 *
 * Per-connection, operator-declared fact: "this system packs and ships its
 * orders itself" (#2118). The destination is an external OMS/WMS that picks,
 * packs and ships, so OpenLinker hides its own packing affordances for orders
 * routed there. Read from the connection's `config.fulfilmentOwnedByDestination`
 * (JSONB) and defaulting to `false`, which keeps today's behaviour.
 *
 * DISPLAY-ONLY by design: nothing dispatches on it, it blocks no write and it
 * resolves no precedence (`POST /orders/:id/packed` still succeeds whatever it
 * says), so an external WMS can still assert "packed" on any order. It is
 * operator-declared configuration no adapter can report, which is why it is
 * not a capability.
 *
 * Pure helpers (no I/O), mirroring the `readStockSafetyBuffer` config-coercion
 * precedent.
 *
 * @module libs/core/src/identifier-mapping/domain/types
 */
import type { ConnectionConfig } from './connection.types';

/**
 * Config key holding the flag on `Connection.config`.
 */
export const FULFILMENT_OWNED_BY_DESTINATION_CONFIG_KEY = 'fulfilmentOwnedByDestination';

/**
 * Read the flag from a connection config. Only the boolean `true` reads as
 * set: a missing key, `false`, `null` and any other type (the string `"true"`
 * included) read as `false`, so a mistyped value can never hide a packing
 * affordance the operator did not mean to hide.
 */
export function readFulfilmentOwnedByDestination(
  config: ConnectionConfig | null | undefined
): boolean {
  if (!config) {
    return false;
  }
  return config[FULFILMENT_OWNED_BY_DESTINATION_CONFIG_KEY] === true;
}

/**
 * Report whether the key is present but not a boolean - a value that reads
 * back as `false` for a reason the operator did not intend. Absent and `null`
 * are the same intentional "off" statement and are not invalid.
 */
export function isPresentButInvalidFulfilmentOwnedByDestination(
  config: ConnectionConfig | null | undefined
): boolean {
  if (!config) {
    return false;
  }
  const raw = config[FULFILMENT_OWNED_BY_DESTINATION_CONFIG_KEY];
  return raw != null && typeof raw !== 'boolean';
}
