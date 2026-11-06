/**
 * Bundle Definition Repository (#3607)
 *
 * @module libs/core/src/products/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { BundleDefinitionConcurrentWriteError } from '../../../domain/exceptions/bundle-definition.errors';
import { BundleDefinitionOrmEntity } from '../entities/bundle-definition.orm-entity';
import type { BundleDefinitionRepositoryPort } from '../../../domain/ports/bundle-definition-repository.port';
import {
  readLineExpansion,
  type BundleComponent,
  type BundleDefinition,
  type BundleDefinitionVersion,
  type MultipackConfirmation,
} from '../../../domain/types/bundle.types';

@Injectable()
export class BundleDefinitionRepository implements BundleDefinitionRepositoryPort {
  constructor(
    @InjectRepository(BundleDefinitionOrmEntity)
    private readonly repository: Repository<BundleDefinitionOrmEntity>
  ) {}

  async findCurrentByVariantIds(variantIds: readonly string[]): Promise<BundleDefinition[]> {
    if (variantIds.length === 0) {
      return [];
    }
    const rows = (await this.repository.query(
      `SELECT DISTINCT ON ("variantId") "variantId", "version", "components", "retiredAt"
         FROM "bundle_definitions"
        WHERE "variantId" = ANY($1::text[])
        ORDER BY "variantId", "version" DESC`,
      [variantIds]
    )) as RawRow[];
    return this.liveDefinitions(rows);
  }

  async findCurrentContainingComponent(variantId: string): Promise<BundleDefinition[]> {
    return this.findCurrentContainingAnyComponent([variantId]);
  }

  /**
   * One query for a whole set of component variants. The table holds one row per
   * bundle VERSION - hundreds at the scale a seller authors bundles by hand - so
   * resolving the latest version per bundle and testing its components is a
   * small scan; a GIN index would not even be used through the DISTINCT ON.
   */
  async findCurrentContainingAnyComponent(variantIds: readonly string[]): Promise<BundleDefinition[]> {
    if (variantIds.length === 0) {
      return [];
    }
    const rows = (await this.repository.query(
      `SELECT "variantId", "version", "components", "retiredAt" FROM (
         SELECT DISTINCT ON ("variantId") "variantId", "version", "components", "retiredAt"
           FROM "bundle_definitions"
          ORDER BY "variantId", "version" DESC
       ) latest
        WHERE "retiredAt" IS NULL
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(latest."components") component
             WHERE component->>'variantId' = ANY($1::text[])
          )`,
      [variantIds]
    )) as RawRow[];
    return this.liveDefinitions(rows);
  }

  async findHistory(variantId: string): Promise<BundleDefinitionVersion[]> {
    const rows = await this.repository.find({ where: { variantId }, order: { version: 'ASC' } });
    return rows.map((row) => ({
      ...this.toDomain(row),
      createdAt: row.createdAt,
      retired: row.retiredAt !== null && row.retiredAt !== undefined,
    }));
  }

  async listCurrent(): Promise<BundleDefinition[]> {
    const rows = (await this.repository.query(
      `SELECT DISTINCT ON ("variantId") "variantId", "version", "components", "retiredAt"
         FROM "bundle_definitions"
        ORDER BY "variantId", "version" DESC`
    )) as RawRow[];
    return this.liveDefinitions(rows);
  }

  async insertNextVersion(
    variantId: string,
    components: BundleComponent[]
  ): Promise<BundleDefinition> {
    try {
      const rows = (await this.repository.query(
        `INSERT INTO "bundle_definitions" ("variantId", "version", "components")
         SELECT $1, COALESCE(MAX("version"), 0) + 1, $2::jsonb
           FROM "bundle_definitions" WHERE "variantId" = $1
         RETURNING "variantId", "version", "components"`,
        [variantId, JSON.stringify(components)]
      )) as RawRow[];
      return this.rowToDomain(rows[0]);
    } catch (error) {
      if (isVersionCollision(error)) {
        throw new BundleDefinitionConcurrentWriteError(variantId);
      }
      throw error;
    }
  }

  async withVariantsLocked<T>(variantIds: readonly string[], work: () => Promise<T>): Promise<T> {
    const keys = [...new Set(variantIds)].sort();
    return this.repository.manager.transaction(async (manager) => {
      for (const key of keys) {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `bundle_definition:${key}`,
        ]);
      }
      return work();
    });
  }

  async findConfirmedMultipacks(
    pairs: readonly MultipackConfirmation[]
  ): Promise<MultipackConfirmation[]> {
    if (pairs.length === 0) {
      return [];
    }
    const variantIds = pairs.map((pair) => pair.variantId);
    const rows = (await this.repository.query(
      'SELECT "variantId", "packQuantity" FROM "multipack_confirmations" WHERE "variantId" = ANY($1::text[])',
      [variantIds]
    )) as { variantId: string; packQuantity: number }[];
    return rows
      .map((row) => ({ variantId: row.variantId, packQuantity: Number(row.packQuantity) }))
      .filter((row) =>
        pairs.some((pair) => pair.variantId === row.variantId && pair.packQuantity === row.packQuantity)
      );
  }

  async confirmMultipack(
    confirmation: MultipackConfirmation,
    confirmedByUserId: string | null
  ): Promise<void> {
    await this.repository.query(
      'INSERT INTO "multipack_confirmations" ("variantId", "packQuantity", "confirmedByUserId") VALUES ($1, $2, $3) ON CONFLICT ("variantId", "packQuantity") DO NOTHING',
      [confirmation.variantId, confirmation.packQuantity, confirmedByUserId]
    );
  }

  async retire(variantId: string): Promise<boolean> {
    const result = (await this.repository.query(
      `UPDATE "bundle_definitions" SET "retiredAt" = now()
        WHERE "variantId" = $1 AND "retiredAt" IS NULL
        RETURNING "id"`,
      [variantId]
    )) as unknown[];
    // pg returns [rows, count] for UPDATE ... RETURNING through TypeORM.
    const rows = Array.isArray(result[0]) ? (result[0] as unknown[]) : result;
    return rows.length > 0;
  }

  private liveDefinitions(rows: RawRow[]): BundleDefinition[] {
    return rows.filter((row) => row.retiredAt === null).map((row) => this.rowToDomain(row));
  }

  private rowToDomain(row: RawRow): BundleDefinition {
    // Reuses the persisted-shape coercer so a malformed row cannot widen the type.
    const coerced = readLineExpansion({
      v: 1,
      definitions: [{ variantId: row.variantId, version: row.version, components: row.components }],
    });
    return (
      coerced?.definitions[0] ?? { variantId: row.variantId, version: row.version, components: [] }
    );
  }

  private toDomain(entity: BundleDefinitionOrmEntity): BundleDefinition {
    return this.rowToDomain(entity);
  }
}

interface RawRow {
  variantId: string;
  version: number;
  components: unknown;
  retiredAt?: Date | null;
}

/** Unique violation of the `(variantId, version)` index specifically (SQLSTATE 23505). */
export function isVersionCollision(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const read = (source: unknown, key: 'code' | 'constraint'): string | undefined => {
    if (typeof source !== 'object' || source === null) return undefined;
    const value = (source as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  };
  const driver = (error as { driverError?: unknown }).driverError;
  const code = read(error, 'code') ?? read(driver, 'code');
  const constraint = read(error, 'constraint') ?? read(driver, 'constraint');
  return code === '23505' && constraint === 'UQ_bundle_definitions_variant_version';
}
