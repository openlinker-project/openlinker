/**
 * Product Repository
 *
 * Repository implementation for product persistence operations.
 * Provides data access methods for finding and upserting products,
 * with conversion between domain entities and ORM entities.
 *
 * Implements ProductRepositoryPort to maintain proper dependency
 * direction and enable easy testing/mocking.
 *
 * @module libs/core/src/products/infrastructure/persistence/repositories
 * @implements {ProductRepositoryPort}
 * @see {@link ProductOrmEntity} for the database entity
 * @see {@link ProductRepositoryPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import { In, Repository } from 'typeorm';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { ProductOrmEntity } from '../entities/product.orm-entity';
import type { ProductRepositoryPort } from '../../../domain/ports/product-repository.port';
import type { Product } from '../../../domain/entities/product.entity';
import type {
  ProductListFilters,
  ProductPagination,
  ProductListSort,
  PaginatedProducts,
} from '../../../domain/types/product.types';
import { LOW_STOCK_THRESHOLD } from '../../../domain/types/product.types';
import type { StoredTaxRate } from '../../../domain/types/tax-rate.types';
import { readTaxRateUnknownReason } from '../../../domain/types/tax-rate.types';
import type {
  ConnectionTaxRateCoverage,
  TaxRateCoverage,
} from '../../../domain/types/tax-rate-coverage.types';

/**
 * Aggregated total available stock for the joined `stock` subquery alias.
 * Products with no inventory rows join to NULL and count as 0 (out of stock).
 */
const TOTAL_STOCK_EXPR = 'COALESCE(stock.total, 0)';

@Injectable()
export class ProductRepository implements ProductRepositoryPort {
  constructor(
    @InjectRepository(ProductOrmEntity)
    private readonly repository: Repository<ProductOrmEntity>
  ) {}

  async findById(id: string): Promise<Product | null> {
    const entity = await this.repository.findOne({
      where: { id },
    });

    if (!entity) {
      return null;
    }

    return this.toDomain(entity);
  }

  async findByIds(ids: string[]): Promise<Product[]> {
    if (ids.length === 0) {
      return [];
    }
    const entities = await this.repository.find({ where: { id: In(ids) } });
    return entities.map((entity) => this.toDomain(entity));
  }

