/**
 * Fiscal Registration Record ORM Entity
 *
 * TypeORM entity for the `fiscal_registration_records` table.
 *
 * The unique index on `(connectionId, idempotencyKey)` is PLAIN, not partial -
 * the difference from `invoice_records` is deliberate (ADR-042 decision 6): the
 * key is mandatory and never null here, so there is no null-key row for a
 * partial predicate to exempt.
 *
 * `regimeExtras` is an adapter-owned jsonb bag whose keys core persists verbatim
 * and indexes NOWHERE - lifting one into an index would make a regime-specific
 * key part of the shared contract, which is exactly what ADR-042 decision 4
 * forbids.
 *
 * @module libs/core/src/fiscalization/infrastructure/persistence/entities
 * @see {@link FiscalRegistrationRecord} for the corresponding domain entity
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// `FiscalRegistrationStatus` is a VALUE import on purpose: it annotates a
// `@Column`-decorated property, and `emitDecoratorMetadata` needs the binding to
// survive erasure (mirrors `invoice-record.orm-entity.ts`).
import { FiscalRegistrationStatus } from '../../../domain/types/fiscalization.types';
import type {
  FiscalArtefact,
  FiscalRegistrationFailureMode,
} from '../../../domain/types/fiscalization.types';

@Entity('fiscal_registration_records')
@Index('IDX_fiscal_registration_records_order_connection', ['orderId', 'connectionId'])
@Index('IDX_fiscal_registration_records_connectionId', ['connectionId'])
@Index('IDX_fiscal_registration_records_status', ['status'])
// Exactly-once guard. PLAIN unique (not partial): `idempotencyKey` is NOT NULL.
@Index(
  'UQ_fiscal_registration_records_connection_idempotency',
  ['connectionId', 'idempotencyKey'],
  { unique: true },
)
export class FiscalRegistrationRecordOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'text' })
  orderId!: string;

  /** Backfilled from the adapter result; `''` on the pending row. */
  @Column({ type: 'text' })
  providerType!: string;

  /** Mandatory exactly-once key - never null. */
  @Column({ type: 'text' })
  idempotencyKey!: string;

  @Column({ type: 'text' })
  status!: FiscalRegistrationStatus;

  /** Provider-assigned locator key - what a later lookup is keyed on. */
  @Column({ type: 'text', nullable: true })
  providerReference!: string | null;

  /** Reference borne by the registered document itself. */
  @Column({ type: 'text', nullable: true })
  documentReference!: string | null;

  /**
   * Flat identifier of whatever performed or signed the registration. Flat by
   * design - an anchor-class union is what ADR-042 decision 3 rejects.
   */
  @Column({ type: 'text', nullable: true })
  signingIdentity!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  registeredAt!: Date | null;

  /** Adapter-owned flat string key/values; no key inside is indexed. */
  @Column({ type: 'jsonb', nullable: true })
  regimeExtras!: Record<string, string> | null;

  /**
   * Customer-facing outputs of the registration. `[]` on a `registered` row is a
   * SUCCESS (a pure reporting regime returns identifiers only) and is distinct
   * from the `null` of a row that never got that far.
   */
  @Column({ type: 'jsonb', nullable: true })
  artefacts!: FiscalArtefact[] | null;

  /** `null` unless `status = 'failed'`. `in-doubt` is non-terminal. */
  @Column({ type: 'text', nullable: true })
  failureMode!: FiscalRegistrationFailureMode | null;

  /** Short PII-free operator-facing summary; safe to expose. */
  @Column({ type: 'text', nullable: true })
  failureReason!: string | null;

  /** INTERNAL-ONLY bounded diagnostic; never returned to an API caller. */
  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  /**
   * Expiry of the in-flight claim; `null` unless this row holds the slot. Backs
   * the atomic guard that lets exactly one concurrent same-key attempt cross the
   * provider boundary.
   */
  @Column({ type: 'timestamptz', nullable: true })
  leaseExpiresAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
