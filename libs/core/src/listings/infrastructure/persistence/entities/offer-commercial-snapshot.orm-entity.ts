/**
 * Offer Commercial Snapshot ORM Entity
 *
 * TypeORM entity for the `offer_commercial_snapshots` table (#2024). Stores
 * the periodically-refreshed channel-side price/currency/available-quantity
 * of mapped offers, keyed uniquely by `(externalOfferId, connectionId)` —
 * mirrors `OfferStatusSnapshotOrmEntity` (#816) exactly.
 *
 * @module libs/core/src/listings/infrastructure/persistence/entities
 * @see {@link OfferCommercialSnapshot} for the corresponding domain entity
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('offer_commercial_snapshots')
// Indexes carry explicit names so the migration can create/drop them
// deterministically and the ORM metadata never drifts from the schema.
//
// Unique key for the keyed read + upsert.
@Index('UQ_offer_commercial_snapshots_offer_connection', ['externalOfferId', 'connectionId'], {
  unique: true,
})
// Reverse navigation from a variant to its offers' commercial snapshots.
@Index('IDX_offer_commercial_snapshots_variant', ['internalVariantId'])
export class OfferCommercialSnapshotOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'text' })
  externalOfferId!: string;

  @Column({ type: 'text' })
  internalVariantId!: string;

  @Column({ type: 'numeric' })
  price!: string;

  @Column({ type: 'text' })
  currency!: string;

  @Column({ type: 'integer' })
  availableQuantity!: number;

  @Column({ type: 'timestamptz' })
  lastCommercialSyncedAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
