/**
 * Product Content Field ORM Entity
 *
 * TypeORM mapping for the `product_content_field` table — the draft buffer
 * plus last-known platform value for a single product field, optionally
 * scoped to a connection (channel override) or master (`connectionId IS NULL`).
 *
 * Index design note: the unique constraint on `(productId, connectionId, fieldKey)`
 * is implemented as **two partial unique indexes** (one for `connectionId IS NULL`,
 * one for `connectionId IS NOT NULL`) to handle Postgres' `NULL ≠ NULL`
 * uniqueness semantics. The decorators declare them here so `synchronize: true`
 * (used only by the integration-test harness) materialises them; production DBs
 * get the identical indexes via the migration, which remains the source of truth.
 * They must also exist at runtime because the repository's upsert relies on the
 * `ON CONFLICT (...) WHERE ...` inference clause matching these partial indexes.
 *
 * @module libs/core/src/content/infrastructure/persistence/entities
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('product_content_field')
@Index('ix_pcf_product', ['productId'])
@Index('ux_pcf_master', ['productId', 'fieldKey'], {
  unique: true,
  where: '"connection_id" IS NULL',
})
@Index('ux_pcf_channel', ['productId', 'connectionId', 'fieldKey'], {
  unique: true,
  where: '"connection_id" IS NOT NULL',
})
export class ProductContentFieldOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'product_id', type: 'text' })
  productId!: string;

  @Column({ name: 'connection_id', type: 'uuid', nullable: true })
  connectionId!: string | null;

  @Column({ name: 'field_key', type: 'text' })
  fieldKey!: string;

  @Column({ name: 'draft_value', type: 'text', nullable: true })
  draftValue!: string | null;

  @Column({ name: 'base_value', type: 'text', nullable: true })
  baseValue!: string | null;

  @Column({ name: 'base_version', type: 'text', nullable: true })
  baseVersion!: string | null;

  @Column({ name: 'has_conflict', type: 'boolean', default: false })
  hasConflict!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'updated_by', type: 'text', nullable: true })
  updatedBy!: string | null;
}
