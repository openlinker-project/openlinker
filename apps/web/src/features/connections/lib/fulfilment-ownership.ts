/**
 * Fulfilment ownership flag (#2118)
 *
 * Browser-side reader for `Connection.config.fulfilmentOwnedByDestination`: "this
 * system packs and ships its orders itself". The browser cannot import
 * `@openlinker/core` (#591), so this is a deliberate one-line mirror of core's
 * `readFulfilmentOwnedByDestination` - only the boolean `true` reads as set, so a
 * mistyped value can never hide a packing affordance the operator did not mean
 * to hide. Display-only: nothing is enforced on the server from it.
 *
 * @module features/connections/lib
 */

/** Config key holding the flag. Mirrors `FULFILMENT_OWNED_BY_DESTINATION_CONFIG_KEY` in core. */
export const FULFILMENT_OWNED_BY_DESTINATION_CONFIG_KEY = 'fulfilmentOwnedByDestination';

export function readFulfilmentOwnedByDestination(
  config: Record<string, unknown> | null | undefined
): boolean {
  return config?.[FULFILMENT_OWNED_BY_DESTINATION_CONFIG_KEY] === true;
}
