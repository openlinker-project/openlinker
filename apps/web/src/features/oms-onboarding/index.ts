/**
 * Packing onboarding — public surface (#3457)
 *
 * The "Pack orders in OpenLinker" wizard, its status page, and the Settings
 * tile. Consumed by `pages/oms/oms-onboarding-page.tsx` and
 * `pages/settings/settings-page.tsx`.
 *
 * `useOmsOnboardingCopy` is exported for one reader only: the page shell
 * (`pages/oms/oms-onboarding-page.tsx`) takes its title and description from
 * it, so the shell and the wizard cannot word the page differently (#4017).
 *
 * @module features/oms-onboarding
 * @see docs/frontend-architecture.md § Feature public surface
 */
export { OmsOnboarding } from './components/oms-onboarding';
export type { OmsOnboardingProps } from './components/oms-onboarding';
export { readSourcingClaim } from './lib/config-merge';
export { useOmsOnboardingCopy } from './hooks/use-oms-onboarding-copy';
