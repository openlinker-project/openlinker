/**
 * useOfferCreationWizard
 *
 * App-tier hook that resolves the per-platform offer-creation wizard from
 * the build-time plugin registry. Returns the registered contribution for
 * `platformType` or `null` if no plugin contributes a wizard for that
 * platform.
 *
 * **Why this lives in `app/`**: `features/` may only import `shared/` per
 * `docs/frontend-architecture.md` §"Dependency Rules" (ESLint-enforced).
 * Features that need plugin contributions go through this DI-boundary
 * hook, mirroring the established `useApiClient` precedent — never by
 * importing `plugins/` directly. (#608)
 *
 * The folder is named `plugin-bindings` (not `plugins`) so it doesn't
 * collide with the `**/plugins/**` glob in `.eslintrc.js` that blocks
 * features from reaching into the top-level `plugins/` registry directly.
 *
 * @module app/plugin-bindings
 * @see {@link resolveOfferCreationWizard} for the pure resolver
 */
import { useMemo } from 'react';

import { plugins } from '../../plugins';
import { resolveOfferCreationWizard } from '../../plugins/resolve-offer-creation-wizard';
import type { OfferCreationWizardContribution } from '../../shared/plugins';

export function useOfferCreationWizard(
  platformType: string | undefined,
): OfferCreationWizardContribution | null {
  return useMemo(
    () => (platformType ? resolveOfferCreationWizard(plugins, platformType) : null),
    [platformType],
  );
}
