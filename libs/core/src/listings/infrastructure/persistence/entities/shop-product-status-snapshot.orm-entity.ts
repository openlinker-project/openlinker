/**
 * Shop Product Status Snapshot ORM Entity (#1845)
 *
 * TypeORM entity for the `shop_product_status_snapshots` table. Stores the
 * periodically-refreshed shop-side publication status of published products,
 * keyed uniquely by `(externalProductId, connectionId)`. The shop-side sibling
 * of `offer_status_snapshots`.
 *
 * @module libs/core/src/listings/infrastructure/persistence/entities
 * @see {@link ShopProductStatusSnapshot} for the corresponding domain entity
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

import {
  ShopPublicationStatus} from '../../../domain/types/shop-product-status.types';
import type {
  ShopProductStatusSnapshotDetails
} from '../../../domain/types/shop-product-status.types';

@Entity('shop_product_status_snapshots')
// Unique key for the keyed read + upsert.
@Index(
  'UQ_shop_product_status_snapshots_product_connection',
  ['externalProductId', 'connectionId'],
  { unique: true },
)
// Reverse navigation from a variant to its products' statuses.
@Index('IDX_shop_product_status_snapshots_variant', ['internalVariantId'])
// Supports "refresh stalest first" ordering and stale-status queries.
@Index('IDX_shop_product_status_snapshots_lastSyncedAt', ['lastStatusSyncedAt'])
// Supports per-connection status aggregation (dashboards / filters).
@Index('IDX_shop_product_status_snapshots_connection_status', ['connectionId', 'publicationStatus'])
export class ShopProductStatusSnapshotOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'text' })
  externalProductId!: string;

  @Column({ type: 'text' })
  internalVariantId!: string;

  @Column({ type: 'text' })
  publicationStatus!: ShopPublicationStatus;

  @Column({ type: 'jsonb', nullable: true })
  statusDetails!: ShopProductStatusSnapshotDetails | null;

  @Column({ type: 'timestamptz' })
  lastStatusSyncedAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