  async findMany(
    filters: ProductListFilters,
    pagination: ProductPagination,
    sort?: ProductListSort
  ): Promise<PaginatedProducts> {
    const qb = this.repository.createQueryBuilder('product');

    if (filters.search) {
      const escapedSearch = filters.search.replace(/[%_]/g, '\\$&');
      qb.andWhere('(product.name ILIKE :search OR product.sku ILIKE :search)', {
        search: `%${escapedSearch}%`,
      });
    }

    if (filters.taxRateState) {
      // #2255 — the three states are a partition of the catalogue, expressed
      // against the two columns rather than a stored enum, so no writer can
      // leave them disagreeing with the data they describe.
      if (filters.taxRateState === 'missing') {
        qb.andWhere('product."taxRateReadAt" IS NOT NULL AND product."taxRate" IS NULL');
      } else if (filters.taxRateState === 'not-checked') {
        qb.andWhere('product."taxRateReadAt" IS NULL');
      } else {
        qb.andWhere('product."taxRateReadAt" IS NOT NULL AND product."taxRate" IS NOT NULL');
      }
    }

    // Stock filter/sort needs the aggregated total; join the grouped
    // inventory_items subquery only when a caller asks for it. This is a
    // read-model reporting join by table name string (#1720) - importing the
    // inventory context's ORM entity here is forbidden, and the join keeps
    // the cross-context import contract intact. Columns are camelCase in
    // Postgres and must be double-quoted in raw fragments.
    const needsStockJoin = filters.stock !== undefined || sort?.field === 'stock';
    if (needsStockJoin) {
      qb.leftJoin(
        (sub) =>
          sub
            .select('ii."productId"', 'productId')
            .addSelect('COALESCE(SUM(ii."availableQuantity"), 0)', 'total')
            .from('inventory_items', 'ii')
            // Stale rows are soft-deleted stock (#1478) - excluded so the
            // page filter agrees with the display aggregates.
            .where('ii."isStale" = false')
            .groupBy('ii."productId"'),
        'stock',
        'stock."productId" = product.id'
      );
    }

    if (filters.stock === 'out') {
      qb.andWhere(`${TOTAL_STOCK_EXPR} = 0`);
    } else if (filters.stock === 'low') {
      qb.andWhere(`${TOTAL_STOCK_EXPR} > 0 AND ${TOTAL_STOCK_EXPR} <= :lowStockThreshold`, {
        lowStockThreshold: LOW_STOCK_THRESHOLD,
      });
    } else if (filters.stock === 'oversold') {
      qb.andWhere(`${TOTAL_STOCK_EXPR} < 0`);
    }

    if (filters.unlistedOnConnectionIds && filters.unlistedOnConnectionIds.length > 0) {
      // Product has at least one variant lacking an Offer mapping for at
      // least one of the given connections (#1720 - "listing gaps"). The
      // read-model reference to product_variants/identifier_mappings stays
      // parameterized end to end.
      qb.andWhere(
        `EXISTS (
          SELECT 1
          FROM product_variants pv, unnest(ARRAY[:...unlistedOn]::uuid[]) AS c(cid)
          WHERE pv."productId" = product.id
            AND NOT EXISTS (
              SELECT 1 FROM identifier_mappings im
              WHERE im."entityType" = :offerEntityType
                AND im."internalId" = pv."id"
                AND im."connectionId" = c.cid
            )
        )`,
        {
          unlistedOn: [...filters.unlistedOnConnectionIds],
          offerEntityType: CORE_ENTITY_TYPE.Offer,
        }
      );
    }

    if (filters.sourceConnectionId) {
      // Product originates from (has a Product mapping on) this connection.
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM identifier_mappings im2
          WHERE im2."entityType" = :productEntityType
            AND im2."internalId" = product.id
            AND im2."connectionId" = :sourceConnectionId
        )`,
        {
          productEntityType: CORE_ENTITY_TYPE.Product,
          sourceConnectionId: filters.sourceConnectionId,
        }
      );
    }

    // Count on a clone taken before ordering/pagination - getManyAndCount's
    // skip/take path miscounts once a joined alias appears in ORDER BY, so
    // pagination uses raw offset/limit and the total comes from a dedicated
    // COUNT(DISTINCT product.id) query with identical WHERE/joins.
    const countQb = qb.clone();

    this.applySort(qb, sort);
    qb.offset(pagination.offset).limit(pagination.limit);

    const [entities, total] = await Promise.all([qb.getMany(), countQb.getCount()]);
    return { items: entities.map((e) => this.toDomain(e)), total };
  }

  /**
   * Apply result ordering (#1720). Omitted sort preserves the historical
   * default (createdAt DESC). Every non-default branch adds a stable
   * createdAt DESC tiebreaker so equal sort keys keep a deterministic order
   * under offset pagination.
   */
  private applySort(qb: SelectQueryBuilder<ProductOrmEntity>, sort?: ProductListSort): void {
    if (!sort) {
      qb.orderBy('product.createdAt', 'DESC');
      return;
    }
    const dir: 'ASC' | 'DESC' = sort.dir === 'asc' ? 'ASC' : 'DESC';
    switch (sort.field) {
      case 'name':
        qb.orderBy('product.name', dir);
        break;
      case 'sku':
        qb.orderBy('product.sku', dir, 'NULLS LAST');
        break;
      case 'price':
        qb.orderBy('product.price', dir, 'NULLS LAST');
        break;
      case 'updatedAt':
        qb.orderBy('product.updatedAt', dir);
        break;
      case 'stock':
        // Joined via the grouped inventory_items subquery above; no-stock
        // products sort as 0.
        qb.orderBy(TOTAL_STOCK_EXPR, dir);
        break;
      case 'createdAt':
        qb.orderBy('product.createdAt', dir);
        return;
    }
    qb.addOrderBy('product.createdAt', 'DESC');
  }

  async upsert(product: Product): Promise<Product> {
    const entity = this.toOrmEntity(product);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  /**
   * Map ORM entity to domain entity.
   *
   * TypeORM surfaces `decimal` columns as strings; `!== null` check preserves
   * `price=0` (previously coerced to `null` via truthy shortcut).
   */
  private toDomain(entity: ProductOrmEntity): Product {
    return {
      id: entity.id,
      name: entity.name,
      sku: entity.sku,
      price: entity.price !== null ? Number(entity.price) : null,
      currency: entity.currency,
      description: entity.description,
      images: entity.images,
      // Source-platform category ids (#1034). DB `null` → omit (the field is
      // optional + non-null on the domain interface); `[]` is preserved.
      categories: entity.categories ?? undefined,
      // Source-platform product-level attributes (#1752). DB `null` → omit
      // (optional + non-null on the domain interface).
      features: entity.features ?? undefined,
      // #2255 — the read surface for the tax-rate state. `taxRateReadAt` is what
      // separates "the shop has no rate" from "nobody has asked", so it travels
      // with the code rather than being inferred from its absence.
      taxRate: entity.taxRate,
      taxRateCountry: entity.taxRateCountry,
      taxRateReadAt: entity.taxRateReadAt,
      taxRateUnknownReason: readTaxRateUnknownReason(entity.taxRateUnknownReason),
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  /**
   * Map domain entity to ORM entity.
   *
   * Adapters may omit timestamps on first insert; TypeORM's @CreateDateColumn
   * and @UpdateDateColumn populate them in that case.
   */
  private toOrmEntity(product: Product): ProductOrmEntity {
    const entity = new ProductOrmEntity();
    entity.id = product.id;
    entity.name = product.name;
    entity.sku = product.sku;
    entity.price = product.price;
    entity.currency = product.currency;
    entity.description = product.description;
    entity.images = product.images;
    entity.categories = product.categories ?? null;
    entity.features = product.features ?? null;
    if (product.createdAt) entity.createdAt = product.createdAt;
    if (product.updatedAt) entity.updatedAt = product.updatedAt;
    // `taxRate` / `taxRateCountry` / `taxRateReadAt` are deliberately absent
    // here (#2054, the `order_records.cancelledAt` single-writer precedent).
    // The ordinary sync upsert carries no rate, so round-tripping them would
    // null a value `recordTaxRate` had just written - and a blanked rate holds
    // documents, so the failure would be loud and confusing rather than
    // cosmetic. `recordTaxRate` is the only writer.
    return entity;
  }

  /**
   * Record the master's answer, including the answer "no rate" (#2054).
   *
   * A targeted `update` rather than a `save`, so no other column is touched
   * and the row's own `updatedAt` is the only side effect. Writing a null code
   * with a non-null `readAt` is the whole point of the second column: it
   * records *asked, and the shop has none*, which the gate treats differently
   * from *never asked*.
   */
  async recordTaxRate(productId: string, rate: StoredTaxRate): Promise<void> {
    await this.repository.update(
      { id: productId },
      {
        taxRate: rate.code,
        taxRateCountry: rate.countryIso2,
        taxRateReadAt: rate.readAt,
        // #2264 — meaningful only alongside a null code; harmless to write
        // alongside a real one, since nothing reads it there.
        taxRateUnknownReason: rate.unknownReason ?? null,
      }
    );
  }

  async findTaxRate(productId: string): Promise<StoredTaxRate | null> {
    const row = await this.repository.findOne({
      where: { id: productId },
      select: {
        id: true,
        taxRate: true,
        taxRateCountry: true,
        taxRateReadAt: true,
        taxRateUnknownReason: true,
      },
    });
    if (!row) return null;
    return {
      code: row.taxRate,
      countryIso2: row.taxRateCountry,
      readAt: row.taxRateReadAt,
      unknownReason: readTaxRateUnknownReason(row.taxRateUnknownReason),
    };
  }

  /**
   * One grouped pass rather than three counts, so the numbers cannot disagree
   * with each other under concurrent syncs.
   */
  async countTaxRateStates(): Promise<TaxRateCoverage> {
    const row = await this.repository
      .createQueryBuilder('product')
      .select('COUNT(*)', 'total')
      .addSelect(
        `COUNT(*) FILTER (WHERE product."taxRateReadAt" IS NOT NULL AND product."taxRate" IS NOT NULL)`,
        'known'
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE product."taxRateReadAt" IS NOT NULL AND product."taxRate" IS NULL)`,
        'missing'
      )
      .addSelect(`COUNT(*) FILTER (WHERE product."taxRateReadAt" IS NULL)`, 'notChecked')
      .getRawOne<{ total: string; known: string; missing: string; notChecked: string }>();

