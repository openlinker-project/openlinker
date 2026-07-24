/**
 * Shop Product Mapping Repository
 *
 * Repository implementation for shop-product mapping counts. Queries the
 * identifier_mappings table scoped to entityType = 'ShopProduct'. The shop-side
 * sibling of `OfferMappingRepository.countByConnectionAndVariants`, backing the
 * destination-aware duplicate guard (#1837).
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 * @implements {ShopProductMappingRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CoreEntityType } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import type { ShopProductMappingRepositoryPort } from '../../../domain/ports/shop-product-mapping-repository.port';

const SHOP_PRODUCT_ENTITY_TYPE: CoreEntityType = CORE_ENTITY_TYPE.ShopProduct;

@Injectable()
export class ShopProductMappingRepository implements ShopProductMappingRepositoryPort {
  constructor(
    @InjectRepository(IdentifierMappingOrmEntity)
    private readonly repository: Repository<IdentifierMappingOrmEntity>
  ) {}

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
      .where('mapping.entityType = :entityType', { entityType: SHOP_PRODUCT_ENTITY_TYPE })
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
}
