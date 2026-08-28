/**
 * Reservation Shortfall Episode ORM Entity (#2349)
 *
 * Three schema choices are the design rather than housekeeping:
 *
 * - **`UQ_reservation_shortfall_open` is PARTIAL on `"closedAt" IS NULL`.**
 *   That partiality IS the episode model: while an episode is open the insert
 *   conflicts, and the conflict arm refreshes the quantities while leaving the
 *   ID alone (#2628 review), so the occurrence id is stable for as long as the
 *   condition lasts; once closed the row leaves the index, so a recurrence
 *   inserts cleanly under a NEW id. Same idiom as `UQ_reservations_active_line`.
 * - **The key is `(orderRecordId, inventoryItemId)`, not `(orderRecordId, sku)`.**
 *   The shortfall is only observable per POSITION, `sku` is nullable and not
 *   unique so it cannot back an index at all, and one position resolves to
 *   exactly one variant — so on every shipped install (WooCommerce leaves
 *   `locationId` undefined, PrestaShop never sets it) the two grains coincide.
 * - **`IDX_reservation_shortfall_open_id` backs the close sweep's page.** The
 *   partial UNIQUE index cannot serve `"closedAt" IS NULL ORDER BY "id"`.
 *
 * There is deliberately NO foreign key on `orderRecordId` (the `reservations`
 * precedent — `order_records` is written by a different flow and a hard FK
 * would make an episode unrecordable for an order OL has not ingested yet) and
 * none on `inventoryItemId` either: an episode is EVIDENCE about a position,
 * and it must outlive the position row rather than cascade away with it.
 *
 * Every constraint is declared class-level under the SAME NAME the migration
 * uses (the `reservations` / `return_lines` precedent), because the integration
 * harness builds its schema by `synchronize` and an anonymous constraint would
 * carry a hash name there.
 *
 * @module libs/core/src/inventory/infrastructure/persistence/entities
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
import type { ReservationShortfallCloseReason } from '../../../domain/types/reservation-shortfall.types';

@Entity('reservation_shortfall_episodes')
// The episode-identity key. See the class docblock for why it is partial.
@Index('UQ_reservation_shortfall_open', ['orderRecordId', 'inventoryItemId'], {
  unique: true,
  where: `"closedAt" IS NULL`,
})
// The close sweep's page.
@Index('IDX_reservation_shortfall_open_id', ['id'], { where: `"closedAt" IS NULL` })
// The order-detail projection's read.
@Index('IDX_reservation_shortfall_order', ['orderRecordId'])
@Check('CHK_reservation_shortfall_quantity_positive', '"shortQuantity" > 0')
export class ReservationShortfallEpisodeOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  orderRecordId!: string;

  @Column({ type: 'text' })
  inventoryItemId!: string;

  @Column({ type: 'text', nullable: true })
  productVariantId!: string | null;

  // Snapshot at open time, resolved by the service through `IProductsService`
  // — never by a SQL join onto `product_variants`, which belongs to another
  // context (ADR-036).
  @Column({ type: 'text', nullable: true })
  sku!: string | null;

  @Column({ type: 'integer' })
  shortQuantity!: number;

  @Column({ type: 'integer' })
  positionShortfall!: number;

  @Column({ type: 'timestamptz' })
  openedAt!: Date;

  // NULL while the episode stands. Never a sentinel date, which would make
  // "still short" and "closed at the epoch" the same query.
  @Column({ type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  closeReason!: ReservationShortfallCloseReason | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
