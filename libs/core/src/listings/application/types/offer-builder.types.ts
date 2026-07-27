/**
 * Offer Builder Types
 *
 * Input shape for `IOfferBuilderService.buildCreateOfferCommand`. The service
 * resolves the OL variant + parent master product, resolves the Allegro
 * category, and produces a neutral `CreateOfferCommand` consumed by any
 * marketplace adapter implementing `OfferManagerPort.createOffer`.
 *
 * @module libs/core/src/listings/application/types
 */

import type { CreateOfferOverrides, OfferCondition } from '@openlinker/core/listings';

export interface BuildCreateOfferCommandInput {
  /** OL internal variant id being listed. */
  internalVariantId: string;
  /** Target marketplace connection id (e.g. Allegro). */
  connectionId: string;
  /**
   * Optional explicit price. When omitted, the builder tries to resolve a
   * price from the master product (requires both amount and currency).
   */
  price?: { amount: number; currency: string };
  /**
   * Offered quantity. Always required — the builder does not read inventory;
   * the caller decides how much stock to expose per offer.
   */
  stock: number;
  /** Whether the resulting command should ask the adapter to publish immediately. */
  publishImmediately?: boolean;
  /** Overrides and platform-specific fields passed through to the command. */
  overrides?: CreateOfferOverrides;
  /**
   * Optional explicit item condition (#1500). When omitted the builder defaults
   * to `'new'` so every produced command carries a condition. An operator's
   * condition parameter picked in the wizard rides on `overrides.parameters`
   * instead and is honoured by the destination adapter independently of this
   * field (the adapter never double-sets condition).
   */
  condition?: OfferCondition;
  /**
   * Optional idempotency key forwarded to the produced `CreateOfferCommand`.
   * Adapters may use it for unique external references on the marketplace
   * (see Allegro's `external.id` handling).
   */
  idempotencyKey?: string;
}
