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

import { ShipmentStatus } from '../../../domain/types/shipment-status.types';
import { ShippingMethod } from '../../../domain/types/shipping-method.types';

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
// `(orderId, connectionId)` — `providerShipmentId IS NULL` selects the
// branch-1 set; branches 2/3 carry a non-null provider id and are
// disambiguated by the sibling `UQ_shipments_providerShipmentId` above.
// The `FulfillmentStatusSyncService` find-then-create gate is not
// atomic; this index is the DB-side backstop against concurrent ticks
// racing on the same order.
@Index('UQ_shipments_branch_one_per_order_conn', ['orderId', 'connectionId'], {
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

  @Column({ type: 'text' })
  shippingMethod!: ShippingMethod;

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

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
