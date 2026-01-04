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

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

