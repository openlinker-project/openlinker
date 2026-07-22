/**
 * Invoice Numbering Route ORM Entity
 *
 * TypeORM entity for the `invoice_numbering_routes` table (#9 / #10 / #1694) —
 * the detachable rule routing a connection's document to a numbering series by
 * its neutral document type and optional register / currency / source axes.
 * Replaces the pre-#9 `invoice_numbering_assignments` main/correction split.
 *
 * Resolution key: `(connectionId, documentType, register, currency, source)`. A
 * surrogate `id` primary key is used because the axis columns are nullable (a
 * NULL cannot sit in a composite primary key); a single COALESCE-based unique
 * index enforces NULL-distinct uniqueness across the full routing key (see the
 * migration). No FK to `connections`: the route (and its series) survives
 * connection deletion, and the FK to `invoice_numbering_series` is
 * `ON DELETE RESTRICT` so a series is never cascade-deleted out from under a
 * route.
 *
 * @module libs/core/src/invoicing/infrastructure/persistence/entities
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('invoice_numbering_routes')
export class InvoiceNumberingRouteOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'text' })
  documentType!: string;

  /** Optional neutral register/entity scope; NULL = wildcard (the register-less default route). */
  @Column({ type: 'text', nullable: true })
  register!: string | null;

  /** Optional ISO-4217 currency axis (#1694); NULL = wildcard (matches any currency). */
  @Column({ type: 'text', nullable: true })
  currency!: string | null;

  /** Optional neutral order-origin axis (#1694); NULL = wildcard (matches any source). */
  @Column({ type: 'text', nullable: true })
  source!: string | null;

  @Column({ type: 'uuid' })
  seriesId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
