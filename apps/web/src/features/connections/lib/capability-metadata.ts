/**
 * Capability Metadata
 *
 * Single source of the operator-facing capability help copy and the
 * capability mutual-exclusivity rules shared by the connection setup wizards
 * (PrestaShop, WooCommerce) and the edit-time ConnectionCapabilitiesPanel.
 *
 * The exclusivity rule is expressed in capability terms only - a stock source
 * of truth (InventoryMaster) must never also be a stock write-back target
 * (OfferManager) on the same connection, and a catalog master (ProductMaster)
 * must never also be a publish target (ProductPublisher) - so no platformType dispatch is
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
    ])
  )
);

type ConflictMessageKey = 'conflict' | 'conflictMasterPublisher';

interface CapabilityExclusivityRule {
  readonly pair: readonly [CoreCapability, CoreCapability];
  /** Key in `connections.capabilityMetadata` holding this pair's copy. */
  readonly messageKey: ConflictMessageKey;
}

/**
 * Pairs of capabilities that must never be enabled together on one connection,
 * each with the copy that explains it. Mirrors the backend guard so the UI can
 * prevent the invalid state up front; a new pair adds one row here.
 */
const CAPABILITY_EXCLUSIVITY_RULES: ReadonlyArray<CapabilityExclusivityRule> = [
  { pair: ['InventoryMaster', 'OfferManager'], messageKey: 'conflict' },
  // #3985: what OL publishes to a shop is read back by its own master sync.
  { pair: ['ProductMaster', 'ProductPublisher'], messageKey: 'conflictMasterPublisher' },
];

export const CAPABILITY_EXCLUSIVITY_PAIRS: ReadonlyArray<
  readonly [CoreCapability, CoreCapability]
> = CAPABILITY_EXCLUSIVITY_RULES.map((rule) => rule.pair);

/**
 * Returns the currently-selected capability that blocks `capability` from
 * being enabled, or null when there is no conflict.
 */
export function getCapabilityConflict(
  selected: ReadonlySet<string> | readonly string[],
  capability: string
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

/** True when the set holds both ProductMaster and ProductPublisher (#3985). */
export function hasMasterPublisherConflict(capabilities: readonly string[]): boolean {
  const set = new Set(capabilities);
  return set.has('ProductMaster') && set.has('ProductPublisher');
}

/**
 * Operator-facing explanation rendered next to a checkbox disabled by an
 * exclusivity conflict.
 */
export function capabilityConflictMessage(conflictingCapability: string): string {
  const copy = getMessages('connections').capabilityMetadata;
  const rule = CAPABILITY_EXCLUSIVITY_RULES.find(({ pair }) =>
    (pair as readonly string[]).includes(conflictingCapability)
  );
  return interpolate(copy[rule?.messageKey ?? 'conflict'], {
    capability: conflictingCapability,
  });
}
