/**
 * Invoice Numbering Series ORM Entity
 *
 * TypeORM entity for the `invoice_numbering_series` table (#1575) — the
 * connection-assignable source of legal, sequential document numbers. The
 * sequence advance + period reset happen through a single guarded
 * `UPDATE ... RETURNING` (see the repository); this entity is the row shape.
 *
 * @module libs/core/src/invoicing/infrastructure/persistence/entities
 * @see {@link InvoiceNumberingSeries} for the domain entity
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ResetPolicy } from '../../../domain/types/invoice-numbering.types';

@Entity('invoice_numbering_series')
export class InvoiceNumberingSeriesOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  pattern!: string;

  @Column({ type: 'integer' })
  nextSeq!: number;

  @Column({ type: 'integer', default: 0 })
  seqPadding!: number;

  @Column({ type: 'text' })
  resetPolicy!: ResetPolicy;

  /** Opaque period marker `nextSeq` belongs to; empty string for `none`. */
  @Column({ type: 'text', default: '' })
  periodKey!: string;

  /** Neutral document type this series numbers (#9); defaults to `invoice`. */
  @Column({ type: 'text', default: 'invoice' })
  documentType!: string;

  /** Optional neutral register/entity scope (#10); NULL = the type's register-less default. */
  @Column({ type: 'text', nullable: true })
  register!: string | null;

  /**
   * Calendar month (1–12) the series' fiscal year starts on (#1692), governing
   * `{FY}`. Defaults to `1` (calendar year), so `{FY}` === `{YYYY}`.
   */
  @Column({ type: 'integer', default: 1 })
  fiscalYearStartMonth!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
