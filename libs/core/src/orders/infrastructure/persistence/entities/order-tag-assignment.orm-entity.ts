/**
 * Order Tag Assignment ORM Entity (#3532)
 *
 * No FK to `order_tags` or `order_records` — the `order_cancellation_signals`
 * precedent of an indexed reference by value. Deleting a tag therefore leaves
 * orphaned assignment rows; `OrderTagService.delete` cleans them up itself in
 * the same call (see that service), which is simpler and more explicit than a
 * DB-level cascade this table deliberately carries none of.
 *
 * @module libs/core/src/orders/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('order_tag_assignments')
@Index('UQ_order_tag_assignments_tag_order', ['tagId', 'internalOrderId'], { unique: true })
export class OrderTagAssignmentOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index('IDX_order_tag_assignments_tagId')
  tagId!: string;

  // `internalOrderId` is `ol_order_{uuid}` (`docs/architecture-overview.md §
  // Identifier Mapping Service`), never a bare uuid — `text`, matching every
  // other reference to it in this context (`OrderHoldOrmEntity`,
  // `OrderChangeOrmEntity`, `RefundRecordOrmEntity`).
  @Column({ type: 'text' })
  @Index('IDX_order_tag_assignments_internalOrderId')
  internalOrderId!: string;

  @Column({ type: 'uuid' })
  assignedByUserId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  assignedAt!: Date;
}
