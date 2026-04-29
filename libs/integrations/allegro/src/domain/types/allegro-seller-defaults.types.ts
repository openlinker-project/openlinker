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
 * Shape verified against Allegro Developer Portal (#445):
 *   https://developer.allegro.pl/news/gpsr-umozliwiamy-dodanie-informacji-o-bezpieczenstwie-produktu-w-postaci-opisu-tekstowego-5L0rGGoZwH0
 *   https://github.com/allegro/allegro-api/issues/10402
 *
 * - `NO_SAFETY_INFORMATION`: seller declares no safety information applies.
 *   Forbidden in some categories (cameras / electronics / etc.) — Allegro
 *   then returns `NO_SAFETY_INFORMATION_OPTION_NOT_ALLOWED`.
 * - `TEXT`: free-text safety information in `description` (1–5000 chars,
 *   no HTML, `\n` allowed, multilingual when offer crosses marketplaces).
 * - `ATTACHMENTS`: array of attachment ids in `attachments[].id` (max 20).
 *   Attachments must be uploaded separately first; the upload flow is
 *   not yet implemented (out of scope for #445).
 *
 * Earlier versions of this file used `'SAFETY_INFORMATION'` with a
 * `content` field — that shape is unrecognized by Allegro's strict
 * validator, gets silently dropped, and surfaces as the misleading
 * `SAFETY_INFO_NOT_DEFINED` error. See #445 for the diagnosis.
 */
export const AllegroSafetyInformationTypeValues = [
  'NO_SAFETY_INFORMATION',
  'TEXT',
  'ATTACHMENTS',
] as const;

export type AllegroSafetyInformationType = (typeof AllegroSafetyInformationTypeValues)[number];

/**
 * Discriminated union mirroring Allegro's `safetyInformation` shape on
 * `productSet[*]`. Only the `TEXT` branch carries free text in `description`;
 * only the `ATTACHMENTS` branch carries `attachments`.
 */
export type AllegroSafetyInformation =
  | { type: 'NO_SAFETY_INFORMATION' }
  | { type: 'TEXT'; description: string }
  | { type: 'ATTACHMENTS'; attachments: Array<{ id: string }> };

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
