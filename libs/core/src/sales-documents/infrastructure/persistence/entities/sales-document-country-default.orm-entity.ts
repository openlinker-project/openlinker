/**
 * Sales-Document Country Default ORM Entity (#2170, #3177)
 *
 * Unique on `country` ALONE (#3177) — "the country's fallback" is
 * structurally singular, not one-per-`document_kind`: a country with both
 * an invoice default and a fiscal-receipt default set was already, on every
 * order, resolving to `ambiguous-defaults` -> `unresolved` (see
 * `evaluate-sales-document-rules.ts`), so at most one row per country can
 * only ever fix behaviour, never regress a currently-working order. FK to
 * `connections` (ON DELETE CASCADE) is emitted by the migration.
 *
 * @module libs/core/src/sales-documents/infrastructure/persistence/entities
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('sales_document_country_defaults')
@Index('UQ_sales_document_country_defaults_country', ['country'], {
  unique: true,
})
export class SalesDocumentCountryDefaultOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 8, name: 'country' })
  country!: string;

  @Column({ type: 'varchar', length: 64, name: 'document_kind' })
  documentKind!: string;

  @Column({ type: 'uuid', name: 'connection_id' })
  connectionId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
