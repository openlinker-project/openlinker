/**
 * Allegro Location Types
 *
 * Polish voivodeship enum + display labels — backs the `province` field on
 * `productSet[*]` `location` (offer-level ship-from address). Allegro's
 * `POST /sale/product-offers` validator rejects `INVALID_STATE` on
 * `location.state` for any value not in this set, surfaced in the
 * 2026-04-28 sandbox repro that motivated #430.
 *
 * `as const` runtime array per engineering-standards.md "Union Types"
 * pattern; the FE Select reads the same array (re-exported via package
 * barrel) so the values stay aligned without a duplicated mirror.
 *
 * @module libs/integrations/allegro/src/domain/types
 */

export const PolishVoivodeshipValues = [
  'DOLNOSLASKIE',
  'KUJAWSKO_POMORSKIE',
  'LUBELSKIE',
  'LUBUSKIE',
  'LODZKIE',
  'MALOPOLSKIE',
  'MAZOWIECKIE',
  'OPOLSKIE',
  'PODKARPACKIE',
  'PODLASKIE',
  'POMORSKIE',
  'SLASKIE',
  'SWIETOKRZYSKIE',
  'WARMINSKO_MAZURSKIE',
  'WIELKOPOLSKIE',
  'ZACHODNIOPOMORSKIE',
] as const;

export type PolishVoivodeship = (typeof PolishVoivodeshipValues)[number];
