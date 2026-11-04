/**
 * Bundle Definition Repository (#3607)
 *
 * @module libs/core/src/products/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BundleDefinitionOrmEntity } from '../entities/bundle-definition.orm-entity';
import type { BundleDefinitionRepositoryPort } from '../../../domain/ports/bundle-definition-repository.port';
import {
  readLineExpansion,
  type BundleComponent,
  type BundleDefinition,
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
    const rows = (await this.repository.query(
      `SELECT "variantId", "version", "components", "retiredAt" FROM (
         SELECT DISTINCT ON ("variantId") "variantId", "version", "components", "retiredAt"
           FROM "bundle_definitions"
          ORDER BY "variantId", "version" DESC
       ) latest
        WHERE "retiredAt" IS NULL
          AND "components" @> $1::jsonb`,
      [JSON.stringify([{ variantId }])]
    )) as RawRow[];
    return this.liveDefinitions(rows);
  }

  async findHistory(variantId: string): Promise<BundleDefinition[]> {
    const rows = await this.repository.find({ where: { variantId }, order: { version: 'ASC' } });
    return rows.map((row) => this.toDomain(row));
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
    const rows = (await this.repository.query(
      `INSERT INTO "bundle_definitions" ("variantId", "version", "components")
       SELECT $1, COALESCE(MAX("version"), 0) + 1, $2::jsonb
         FROM "bundle_definitions" WHERE "variantId" = $1
       RETURNING "variantId", "version", "components"`,
      [variantId, JSON.stringify(components)]
    )) as RawRow[];
    return this.rowToDomain(rows[0]);
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
