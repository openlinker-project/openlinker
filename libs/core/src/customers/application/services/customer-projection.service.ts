/**
 * Customer Projection Service
 *
 * Implements customer projection operations, handling PII toggle logic
 * and delegating to repository for persistence. Respects OL_STORE_PII
 * configuration: when false, only hashes are stored; emailHash is always persisted.
 *
 * @module libs/core/src/customers/application/services
 * @implements {ICustomerProjectionService}
 * @see {@link CustomerProjectionRepositoryPort} for persistence port
 */
import { Injectable, Inject } from '@nestjs/common';
import type { ICustomerProjectionService } from '../interfaces/customer-projection.service.interface';
import { CustomerProjectionRepositoryPort } from '../../domain/ports/customer-projection-repository.port';
import { CustomerProjection } from '../../domain/entities/customer-projection.entity';
import { CustomerAddressProjection } from '../../domain/entities/customer-address-projection.entity';
import type { DestinationAddressMapping } from '../../domain/entities/destination-address-mapping.entity';
import { getPiiConfig } from '@openlinker/shared/config';
import { CUSTOMER_PROJECTION_REPOSITORY_TOKEN } from '../../customers.tokens';

@Injectable()
export class CustomerProjectionService implements ICustomerProjectionService {
  private readonly piiConfig = getPiiConfig();

  constructor(
    @Inject(CUSTOMER_PROJECTION_REPOSITORY_TOKEN)
    private readonly repository: CustomerProjectionRepositoryPort
  ) {}

  async getProjection(internalCustomerId: string): Promise<CustomerProjection | null> {
    return this.repository.findById(internalCustomerId);
  }

  async upsertProjection(projection: CustomerProjection): Promise<CustomerProjection> {
    // If PII storage is disabled, clear PII fields but keep emailHash
    const projectionToSave = this.piiConfig.storePii
      ? projection
      : new CustomerProjection(
          projection.internalCustomerId,
          projection.emailHash,
          null, // normalizedEmail
          null, // firstName
          null, // lastName
          projection.lastSeenAt,
          projection.lastSourceConnectionId,
          projection.createdAt,
          projection.updatedAt
        );

    return this.repository.upsert(projectionToSave);
  }

  async upsertAddressProjection(
    address: CustomerAddressProjection
  ): Promise<CustomerAddressProjection> {
    // If PII storage is disabled, clear PII fields but keep addressHash
    const addressToSave = this.piiConfig.storePii
      ? address
      : new CustomerAddressProjection(
          address.internalCustomerId,
          address.addressHash,
          address.addressType,
          null, // address1
          null, // address2
          null, // city
          null, // postcode
          null, // countryIso2
          address.lastSeenAt,
          address.createdAt,
          address.updatedAt
        );

    return this.repository.upsertAddress(addressToSave);
  }

  async upsertDestinationAddressMapping(
    mapping: DestinationAddressMapping
  ): Promise<DestinationAddressMapping> {
    // Destination address mapping doesn't contain PII, so no filtering needed
    return this.repository.upsertDestinationAddressMapping(mapping);
  }
}
