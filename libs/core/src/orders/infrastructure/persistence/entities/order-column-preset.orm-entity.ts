/**
 * Order Column Preset ORM Entity (#3530)
 *
 * TypeORM entity for `order_column_presets`. `userId` is nullable — NULL marks
 * the single workspace-default row (D32), enforced by a partial unique index
 * declared at class level with the SAME NAME the migration uses (the
 * `order_cancellation_signals` precedent: the integration harness builds its
 * schema by `synchronize`, not by migration, so an unnamed decorator would
 * produce a hash name there and the two schemas would diverge on the exact
 * constraint the "at most one workspace default" guarantee relies on).
 *
 * No FK to `users` — a plain uuid reference by value, mirroring
 * `OrderRecordOrmEntity.packedByUserId`: this table FKs across no context, and
 * a preset outliving its author is the honest outcome for a deleted user.
 *
 * @module libs/core/src/orders/infrastructure/persistence/entities
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('order_column_presets')
@Index('UQ_order_column_presets_workspace_default', ['userId'], {
  unique: true,
  where: '"userId" IS NULL',
})
export class OrderColumnPresetOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  @Index('IDX_order_column_presets_userId')
  userId!: string | null;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'jsonb' })
  columns!: string[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
