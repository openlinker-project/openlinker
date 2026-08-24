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
import type { SelectQueryBuilder } from 'typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Logger } from '@openlinker/shared/logging';
import type { CoreEntityType } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { IdentifierMapping } from '@openlinker/core/identifier-mapping';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import { OfferCommercialSnapshotOrmEntity } from '../entities/offer-commercial-snapshot.orm-entity';
import { OfferStatusSnapshotOrmEntity } from '../entities/offer-status-snapshot.orm-entity';
import { UnfilterableOfferLifecycleException } from '../../../domain/exceptions/unfilterable-offer-lifecycle.exception';
import type { OfferMappingRepositoryPort } from '../../../domain/ports/offer-mapping-repository.port';
import {
  OFFER_VALIDATION_MESSAGES_KEY,
  emptyOfferLifecycleCounts,
  listSnapshotFactsForLifecycle,
  readValidationMessages,
  resolveOfferLifecycle,
} from '../../../domain/types/offer-lifecycle.types';
import { readValidationProblems } from '../../../domain/types/offer-validation-problem.types';
import type {
  OfferLifecycle,
  OfferLifecycleCounts,
} from '../../../domain/types/offer-lifecycle.types';
import { deriveVariantLabel } from '../../../domain/types/offer-mapping.types';
import type {
  OfferMappingChannelStatus,
  OfferMappingCommercial,
  OfferMappingCountFilters,
  FindRecentlyListedVariantIdsOptions,
  OfferMappingFilters,
  OfferMappingIdentity,
  OfferMappingListItem,
  OfferMappingPagination,
  PaginatedIdentifierMappings,
  PaginatedOfferMappings,
  ProductListingsCoverage,
  RecentlyListedVariant,
  StaleMappedVariant,
} from '../../../domain/types/offer-mapping.types';
import {
  isOfferPublicationStatus,
  OfferPublicationStatusValues,
} from '../../../domain/types/offer-status-read.types';
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
  /**
   * Deliberately `string | null`, not `OfferPublicationStatus | null`: the
   * column is unconstrained `text`, so declaring the union here would be a
   * type-level claim about the DATA the schema does not enforce. Narrowed
   * through `readPublicationStatus` before anything classifies it.
   */
  publicationStatus: string | null;
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

/**
 * Whether the status-snapshot LEFT join actually found a row (#2026). Mirrors
 * the pair of null checks `toChannelStatus` makes, so a row the list renders
 * as `Unsynced` is the same row this counts as `Unsynced`.
 */
const HAS_STATUS_SNAPSHOT_SQL =
  '(oss."publicationStatus" IS NOT NULL AND oss."lastStatusSyncedAt" IS NOT NULL)';

/**
 * Whether the snapshot's `publicationStatus` is a value `resolveOfferLifecycle`
 * can actually classify (#2032 review thread 1). `readPublicationStatus` folds
 * an out-of-union value to `null` - the same treatment as "no snapshot" - so
 * the Unsynced predicate must be the complement of BOTH conditions, not just
 * `HAS_STATUS_SNAPSHOT_SQL`. Generated from `OfferPublicationStatusValues`
 * rather than hand-written so a union change updates this WHERE clause too.
 */
const RECOGNISED_STATUS_SQL = `oss."publicationStatus" IN (${OfferPublicationStatusValues.map(
  (value) => `'${value}'`
).join(', ')})`;

/**
 * The one snapshot fact that is not a plain column: does the detail blob carry
 * validator messages. A `CASE` rather than an `AND` chain because Postgres
 * does not promise to short-circuit `AND`, and `jsonb_array_length` RAISES on
 * a non-array - which would 500 the whole page over one malformed row (the
 * same trap the search predicate's `jsonb_typeof` guard avoids). `CASE` does
 * guarantee only the taken branch is evaluated, and the `ELSE` makes the
 * expression total, so it is safe to GROUP BY and to negate.
 */
const HAS_VALIDATION_MESSAGES_SQL =
  `(CASE WHEN jsonb_typeof(oss."statusDetails" -> '${OFFER_VALIDATION_MESSAGES_KEY}') = 'array' ` +
  `THEN jsonb_array_length(oss."statusDetails" -> '${OFFER_VALIDATION_MESSAGES_KEY}') > 0 ` +
  `ELSE false END)`;

/** Raw shape of one `countByLifecycle` group (#2026). */
interface OfferLifecycleCountRawRow {
  /** Unconstrained `text` - see `OfferMappingListRawRow.publicationStatus`. */
  publicationStatus: string | null;
  hasStatusSnapshot: boolean;
  hasValidationMessages: boolean;
  count: string;
}

