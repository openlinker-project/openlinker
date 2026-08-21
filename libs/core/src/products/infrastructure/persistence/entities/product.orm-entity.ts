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

  /**
   * Neutral tax-rate code the ProductMaster stated for this product (#2054,
   * ADR-052) - percent-as-string (`'23'`) or an exemption code (`'zw'`).
   * Populated by product sync, never by a person.
   *
   * Null carries TWO meanings, disambiguated by `taxRateReadAt`: null with a
   * null timestamp is *never checked*; null with a timestamp is *checked, and
   * the shop has no rate*. A single nullable column cannot tell those apart,
   * and on the day this ships every row is the first one.
   */
  @Column({ type: 'varchar', length: 16, nullable: true })
  taxRate!: string | null;

  /** ISO 3166-1 alpha-2 the rate was resolved against. Provenance only. */
  @Column({ type: 'varchar', length: 2, nullable: true })
  taxRateCountry!: string | null;

  /**
   * When the master was last asked. `timestamptz` rather than bare `timestamp`
   * so the write is stored without a silent tz coercion (the #1296 correction).
   */
  @Column({ type: 'timestamptz', nullable: true })
  taxRateReadAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
