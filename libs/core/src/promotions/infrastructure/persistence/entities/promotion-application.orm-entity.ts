/**
 * Promotion Application ORM Entity (#3935)
 *
 * Append-only log of what happened when a promotion was applied to an order. The
 * promotion's name is frozen on the row so history survives a rename or a delete;
 * no FK for the same reason. `dismissedAt` / `dismissedByUserId` record that a
 * person handled a not-applied or failed row ("send without the gift").
 *
 * @module libs/core/src/promotions/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('promotion_applications')
@Index('IDX_promotion_applications_order', ['internalOrderId', 'createdAt'])
@Index('IDX_promotion_applications_promotion', ['promotionId', 'createdAt'])
export class PromotionApplicationOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  promotionId!: string;

  @Column({ type: 'text' })
  promotionName!: string;

  @Column({ type: 'text' })
  internalOrderId!: string;

  @Column({ type: 'varchar', length: 16 })
  outcome!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  reason!: string | null;

  @Column({ type: 'int', default: 0 })
  quantity!: number;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  dismissedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  dismissedByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
