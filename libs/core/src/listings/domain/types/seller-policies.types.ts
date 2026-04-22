/**
 * Seller Policies Types
 *
 * Canonical shape returned by `OfferManagerPort.fetchSellerPolicies?()` —
 * the neutral view of seller-configured policies (delivery, return,
 * warranty, implied-warranty) that an operator must reference when
 * creating a marketplace offer. Allegro-specific IDs today; other
 * marketplaces that need analogous policies would map their platform
 * shape into the same structure.
 *
 * Framework-free. Interface-layer DTOs decorate these fields with
 * Swagger annotations separately.
 *
 * @module libs/core/src/listings/domain/types
 */

export interface SellerPolicy {
  /** Platform-native policy id passed back through `CreateOfferCommand.overrides.platformParams`. */
  id: string;
  /** Operator-facing label for dropdown display. */
  name: string;
}

export interface SellerPolicies {
  deliveryPolicies: SellerPolicy[];
  returnPolicies: SellerPolicy[];
  warranties: SellerPolicy[];
  impliedWarranties: SellerPolicy[];
}
