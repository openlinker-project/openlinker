/**
 * Customer Address Projection Domain Entity
 *
 * Represents a projection of customer address data for address history tracking.
 * Stores address hash (always) and optionally raw address PII fields based on
 * OL_STORE_PII configuration.
 *
 * Multiple addresses can exist for the same customer (no overwriting).
 *
 * @module libs/core/src/customers/domain/entities
 */
import { AddressType } from '../types/customer-projection.types';

export class CustomerAddressProjection {
  constructor(
    public readonly internalCustomerId: string,
    public readonly addressHash: string,
    public readonly addressType: AddressType,
    public readonly address1: string | null,
    public readonly address2: string | null,
    public readonly city: string | null,
    public readonly postcode: string | null,
    public readonly countryIso2: string | null,
    public readonly lastSeenAt: Date,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
