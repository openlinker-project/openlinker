/**
 * Sales-Document Country Acknowledgment ORM Entity (#2186)
 *
 * `country` is the primary key — mirrors `SalesDocumentThresholdOrmEntity`'s
 * `ref`-as-primary-key shape, since "the acknowledgment for this country" is
 * structurally singular (upsert replaces, it never accumulates a history).
 *
 * @module libs/core/src/sales-documents/infrastructure/persistence/entities
 */
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('sales_document_country_acknowledgments')
export class SalesDocumentCountryAcknowledgmentOrmEntity {
  @PrimaryColumn({ type: 'varchar', length: 8, name: 'country' })
  country!: string;

  @Column({ type: 'timestamptz', name: 'acknowledged_at' })
  acknowledgedAt!: Date;
}
