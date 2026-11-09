/**
 * Capability Metadata
 *
 * Single source of the operator-facing capability help copy and the
 * capability mutual-exclusivity rules shared by the connection setup wizards
 * (PrestaShop, WooCommerce) and the edit-time ConnectionCapabilitiesPanel.
 *
 * The exclusivity rule is expressed in capability terms only - a stock source
 * of truth (InventoryMaster) must never also be a stock write-back target
 * (OfferManager) on the same connection - so no platformType dispatch is
 * needed; the backend enforces the same rule authoritatively on create/update.
 *
 * @module features/connections/lib
 */
import { getMessages, interpolate } from '../../../shared/i18n';
import { CORE_CAPABILITY_VALUES, type CoreCapability } from '../api/connections.types';

/**
 * Help text per capability, read from `connections.capabilityHelp` in the
 * active language each time an entry is read.
 */
export const CAPABILITY_HELP = Object.defineProperties(
  {} as Record<CoreCapability, string>,
  Object.fromEntries(
    CORE_CAPABILITY_VALUES.map((capability) => [
      capability,
      {
        enumerable: true,
        get: (): string => getMessages('connections').capabilityHelp[capability],
      },
    ]),
  ),
);

/**
 * Pairs of capabilities that must never be enabled together on one connection.
 * Mirrors the backend guard so the UI can prevent the invalid state up front.
 */
export const CAPABILITY_EXCLUSIVITY_PAIRS: ReadonlyArray<
  readonly [CoreCapability, CoreCapability]
> = [['InventoryMaster', 'OfferManager']];

/**
 * Returns the currently-selected capability that blocks `capability` from
 * being enabled, or null when there is no conflict.
 */
export function getCapabilityConflict(
  selected: ReadonlySet<string> | readonly string[],
  capability: string,
): CoreCapability | null {
  const selectedSet = selected instanceof Set ? selected : new Set(selected);
  for (const [a, b] of CAPABILITY_EXCLUSIVITY_PAIRS) {
    if (capability === a && selectedSet.has(b)) return b;
    if (capability === b && selectedSet.has(a)) return a;
  }
  return null;
}

/** True when the set contains at least one mutually-exclusive pair. */
export function hasCapabilityConflict(capabilities: readonly string[]): boolean {
  const set = new Set(capabilities);
  return CAPABILITY_EXCLUSIVITY_PAIRS.some(([a, b]) => set.has(a) && set.has(b));
}

/**
 * Operator-facing explanation rendered next to a checkbox disabled by an
 * exclusivity conflict.
 */
export function capabilityConflictMessage(conflictingCapability: string): string {
  return interpolate(getMessages('connections').capabilityMetadata.conflict, {
    capability: conflictingCapability,
  });
}
