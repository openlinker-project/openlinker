/**
 * Product Variant ORM Entity
 *
 * TypeORM entity representing the product_variants table in PostgreSQL.
 * Stores product variant data (e.g., size/color combinations) with internal IDs only.
 * External identifiers live in the identifier_mappings table.
 *
 * @module libs/core/src/products/infrastructure/persistence/entities
 */
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ProductOrmEntity } from './product.orm-entity';

@Entity('product_variants')
export class ProductVariantOrmEntity {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'text' })
  productId!: string;

  @ManyToOne(() => ProductOrmEntity)
  @JoinColumn({ name: 'productId' })
  product!: ProductOrmEntity;

  @Column({ type: 'varchar', nullable: true })
  sku!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  attributes!: Record<string, string> | null;

  @Column({ type: 'varchar', nullable: true })
  ean!: string | null;

  @Column({ type: 'varchar', nullable: true })
  gtin!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  price!: number | null;

  // Soft-mark for a variant that no longer appears in the master's
  // getProductVariants response, or whose product 404s at the master
  // (#1599 — the products-context counterpart of inventory_items.isStale,
  // #1478). Excluded from nothing at the persistence layer; consulted by
  // order-item resolution to fail early. Cleared (false, staleAt=null) when
  // the variant reappears via upsert.
  @Column({ type: 'boolean', default: false })
  isStale!: boolean;

  // `timestamptz` (not bare `timestamp`) so the `NOW()` write is stored without a
  // silent tz coercion — the #1296 correction applied to invoice_records (#1599).
  @Column({ type: 'timestamptz', nullable: true })
  staleAt!: Date | null;

  /**
   * Per-variant tax-rate OVERRIDE (#2054, ADR-052). Set only by a master that
   * keys tax per variant (WooCommerce can; PrestaShop keys on the product, so
   * these stay null there and the product's rate applies).
   *
   * A present override always wins for a line carrying this variant id - it is
   * the more specific statement of the same fact, not a conflict to arbitrate.
   * Same null semantics as the product column: `taxRateReadAt` separates
   * *never checked* from *checked, no rate*.
   */
  @Column({ type: 'varchar', length: 16, nullable: true })
  taxRate!: string | null;

  /** ISO 3166-1 alpha-2 the override was resolved against. Provenance only. */
  @Column({ type: 'varchar', length: 2, nullable: true })
  taxRateCountry!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  taxRateReadAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

