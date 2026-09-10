/**
 * Price Change Episode ORM Entity (#3142, ADR-072)
 *
 * `UQ_price_change_episodes_open` is PARTIAL on `"resolvedAt" IS NULL` — the
 * `ReservationShortfallEpisode` idiom applied here: while an episode is open,
 * a re-detection CONFLICTS and the conflict arm refreshes the amounts in
 * place, leaving the id stable; once resolved, the row leaves the index and a
 * later re-detection opens a fresh episode under a new id.
 *
 * No foreign keys — `productVariantId`, `destinationConnectionId` and
 * `sourceConnectionId` are all references by value (the `reservations` /
 * `order_changes` precedent): an episode is evidence of a past detection and
 * must survive a deleted connection or re-mapped variant rather than cascade
 * away with it.
 *
 * Every constraint is declared class-level under the SAME NAME the migration
 * uses, because the integration harness builds schema by `synchronize` and an
 * anonymous constraint would carry a hash name there.
 *
 * @module libs/core/src/listings/infrastructure/persistence/entities
 */
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  PriceChangeBlockReason,
  PriceChangeResolution,
} from '../../../domain/types/price-change-episode.types';

@Entity('price_change_episodes')
@Index(
  'UQ_price_change_episodes_open',
  ['productVariantId', 'destinationConnectionId', 'sourceConnectionId'],
  { unique: true, where: `"resolvedAt" IS NULL` }
)
// The review-queue's per-destination list.
@Index('IDX_price_change_episodes_destination', ['destinationConnectionId', 'resolvedAt'])
// The source-connection rollup's "how many changes waiting" count (#3146).
@Index('IDX_price_change_episodes_source', ['sourceConnectionId', 'resolvedAt'])
@Check('CHK_price_change_episodes_amounts_non_negative', '"sourceOldAmount" >= 0 AND "sourceNewAmount" >= 0 AND "computedOldAmount" >= 0 AND "computedNewAmount" >= 0')
export class PriceChangeEpisodeOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  productVariantId!: string;

  @Column({ type: 'uuid' })
  destinationConnectionId!: string;

  @Column({ type: 'uuid' })
  sourceConnectionId!: string;

  @Column({ type: 'varchar', length: 8 })
  sourceCurrency!: string;

  @Column({ type: 'numeric', precision: 14, scale: 4 })
  sourceOldAmount!: string;

  @Column({ type: 'numeric', precision: 14, scale: 4 })
  sourceNewAmount!: string;

  @Column({ type: 'numeric', precision: 14, scale: 4 })
  computedOldAmount!: string;

  @Column({ type: 'numeric', precision: 14, scale: 4 })
  computedNewAmount!: string;

  // The pinned/custom price mechanism (ADR-072 decision 5) — an OL-side
  // override, never a reuse of the destination-reported `frozen` field.
  @Column({ type: 'numeric', precision: 14, scale: 4, nullable: true })
  manualPriceOverride!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  manualPriceOverrideSetAt!: Date | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  blockReason!: PriceChangeBlockReason | null;

  @Column({ type: 'timestamptz' })
  detectedAt!: Date;

  // Staleness marker (#3143): stamped when a re-detection lands on an
  // already-open row with a changed `sourceNewAmount`.
  @Column({ type: 'timestamptz', nullable: true })
  refreshedAt!: Date | null;

  // NULL while the episode stands. Never a sentinel date.
  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  resolution!: PriceChangeResolution | null;

  @Column({ type: 'text', nullable: true })
  resolvedByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
