/**
 * Inventory Sale Decrement ORM Entity (#3453)
 *
 * `inventory_sale_decrements` — one row per routed work line OpenLinker lowered
 * (or deliberately did not lower) in its owning product master.
 *
 * The UNIQUE `idempotencyKey` is the enforcement: every writer goes through
 * `INSERT … ON CONFLICT`, so a replay can never produce a second row, and
 * therefore never a second adapter call. `orderId` / `workId` are references by
 * value with no foreign key (the `fulfillment_works.orderId` precedent) — an
 * audit record must outlive the rows it describes.
 *
 * Constraints are declared class-level under the migration's exact names, so the
 * `synchronize`-built integration schema matches the migration.
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
import {
  InventorySaleDecrementStatus,
  type InventorySaleDecrementReason,
} from '../../../domain/types/inventory-sale-decrement.types';

@Entity('inventory_sale_decrements')
@Index('UQ_inventory_sale_decrements_key', ['idempotencyKey'], { unique: true })
@Index('IDX_inventory_sale_decrements_order', ['orderId'])
@Check('CHK_inventory_sale_decrements_quantity_positive', '"quantity" > 0')
export class InventorySaleDecrementOrmEntity {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_inventory_sale_decrements' })
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ type: 'text' })
  orderId!: string;

  @Column({ type: 'text' })
  workId!: string;

  @Column({ type: 'text' })
  orderLineId!: string;

  @Column({ type: 'text' })
  productId!: string;

  @Column({ type: 'text', nullable: true })
  productVariantId!: string | null;

  @Column({ type: 'text', nullable: true })
  ownerConnectionId!: string | null;

  @Column({ type: 'integer' })
  quantity!: number;

  @Column({ type: 'varchar', length: 32 })
  status!: InventorySaleDecrementStatus;

  @Column({ type: 'varchar', length: 64, nullable: true })
  reason!: InventorySaleDecrementReason | null;

  @Column({ type: 'text', nullable: true })
  detail!: string | null;

  @Column({ type: 'boolean', default: false })
  clamped!: boolean;

  @Column({ type: 'boolean', default: false })
  idempotencyUnsupported!: boolean;

  @Column({ type: 'integer', nullable: true })
  resultingQuantity!: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
