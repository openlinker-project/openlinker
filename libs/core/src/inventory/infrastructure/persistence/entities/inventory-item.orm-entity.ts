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
 * (ADR-058 ladder step (i), #2314). Nullable until the #2317 backfill stamps
 * the `LEGACY_SOURCE_CONNECTION_ID` (`'legacy'`) sentinel onto pre-existing
 * rows; neither partial unique index includes it — see the column comment.
 *
 * @module libs/core/src/inventory/infrastructure/persistence/entities
 */
import {
  Check,
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
// ANALYSIS-1032 § 6I's "hard floor". Declared class-level under the SAME NAME as
// the migration's constraint (the `return_lines` precedent) because the
// integration harness builds its schema by `synchronize`, so an anonymous
// @Check would carry a hash name there.
//
// There is deliberately NO `CHECK ("olReservedQuantity" <= "availableQuantity")`.
// A master may legitimately lower availability below an already-committed
// reservation set; such a constraint would make the *sync* fail rather than
// surface the shortfall, which is a fact an operator must see (`W2-12`).
@Check('CHK_inventory_items_ol_reserved_nonneg', '"olReservedQuantity" >= 0')
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

  // OpenLinker's OWN reservation counter (#2343, ADR-061) — denormalised over
  // the `reservations` ledger, which is authoritative (#2349's reconciler
  // corrects this column TO the ledger, never the reverse).
  //
  // Note the neighbouring trap: `reservedQuantity` above reads like an OL
  // counter and is NOT — it is a mirror of the master's value, rewritten every
  // sync. This column is master-invisible, which is why it is classified into
  // INVENTORY_OL_OWNED_COLUMNS and must never join the master sync's write set.
  @Column('int', { default: 0 })
  olReservedQuantity!: number;

  @Column({ type: 'varchar', nullable: true })
  locationId!: string | null;

  // Connection provenance for the position (ADR-058 ladder step (i), #2314):
  // which connection's sync owns this row. `text` rather than `uuid`, and no FK
  // to `connections` — step (ii) writes the `'legacy'` sentinel, declared once
  // as `LEGACY_SOURCE_CONNECTION_ID` in `domain/types/inventory.types.ts`
  // (which a `uuid` column could not hold at all), and provenance must survive
  // deletion of the connection it names.
  //
  // Three values are therefore legal here, and they mean different things: a
  // real connection id (this sync owns the position), the `'legacy'` sentinel
  // (the position predates provenance and its owner is unknown — a VALUE, never
  // a wildcard that matches every connection), and NULL (not yet reached by the
  // #2317 backfill). SET NOT NULL is #2325, which retires the third.
  //
  // Deliberately NOT in either partial unique index: a NULL-bearing column
  // makes the index NULL-distinct, admitting duplicate positions that
  // double-count available-to-promise.
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

