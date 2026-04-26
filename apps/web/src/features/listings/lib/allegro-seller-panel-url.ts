/**
 * Allegro Seller Panel URL Helper
 *
 * Pure derivation of the Allegro seller-panel deep link for an offer.
 * Mirrors the BE adapter's environment → host switch in
 * `libs/integrations/allegro/src/application/allegro-adapter.factory.ts`
 * (see `getDefaultApiBaseUrl`). Returns null when the platform is not
 * 'allegro' or the external offer id is missing.
 *
 * @module apps/web/src/features/listings/lib
 */

/**
 * Build the Allegro seller-panel "edit offer" deep link.
 *
 * @param platformType — connection platform type; non-'allegro' returns null
 * @param environment — 'sandbox' | 'production'; unknown / missing falls back
 *   to sandbox (same default as the BE adapter — operators most often hit this
 *   surface during sandbox onboarding)
 * @param externalOfferId — Allegro offer id from `OfferCreationRecord`; null
 *   means the offer hasn't yet been created externally and there's nothing
 *   to deep-link to
 */
export function buildAllegroSellerPanelUrl(
  platformType: string | undefined,
  environment: string | undefined,
  externalOfferId: string | null,
): string | null {
  if (platformType !== 'allegro' || !externalOfferId) return null;
  const host = environment === 'production' ? 'allegro.pl' : 'allegro.pl.allegrosandbox.pl';
  return `https://${host}/oferta/${encodeURIComponent(externalOfferId)}/edit`;
}
