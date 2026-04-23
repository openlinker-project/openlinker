/**
 * Offer Mapping Repository
 *
 * Repository implementation for offer mapping read operations.
 * Queries the identifier_mappings table scoped to entityType = 'Offer'.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 * @implements {OfferMappingRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  IdentifierMappingOrmEntity,
  IdentifierMapping,
  EntityType,
} from '@openlinker/core/identifier-mapping';
import { OfferMappingRepositoryPort } from '../../../domain/ports/offer-mapping-repository.port';
import {
  OfferMappingFilters,
  OfferMappingPagination,
  PaginatedOfferMappings,
} from '../../../domain/types/offer-mapping.types';

const OFFER_ENTITY_TYPE: EntityType = 'Offer';

@Injectable()
export class OfferMappingRepository implements OfferMappingRepositoryPort {
  constructor(
    @InjectRepository(IdentifierMappingOrmEntity)
    private readonly repository: Repository<IdentifierMappingOrmEntity>,
  ) {}

  async findById(id: string): Promise<IdentifierMapping | null> {
    const entity = await this.repository.findOne({
      where: { id, entityType: OFFER_ENTITY_TYPE },
    });
    if (!entity) return null;
    return this.toDomain(entity);
  }

  async findMany(
    filters: OfferMappingFilters,
    pagination: OfferMappingPagination,
  ): Promise<PaginatedOfferMappings> {
    const qb = this.repository.createQueryBuilder('mapping');

    qb.where('mapping.entityType = :entityType', { entityType: OFFER_ENTITY_TYPE });

    if (filters.connectionId) {
      qb.andWhere('mapping.connectionId = :connectionId', {
        connectionId: filters.connectionId,
      });
    }

    if (filters.platformType) {
      qb.andWhere('mapping.platformType = :platformType', {
        platformType: filters.platformType,
      });
    }

    if (filters.internalId) {
      qb.andWhere('mapping.internalId = :internalId', {
        internalId: filters.internalId,
      });
    }

    if (filters.search) {
      const escapedSearch = filters.search.replace(/[%_]/g, '\\$&');
      qb.andWhere('mapping.externalId ILIKE :search', {
        search: `%${escapedSearch}%`,
      });
    }

    qb.orderBy('mapping.createdAt', 'DESC')
      .skip(pagination.offset)
      .take(pagination.limit);

    const [entities, total] = await qb.getManyAndCount();
    return { items: entities.map((e) => this.toDomain(e)), total };
  }

  async countByConnectionAndVariants(
    connectionId: string,
    internalIds: ReadonlyArray<string>,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (internalIds.length === 0) return result;

    const rows = await this.repository
      .createQueryBuilder('mapping')
      .select('mapping.internalId', 'internalId')
      .addSelect('COUNT(*)', 'count')
      .where('mapping.entityType = :entityType', { entityType: OFFER_ENTITY_TYPE })
      .andWhere('mapping.connectionId = :connectionId', { connectionId })
      .andWhere('mapping.internalId IN (:...internalIds)', { internalIds })
      .groupBy('mapping.internalId')
      .getRawMany<{ internalId: string; count: string }>();

    for (const row of rows) {
      const count = Number(row.count);
      if (count > 0) result.set(row.internalId, count);
    }
    return result;
  }

  private toDomain(entity: IdentifierMappingOrmEntity): IdentifierMapping {
    return new IdentifierMapping(
      entity.id,
      entity.entityType as EntityType,
      entity.internalId,
      entity.externalId,
      entity.platformType,
      entity.connectionId,
      entity.context ?? null,
      entity.createdAt,
      entity.updatedAt,
    );
  }
}
