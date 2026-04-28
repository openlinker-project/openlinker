/**
 * Allegro Seller Defaults Types
 *
 * Connection-level seller defaults persisted on `Connection.config.allegro
 * .sellerDefaults`. Three fields make `POST /sale/product-offers` succeed
 * on the inline-product path (when smart-link to an existing product card
 * misses) — `location` is required for every offer regardless of path
 * (#430).
 *
 * Adapter behaviour: when these are missing on a connection that attempts
 * offer creation, `AllegroOfferManagerAdapter.buildCreateOfferRequest`
 * throws `OfferCreateRejectedException` with code
 * `SELLER_DEFAULTS_NOT_CONFIGURED` directly, naming the missing fields.
 * No CORE-side mapping (avoids `core → integration` reverse dependency).
 *
 * @module libs/integrations/allegro/src/domain/types
 */
import type { PolishVoivodeship } from './allegro-location.types';

/**
 * `safetyInformation.type` discriminator. EU GPSR (Reg. 2023/988) requires
 * one of these on every `productSet[*]` payload sent to Allegro.
 *
 * - `NO_SAFETY_INFORMATION`: seller declares no safety information applies.
 * - `SAFETY_INFORMATION`: free-text content with the safety details.
 */
export const AllegroSafetyInformationTypeValues = [
  'NO_SAFETY_INFORMATION',
  'SAFETY_INFORMATION',
] as const;

export type AllegroSafetyInformationType = (typeof AllegroSafetyInformationTypeValues)[number];

/**
 * Discriminated union mirroring Allegro's `safetyInformation` shape on
 * `productSet[*]`. Only the `SAFETY_INFORMATION` branch carries free text.
 */
export type AllegroSafetyInformation =
  | { type: 'NO_SAFETY_INFORMATION' }
  | { type: 'SAFETY_INFORMATION'; content: string };

/**
 * Ship-from address sent on every offer's `body.location`. `countryCode` is
 * pinned to `'PL'` for now — multi-market support is out of scope for #430
 * (and Allegro's voivodeship enum only applies to Poland).
 */
export interface AllegroSellerLocation {
  countryCode: 'PL';
  province: PolishVoivodeship;
  city: string;
  postCode: string; // /^\d{2}-\d{3}$/
}

/**
 * Connection-level seller defaults persisted in `Connection.config.allegro
 * .sellerDefaults`. All three sub-fields are required when present;
 * partial configurations fail validation at the API DTO layer.
 */
export interface AllegroSellerDefaultsConfig {
  location: AllegroSellerLocation;
  /** Id from Allegro's `/sale/responsible-producers` registry. */
  responsibleProducerId: string;
  safetyInformation: AllegroSafetyInformation;
}
