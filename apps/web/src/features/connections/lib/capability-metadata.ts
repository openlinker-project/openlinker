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
import type { CoreCapability } from '../api/connections.types';

export const CAPABILITY_HELP: Record<CoreCapability, string> = {
  ProductMaster:
    'Read the product catalog (variants, attributes, categories) from this connection.',
  InventoryMaster: 'Read stock levels from this connection as the inventory source of truth.',
  OrderProcessorManager:
    'Create and manage orders in this connection (typically the destination shop).',
  OrderSource:
    'Fetch new orders from this connection (disable if orders come from a marketplace instead).',
  OfferManager: 'Manage offers and listings on this marketplace connection.',
  ProductPublisher:
    'Publish and manage shop listings owned by this connection (cross-platform listing).',
  CategoryProvisioner:
    'Create or resolve destination categories when publishing listings to this connection.',
  Invoicing: 'Issue and manage fiscal documents (invoices) through this connection.',
};

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
  return `Unavailable while ${conflictingCapability} is selected - the inventory source of truth cannot also be a stock write-back target.`;
}
