/**
 * Allegro Seller Panel URL Helper Tests
 *
 * Pure-function coverage for the six branches of `buildAllegroSellerPanelUrl`.
 *
 * @module apps/web/src/features/listings/lib
 */
import { describe, expect, it } from 'vitest';
import { buildAllegroSellerPanelUrl } from './allegro-seller-panel-url';

describe('buildAllegroSellerPanelUrl', () => {
  it('uses the production host when environment is "production"', () => {
    expect(buildAllegroSellerPanelUrl('allegro', 'production', 'offer-1')).toBe(
      'https://allegro.pl/oferta/offer-1/edit',
    );
  });

  it('uses the sandbox host when environment is "sandbox"', () => {
    expect(buildAllegroSellerPanelUrl('allegro', 'sandbox', 'offer-1')).toBe(
      'https://allegro.pl.allegrosandbox.pl/oferta/offer-1/edit',
    );
  });

  it('falls back to sandbox host when environment is undefined', () => {
    // Matches the BE adapter's getDefaultApiBaseUrl default — operators
    // most often hit this surface during sandbox onboarding.
    expect(buildAllegroSellerPanelUrl('allegro', undefined, 'offer-1')).toBe(
      'https://allegro.pl.allegrosandbox.pl/oferta/offer-1/edit',
    );
  });

  it('falls back to sandbox host on an unknown environment string', () => {
    expect(buildAllegroSellerPanelUrl('allegro', 'staging', 'offer-1')).toBe(
      'https://allegro.pl.allegrosandbox.pl/oferta/offer-1/edit',
    );
  });

  it('returns null for a non-allegro platform type', () => {
    expect(buildAllegroSellerPanelUrl('prestashop', 'production', 'offer-1')).toBeNull();
    expect(buildAllegroSellerPanelUrl(undefined, 'production', 'offer-1')).toBeNull();
  });

  it('returns null when externalOfferId is null', () => {
    expect(buildAllegroSellerPanelUrl('allegro', 'production', null)).toBeNull();
  });

  it('encodeURIComponent-escapes the offer id', () => {
    // Defends against any pathological id values from Allegro that contain
    // path-segment delimiters or query-string characters.
    expect(buildAllegroSellerPanelUrl('allegro', 'production', 'a/b?c')).toBe(
      'https://allegro.pl/oferta/a%2Fb%3Fc/edit',
    );
  });
});
