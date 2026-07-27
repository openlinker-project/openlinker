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
import { QueryFailedError, Repository } from 'typeorm';
import type { CoreEntityType } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { IdentifierMapping } from '@openlinker/core/identifier-mapping';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import type { OfferMappingRepositoryPort } from '../../../domain/ports/offer-mapping-repository.port';
import type {
  OfferMappingFilters,
  OfferMappingPagination,
  PaginatedOfferMappings,
  ProductListingsCoverage,
} from '../../../domain/types/offer-mapping.types';

const OFFER_ENTITY_TYPE: CoreEntityType = CORE_ENTITY_TYPE.Offer;

@Injectable()
export class OfferMappingRepository implements OfferMappingRepositoryPort {
  constructor(
    @InjectRepository(IdentifierMappingOrmEntity)
    private readonly repository: Repository<IdentifierMappingOrmEntity>
  ) {}

  async findById(id: string): Promise<IdentifierMapping | null> {
    try {
      const entity = await this.repository.findOne({
        where: { id, entityType: OFFER_ENTITY_TYPE },
      });
      if (!entity) return null;
      return this.toDomain(entity);
    } catch (error) {
      // Handle invalid UUID format - PostgreSQL throws QueryFailedError
      // when trying to query with a non-UUID string
      if (
        error instanceof QueryFailedError &&
        'code' in error &&
        error.code === '22P02' // PostgreSQL invalid input syntax error code
      ) {
        return null;
      }
      throw error;
    }
  }

  async findMany(
    filters: OfferMappingFilters,
    pagination: OfferMappingPagination
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

    qb.orderBy('mapping.createdAt', 'DESC').skip(pagination.offset).take(pagination.limit);

    const [entities, total] = await qb.getManyAndCount();
    return { items: entities.map((e) => this.toDomain(e)), total };
  }

  async countByConnectionAndVariants(
    connectionId: string,
    internalIds: ReadonlyArray<string>
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

  async countListedVariantsByProducts(
    productIds: readonly string[]
  ): Promise<readonly ProductListingsCoverage[]> {
    if (productIds.length === 0) return [];

    const rows = await this.repository
      .createQueryBuilder('mapping')
      .select('pv."productId"', 'productId')
      .addSelect('mapping.connectionId', 'connectionId')
      .addSelect('mapping.platformType', 'platformType')
      .addSelect('COUNT(DISTINCT mapping.internalId)', 'listedVariants')
      // Read-model reporting join onto the products-context table by name -
      // no cross-context ORM-entity import, so the import contract stays
      // intact (#1720; columns are camelCase and must be double-quoted in
      // raw fragments).
      .innerJoin('product_variants', 'pv', 'pv."id" = mapping."internalId"')
      .where('mapping.entityType = :entityType', { entityType: OFFER_ENTITY_TYPE })
      .andWhere('pv."productId" IN (:...productIds)', { productIds: [...productIds] })
      .groupBy('pv."productId"')
      .addGroupBy('mapping.connectionId')
      .addGroupBy('mapping.platformType')
      .getRawMany<{
        productId: string;
        connectionId: string;
        platformType: string;
        listedVariants: string;
      }>();

    // COUNT(DISTINCT) comes back as bigint (string) through TypeORM's
    // raw-query path - explicit Number() cast surfaces the right shape.
    return rows.map((row) => ({
      productId: row.productId,
      connectionId: row.connectionId,
      platformType: row.platformType,
      listedVariants: Number(row.listedVariants),
    }));
  }

  private toDomain(entity: IdentifierMappingOrmEntity): IdentifierMapping {
    return new IdentifierMapping(
      entity.id,
      entity.entityType,
      entity.internalId,
      entity.externalId,
      entity.platformType,
      entity.connectionId,
      entity.context ?? null,
      entity.createdAt,
      entity.updatedAt
    );
  }
}
