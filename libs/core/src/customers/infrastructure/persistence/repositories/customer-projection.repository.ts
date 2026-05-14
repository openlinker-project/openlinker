/**
 * Customer Projection Repository
 *
 * Repository implementation for customer projection persistence operations.
 * Provides data access methods for finding and upserting customer projections,
 * with conversion between domain entities and ORM entities.
 *
 * Implements CustomerProjectionRepositoryPort to maintain proper dependency
 * direction and enable easy testing/mocking.
 *
 * @module libs/core/src/customers/infrastructure/persistence/repositories
 * @implements {CustomerProjectionRepositoryPort}
 * @see {@link CustomerProjectionOrmEntity} for the database entity
 * @see {@link CustomerProjectionRepositoryPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerProjectionOrmEntity } from '../entities/customer-projection.orm-entity';
import { CustomerAddressProjectionOrmEntity } from '../entities/customer-address-projection.orm-entity';
import { DestinationAddressMappingOrmEntity } from '../entities/destination-address-mapping.orm-entity';
import type { CustomerProjectionRepositoryPort } from '../../../domain/ports/customer-projection-repository.port';
import { CustomerProjection } from '../../../domain/entities/customer-projection.entity';
import { CustomerAddressProjection } from '../../../domain/entities/customer-address-projection.entity';
import { DestinationAddressMapping } from '../../../domain/entities/destination-address-mapping.entity';
import type {
  AddressType,
  CustomerProjectionFilters,
  CustomerProjectionPagination,
  PaginatedCustomerProjections,
} from '../../../domain/types/customer-projection.types';

@Injectable()
export class CustomerProjectionRepository implements CustomerProjectionRepositoryPort {
  constructor(
    @InjectRepository(CustomerProjectionOrmEntity)
    private readonly customerRepository: Repository<CustomerProjectionOrmEntity>,
    @InjectRepository(CustomerAddressProjectionOrmEntity)
    private readonly addressRepository: Repository<CustomerAddressProjectionOrmEntity>,
    @InjectRepository(DestinationAddressMappingOrmEntity)
    private readonly mappingRepository: Repository<DestinationAddressMappingOrmEntity>
  ) {}

  async findById(internalCustomerId: string): Promise<CustomerProjection | null> {
    const entity = await this.customerRepository.findOne({
      where: { internalCustomerId },
    });

    if (!entity) {
      return null;
    }

    return this.toDomainCustomer(entity);
  }

  async findMany(
    filters: CustomerProjectionFilters,
    pagination: CustomerProjectionPagination
  ): Promise<PaginatedCustomerProjections> {
    const qb = this.customerRepository.createQueryBuilder('customer');

    if (filters.search) {
      const escapedSearch = filters.search.replace(/[%_]/g, '\\$&');
      qb.where(
        '(customer.emailHash ILIKE :search OR customer.normalizedEmail ILIKE :search OR customer.firstName ILIKE :search OR customer.lastName ILIKE :search)',
        { search: `%${escapedSearch}%` }
      );
    }

    if (filters.lastSourceConnectionId) {
      qb.andWhere('customer.lastSourceConnectionId = :connectionId', {
        connectionId: filters.lastSourceConnectionId,
      });
    }

    qb.orderBy('customer.lastSeenAt', 'DESC').skip(pagination.offset).take(pagination.limit);

    const [entities, total] = await qb.getManyAndCount();
    return { items: entities.map((e) => this.toDomainCustomer(e)), total };
  }

  async findByEmailHash(emailHash: string): Promise<CustomerProjection[]> {
    const entities = await this.customerRepository.find({
      where: { emailHash },
    });

    return entities.map((entity) => this.toDomainCustomer(entity));
  }

  async upsert(projection: CustomerProjection): Promise<CustomerProjection> {
    const entity = this.toOrmCustomer(projection);
    // TypeORM save() performs upsert on primary key (internalCustomerId)
    const saved = await this.customerRepository.save(entity);
    return this.toDomainCustomer(saved);
  }

  async findAddressesByCustomerId(
    internalCustomerId: string
  ): Promise<CustomerAddressProjection[]> {
    const entities = await this.addressRepository.find({
      where: { internalCustomerId },
    });

    return entities.map((entity) => this.toDomainAddress(entity));
  }

  async upsertAddress(address: CustomerAddressProjection): Promise<CustomerAddressProjection> {
    const entity = this.toOrmAddress(address);
    // TypeORM save() performs upsert on composite primary key
    const saved = await this.addressRepository.save(entity);
    return this.toDomainAddress(saved);
  }

  async findDestinationAddressMapping(
    internalCustomerId: string,
    destinationConnectionId: string,
    addressHash: string,
    addressType: AddressType
  ): Promise<DestinationAddressMapping | null> {
    const entity = await this.mappingRepository.findOne({
      where: {
        internalCustomerId,
        destinationConnectionId,
        addressHash,
        addressType,
      },
    });

    if (!entity) {
      return null;
    }

    return this.toDomainMapping(entity);
  }

  async upsertDestinationAddressMapping(
    mapping: DestinationAddressMapping
  ): Promise<DestinationAddressMapping> {
    const entity = this.toOrmMapping(mapping);
    // TypeORM save() performs upsert on composite primary key
    const saved = await this.mappingRepository.save(entity);
    return this.toDomainMapping(saved);
  }

  private toDomainCustomer(entity: CustomerProjectionOrmEntity): CustomerProjection {
    return new CustomerProjection(
      entity.internalCustomerId,
      entity.emailHash,
      entity.normalizedEmail,
      entity.firstName,
      entity.lastName,
      entity.lastSeenAt,
      entity.lastSourceConnectionId,
      entity.createdAt,
      entity.updatedAt
    );
  }

  private toOrmCustomer(projection: CustomerProjection): CustomerProjectionOrmEntity {
    const entity = new CustomerProjectionOrmEntity();
    entity.internalCustomerId = projection.internalCustomerId;
    entity.emailHash = projection.emailHash;
    entity.normalizedEmail = projection.normalizedEmail;
    entity.firstName = projection.firstName;
    entity.lastName = projection.lastName;
    entity.lastSeenAt = projection.lastSeenAt;
    entity.lastSourceConnectionId = projection.lastSourceConnectionId;
    entity.createdAt = projection.createdAt;
    entity.updatedAt = projection.updatedAt;
    return entity;
  }

  private toDomainAddress(entity: CustomerAddressProjectionOrmEntity): CustomerAddressProjection {
    return new CustomerAddressProjection(
      entity.internalCustomerId,
      entity.addressHash,
      entity.addressType as AddressType,
      entity.address1,
      entity.address2,
      entity.city,
      entity.postcode,
      entity.countryIso2,
      entity.lastSeenAt,
      entity.createdAt,
      entity.updatedAt
    );
  }

  private toOrmAddress(address: CustomerAddressProjection): CustomerAddressProjectionOrmEntity {
    const entity = new CustomerAddressProjectionOrmEntity();
    entity.internalCustomerId = address.internalCustomerId;
    entity.addressHash = address.addressHash;
    entity.addressType = address.addressType;
    entity.address1 = address.address1;
    entity.address2 = address.address2;
    entity.city = address.city;
    entity.postcode = address.postcode;
    entity.countryIso2 = address.countryIso2;
    entity.lastSeenAt = address.lastSeenAt;
    entity.createdAt = address.createdAt;
    entity.updatedAt = address.updatedAt;
    return entity;
  }

  private toDomainMapping(entity: DestinationAddressMappingOrmEntity): DestinationAddressMapping {
    return new DestinationAddressMapping(
      entity.internalCustomerId,
      entity.destinationConnectionId,
      entity.addressHash,
      entity.addressType as AddressType,
      entity.destinationAddressId,
      entity.createdAt,
      entity.updatedAt
    );
  }

  private toOrmMapping(mapping: DestinationAddressMapping): DestinationAddressMappingOrmEntity {
    const entity = new DestinationAddressMappingOrmEntity();
    entity.internalCustomerId = mapping.internalCustomerId;
    entity.destinationConnectionId = mapping.destinationConnectionId;
    entity.addressHash = mapping.addressHash;
    entity.addressType = mapping.addressType;
    entity.destinationAddressId = mapping.destinationAddressId;
    entity.createdAt = mapping.createdAt;
    entity.updatedAt = mapping.updatedAt;
    return entity;
  }
}
