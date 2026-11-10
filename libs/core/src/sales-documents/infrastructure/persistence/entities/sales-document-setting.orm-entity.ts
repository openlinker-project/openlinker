/**
 * Sales Document Setting ORM Entity (#3941)
 *
 * The `sales_document_settings` singleton row (`id = 'singleton'`), the shape
 * `reporting_currency_setting` / `operational_settings` established. Every
 * setting column is nullable and NULL means "not set", so resolution falls to
 * the code default and an install that never saved anything is unchanged.
 *
 * @module libs/core/src/sales-documents/infrastructure/persistence/entities
 */
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('sales_document_settings')
export class SalesDocumentSettingOrmEntity {
  @PrimaryColumn({ type: 'text', name: 'id' })
  id!: string;

  /** The OpenLinker-wide gift form on documents; NULL = not set (`technical-cent`). */
  @Column({ type: 'varchar', length: 32, name: 'gift_document_form', nullable: true })
  giftDocumentForm!: string | null;

  /** The `custom-price` amount that goes with the default form; NULL otherwise. */
  @Column({ type: 'varchar', length: 16, name: 'gift_document_unit_price', nullable: true })
  giftDocumentUnitPrice!: string | null;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'text', name: 'updated_by', nullable: true })
  updatedBy!: string | null;
}
