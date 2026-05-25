/**
 * Offer Status Snapshot ORM Entity
 *
 * TypeORM entity for the `offer_status_snapshots` table (#816). Stores the
 * periodically-refreshed marketplace publication status of mapped offers,
 * keyed uniquely by `(externalOfferId, connectionId)`.
 *
 * @module libs/core/src/listings/infrastructure/persistence/entities
 * @see {@link OfferStatusSnapshot} for the corresponding domain entity
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

import { OfferPublicationStatus } from '../../../domain/types/offer-status-read.types';
import type { OfferStatusSnapshotDetails } from '../../../domain/types/offer-status-snapshot.types';

@Entity('offer_status_snapshots')
// Indexes carry explicit names so the migration can create/drop them
// deterministically and the ORM metadata never drifts from the schema.
//
// Unique key for the keyed read + upsert.
@Index('UQ_offer_status_snapshots_offer_connection', ['externalOfferId', 'connectionId'], {
  unique: true,
})
// Reverse navigation from a variant to its offers' statuses.
@Index('IDX_offer_status_snapshots_variant', ['internalVariantId'])
// Supports "refresh stalest first" ordering and stale-status queries.
@Index('IDX_offer_status_snapshots_lastSyncedAt', ['lastStatusSyncedAt'])
// Supports per-connection status aggregation (dashboards / filters).
@Index('IDX_offer_status_snapshots_connection_status', ['connectionId', 'publicationStatus'])
export class OfferStatusSnapshotOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'text' })
  externalOfferId!: string;

  @Column({ type: 'text' })
  internalVariantId!: string;

  @Column({ type: 'text' })
  publicationStatus!: OfferPublicationStatus;

  @Column({ type: 'jsonb', nullable: true })
  statusDetails!: OfferStatusSnapshotDetails | null;

  @Column({ type: 'timestamptz' })
  lastStatusSyncedAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
