/**
 * Product Publish Builder Types
 *
 * Input shape for `IProductPublishBuilderService.buildPublishProductCommand`.
 * The service resolves the OL variant + parent master product, provisions the
 * destination category (open-provenance, via `CategoryProvisioner`), projects
 * the variant's attributes into neutral `OfferParameter[]`, and produces a
 * neutral `PublishProductCommand` for any shop adapter implementing
 * `ShopProductManagerPort.publishProduct` (#1042, #1072).
 *
 * @module libs/core/src/listings/application/types
 */

import type {
  OfferParameter,
  PublishProductCommerce,
  PublishProductContent,
  PublishProductStatus,
} from '@openlinker/core/listings';

export interface BuildPublishProductCommandInput {
  /** OL internal variant id being published. */
  internalVariantId: string;
  /** Target shop connection id. */
  connectionId: string;
  /** Stock quantity to expose on the shop. */
  stock: number;
  /** Target publication state (`draft` | `published`). */
  status: PublishProductStatus;
  /**
   * Optional explicit price. When omitted, the builder resolves a price from the
   * master product (requires both amount and currency).
   */
  price?: { amount: number; currency: string };
  /** Optional owned-record content overrides; missing fields fall back to the master product. */
  content?: PublishProductContent;
  /** Optional operator-supplied commerce fields (sale price, dimensions, tax). */
  commerce?: PublishProductCommerce;
  /**
   * Optional destination category override (#1831). Present (including an empty
   * array) ⇒ the builder uses these ids verbatim and skips server-side category
   * provisioning; omitted ⇒ the builder provisions category placement as today.
   */
  destinationCategoryIds?: string[];
  /**
   * Optional neutral category parameters override (#1831). Present (including an
   * empty array) ⇒ the builder uses these verbatim and skips attribute
   * projection + the required-parameter gate; omitted ⇒ the builder projects the
   * variant's attributes as today.
   */
  parameters?: OfferParameter[];
  /** Optional idempotency key forwarded to the produced command. */
  idempotencyKey?: string;
}
