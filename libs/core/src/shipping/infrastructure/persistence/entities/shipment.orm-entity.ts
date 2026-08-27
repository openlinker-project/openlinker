/**
 * Shipment ORM Entity
 *
 * TypeORM entity for the `shipments` table. The application generates the
 * `ol_shipment_*` primary-key via `formatInternalId('Shipment')` at
 * create-time, mirroring how Order / Product ids are produced — so `id`
 * is declared `@PrimaryColumn`, NOT `@PrimaryGeneratedColumn`.
 *
 * Multiple shipments per order are allowed by design (append-only AC-7
 * cancel + re-issue + future multi-package shipments) — the `orderId`
 * index is intentionally non-unique. `providerShipmentId` carries a
 * partial-unique index so the same provider id can't be assigned twice.
 *
 * No foreign-key constraints emitted — matches the recent
 * `bulk_offer_creation_batches` convention.
 *
 * @module libs/core/src/shipping/infrastructure/persistence/entities
 */
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

import { ShipmentDirection } from '../../../domain/types/shipment-direction.types';
import { ShipmentStatus } from '../../../domain/types/shipment-status.types';
import { ShippingMethod } from '../../../domain/types/shipping-method.types';
import type { DeliveryIntent } from '../../../domain/types/delivery-intent.types';

@Entity('shipments')
@Index('IDX_shipments_orderId', ['orderId'])
@Index('IDX_shipments_connectionId', ['connectionId'])
@Index('IDX_shipments_status', ['status'])
@Index('IDX_shipments_carrier', ['carrier'])
@Index('UQ_shipments_providerShipmentId', ['providerShipmentId'], {
  unique: true,
  where: '"providerShipmentId" IS NOT NULL',
})
// Branch-1 (#834) dedup guard. At most one branch-1 Shipment per
// `(orderId, connectionId, direction)` — `providerShipmentId IS NULL` selects
// the branch-1 set; branches 2/3 carry a non-null provider id and are
// disambiguated by the sibling `UQ_shipments_providerShipmentId` above.
// The `FulfillmentStatusSyncService` find-then-create gate is not
// atomic; this index is the DB-side backstop against concurrent ticks
// racing on the same order.
//
// `direction` is a KEY column, deliberately not an arm of the WHERE clause
// (#2373, ADR-060). Written as `direction = 'outbound'` in the predicate, the
// index would keep guarding outbound rows and stop guarding return rows
// entirely — any number of branch-1 return rows per `(order, connection)`. As
// a key column it admits exactly the one pair ADR-060 needs (an outbound and a
// return label for the same order) while still refusing a second row in either
// direction. Neither too narrow nor too wide; do not move it into the WHERE.
@Index('UQ_shipments_branch_one_per_order_conn', ['orderId', 'connectionId', 'direction'], {
  unique: true,
  where: '"providerShipmentId" IS NULL',
})
export class ShipmentOrmEntity {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'text' })
  orderId!: string;

  @Column({ type: 'uuid' })
  connectionId!: string;

  // Which way the goods travel (#2373). NO column default, deliberately: the
  // migration adds one only to backfill history and drops it in the same
  // statement, so an insert that fails to state its direction fails loudly
  // rather than silently acquiring `'outbound'`. `synchronize` mirrors this
  // declaration, so the two schema sources agree.
  @Column({ type: 'text' })
  direction!: ShipmentDirection;

  @Column({ type: 'text' })
  shippingMethod!: ShippingMethod;

  // Carrier-neutral delivery intent the dispatch was requested with (#979,
  // ADR-020). Nullable: branch-1/omp projection rows carry no intent. The
  // `shippingMethod` above is resolved from this at the dispatch seam.
  @Column({ type: 'text', nullable: true })
  deliveryIntent!: DeliveryIntent | null;

  @Column({ type: 'text' })
  status!: ShipmentStatus;

  @Column({ type: 'text', nullable: true })
  providerShipmentId!: string | null;

  @Column({ type: 'text', nullable: true })
  paczkomatId!: string | null;

  @Column({ type: 'text', nullable: true })
  sourceDeliveryMethodId!: string | null;

  @Column({ type: 'text', nullable: true })
  trackingNumber!: string | null;

  // Actual carrier-of-record (#769) — distinct from the dispatcher
  // (connectionId.platformType). Indexed for the future /shipments
  // filter-by-carrier query (#839 AC-7 work, blocked on #834).
  @Column({ type: 'text', nullable: true })
  carrier!: string | null;

  @Column({ type: 'text', nullable: true })
  labelPdfRef!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  dispatchedAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  cancelledAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  failedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  // Structured rejection-code discriminator (#1918) — see the domain entity
  // for the full rationale.
  @Column({ type: 'text', nullable: true })
  providerCode!: string | null;

  // Source-relay claim marker for the waybill (#1947) — see the domain entity
  // for why this is a dedicated column and not inferred from `trackingNumber`.
  // Claimed conditionally (`WHERE waybill_relayed_at IS NULL`), so it is the
  // serialization point between the status-sync poll and the carrier webhook.
  @Column({ type: 'timestamp', nullable: true })
  waybillRelayedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
