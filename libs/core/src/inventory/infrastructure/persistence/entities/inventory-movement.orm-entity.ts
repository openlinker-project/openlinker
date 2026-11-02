/**
 * Inventory Movement ORM Entity (#3565)
 *
 * `inventory_movements` - the append-only stock movement ledger. No foreign keys:
 * a movement is an audit record that must outlive the product, variant, order or
 * connection it names (the `return_line_events` precedent), so the integration
 * harness truncates it explicitly.
 *
 * Every index is declared class-level under the migration's exact name because
 * the integration harness builds its schema by `synchronize`.
 *
 * @module libs/core/src/inventory/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('inventory_movements')
// History per variant / per product. Not DESC: a b-tree is scanned backwards.
@Index('IDX_inventory_movements_variant_occurred', ['productVariantId', 'occurredAt'])
@Index('IDX_inventory_movements_product_occurred', ['productId', 'occurredAt'])
// The global list and the retention prune both range over time alone.
@Index('IDX_inventory_movements_occurred', ['occurredAt'])
// A repeated manual correction (same dialog) finds its row by this key.
@Index('UQ_inventory_movements_idempotency_key', ['idempotencyKey'], {
  unique: true,
  where: '"idempotencyKey" IS NOT NULL',
})
// "Needs attention": refused and in-doubt rows are a tiny minority of the table.
@Index('IDX_inventory_movements_attention', ['occurredAt'], {
  where: `"status" IN ('refused', 'in_doubt')`,
})
export class InventoryMovementOrmEntity {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_inventory_movements' })
  id!: string;

  @Column({ type: 'text' })
  productId!: string;

  @Column({ type: 'text', nullable: true })
  productVariantId!: string | null;

  @Column({ type: 'text', nullable: true })
  locationId!: string | null;

  @Column({ type: 'text', nullable: true })
  sourceConnectionId!: string | null;

  @Column({ type: 'varchar', length: 32 })
  reason!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: string;

  @Column({ type: 'integer' })
  quantityDelta!: number;

  @Column({ type: 'integer', nullable: true })
  quantityBefore!: number | null;

  @Column({ type: 'integer', nullable: true })
  quantityAfter!: number | null;

  @Column({ type: 'varchar', length: 16 })
  sourceKind!: string;

  @Column({ type: 'text', nullable: true })
  sourceRef!: string | null;

  @Column({ type: 'text', nullable: true })
  actorUserId!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  operatorReason!: string | null;

  /** Stays in OpenLinker; never sent to the master. */
  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'text', nullable: true })
  idempotencyKey!: string | null;

  @Column({ type: 'varchar', length: 48, nullable: true })
  refusalReason!: string | null;

  /** The adapter's own sentence, verbatim. */
  @Column({ type: 'text', nullable: true })
  refusalDetail!: string | null;

  @Column({ type: 'timestamptz' })
  occurredAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
