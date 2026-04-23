/**
 * Product Content Field Repository
 *
 * TypeORM-backed implementation of `ProductContentFieldRepositoryPort`.
 *
 * Upsert design: the unique key spans a nullable column (`connection_id`)
 * via two partial unique indexes (one `WHERE connection_id IS NULL`, one
 * `WHERE connection_id IS NOT NULL`). A naive find-then-save would race —
 * two concurrent callers can both observe "no row" and both attempt insert,
 * and the second insert would explode with a `QueryFailedError` from the
 * partial unique index. We use Postgres `INSERT ... ON CONFLICT WHERE
 * <index_predicate> DO UPDATE` so the upsert collapses to a single
 * round-trip and is concurrency-safe by construction. The conflict target
 * is branched by `connection_id IS NULL` because the two partial indexes
 * have different predicates.
 *
 * Mapping between ORM and domain entities is private to this class.
 *
 * @module libs/core/src/content/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ProductContentField } from '../../../domain/entities/product-content-field.entity';
import type {
  ProductContentFieldKey,
  ProductContentFieldRepositoryPort,
  ProductContentFieldUpsert,
} from '../../../domain/ports/product-content-field-repository.port';
import type { FieldKey } from '../../../domain/types/content.types';
import { ProductContentFieldOrmEntity } from '../entities/product-content-field.orm-entity';

interface UpsertReturningRow {
  id: string;
  product_id: string;
  connection_id: string | null;
  field_key: string;
  draft_value: string | null;
  base_value: string | null;
  base_version: string | null;
  has_conflict: boolean;
  updated_at: string | Date;
  updated_by: string | null;
}

const MASTER_UPSERT_SQL = `
  INSERT INTO product_content_field
    (product_id, connection_id, field_key, draft_value, base_value, base_version, has_conflict, updated_by)
  VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (product_id, field_key) WHERE connection_id IS NULL
  DO UPDATE SET
    draft_value  = EXCLUDED.draft_value,
    base_value   = EXCLUDED.base_value,
    base_version = EXCLUDED.base_version,
    has_conflict = EXCLUDED.has_conflict,
    updated_by   = EXCLUDED.updated_by,
    updated_at   = now()
  RETURNING id, product_id, connection_id, field_key, draft_value, base_value, base_version, has_conflict, updated_at, updated_by
`;

const CHANNEL_UPSERT_SQL = `
  INSERT INTO product_content_field
    (product_id, connection_id, field_key, draft_value, base_value, base_version, has_conflict, updated_by)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (product_id, connection_id, field_key) WHERE connection_id IS NOT NULL
  DO UPDATE SET
    draft_value  = EXCLUDED.draft_value,
    base_value   = EXCLUDED.base_value,
    base_version = EXCLUDED.base_version,
    has_conflict = EXCLUDED.has_conflict,
    updated_by   = EXCLUDED.updated_by,
    updated_at   = now()
  RETURNING id, product_id, connection_id, field_key, draft_value, base_value, base_version, has_conflict, updated_at, updated_by
`;

@Injectable()
export class ProductContentFieldRepository implements ProductContentFieldRepositoryPort {
  constructor(
    @InjectRepository(ProductContentFieldOrmEntity)
    private readonly ormRepository: Repository<ProductContentFieldOrmEntity>,
  ) {}

  async findByKey(key: ProductContentFieldKey): Promise<ProductContentField | null> {
    const entity = await this.ormRepository.findOne({
      where: {
        productId: key.productId,
        connectionId: key.connectionId === null ? IsNull() : key.connectionId,
        fieldKey: key.fieldKey,
      },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async findByProduct(productId: string, fieldKey: FieldKey): Promise<ProductContentField[]> {
    const entities = await this.ormRepository.find({
      where: { productId, fieldKey },
      // Deterministic order: the controller composes per-channel summaries in
      // its own sorted order, but keep a stable row ordering here for tests.
      order: { connectionId: 'ASC' },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async upsert(payload: ProductContentFieldUpsert): Promise<ProductContentField> {
    const rows: UpsertReturningRow[] =
      payload.connectionId === null
        ? ((await this.ormRepository.query(MASTER_UPSERT_SQL, [
            payload.productId,
            payload.fieldKey,
            payload.draftValue,
            payload.baseValue,
            payload.baseVersion,
            payload.hasConflict,
            payload.updatedBy,
          ])) as UpsertReturningRow[])
        : ((await this.ormRepository.query(CHANNEL_UPSERT_SQL, [
            payload.productId,
            payload.connectionId,
            payload.fieldKey,
            payload.draftValue,
            payload.baseValue,
            payload.baseVersion,
            payload.hasConflict,
            payload.updatedBy,
          ])) as UpsertReturningRow[]);

    return this.toDomainFromRow(rows[0]);
  }

  async delete(key: ProductContentFieldKey): Promise<void> {
    await this.ormRepository.delete({
      productId: key.productId,
      connectionId: key.connectionId === null ? IsNull() : key.connectionId,
      fieldKey: key.fieldKey,
    });
  }

  private toDomain(entity: ProductContentFieldOrmEntity): ProductContentField {
    return new ProductContentField(
      entity.id,
      entity.productId,
      entity.connectionId,
      entity.fieldKey as FieldKey,
      entity.draftValue,
      entity.baseValue,
      entity.baseVersion,
      entity.hasConflict,
      entity.updatedAt,
      entity.updatedBy,
    );
  }

  private toDomainFromRow(row: UpsertReturningRow): ProductContentField {
    return new ProductContentField(
      row.id,
      row.product_id,
      row.connection_id,
      row.field_key as FieldKey,
      row.draft_value,
      row.base_value,
      row.base_version,
      row.has_conflict,
      row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
      row.updated_by,
    );
  }
}
