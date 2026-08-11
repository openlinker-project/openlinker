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
import { OfferCommercialSnapshotOrmEntity } from '../entities/offer-commercial-snapshot.orm-entity';
import { OfferStatusSnapshotOrmEntity } from '../entities/offer-status-snapshot.orm-entity';
import type { OfferMappingRepositoryPort } from '../../../domain/ports/offer-mapping-repository.port';
import {
  deriveOfferLifecycle,
  readValidationMessages,
} from '../../../domain/types/offer-lifecycle.types';
import { deriveVariantLabel } from '../../../domain/types/offer-mapping.types';
import type {
  OfferMappingChannelStatus,
  OfferMappingCommercial,
  OfferMappingFilters,
  OfferMappingIdentity,
  OfferMappingListItem,
  OfferMappingPagination,
  PaginatedOfferMappings,
  ProductListingsCoverage,
  StaleMappedVariant,
} from '../../../domain/types/offer-mapping.types';
import type { OfferPublicationStatus } from '../../../domain/types/offer-status-read.types';
import type { OfferStatusSnapshotDetails } from '../../../domain/types/offer-status-snapshot.types';

const OFFER_ENTITY_TYPE: CoreEntityType = CORE_ENTITY_TYPE.Offer;

/**
 * Raw shape of one enriched `findMany` row (#2025). Every joined column is
 * nullable because all four joins are LEFT joins - a mapping can outlive its
 * variant, and neither snapshot table is guaranteed to have been written yet.
 */
interface OfferMappingListRawRow {
  id: string;
  entityType: string;
  internalId: string;
  externalId: string;
  platformType: string;
  connectionId: string;
  context: IdentifierMapping['context'];
  createdAt: Date;
  updatedAt: Date;
  productId: string | null;
  productName: string | null;
  productImages: string[] | null;
  variantSku: string | null;
  variantEan: string | null;
  variantAttributes: Record<string, string> | null;
  variantIsStale: boolean | null;
  publicationStatus: OfferPublicationStatus | null;
  statusDetails: OfferStatusSnapshotDetails | null;
  lastStatusSyncedAt: Date | null;
  commercialPrice: string | null;
  commercialCurrency: string | null;
  commercialAvailableQuantity: number | null;
  lastCommercialSyncedAt: Date | null;
}

/**
 * The one publication status that means the offer is genuinely over and the
 * variant may be listed again (#1934/F2). Every other status - including
 * `inactive` / `inactivating` - describes an offer that still exists on the
 * marketplace and could be reactivated, so re-listing it would duplicate.
 */
