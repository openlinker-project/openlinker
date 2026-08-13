/**
 * Destination Category Repository (#1979, ADR-037)
 *
 * TypeORM-backed implementation of `DestinationCategoryRepositoryPort`.
 *
 * Upsert design mirrors `ProductContentFieldRepository`: the unique key spans a
 * nullable column via two PARTIAL unique indexes, so the conflict target must
 * repeat the index predicate and is branched per scope. A single-statement
 * `INSERT ... ON CONFLICT DO UPDATE` also makes the sync concurrency-safe by
 * construction — a find-then-save would race two runs over the same scope.
 *
 * Every statement binds its inputs as `$n` parameters; nothing is interpolated
 * (the `search` query reaches this class from an operator today and from an MCP
 * tool in Wave 4).
 *
 * ORM <-> domain mapping is private to this class, and deliberately drops
 * `searchText` — it is an index-serving derivation, not domain data.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { normalizeCategorySearchText } from '../../../domain/destination-category-search';
import { TaxonomyOwnerValues } from '../../../domain/types/taxonomy-owner.types';
import type { TaxonomyOwner } from '../../../domain/types/taxonomy-owner.types';
import { DestinationCategory } from '../../../domain/entities/destination-category.entity';
import type { DestinationCategoryRepositoryPort } from '../../../domain/ports/destination-category-repository.port';
import type {
  DestinationCategorySearchHit,
  DestinationCategoryUpsert,
  TaxonomyScope,
} from '../../../domain/types/destination-category.types';
import type { CategoryPathSegment } from '../../../domain/types/category.types';
import { DestinationCategoryOrmEntity } from '../entities/destination-category.orm-entity';

/**
 * Escape the LIKE metacharacters so a query is matched literally.
 *
 * The value is already a bound parameter (no injection), but `%` and `_` are
 * still wildcards *inside* the value: an unescaped `%` would match every row in
 * the scope, and `50%` would match far more than an operator meant. Escaping the
 * QUERY only — never the stored column — keeps stored names matchable verbatim.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

interface CategoryRow {
  taxonomyOwner: string | null;
  connectionId: string | null;
  externalId: string;
  name: string;
  parentId: string | null;
  leaf: boolean | null;
  syncedAt: string | Date;
}

/**
 * Walks each hit UP to its root, then reverses, so the caller gets a
 * root -> leaf breadcrumb. Anchored on the hit ids rather than the whole tree,
 * so the recursion is bounded by depth x limit, not by table size.
 */
const BREADCRUMB_SQL = `
  WITH RECURSIVE seed AS (
    SELECT "externalId", "parentId", "name", "externalId" AS "hitId", 0 AS depth
    FROM destination_categories
    WHERE $1::text IS NOT DISTINCT FROM "taxonomyOwner"
      AND $2::uuid IS NOT DISTINCT FROM "connectionId"
      AND "externalId" = ANY($3::text[])
    UNION ALL
    SELECT p."externalId", p."parentId", p."name", s."hitId", s.depth + 1
    FROM destination_categories p
    JOIN seed s ON p."externalId" = s."parentId"
    WHERE $1::text IS NOT DISTINCT FROM p."taxonomyOwner"
      AND $2::uuid IS NOT DISTINCT FROM p."connectionId"
  )
  SELECT "hitId", "externalId", "name", depth FROM seed ORDER BY "hitId", depth DESC
`;

@Injectable()
export class DestinationCategoryRepository implements DestinationCategoryRepositoryPort {
  constructor(
    @InjectRepository(DestinationCategoryOrmEntity)
    private readonly ormRepository: Repository<DestinationCategoryOrmEntity>,
  ) {}

  async browse(scope: TaxonomyScope, parentId: string | null): Promise<DestinationCategory[]> {
    const rows = (await this.ormRepository.query(
      `
        SELECT "taxonomyOwner", "connectionId", "externalId", "name", "parentId", "leaf", "syncedAt"
        FROM destination_categories
        WHERE $1::text IS NOT DISTINCT FROM "taxonomyOwner"
          AND $2::uuid IS NOT DISTINCT FROM "connectionId"
          AND $3::text IS NOT DISTINCT FROM "parentId"
        ORDER BY "name" ASC
      `,
      [scope.taxonomyOwner, scope.connectionId, parentId],
    )) as CategoryRow[];

    return rows.map((row) => this.toDomain(row));
  }

  async search(
    scope: TaxonomyScope,
    query: string,
    limit: number,
  ): Promise<DestinationCategorySearchHit[]> {
    const normalized = normalizeCategorySearchText(query);
    if (normalized.length === 0) {
      return [];
    }

    const rows = (await this.ormRepository.query(
      `
        SELECT "taxonomyOwner", "connectionId", "externalId", "name", "parentId", "leaf", "syncedAt"
        FROM destination_categories
        WHERE $1::text IS NOT DISTINCT FROM "taxonomyOwner"
          AND $2::uuid IS NOT DISTINCT FROM "connectionId"
          AND "searchText" LIKE '%' || $3 || '%' ESCAPE '\\'
        ORDER BY length("searchText") ASC, "name" ASC
        LIMIT $4
      `,
      [scope.taxonomyOwner, scope.connectionId, escapeLikePattern(normalized), limit],
    )) as CategoryRow[];

    if (rows.length === 0) {
      return [];
    }

    const paths = await this.loadBreadcrumbs(
      scope,
      rows.map((row) => row.externalId),
    );

    return rows.map((row) => ({
      category: this.toDomain(row),
      path: paths.get(row.externalId) ?? [{ id: row.externalId, name: row.name }],
    }));
  }

