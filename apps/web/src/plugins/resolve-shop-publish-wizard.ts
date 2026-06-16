/**
 * resolveShopPublishWizard
 *
 * Pure helper: walks a plugin list and returns the first plugin whose
 * `build.shopProductPublishWizard` contribution matches `platformType`, or
 * `null` if none. Consumed by the `app/`-tier hook `useShopPublishWizard`
 * — never imported directly from `features/` or `pages/` (FE dep rules,
 * #1044).
 *
 * "First match wins" mirrors how `routes` and `navItems` are merged
 * elsewhere in the registry. Duplicate contributions for the same
 * `platformType` would be a registry-construction bug; a stronger guard
 * (warn / throw) can be layered in later if the need arises.
 *
 * @module plugins
 */
import type { ShopProductPublishWizardContribution, OpenLinkerPlugin } from '../shared/plugins';

export function resolveShopPublishWizard(
  plugins: ReadonlyArray<OpenLinkerPlugin>,
  platformType: string,
): ShopProductPublishWizardContribution | null {
  for (const plugin of plugins) {
    const contribution = plugin.build?.shopProductPublishWizard;
    if (contribution && contribution.platformType === platformType) {
      return contribution;
    }
  }
  return null;
}
