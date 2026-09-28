/**
 * Packing onboarding — public surface (#3457)
 *
 * The "Pack orders in OpenLinker" wizard, its status page, and the Settings
 * tile. Consumed by `pages/oms/oms-onboarding-page.tsx` and
 * `pages/settings/settings-page.tsx`.
 *
 * @module features/oms-onboarding
 * @see docs/frontend-architecture.md § Feature public surface
 */
export { OmsOnboarding } from './components/oms-onboarding';
export type { OmsOnboardingProps } from './components/oms-onboarding';
export { OmsOnboardingTile } from './components/oms-onboarding-tile';
export { omsOnboardingCopy } from './lib/oms-onboarding.copy';
