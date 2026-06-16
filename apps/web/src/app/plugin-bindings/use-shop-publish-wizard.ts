/**
 * useShopPublishWizard
 *
 * App-tier hook that resolves the per-platform shop-publish wizard from
 * the build-time plugin registry. Returns the registered contribution for
 * `platformType` or `null` if no plugin contributes a wizard for that
 * platform.
 *
 * **Why this lives in `app/`**: `features/` may only import `shared/` per
 * `docs/frontend-architecture.md` §"Dependency Rules" (ESLint-enforced).
 * Features that need plugin contributions go through this DI-boundary
 * hook, mirroring the established `useApiClient` precedent — never by
 * importing `plugins/` directly. (#1044)
 *
 * The folder is named `plugin-bindings` (not `plugins`) so it doesn't
 * collide with the `**/ plugins; /**` glob in `.eslintrc.js` that blocks
 * features from reaching into the top-level `plugins/` registry directly.
 *
 * @module app/plugin-bindings
 * @see {@link resolveShopPublishWizard} for the pure resolver
 */
import { useMemo } from 'react';

import { plugins } from '../../plugins';
import { resolveShopPublishWizard } from '../../plugins/resolve-shop-publish-wizard';
import type { ShopProductPublishWizardContribution } from '../../shared/plugins';

export function useShopPublishWizard(
  platformType: string | undefined,
): ShopProductPublishWizardContribution | null {
  return useMemo(
    () => (platformType ? resolveShopPublishWizard(plugins, platformType) : null),
    [platformType],
  );
}
