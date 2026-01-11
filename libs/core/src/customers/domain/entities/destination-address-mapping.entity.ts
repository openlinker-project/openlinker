/**
 * Destination Address Mapping Domain Entity
 *
 * Represents a mapping between an internal customer address (identified by
 * addressHash) and a destination-specific address ID (e.g., PrestaShop address ID).
 *
 * This enables address reuse across orders without adding Address to
 * IdentifierMapping. Addresses are treated as fingerprints, stored via
 * (internalCustomerId, destinationConnectionId, addressHash, addressType) → destinationAddressId.
 *
 * @module libs/core/src/customers/domain/entities
 */
import { AddressType } from '../types/customer-projection.types';

export class DestinationAddressMapping {
  constructor(
    public readonly internalCustomerId: string,
    public readonly destinationConnectionId: string,
    public readonly addressHash: string,
    public readonly addressType: AddressType,
    public readonly destinationAddressId: string,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
