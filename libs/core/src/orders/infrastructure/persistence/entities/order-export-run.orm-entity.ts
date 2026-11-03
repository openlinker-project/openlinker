/**
 * Order Export Run ORM Entity (#3534, D35)
 *
 * `order_exports` — the `analytics_remediation_runs` shape (#2468): a
 * generated `text` primary key, plain columns, no FK to `users` (a
 * `requestedByUserId` reference by value, the `packedByUserId` /
 * `order_notes.authorUserId` precedent — a export outliving its requester's
 * account is the honest outcome).
 *
 * `file` is `jsonb`, nullable — the `StoredDocument` shape, populated only
 * once the run reaches `ready`.
 *
 * No FK, so `apps/api/test/integration/setup.ts` lists this table in its
 * explicit truncation set.
 *
 * @module libs/core/src/orders/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { OrderExportFile } from '../../../domain/types/order-export.types';

@Entity('order_exports')
@Index('IDX_order_exports_requestedByUserId', ['requestedByUserId'])
export class OrderExportRunOrmEntity {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'uuid' })
  requestedByUserId!: string;

  @Column({ type: 'text' })
  status!: string;

  @Column({ type: 'text' })
  format!: string;

  @Column({ type: 'text' })
  scope!: string;

  @Column({ type: 'jsonb' })
  filters!: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  selectedOrderIds!: string[];

  @Column({ type: 'jsonb' })
  columns!: string[];

  @Column({ type: 'integer', nullable: true })
  rowCount!: number | null;

  @Column({ type: 'boolean', nullable: true })
  containsPii!: boolean | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  file!: OrderExportFile | null;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
