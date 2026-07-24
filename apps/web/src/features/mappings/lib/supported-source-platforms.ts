/**
 * Supported source platforms for order mapping (#1784)
 *
 * The platform types whose connections may configure order mappings today.
 * A source connection outside this list routes to the "unsupported" state on
 * the mappings page instead of showing the mapping tabs.
 *
 * FE-ONLY GATE (by decision, #1784): this list lives only on the front end.
 * The mapping API stays open on capability, so an operator can still add
 * mappings for an unlisted pair by calling the API directly in an emergency
 * (as was done earlier for presta -> erli). Do NOT mirror this into a
 * server-side guard without an explicit decision to close that escape hatch.
 *
 * @module apps/web/src/features/mappings/lib
 */

export const SUPPORTED_SOURCE_PLATFORMS = ['allegro', 'erli'] as const;

export function isSupportedSourcePlatform(platformType: string | undefined): boolean {
  if (!platformType) return false;
  return (SUPPORTED_SOURCE_PLATFORMS as readonly string[]).includes(platformType);
}