@Injectable()
export class OfferMappingRepository implements OfferMappingRepositoryPort {
  private readonly logger = new Logger(OfferMappingRepository.name);

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
    pagination: OfferMappingPagination,
    options?: { skipTotal?: boolean }
  ): Promise<PaginatedOfferMappings> {
    const qb = this.buildFilteredQuery(filters);

    if (filters.lifecycle) {
      this.applyLifecycleFilter(qb, filters.lifecycle);
    }

    // Counted before the projection/paging clauses are attached so the count
    // is unambiguously the filtered total, independent of the raw select.
    // Skipped when the caller already has the total from `countByLifecycle`
    // under the same filters (#2032 review thread 3) - see the port docblock.
    const total = options?.skipTotal ? -1 : await qb.getCount();

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

  async findMappingPage(
    filters: OfferMappingFilters,
    pagination: OfferMappingPagination
  ): Promise<PaginatedIdentifierMappings> {
    const qb = this.repository.createQueryBuilder('mapping');

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
      const escapedSearch = this.escapeIlikeTerm(searchTerm);
      qb.andWhere('mapping.externalId ILIKE :search', { search: `%${escapedSearch}%` });
    }

    // Same tiebreaker as `findMany` - `createdAt` alone can repeat across a
    // same-timestamp cluster.
    qb.orderBy('mapping.createdAt', 'DESC')
      .addOrderBy('mapping.id', 'DESC')
      .skip(pagination.offset)
      .take(pagination.limit);

    const [entities, total] = await qb.getManyAndCount();
    return { items: entities.map((entity) => this.toDomain(entity)), total };
  }

  async countByLifecycle(filters: OfferMappingCountFilters): Promise<OfferLifecycleCounts> {
    // One aggregate pass over the join `findMany` already builds - far cheaper
    // than five predicated counts or a second endpoint, and it reuses the same
    // predicates so a tab count can never describe a different row set than
    // the tab's own page.
    //
    // Grouped by the RAW snapshot facts, never by a bucket: the lifecycle rule
    // stays in `resolveOfferLifecycle` and is applied to each group below.
    // That is what keeps SQL and TypeScript from drifting - there is no second
    // implementation of the rule to drift from.
    const rows = await this.buildFilteredQuery(filters)
      .select('oss."publicationStatus"', 'publicationStatus')
      .addSelect(HAS_STATUS_SNAPSHOT_SQL, 'hasStatusSnapshot')
      .addSelect(HAS_VALIDATION_MESSAGES_SQL, 'hasValidationMessages')
      // DISTINCT to match what `findMany`'s `getCount()` compiles to
      // (`COUNT(DISTINCT("mapping"."id"))`), not because today's joins can
      // duplicate a row - they cannot, every one is unique-indexed on exactly
      // its join key. `buildFilteredQuery` guarantees the two paths share their
      // PREDICATES; it does not guarantee cardinality, so the day a 1:N join is
      // added there the tab counts would silently inflate past the total while
      // the list de-duplicated. Same count shape means that cannot happen.
      .addSelect('COUNT(DISTINCT mapping.id)', 'count')
      .groupBy('oss."publicationStatus"')
      .addGroupBy(HAS_STATUS_SNAPSHOT_SQL)
      .addGroupBy(HAS_VALIDATION_MESSAGES_SQL)
      .getRawMany<OfferLifecycleCountRawRow>();

    const counts = emptyOfferLifecycleCounts();
    for (const row of rows) {
      const publicationStatus = this.readPublicationStatus(row.publicationStatus);
      const facts =
        publicationStatus === null || !row.hasStatusSnapshot
          ? null
          : {
              publicationStatus,
              hasValidationMessages: row.hasValidationMessages,
            };
      // COUNT comes back as bigint (string) through the raw-query path.
      counts[resolveOfferLifecycle(facts)] += Number(row.count);
    }
    return counts;
  }

  /**
   * Narrow a persisted `publicationStatus` onto the closed neutral union.
   *
   * `offer_status_snapshots."publicationStatus"` is unconstrained `text`, so
   * `resolveOfferLifecycle`'s exhaustive switch is total over the UNION but not
   * over the COLUMN. Left untreated, an out-of-union value falls off the end of
   * the switch as `undefined`: in the fold it lands on a stray `counts` key
   * (`NaN`), disappears from all five buckets and serialises as
   * `"undefined": null`; on the per-row path it produces a row on no tab. Both
   * are silent under-counts that break the partition guarantee the whole design
   * rests on.
   *
   * An unrecognised value is therefore folded into `Unsynced` - "no status we
   * can read", which is honest and keeps the partition intact - and warn-logged
   * so the condition is visible rather than merely survivable.
   */
  /**
   * Escape Postgres' ILIKE metacharacters in a user-supplied search term
   * before it's wrapped in `%...%` (#2032 review round 2, finding 10 -
   * extracted so the escaping rule has exactly one definition, not two
   * copies that could silently drift). `\` is Postgres' default LIKE escape
   * character, so it must be escaped alongside the wildcards: a term ENDING
   * in `\` would otherwise escape the appended trailing `%` and silently
   * make the suffix wildcard literal.
   */
  private escapeIlikeTerm(term: string): string {
    return term.replace(/[\\%_]/g, '\\$&');
  }

  private readPublicationStatus(value: string | null): OfferPublicationStatus | null {
    if (value === null) return null;
    if (isOfferPublicationStatus(value)) return value;
    this.logger.warn(
      `offer_status_snapshots."publicationStatus" holds "${value}", which is outside ` +
        'OfferPublicationStatusValues. Classifying the row as Unsynced. This needs a data ' +
        'migration or a union change - see offer-status-read.types.ts.'
    );
    return null;
  }

  /**
   * The join + filter shape shared by the list and its tab counts (#2025 /
   * #2026). Extracted so neither can gain a predicate the other lacks: two
   * copies of these clauses is exactly how a count starts disagreeing with the
   * page it labels.
   *
   * Takes the wider `OfferMappingFilters` and deliberately never reads
   * `lifecycle`: the bucket narrowing is the ONE clause the two callers must
   * not share, so `findMany` attaches it afterwards via `applyLifecycleFilter`
   * and `countByLifecycle` (whose `OfferMappingCountFilters` cannot carry one)
   * never does.
   */
  private buildFilteredQuery(
    filters: OfferMappingFilters
  ): SelectQueryBuilder<IdentifierMappingOrmEntity> {
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
      const escapedSearch = this.escapeIlikeTerm(searchTerm);
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

    return qb;
  }

  /**
   * Narrow the query to one lifecycle bucket (#2026).
   *
   * The predicate is GENERATED from `listSnapshotFactsForLifecycle`, which
   * runs the TypeScript rule over the closed fact space - so reclassifying a
   * publication status changes this WHERE clause with no SQL edit, and there
   * is no hand-written second copy of the rule that could disagree with the
   * per-row derivation.
   */
  private applyLifecycleFilter(
    qb: SelectQueryBuilder<IdentifierMappingOrmEntity>,
    lifecycle: OfferLifecycle
  ): void {
    // `Unsynced` is the complement of every snapshot fact - the absence of the
    // joined row, which no fact combination can express. Branched on the bucket
    // BY NAME rather than on "the rule yielded no facts", because an empty fact
    // set means two different things: this bucket, OR a bucket that is not
    // expressible from `OfferSnapshotFacts` at all. Conflating them would serve
    // the Unsynced page for a future bucket keyed on variant staleness /
    // snapshot age / a creation-record field - a wrong page, no error, no
    // failing type-check, in a design where everything else fails loudly.
    if (lifecycle === 'Unsynced') {
      qb.andWhere(`NOT (${HAS_STATUS_SNAPSHOT_SQL} AND ${RECOGNISED_STATUS_SQL})`);
      return;
    }

    const facts = listSnapshotFactsForLifecycle(lifecycle);
    if (facts.length === 0) {
      throw new UnfilterableOfferLifecycleException(lifecycle);
    }

    // A status whose BOTH message-presence values land in this bucket needs no
    // jsonb inspection at all, so it collapses into a plain indexed `IN` - the
    // Active and Ended tabs, i.e. the common case, never touch the blob.
    const factsByStatus = new Map<OfferPublicationStatus, boolean[]>();
    for (const { publicationStatus, hasValidationMessages } of facts) {
      const seen = factsByStatus.get(publicationStatus) ?? [];
      seen.push(hasValidationMessages);
      factsByStatus.set(publicationStatus, seen);
    }

    const unconditionalStatuses: OfferPublicationStatus[] = [];
    const terms: string[] = [];
    const parameters: Record<string, unknown> = {};

    for (const [publicationStatus, messagePresence] of factsByStatus) {
      // Each fact combination is enumerated once, so more than one entry here
      // means both `true` and `false` map to this bucket.
      if (messagePresence.length > 1) {
        unconditionalStatuses.push(publicationStatus);
        continue;
      }
      const key = `lifecycleStatus${String(terms.length)}`;
      parameters[key] = publicationStatus;
      terms.push(
        `(oss."publicationStatus" = :${key} AND ` +
          `${messagePresence[0] ? '' : 'NOT '}${HAS_VALIDATION_MESSAGES_SQL})`
      );
    }

    if (unconditionalStatuses.length > 0) {
      parameters.lifecycleStatuses = unconditionalStatuses;
      terms.push('oss."publicationStatus" IN (:...lifecycleStatuses)');
    }

    qb.andWhere(`${HAS_STATUS_SNAPSHOT_SQL} AND (${terms.join(' OR ')})`, parameters);
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
    // Narrowed, not trusted: the column is unconstrained text, so an
    // out-of-union value must not reach the exhaustive switch (see
    // `readPublicationStatus`). It reads as Unsynced here for the same reason
    // it does in the counts - one rule, one treatment of a value we cannot map.
    const publicationStatus = this.readPublicationStatus(row.publicationStatus);
    // No snapshot row is the majority state on a large catalog (the scan is
    // hourly at 100 offers/tick), so it gets its own bucket rather than a
    // `null` that would leave the row on no lifecycle tab at all.
    if (publicationStatus === null || row.lastStatusSyncedAt === null) {
      return {
        publicationStatus: null,
        lifecycle: 'Unsynced',
        validationMessages: [],
        validationProblems: [],
        lastStatusSyncedAt: null,
      };
    }
    const validationMessages = readValidationMessages(row.statusDetails);
    return {
      publicationStatus,
      // Same function the tab counts fold their groups through (#2026), fed
      // the same two facts - the list and its counts share one rule.
      lifecycle: resolveOfferLifecycle({
        publicationStatus,
        hasValidationMessages: validationMessages.length > 0,
      }),
      validationMessages,
      // Read from the same blob, by its own guarded reader (#2231). Deliberately
      // NOT derived from `validationMessages`: a message list carries no code and
      // no scope, so a shop-level block would be indistinguishable from an
      // offer-level one and would be stamped on every row.
      validationProblems: readValidationProblems(row.statusDetails),
      lastStatusSyncedAt: row.lastStatusSyncedAt,
    };
  }

  private toCommercial(row: OfferMappingListRawRow): OfferMappingCommercial | null {
    if (row.lastCommercialSyncedAt === null) return null;
    return {
      // Kept as the driver's decimal STRING, not coerced to `number` (#2032
      // review thread 6) - `numeric` arrives as a string specifically to
      // avoid float64 precision loss, and a `Number()` cast here would
      // discard that precision one hop before the wire.
      price: row.commercialPrice,
      currency: row.commercialCurrency,
      availableQuantity: row.commercialAvailableQuantity,
      lastCommercialSyncedAt: row.lastCommercialSyncedAt,
    };
  }

  /**
   * Backs the coverage-gap / stock-at-risk candidate pools (#1983). No
   * supporting index covers this shape — `identifier_mappings` only carries
   * `(entityType, platformType, connectionId, externalId)` and
   * `(entityType, connectionId, internalId)`, neither of which serves an
   * `entityType`-only filter grouped + ordered by `MAX(createdAt)`. Left as a
   * full-partition scan deliberately: this is an on-demand operator read
   * (the needs-attention panel), not a hot path — add a supporting index if
   * it starts showing up in slow-query logs.
   */
  async findRecentlyListedVariantIds(
    options: FindRecentlyListedVariantIdsOptions
  ): Promise<RecentlyListedVariant[]> {
    const qb = this.repository
      .createQueryBuilder('mapping')
      .select('mapping.internalId', 'internalId')
      .addSelect('pv."productId"', 'productId')
      .addSelect('MAX(mapping.createdAt)', 'latestMappedAt')
      // Read-model reporting join onto the products-context table by name -
      // no cross-context ORM-entity import (mirrors countListedVariantsByProducts).
      .innerJoin('product_variants', 'pv', 'pv."id" = mapping."internalId"')
      .where('mapping.entityType = :entityType', { entityType: OFFER_ENTITY_TYPE })
      .andWhere('pv."isStale" IS NOT TRUE')
      .groupBy('mapping.internalId')
      .addGroupBy('pv."productId"')
      .orderBy('"latestMappedAt"', 'DESC')
      .limit(options.limit);

    if (options.connectionId) {
      qb.andWhere('mapping.connectionId = :connectionId', { connectionId: options.connectionId });
    }

    const rows = await qb.getRawMany<{
      internalId: string;
      productId: string;
      latestMappedAt: Date;
    }>();
    return rows.map((row) => ({
      variantId: row.internalId,
      productId: row.productId,
      latestMappedAt: new Date(row.latestMappedAt),
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
