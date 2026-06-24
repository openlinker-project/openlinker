/**
 * Allegro bulk-config completeness predicate
 *
 * Pure, component-free home for `allegroBulkConfigIsComplete` (#1096). Lives in
 * this lightweight module (no React component, no lazy chunk) so BOTH the
 * lazy-loaded `AllegroBulkConfigSection` and the Allegro plugin's `isComplete`
 * hook share ONE definition without the plugin statically pulling the section
 * component into the eager graph. Mirrors `erli-offer-fields.schema.ts`.
 *
 * @module features/listings/components/allegro
 */

/**
 * Pure completeness predicate the bulk host ANDs into its `canProceed` gate.
 * An Allegro bulk config is complete once a delivery policy is chosen.
 */
export function allegroBulkConfigIsComplete(values: {
  platformParams: Record<string, unknown>;
}): boolean {
  const id = values.platformParams.deliveryPolicyId;
  return typeof id === 'string' && id !== '';
}
