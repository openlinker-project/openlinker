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
    public readonly updatedAt: Date
  ) {}
}
