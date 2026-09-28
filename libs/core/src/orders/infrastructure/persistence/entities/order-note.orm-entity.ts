/**
 * Order Note ORM Entity (#3531)
 *
 * No FK to `order_records` or `users` — the `order_cancellation_signals` /
 * `packedByUserId` precedent of an indexed reference by value.
 * `apps/api/test/integration/setup.ts` lists this table in
 * `tablesToTruncate` explicitly.
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

@Entity('order_notes')
export class OrderNoteOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index('IDX_order_notes_internalOrderId')
  internalOrderId!: string;

  @Column({ type: 'uuid' })
  authorUserId!: string;

  @Column({ type: 'text' })
  authorUsername!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'boolean', default: false })
  @Index('IDX_order_notes_showToPacker')
  showToPacker!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  editedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
