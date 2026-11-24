/**
 * Listing Sale Hold ORM Entity (#3962)
 *
 * TypeORM entity for `listing_sale_holds`. At most one ACTIVE (not released)
 * hold per listing, enforced by a partial unique index - declared here as
 * well as in the migration because the integration harness builds its schema
 * with `synchronize`.
 *
 * @module libs/core/src/listings/infrastructure/persistence/entities
 * @see {@link ListingSaleHold} for the corresponding domain entity
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import {
  ListingSaleHoldEntityType,
  ListingSaleHoldMethod,
  ListingSaleHoldOutcome} from '../../../domain/types/listing-sale-hold.types';
import type {
  ListingSaleHoldReason,
} from '../../../domain/types/listing-sale-hold.types';

@Entity('listing_sale_holds')
@Index('UQ_listing_sale_holds_active_listing', ['connectionId', 'entityType', 'externalId'], {
  unique: true,
  where: '"releasedAt" IS NULL',
})
// The product page reads every hold of one product.
@Index('IDX_listing_sale_holds_product', ['internalProductId'])
export class ListingSaleHoldOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'text' })
  entityType!: ListingSaleHoldEntityType;

  @Column({ type: 'text' })
  externalId!: string;

  @Column({ type: 'text', nullable: true })
  externalParentId!: string | null;

  @Column({ type: 'text' })
  internalProductId!: string;

  @Column({ type: 'text', nullable: true })
  internalVariantId!: string | null;

  @Column({ type: 'text' })
  method!: ListingSaleHoldMethod;

  @Column({ type: 'text' })
  outcome!: ListingSaleHoldOutcome;

  @Column({ type: 'text', nullable: true })
  outcomeReason!: ListingSaleHoldReason | null;

  @Column({ type: 'timestamptz' })
  staleAt!: Date;

  @Column({ type: 'timestamptz' })
  appliedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  releasedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  releasedBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
