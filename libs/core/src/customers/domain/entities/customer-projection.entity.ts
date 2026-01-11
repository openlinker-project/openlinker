/**
 * Customer Projection Domain Entity
 *
 * Represents a lightweight projection of customer data stored in OpenLinker
 * for debugging, retry support, and future routing. This is a non-authoritative
 * projection (Model C) - customers remain destination-owned (Model A).
 *
 * The projection stores emailHash (always) and optionally raw PII fields
 * based on OL_STORE_PII configuration.
 *
 * @module libs/core/src/customers/domain/entities
 */
export class CustomerProjection {
  constructor(
    public readonly internalCustomerId: string,
    public readonly emailHash: string,
    public readonly normalizedEmail: string | null,
    public readonly firstName: string | null,
    public readonly lastName: string | null,
    public readonly lastSeenAt: Date,
    public readonly lastSourceConnectionId: string | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
