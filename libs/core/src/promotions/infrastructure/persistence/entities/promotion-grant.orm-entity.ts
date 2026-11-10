/**
 * Promotion Grant ORM Entity (#3935)
 *
 * One row per (promotion, order): the benefit a promotion gave an order. The
 * unique index IS the idempotency guarantee - the writer inserts with
 * `ON CONFLICT DO NOTHING` - and the table is what the unit cap and the
 * per-customer limit are summed over. No FKs (indexed references by value): the
 * history outlives a deleted promotion.
 *
 * @module libs/core/src/promotions/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('promotion_grants')
@Index('UQ_promotion_grants_promotion_order', ['promotionId', 'internalOrderId'], { unique: true })
@Index('IDX_promotion_grants_promotion_customer', ['promotionId', 'customerId'])
@Index('IDX_promotion_grants_order', ['internalOrderId'])
@Index('IDX_promotion_grants_variant', ['variantId', 'createdAt'])
export class PromotionGrantOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  promotionId!: string;

  @Column({ type: 'text' })
  internalOrderId!: string;

  @Column({ type: 'text', nullable: true })
  customerId!: string | null;

  @Column({ type: 'int' })
  quantity!: number;

  @Column({ type: 'text' })
  productId!: string;

  @Column({ type: 'text' })
  variantId!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  documentForm!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
