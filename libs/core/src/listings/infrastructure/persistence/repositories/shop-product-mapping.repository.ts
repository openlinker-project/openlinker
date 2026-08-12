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
import type {
  FindRecentlyListedVariantIdsOptions,
  ProductListingsCoverage,
  RecentlyListedVariant,
} from '../../../domain/types/offer-mapping.types';

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
      // raw fragments). Mirrors OfferMappingRepository.countListedVariantsByProducts.
      .innerJoin('product_variants', 'pv', 'pv."id" = mapping."internalId"')
      .where('mapping.entityType = :entityType', { entityType: SHOP_PRODUCT_ENTITY_TYPE })
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

  async findRecentlyListedVariantIds(
    options: FindRecentlyListedVariantIdsOptions
  ): Promise<RecentlyListedVariant[]> {
    const qb = this.repository
      .createQueryBuilder('mapping')
      .select('mapping.internalId', 'internalId')
      .addSelect('pv."productId"', 'productId')
      .addSelect('MAX(mapping.createdAt)', 'latestMappedAt')
      // Read-model reporting join onto the products-context table by name -
      // no cross-context ORM-entity import (mirrors OfferMappingRepository).
      .innerJoin('product_variants', 'pv', 'pv."id" = mapping."internalId"')
      .where('mapping.entityType = :entityType', { entityType: SHOP_PRODUCT_ENTITY_TYPE })
      .andWhere('pv."isStale" IS NOT TRUE')
      .groupBy('mapping.internalId')
      .addGroupBy('pv."productId"')
      .orderBy('"latestMappedAt"', 'DESC')
      .limit(options.limit);

    if (options.connectionId) {
      qb.andWhere('mapping.connectionId = :connectionId', { connectionId: options.connectionId });
    }

    const rows = await qb.getRawMany<{ internalId: string; productId: string }>();
    return rows.map((row) => ({ variantId: row.internalId, productId: row.productId }));
  }
}
