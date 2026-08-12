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
  Check,
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
// An unlabeled amount is schema-legal without this (#2032 review thread 6) -
// every comparable project (Vendure/Medusa/Saleor/Spree/Sylius) makes an
// amount's currency mandatory whenever the amount is present. `currency`
// stays nullable for the legitimate "nothing reported" row, so a CHECK - not
// a plain NOT NULL - is what encodes the pairing.
@Check(
  'CHK_offer_commercial_snapshots_price_currency_pair',
  '("price" IS NULL) = ("currency" IS NULL)'
)
export class OfferCommercialSnapshotOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'text' })
  externalOfferId!: string;

  @Column({ type: 'text' })
  internalVariantId!: string;

  // `(12, 3)`, not `(10, 2)` (#2032 review thread 6): KWD/BHD/OMR/TND/JOD
  // carry three decimal places, and Postgres rounds a SCALE overflow
  // silently (a PRECISION overflow errors instead) - `(10, 2)` would drop
  // those currencies' last digit with no warning.
  @Column({ type: 'decimal', precision: 12, scale: 3, nullable: true })
  price!: string | null;

  @Column({ type: 'text', nullable: true })
  currency!: string | null;

  @Column({ type: 'integer', nullable: true })
  availableQuantity!: number | null;

  @Column({ type: 'timestamptz' })
  lastCommercialSyncedAt!: Date;

  // Explicit `timestamptz`, not the bare `timestamp` TypeORM's Postgres
  // driver hardcodes for `@CreateDateColumn`/`@UpdateDateColumn` (#2032
  // review thread 6) - otherwise these sit inconsistently next to
  // `lastCommercialSyncedAt`, a `timestamptz` business column in the same row.
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
