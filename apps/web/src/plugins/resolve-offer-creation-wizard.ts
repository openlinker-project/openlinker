/**
 * resolveOfferCreationWizard
 *
 * Pure helper: walks a plugin list and returns the first plugin whose
 * `offerCreationWizard` contribution matches `platformType`, or `null` if
 * none. Consumed by the `app/`-tier hook `useOfferCreationWizard` — never
 * imported directly from `features/` or `pages/` (FE dep rules, #608).
 *
 * "First match wins" mirrors how `routes` and `navItems` are merged
 * elsewhere in the registry. Duplicate contributions for the same
 * `platformType` would be a registry-construction bug; a stronger guard
 * (warn / throw) can be layered in later if the need arises.
 *
 * @module plugins
 */
import type { OfferCreationWizardContribution, WebPlugin } from './plugin.types';

export function resolveOfferCreationWizard(
  plugins: ReadonlyArray<WebPlugin>,
  platformType: string,
): OfferCreationWizardContribution | null {
  for (const plugin of plugins) {
    const contribution = plugin.offerCreationWizard;
    if (contribution && contribution.platformType === platformType) {
      return contribution;
    }
  }
  return null;
}
