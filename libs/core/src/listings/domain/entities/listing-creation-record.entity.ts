/**
 * Listing Creation Record Domain Entity
 *
 * Tracks the lifecycle of an OL-initiated product publish onto a shop
 * destination (OL → WooCommerce / Shopify / …, #1042, ADR-024). Complements the
 * `IdentifierMapping` row (`entityType: 'ShopProduct'`) which records the
 * variant → external-product linkage once the product exists — this record
 * tracks the *publish attempt* itself, including pending state before the
 * adapter is called and structured errors when the shop rejects it.
 *
 * Immutable (anemic) per ADR-011 — state changes go through repository methods.
 *
 * @module libs/core/src/listings/domain/entities
 */

import type {
  ListingCreationError,
  ListingCreationStatus,
} from '../types/listing-creation-record.types';

export class ListingCreationRecord {
  constructor(
    public readonly id: string,
    public readonly internalVariantId: string,
    public readonly connectionId: string,
    public readonly externalProductId: string | null,
    public readonly status: ListingCreationStatus,
    public readonly errors: ListingCreationError[] | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    /**
     * Parent bulk-batch id when this publish is part of a bulk submission
     * (#1044). Null for single publishes. Appended last so single-publish
     * construction sites stay unchanged.
     */
    public readonly bulkBatchId: string | null = null,
    /**
     * Non-fatal warnings emitted by the adapter on a successful publish (#1131).
     * Null when the adapter reported no warnings. Never set on failed records.
     */
    public readonly warnings: string[] | null = null,
  ) {}
}
