/**
 * Product ORM Entity
 *
 * TypeORM entity representing the products table in PostgreSQL.
 * Stores canonical product data with internal IDs only. External identifiers
 * live in the identifier_mappings table.
 *
 * @module libs/core/src/products/infrastructure/persistence/entities
 */
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('products')
export class ProductOrmEntity {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column()
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  sku!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  price!: number | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  currency!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  images!: string[] | null;

  /**
   * Source-platform external category ids (#1034 / ADR-023 §0) — the input for
   * per-source-category mapping. Null until a product sync populates it.
   */
  @Column({ type: 'jsonb', nullable: true })
  categories!: string[] | null;

  /**
   * Source-platform product-level attributes (#1752) — `{ name, value }[]`
   * (e.g. Brand / Material), distinct from variant-distinguishing attributes.
   * Null until a product sync populates it.
   */
  @Column({ type: 'jsonb', nullable: true })
  features!: { name: string; value: string }[] | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
