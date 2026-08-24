/**
 * Inventory Item ORM Entity
 *
 * TypeORM entity representing the inventory_items table in PostgreSQL.
 * Stores canonical inventory data with internal IDs only. External identifiers
 * live in the identifier_mappings table.
 *
 * Supports both product-level and variant-level inventory (productVariantId is nullable).
 * Uses partial unique indexes to prevent duplicate base inventory rows when productVariantId is NULL.
 *
 * `sourceConnectionId` records which connection's sync owns the position
 * (ADR-058 ladder step (i), #2314). Nullable until the #2317 `'legacy'`-sentinel
 * backfill; neither partial unique index includes it — see the column comment.
 *
 * @module libs/core/src/inventory/infrastructure/persistence/entities
 */
import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
// Use relative imports within the same package to avoid package.json exports issues
// Path: from inventory/.../entities/ up 4 levels to src/, then down to products/.../entities/
import { ProductOrmEntity } from '../../../../products/infrastructure/persistence/entities/product.orm-entity';
import { ProductVariantOrmEntity } from '../../../../products/infrastructure/persistence/entities/product-variant.orm-entity';

@Entity('inventory_items')
// Partial unique index for base inventory (product-level, no variant)
@Index(['productId', 'locationId'], {
  unique: true,
  where: '"productVariantId" IS NULL',
})
// Partial unique index for variant inventory
@Index(['productId', 'productVariantId', 'locationId'], {
  unique: true,
  where: '"productVariantId" IS NOT NULL',
})
export class InventoryItemOrmEntity {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'text' })
  productId!: string;

  @ManyToOne(() => ProductOrmEntity)
  @JoinColumn({ name: 'productId' })
  product!: ProductOrmEntity;

  @Column({ type: 'text', nullable: true })
  productVariantId!: string | null;

  @ManyToOne(() => ProductVariantOrmEntity, { nullable: true })
  @JoinColumn({ name: 'productVariantId' })
  productVariant!: ProductVariantOrmEntity | null;

  @Column('int')
  availableQuantity!: number;

  @Column('int', { default: 0 })
  reservedQuantity!: number;

  @Column({ type: 'varchar', nullable: true })
  locationId!: string | null;

  // Connection provenance for the position (ADR-058 ladder step (i), #2314):
  // which connection's sync owns this row. `text` rather than `uuid`, and no FK
  // to `connections` — step (ii) writes the literal `'legacy'` sentinel, and
  // provenance must survive deletion of the connection it names.
  //
  // Nullable until the #2317 backfill; SET NOT NULL is #2325. Deliberately NOT
  // in either partial unique index: a NULL-bearing column makes the index
  // NULL-distinct, admitting duplicate positions that double-count
  // available-to-promise.
  @Column({ type: 'text', nullable: true })
  sourceConnectionId!: string | null;

  // Soft-mark for a row whose variant no longer appears in the master's
  // listInventory response (#1478). Excluded from the variant-availability read;
  // cleared when the variant reappears (upsert writes false).
  @Column({ type: 'boolean', default: false })
  isStale!: boolean;

  @UpdateDateColumn()
  updatedAt!: Date;
}

