/**
 * Invoice Numbering Assignment ORM Entity
 *
 * TypeORM entity for the `invoice_numbering_assignments` table (#1575) — the
 * detachable pointer linking a connection to its main numbering series and an
 * optional correction series. Keyed by `connectionId` (one assignment per
 * connection). No FK to `connections`: the assignment survives connection
 * deletion, and the FKs to `invoice_numbering_series` are `ON DELETE RESTRICT`
 * so a series is never cascade-deleted out from under an assignment.
 *
 * @module libs/core/src/invoicing/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('invoice_numbering_assignments')
export class InvoiceNumberingAssignmentOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'uuid' })
  mainSeriesId!: string;

  @Column({ type: 'uuid', nullable: true })
  correctionSeriesId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
