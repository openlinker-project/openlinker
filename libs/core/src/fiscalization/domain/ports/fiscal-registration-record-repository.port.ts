/**
 * Fiscal Registration Record Repository Port
 *
 * Persistence contract for `fiscal_registration_records`. Minimal surface - only
 * what the application service needs.
 *
 * Two members carry the exactly-once guarantee (ADR-042 decision 6) and are not
 * ordinary CRUD: {@link FiscalRegistrationRecordRepositoryPort.create} relies on
 * a PLAIN unique index on `(connectionId, idempotencyKey)`, and
 * {@link FiscalRegistrationRecordRepositoryPort.claimForRegistration} is the
 * atomic in-flight claim. The index alone is insufficient - without the claim,
 * two concurrent same-key calls both pass the read gate and both reach the
 * provider.
 *
 * @module libs/core/src/fiscalization/domain/ports
 */
import type { FiscalRegistrationRecord } from '../entities/fiscal-registration-record.entity';
import type {
  CreateFiscalRegistrationRecordInput,
  FiscalRegistrationOutcomePatch,
} from '../types/fiscalization.types';

export interface FiscalRegistrationRecordRepositoryPort {
  /**
   * Insert a new record. Throws `DuplicateFiscalRegistrationRecordException`
   * when it collides with the `(connectionId, idempotencyKey)` unique guard.
   */
  create(input: CreateFiscalRegistrationRecordInput): Promise<FiscalRegistrationRecord>;

  findById(id: string): Promise<FiscalRegistrationRecord | null>;

  /** Read half of the exactly-once gate; `null` when no row holds the key. */
  findByIdempotencyKey(
    connectionId: string,
    idempotencyKey: string,
  ): Promise<FiscalRegistrationRecord | null>;

  /**
   * Every record held by an order, across ALL connections, newest-first
   * (`createdAt` DESC, `id` DESC). Returns `[]` for an order with no records.
   */
  findAllByOrderId(orderId: string): Promise<FiscalRegistrationRecord[]>;

  /**
   * Batch counterpart of {@link findAllByOrderId} (#2516): every record held by
   * any of the given orders, across ALL connections, newest-first within each
   * order (`orderId` ASC, then `createdAt` DESC, `id` DESC). Backs the per-order
   * sales-document projection (ADR-065), which renders a whole page of orders
   * and must not pay one query per row. Returns `[]` for an empty input.
   */
  findAllByOrderIds(orderIds: readonly string[]): Promise<FiscalRegistrationRecord[]>;

  /**
   * Apply an outcome patch. Throws `FiscalRegistrationRecordNotFoundException`
   * when the id does not exist.
   */
  updateOutcome(
    id: string,
    patch: FiscalRegistrationOutcomePatch,
  ): Promise<FiscalRegistrationRecord>;

  /**
   * Atomic compare-and-swap claim of the in-flight registration slot. A SINGLE
   * guarded UPDATE flips the row to `registering` with a fresh lease ONLY when
   * no live attempt holds it AND a re-attempt is fiscally safe:
   *   - `pending` (no lease by definition), OR
   *   - a TERMINAL-`rejected` `failed` row (the provider definitely created
   *     nothing), OR
   *   - `registering` with an EXPIRED lease (a crashed prior attempt).
   *
   * A `registered` row, an in-doubt/mode-less `failed` row and a live
   * `registering` lease NEVER match, so none can be re-claimed and re-sent. The
   * fiscal invariant is enforced HERE, at the persistence boundary, not only in
   * the service - no caller can weaken it.
   *
   * Returns the claimed row on a WIN; returns `null` on a contended loss, at
   * which point the caller MUST back off WITHOUT crossing the provider boundary.
   * A `null` is a SAFE non-action: a stuck record is preferable to a
   * double-registered sale. Throws
   * `FiscalRegistrationRecordNotFoundException` when the id does not exist.
   */
  claimForRegistration(
    id: string,
    leaseExpiresAt: Date,
  ): Promise<FiscalRegistrationRecord | null>;
}
