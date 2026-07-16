/**
 * Invoice Number Gap-Note ORM Entity
 *
 * TypeORM entity for the `invoice_number_gap_notes` table (#8) - the persisted,
 * neutral written explanation of a numbering gap. One note per `(seriesId, seq)`
 * (a unique index), upserted so re-explaining a gap replaces the prior reason.
 * Country-agnostic (ADR-026): `reason` is a free-text neutral string; the
 * jurisdiction's document label is a FE/adapter concern. No FK to the series -
 * the note survives a detached series, mirroring the numbering-route pointer.
 *
 * @module libs/core/src/invoicing/infrastructure/persistence/entities
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('invoice_number_gap_notes')
// One explanation per gap: at most one note per (series, sequence integer).
@Index('UQ_invoice_number_gap_notes_series_seq', ['seriesId', 'seq'], { unique: true })
export class InvoiceNumberGapNoteOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  seriesId!: string;

  /** The sequence integer this note explains. */
  @Column({ type: 'integer' })
  seq!: number;

  /** Rendered document number of the abandoned record, when known; `null` for a skipped integer. */
  @Column({ type: 'text', nullable: true })
  documentNumber!: string | null;

  /** Free-text neutral explanation for the gap. */
  @Column({ type: 'text' })
  reason!: string;

  /** User who recorded the explanation; `null` when unattributed. */
  @Column({ type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