    return {
      total: Number(row?.total ?? 0),
      known: Number(row?.known ?? 0),
      missing: Number(row?.missing ?? 0),
      notChecked: Number(row?.notChecked ?? 0),
    };
  }

  /**
   * Per-connection breakdown (#2256).
   *
   * A read-model reporting join by table NAME rather than by importing the
   * identifier-mapping context's ORM entity, which the cross-context contract
   * forbids - the same posture the stock-aggregation join in `findMany`
   * already takes. Columns are camelCase in Postgres and must stay quoted.
   */
  async countTaxRateStatesByConnection(): Promise<ConnectionTaxRateCoverage[]> {
    const rows = (await this.repository.query(
      `SELECT m."connectionId"   AS "connectionId",
              m."platformType"   AS "platformType",
              COUNT(*)                                                                        AS "total",
              COUNT(*) FILTER (WHERE p."taxRateReadAt" IS NOT NULL AND p."taxRate" IS NOT NULL) AS "known",
              COUNT(*) FILTER (WHERE p."taxRateReadAt" IS NOT NULL AND p."taxRate" IS NULL)     AS "missing",
              COUNT(*) FILTER (WHERE p."taxRateReadAt" IS NULL)                                 AS "notChecked"
         FROM "products" p
         JOIN "identifier_mappings" m
           ON m."internalId" = p."id" AND m."entityType" = $1
        GROUP BY m."connectionId", m."platformType"
        ORDER BY "missing" DESC, "notChecked" DESC`,
      [CORE_ENTITY_TYPE.Product]
    )) as Array<{
      connectionId: string;
      platformType: string;
      total: string;
      known: string;
      missing: string;
      notChecked: string;
    }>;

    return rows.map((row) => ({
      connectionId: row.connectionId,
      platformType: row.platformType,
      total: Number(row.total),
      known: Number(row.known),
      missing: Number(row.missing),
      notChecked: Number(row.notChecked),
    }));
  }
}
