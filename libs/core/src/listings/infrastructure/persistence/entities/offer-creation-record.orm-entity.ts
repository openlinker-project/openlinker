/**
 * Offer Creation Record ORM Entity
 *
 * TypeORM entity representing the `offer_creation_records` table in PostgreSQL.
 * Tracks the lifecycle of OL-initiated offer creation attempts on marketplaces.
 *
 * @module libs/core/src/listings/infrastructure/persistence/entities
 * @see {@link OfferCreationRecord} for the corresponding domain entity
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

import { OfferCreationStatus } from '../../../domain/types/offer-creation-record.types';
import type { OfferCreationError } from '../../../domain/types/offer-creation-record.types';
import type { OfferCreationRequestSnapshot } from '../../../domain/types/offer-creation-request-snapshot.types';

@Entity('offer_creation_records')
@Index(['internalVariantId', 'connectionId'])
@Index(['connectionId'])
@Index(['status'])
// Partial composite index for the `findByExternalOfferIdAndConnectionId` lookup.
// `WHERE "externalOfferId" IS NOT NULL` keeps pre-creation pending rows (which
// always have a null external id) out of the index. Explicit name so the
// migration's `down()` can target it deterministically.
@Index(
  'IDX_offer_creation_records_external_offer_connection',
  ['externalOfferId', 'connectionId'],
  {
    where: '"externalOfferId" IS NOT NULL',
  }
)
export class OfferCreationRecordOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  internalVariantId!: string;

  @Column({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'text', nullable: true })
  externalOfferId!: string | null;

  @Column({ type: 'text' })
  status!: OfferCreationStatus;

  @Column({ type: 'jsonb', nullable: true })
  errors!: OfferCreationError[] | null;

  @Column({ type: 'boolean', default: false })
  publishImmediately!: boolean;

  /**
   * Snapshot of the original create-offer request payload. Nullable because
   * records predating the 2026-04-22 schema change carry no payload; the
   * retry-prefill path on the FE degrades gracefully when null.
   */
  @Column({ type: 'jsonb', nullable: true })
  request!: OfferCreationRequestSnapshot | null;

  /**
   * Optional reference to the parent bulk-batch this record belongs to.
   * Null for single (non-bulk) offer-creation attempts. No FK enforced at
   * the schema level (matches the `connectionId` precedent); application
   * code maintains referential integrity.
   */
  @Column({ type: 'uuid', nullable: true })
  @Index('IDX_offer_creation_records_bulkBatchId')
  bulkBatchId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
