/**
 * Listing Creation Record ORM Entity
 *
 * TypeORM entity for the `listing_creation_records` table — OL-initiated shop
 * product publish attempts (#1042). Sibling of `offer_creation_records`.
 *
 * @module libs/core/src/listings/infrastructure/persistence/entities
 * @see {@link ListingCreationRecord} for the corresponding domain entity
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

import type {
  ListingCreationError,
  ListingCreationStatus,
} from '../../../domain/types/listing-creation-record.types';

@Entity('listing_creation_records')
@Index(['internalVariantId', 'connectionId'])
@Index(['connectionId'])
@Index(['status'])
// Partial composite index for the `findByExternalProductIdAndConnectionId`
// lookup. `WHERE "externalProductId" IS NOT NULL` keeps pending rows (null
// external id) out of the index. Explicit name so the migration `down()` can
// target it deterministically.
@Index(
  'IDX_listing_creation_records_external_product_connection',
  ['externalProductId', 'connectionId'],
  {
    where: '"externalProductId" IS NOT NULL',
  }
)
export class ListingCreationRecordOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  internalVariantId!: string;

  @Column({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'text', nullable: true })
  externalProductId!: string | null;

  @Column({ type: 'text' })
  status!: ListingCreationStatus;

  @Column({ type: 'jsonb', nullable: true })
  errors!: ListingCreationError[] | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