  async upsertMany(
    scope: TaxonomyScope,
    nodes: readonly DestinationCategoryUpsert[],
    syncedAt: Date,
  ): Promise<number> {
    if (nodes.length === 0) {
      return 0;
    }

    // Postgres rejects a multi-row INSERT whose ON CONFLICT target matches the
    // same row twice ("cannot affect row a second time"). `nodes` comes straight
    // from an external adapter, so a platform returning a duplicated id under one
    // parent would otherwise crash the whole sync instead of degrading. Last
    // occurrence wins, matching the DO UPDATE semantics.
    const deduped = [...new Map(nodes.map((node) => [node.externalId, node])).values()];

    // The conflict target must repeat the partial index's predicate, so the two
    // scope shapes take different statements — same branching as
    // `ProductContentFieldRepository`'s master/channel split.
    const isOwnerScoped = scope.taxonomyOwner !== null;
    const conflictTarget = isOwnerScoped
      ? '("taxonomyOwner", "externalId") WHERE "taxonomyOwner" IS NOT NULL'
      : '("connectionId", "externalId") WHERE "connectionId" IS NOT NULL';

    // One multi-row INSERT: ($1,$2) carry the scope, then five params per node.
    const params: unknown[] = [scope.taxonomyOwner, scope.connectionId, syncedAt];
    const valueTuples = deduped.map((node) => {
      const base = params.length;
      params.push(
        node.externalId,
        node.name,
        node.parentId,
        node.leaf,
        normalizeCategorySearchText(node.name),
      );
      return `($1, $2, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $3)`;
    });

    await this.ormRepository.query(
      `
        INSERT INTO destination_categories
          ("taxonomyOwner", "connectionId", "externalId", "name", "parentId", "leaf", "searchText", "syncedAt")
        VALUES ${valueTuples.join(', ')}
        ON CONFLICT ${conflictTarget}
        DO UPDATE SET
          "name"       = EXCLUDED."name",
          "parentId"   = EXCLUDED."parentId",
          "leaf"       = EXCLUDED."leaf",
          "searchText" = EXCLUDED."searchText",
          "syncedAt"   = EXCLUDED."syncedAt",
          "updatedAt"  = now()
      `,
      params,
    );

    return deduped.length;
  }

  async deleteStaleBelow(scope: TaxonomyScope, syncedAt: Date): Promise<number> {
    const result = (await this.ormRepository.query(
      `
        DELETE FROM destination_categories
        WHERE $1::text IS NOT DISTINCT FROM "taxonomyOwner"
          AND $2::uuid IS NOT DISTINCT FROM "connectionId"
          AND "syncedAt" < $3
      `,
      [scope.taxonomyOwner, scope.connectionId, syncedAt],
    )) as [unknown[], number];

    // TypeORM returns [rows, affectedCount] for a DELETE on the pg driver.
    return Array.isArray(result) && typeof result[1] === 'number' ? result[1] : 0;
  }

  private async loadBreadcrumbs(
    scope: TaxonomyScope,
    hitIds: string[],
  ): Promise<Map<string, CategoryPathSegment[]>> {
    const rows = (await this.ormRepository.query(BREADCRUMB_SQL, [
      scope.taxonomyOwner,
      scope.connectionId,
      hitIds,
    ])) as { hitId: string; externalId: string; name: string }[];

    const byHit = new Map<string, CategoryPathSegment[]>();
    for (const row of rows) {
      const segments = byHit.get(row.hitId) ?? [];
      segments.push({ id: row.externalId, name: row.name });
      byHit.set(row.hitId, segments);
    }
    return byHit;
  }

  /**
   * Narrow the stored owner instead of casting it: if a value is ever removed
   * from `TaxonomyOwnerValues` while rows survive, an unchecked cast would leak
   * an invalid `TaxonomyOwner` into the domain. Unknown values read as `null`
   * (the row is orphaned, not silently mistyped).
   */
  private toTaxonomyOwner(value: string | null): TaxonomyOwner | null {
    return value !== null && (TaxonomyOwnerValues as readonly string[]).includes(value)
      ? (value as TaxonomyOwner)
      : null;
  }

  private toDomain(row: CategoryRow): DestinationCategory {
    return new DestinationCategory(
      this.toTaxonomyOwner(row.taxonomyOwner),
      row.connectionId,
      row.externalId,
      row.name,
      row.parentId,
      row.leaf,
      row.syncedAt instanceof Date ? row.syncedAt : new Date(row.syncedAt),
    );
  }
}
