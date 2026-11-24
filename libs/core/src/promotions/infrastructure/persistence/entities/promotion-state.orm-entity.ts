/**
 * Promotion State ORM Entity (#3935)
 *
 * The MUTABLE half of a promotion: why it is paused and how far the operator has
 * raised its cap. Kept out of `promotions` because the definition hash is the
 * promotion's identity and nothing here is part of it. One row per promotion,
 * created on first need; no FK, so the harness truncates it explicitly.
 *
 * @module libs/core/src/promotions/infrastructure/persistence/entities
 */
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('promotion_state')
export class PromotionStateOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  promotionId!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  pausedReason!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  pausedAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  capExtension!: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
