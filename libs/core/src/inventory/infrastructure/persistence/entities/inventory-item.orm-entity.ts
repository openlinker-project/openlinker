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

  @UpdateDateColumn()
  updatedAt!: Date;
}