const ENDED_PUBLICATION_STATUS = 'ended';

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

    // Cross-context read-model reporting joins onto the products context BY
    // TABLE NAME - ADR-036's sanctioned escape hatch (no cross-context
    // ORM-entity import, so the import contract stays intact; same pattern as
    // `countListedVariantsByProducts`, #1720). Columns are camelCase and must
    // be double-quoted in raw fragments.
    //
    // One query per page, never an N+1 enrichment loop: every join below is an
    // at-most-one index lookup (variant and product on their primary keys,
    // both snapshots on their unique `(externalOfferId, connectionId)` key),
    // so row cardinality is unchanged.
    qb.leftJoin('product_variants', 'pv', 'pv."id" = mapping."internalId"').leftJoin(
      'products',
      'p',
      'p."id" = pv."productId"'
    );

    // The two snapshot tables are SAME-context (listings, same persistence
    // layer), so ADR-036 does not apply to them: joining by entity class keeps
    // a table rename a compile-time break instead of the silent runtime one
    // the ADR accepts only where an import contract has to be protected.
    qb.leftJoin(
      OfferStatusSnapshotOrmEntity,
      'oss',
      'oss."externalOfferId" = mapping."externalId" ' +
        'AND oss."connectionId" = mapping."connectionId"'
    ).leftJoin(
      OfferCommercialSnapshotOrmEntity,
      'ocs',
      'ocs."externalOfferId" = mapping."externalId" ' +
        'AND ocs."connectionId" = mapping."connectionId"'
    );

    qb.where('mapping.entityType = :entityType', { entityType: OFFER_ENTITY_TYPE });

    if (filters.connectionId) {
      qb.andWhere('mapping.connectionId = :connectionId', {
        connectionId: filters.connectionId,
      });
    }

    if (filters.internalId) {
      qb.andWhere('mapping.internalId = :internalId', {
        internalId: filters.internalId,
      });
    }

    const searchTerm = filters.search?.trim();
    if (searchTerm) {
      // `\` is Postgres' default LIKE escape character, so it must be escaped
      // alongside the wildcards: a term ENDING in `\` would otherwise escape
      // the appended trailing `%` and silently make the suffix wildcard literal.
      const escapedSearch = searchTerm.replace(/[\\%_]/g, '\\$&');
      // `ean` and `gtin` are separate, independently-populated columns (each
      // master adapter fills whichever the platform exposes), so a barcode
      // search must cover both or a variant is unfindable by the code printed
      // on it. `products.sku` is the master reference many sellers call "the
      // SKU", distinct from the variant's own.
      //
      // The variant term matches attribute VALUES only. A plain
      // `attributes::text ILIKE` would also match the jsonb keys, so a search
      // for "kolor" would return every coloured variant in the catalog. The
      // `jsonb_typeof` guard is required because `jsonb_each_text` raises on
      // any non-object jsonb, which would 500 every search on the page until
      // the offending row was found.
      qb.andWhere(
        '(mapping."externalId" ILIKE :search ' +
          'OR p."name" ILIKE :search ' +
          'OR p."sku" ILIKE :search ' +
          'OR pv."sku" ILIKE :search ' +
          'OR pv."ean" ILIKE :search ' +
          'OR pv."gtin" ILIKE :search ' +
          'OR (jsonb_typeof(pv."attributes") = \'object\' ' +
          'AND EXISTS (SELECT 1 FROM jsonb_each_text(pv."attributes") attr ' +
          'WHERE attr.value ILIKE :search)))',
        { search: `%${escapedSearch}%` }
      );
    }

    // Counted before the projection/paging clauses are attached so the count
    // is unambiguously the filtered total, independent of the raw select.
    const total = await qb.getCount();

    qb.select('mapping.id', 'id')
      .addSelect('mapping.entityType', 'entityType')
      .addSelect('mapping.internalId', 'internalId')
      .addSelect('mapping.externalId', 'externalId')
      .addSelect('mapping.platformType', 'platformType')
      .addSelect('mapping.connectionId', 'connectionId')
      .addSelect('mapping.context', 'context')
      .addSelect('mapping.createdAt', 'createdAt')
      .addSelect('mapping.updatedAt', 'updatedAt')
      .addSelect('pv."productId"', 'productId')
      .addSelect('pv."sku"', 'variantSku')
      .addSelect('pv."ean"', 'variantEan')
      .addSelect('pv."attributes"', 'variantAttributes')
      .addSelect('pv."isStale"', 'variantIsStale')
      .addSelect('p."name"', 'productName')
      .addSelect('p."images"', 'productImages')
      .addSelect('oss."publicationStatus"', 'publicationStatus')
      .addSelect('oss."statusDetails"', 'statusDetails')
      .addSelect('oss."lastStatusSyncedAt"', 'lastStatusSyncedAt')
      .addSelect('ocs."price"', 'commercialPrice')
      .addSelect('ocs."currency"', 'commercialCurrency')
      .addSelect('ocs."availableQuantity"', 'commercialAvailableQuantity')
      .addSelect('ocs."lastCommercialSyncedAt"', 'lastCommercialSyncedAt');

    // `createdAt` alone is not unique, so a same-timestamp cluster could
    // repeat or skip rows across pages; the id tiebreaker makes paging total.
    qb.orderBy('mapping."createdAt"', 'DESC')
      .addOrderBy('mapping."id"', 'DESC')
      .offset(pagination.offset)
      .limit(pagination.limit);

    const rows = await qb.getRawMany<OfferMappingListRawRow>();
    return { items: rows.map((row) => this.toListItem(row)), total };
  }

  async countByConnectionAndVariants(
    connectionId: string,
    internalIds: ReadonlyArray<string>
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (internalIds.length === 0) return result;

    // An ENDED offer must not count as "already listed" (#1934/F2).
    //
    // This count is what `filterAlreadyListed` uses to silently drop a variant
    // from a bulk submit, and what the FE reads for its "already on
    // {destination}" chip. With no status predicate, a variant whose only offer
    // has ended on the marketplace was un-relistable through the wizard
    // FOREVER: the mapping row survives the offer, so the drop fired on every
    // retry and, when it was the only variant, the operator got a 400 reading
    // "requires at least one productId".
    //
    // A missing snapshot is treated as still-listed (the conservative default -
    // absence of a status read is not evidence the offer ended). `inactive` and
    // `inactivating` likewise still count: those offers exist and can be
    // reactivated, so re-listing them WOULD duplicate.
    const rows = await this.repository
      .createQueryBuilder('mapping')
      .select('mapping.internalId', 'internalId')
      .addSelect('COUNT(*)', 'count')
      // Same-context entity (see the findMany join block): by class, so a table
      // rename stays a compile-time break.
      .leftJoin(
        OfferStatusSnapshotOrmEntity,
        'snapshot',
        'snapshot."externalOfferId" = mapping."externalId" ' +
          'AND snapshot."connectionId" = mapping."connectionId"'
      )
      .where('mapping.entityType = :entityType', { entityType: OFFER_ENTITY_TYPE })
      .andWhere('mapping.connectionId = :connectionId', { connectionId })
      .andWhere('mapping.internalId IN (:...internalIds)', { internalIds })
      .andWhere('(snapshot."publicationStatus" IS NULL OR snapshot."publicationStatus" != :ended)', {
        ended: ENDED_PUBLICATION_STATUS,
      })
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
      // Cross-context read-model reporting join onto the products-context
      // table by name (ADR-036) - no cross-context ORM-entity import, so the
      // import contract stays intact (#1720; columns are camelCase and must
      // be double-quoted in raw fragments).
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

  async findStaleMappedVariants(
    connectionId: string,
    options: { limit: number; staleSince: Date }
  ): Promise<readonly StaleMappedVariant[]> {
    const rows = await this.repository
      .createQueryBuilder('mapping')
      .select('pv."id"', 'variantId')
      .addSelect('mapping.externalId', 'externalOfferId')
      .addSelect('pv."staleAt"', 'staleAt')
      // Cross-context read-model reporting join onto the products-context
      // table by name (ADR-036) - no cross-context ORM-entity import,
      // mirroring countListedVariantsByProducts (#1720; columns are camelCase
      // and must be double-quoted in raw fragments).
      .innerJoin('product_variants', 'pv', 'pv."id" = mapping."internalId"')
      .where('mapping.entityType = :entityType', { entityType: OFFER_ENTITY_TYPE })
      .andWhere('mapping.connectionId = :connectionId', { connectionId })
      .andWhere('pv."isStale" = true')
      .andWhere('pv."staleAt" >= :staleSince', { staleSince: options.staleSince })
      .orderBy('pv."staleAt"', 'DESC')
      .take(options.limit)
      .getRawMany<{ variantId: string; externalOfferId: string; staleAt: Date }>();

    return rows.map((row) => ({
      variantId: row.variantId,
      externalOfferId: row.externalOfferId,
      staleAt: row.staleAt,
    }));
  }

  private toListItem(row: OfferMappingListRawRow): OfferMappingListItem {
    return {
      id: row.id,
      entityType: row.entityType,
      internalId: row.internalId,
      externalId: row.externalId,
      platformType: row.platformType,
      connectionId: row.connectionId,
      context: row.context ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      identity: this.toIdentity(row),
      channelStatus: this.toChannelStatus(row),
      commercial: this.toCommercial(row),
    };
  }

  private toIdentity(row: OfferMappingListRawRow): OfferMappingIdentity | null {
    // `productId` comes from the variant join: its absence is what says the
    // mapping's `internalId` no longer resolves to a live variant.
    if (row.productId === null) return null;
    return {
      productId: row.productId,
      productName: row.productName,
      variantLabel: deriveVariantLabel(row.variantAttributes),
      sku: row.variantSku,
      ean: row.variantEan,
      imageUrl: row.productImages?.[0] ?? null,
      isStale: row.variantIsStale ?? false,
    };
  }

  private toChannelStatus(row: OfferMappingListRawRow): OfferMappingChannelStatus {
    // No snapshot row is the majority state on a large catalog (the scan is
    // hourly at 100 offers/tick), so it gets its own bucket rather than a
    // `null` that would leave the row on no lifecycle tab at all.
    if (row.publicationStatus === null || row.lastStatusSyncedAt === null) {
      return {
        publicationStatus: null,
        lifecycle: 'Unsynced',
        validationMessages: [],
        lastStatusSyncedAt: null,
      };
    }
    return {
      publicationStatus: row.publicationStatus,
      lifecycle: deriveOfferLifecycle(row.publicationStatus, row.statusDetails),
      validationMessages: readValidationMessages(row.statusDetails),
      lastStatusSyncedAt: row.lastStatusSyncedAt,
    };
  }

  private toCommercial(row: OfferMappingListRawRow): OfferMappingCommercial | null {
    if (row.lastCommercialSyncedAt === null) return null;
    return {
      // `numeric` arrives as a string through the driver - an explicit cast
      // keeps the wire value a number rather than "100.00".
      price: row.commercialPrice === null ? null : Number(row.commercialPrice),
      currency: row.commercialCurrency,
      availableQuantity: row.commercialAvailableQuantity,
      lastCommercialSyncedAt: row.lastCommercialSyncedAt,
    };
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
