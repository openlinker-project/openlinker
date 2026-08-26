/**
 * Reservation ORM Entity (#2343, ADR-061 decision 1)
 *
 * TypeORM entity for the `reservations` table — OpenLinker's own advisory
 * reservation ledger.
 *
 * Three schema choices are the design rather than housekeeping:
 *
 * - **`UQ_reservations_active_line` is PARTIAL on `status = 'held'`.** That
 *   partiality IS the idempotency key: a retried reserve conflicts instead of
 *   double-incrementing the counter, while a released line can be re-reserved
 *   later without colliding with its own terminal history. Same idiom as the two
 *   partial unique indexes already on `inventory_items`.
 * - **The key carries `orderRecordId`** (§ 6I). `orderLineId` is the
 *   source-supplied `OrderItem.id`, unique only within its own order — Allegro
 *   and PrestaShop line ids collide across orders trivially, so a key without
 *   the order would make order B's reserve fail against order A's unrelated row.
 * - **The ONE foreign key is `inventoryItemId -> inventory_items(id)` with
 *   `ON DELETE RESTRICT`**: a position carrying live reservations must not
 *   vanish (the stale path soft-marks rather than deletes). There is
 *   deliberately NO FK on `orderRecordId` / `orderLineId` — the `refund_records`
 *   / `returns` precedent for the first, and for the second it is not merely
 *   undesirable but impossible: `order_records` has no lines table, so the value
 *   points into the `orderSnapshot` jsonb document.
 *
 * The `@Check` is declared class-level with the SAME NAME the migration uses
 * (the `return_lines` / `offer_commercial_snapshots` precedent): the integration
 * harness builds its schema by `synchronize`, so an anonymous `@Check` would
 * carry a hash name there and an int-spec would assert a constraint the
 * migration-built schema does not have under that name.
 *
 * @module libs/core/src/inventory/infrastructure/persistence/entities
 */
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { InventoryItemOrmEntity } from './inventory-item.orm-entity';
import { ReservationAtpEffect } from '../../../domain/ports/reservation-ledger-reader.port';
import {
  ReservationStatusValues,
  type ReservationStatus,
} from '../../../domain/types/reservation.types';

@Entity('reservations')
// The idempotency key. See the class docblock for why it is partial and why it
// carries `orderRecordId`.
@Index(['orderRecordId', 'orderLineId', 'inventoryItemId'], {
  unique: true,
  where: `"status" = 'held'`,
})
// Named for the query that is ALREADY WRITTEN: `computeAtp`
// (`domain/types/availability.types.ts`) fixes #2345's sum as
// `Σ quantity WHERE status='held' AND atpEffect='published'`, joined to
// `inventory_items` on `inventoryItemId` to reach `productVariantId` /
// `sourceConnectionId`. Both predicate columns lead; the join column trails.
// The same index serves #2349's reconciler (`SUM … GROUP BY inventoryItemId`).
@Index(['status', 'atpEffect', 'inventoryItemId'])
// #2349's expiry-sweep CANDIDATE scan. Only half of that sweep's predicate:
// expiry is state-dependent (ADR-061 decision 1 / REVIEW C1 — the sweep
// *extends* rather than releases when the order carries an open hold), so it
// reads orders after this index narrows the candidates.
@Index(['status', 'expiresAt'])
// Order-scoped reads (#2346/#2347), backing `listHeldByOrderRecordId`.
@Index(['orderRecordId'])
@Check('CHK_reservations_quantity_positive', '"quantity" > 0')
export class ReservationOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  orderRecordId!: string;

  @Column({ type: 'text' })
  orderLineId!: string;

  @Column({ type: 'text' })
  inventoryItemId!: string;

  @ManyToOne(() => InventoryItemOrmEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'inventoryItemId',
    foreignKeyConstraintName: 'FK_reservations_inventory_item',
  })
  inventoryItem!: InventoryItemOrmEntity;

  @Column({ type: 'integer' })
  quantity!: number;

  @Column({ type: 'varchar', length: 16, default: ReservationStatusValues[0] })
  status!: ReservationStatus;

  // NOT NULL by ADR-061 decision 1: an unbounded hold on a system that may never
  // observe the close event is an oversell leak with no floor.
  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  // Stamped at creation by the ingestion caller holding the routing outcome, and
  // immutable thereafter — so the ATP query is a local column test and no
  // `inventory <-> fulfillment` read exists on the publish path.
  @Column({ type: 'varchar', length: 16 })
  atpEffect!: ReservationAtpEffect;

  // When the row left `held`. NULL while live — never a sentinel date, which
  // would make "still held" and "closed at the epoch" the same query.
  @Column({ type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
