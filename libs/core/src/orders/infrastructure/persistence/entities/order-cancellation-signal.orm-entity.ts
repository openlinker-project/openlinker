/**
 * Order Cancellation Signal ORM Entity (#2069)
 *
 * TypeORM entity for `order_cancellation_signals` — a durable trace that a
 * source cancellation arrived for an order OpenLinker has not yet ingested.
 * See {@link OrderCancellationSignalRepositoryPort} for why this table exists
 * and why it is keyed on `(sourceConnectionId, externalOrderId)` rather than
 * an internal order id.
 *
 * No FK to `order_records` — the `order_holds` / `order_changes` /
 * `refund_records` precedent of an indexed reference by value, avoiding
 * cross-table lock coupling and, here, referencing a row that may not exist
 * yet at all. `apps/api/test/integration/setup.ts` lists this table in
 * `tablesToTruncate` explicitly: nothing cascades into it.
 *
 * The unique index is declared at class level with the SAME NAME the
 * migration uses (`UQ_order_cancellation_signals_source_external`) — the
 * integration harness builds its schema by `synchronize`, not by migration,
 * so an unnamed decorator would produce a hash name there and the two schemas
 * would diverge on exactly the constraint the port's first-write-wins
 * guarantee relies on (the `order_holds` / `ReturnLineOrmEntity` precedent).
 *
 * @module libs/core/src/orders/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('order_cancellation_signals')
@Index('UQ_order_cancellation_signals_source_external', ['sourceConnectionId', 'externalOrderId'], {
  unique: true,
})
export class OrderCancellationSignalOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sourceConnectionId!: string;

  @Column({ type: 'text' })
  externalOrderId!: string;

  @Column({ type: 'timestamptz' })
  cancelledAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
