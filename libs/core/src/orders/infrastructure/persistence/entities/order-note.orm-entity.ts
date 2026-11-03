/**
 * Order Note ORM Entity (#3531)
 *
 * No FK to `order_records` or `users` — the `order_cancellation_signals` /
 * `packedByUserId` precedent of an indexed reference by value.
 * `apps/api/test/integration/setup.ts` lists this table in
 * `tablesToTruncate` explicitly.
 *
 * `pinnedAt` (#3507 recovery pass) is the "at most one pinned note per
 * order" mark (mockup M3: "pin one note full width under the header").
 * Enforced by a partial unique index declared at CLASS level under the
 * SAME NAME the migration uses — the `order_column_presets` workspace-default
 * precedent, load-bearing for the same reason: the integration harness
 * builds its schema by `synchronize`, not by migration, so an unnamed
 * decorator would mint a hash name there and the two schemas would diverge
 * on the exact constraint the "at most one" guarantee relies on.
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
@Index('UQ_order_notes_pinned_per_order', ['internalOrderId'], {
  unique: true,
  where: '"pinnedAt" IS NOT NULL AND "deletedAt" IS NULL',
})
export class OrderNoteOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // `internalOrderId` is `ol_order_{uuid}` (`docs/architecture-overview.md §
  // Identifier Mapping Service`), never a bare uuid — `text`, matching every
  // other reference to it in this context (`OrderHoldOrmEntity`,
  // `OrderChangeOrmEntity`, `RefundRecordOrmEntity`).
  @Column({ type: 'text' })
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

  /** `null` = not pinned. At most one non-null, non-deleted row per order. */
  @Column({ type: 'timestamptz', nullable: true })
  pinnedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
