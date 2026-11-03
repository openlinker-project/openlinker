/**
 * Packing onboarding query keys (#3457)
 *
 * Only the reads this feature composes itself. Everything else it shows is
 * read under the owning feature's own keys (connections, inventory,
 * who-decides), so those features' mutations keep invalidating it.
 *
 * @module features/oms-onboarding/api
 */
export const omsOnboardingQueryKeys = {
  all: ['oms-onboarding'] as const,
  fulfillmentSnapshot: () => ['oms-onboarding', 'fulfillment-snapshot'] as const,
};
