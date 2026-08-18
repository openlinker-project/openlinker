/**
 * Sales-Document Country Default ORM Entity (#2170)
 *
 * Unique on `(country, document_kind)` — "the default" is structurally
 * singular. FK to `connections` (ON DELETE CASCADE) is emitted by the
 * migration.
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
@Index('UQ_sales_document_country_defaults_country_kind', ['country', 'documentKind'], {
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
