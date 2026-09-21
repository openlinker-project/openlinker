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
  FiscalRegistrationKeysetCursor,
  FiscalRegistrationListFilters,
  FiscalRegistrationOutcomePatch,
} from '../types/fiscalization.types';

/** Page of {@link FiscalRegistrationRecordRepositoryPort.findManyKeyset}. */
export interface FiscalRegistrationKeysetPage {
  items: FiscalRegistrationRecord[];
  /** `null` means the filtered set is exhausted - there is no next page. */
  nextCursor: FiscalRegistrationKeysetCursor | null;
}

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
   * Recent records for ONE connection, newest-first (`createdAt` DESC, `id`
   * DESC), capped at `limit` (#3179). Backs the connection health/diagnostics
   * read: a document registration is real connection activity, and it must
   * count even when the `sync_jobs` row that dispatched it has aged out of
   * that read's own recency window, or predates job-based dispatch (#2525)
   * entirely.
   *
   * **The selection clock is not the comparison clock.** The window is the
   * newest `limit` rows by `createdAt`, while the caller ranks them by
   * `registeredAt ?? updatedAt`. A record created outside that window but
   * registered recently — a long-running `in-doubt` registration that #2520's
   * reconcile later resolved, or one that spent the retry ladder's 6-hour
   * backoff before succeeding — therefore never reaches the merge, so the
   * caller's "last succeeded" is a lower bound rather than an exact answer. An
   * accepted proxy for a diagnostics read, not an invariant. Returns `[]` for
   * a connection with no records.
   */
  findRecentByConnectionId(
    connectionId: string,
    limit: number,
  ): Promise<FiscalRegistrationRecord[]>;

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

  /**
   * Cross-order operational list (#3306) - every record matching `filter`,
   * newest-first, keyset-paginated on `(createdAt, id)` (never `OFFSET`: a
   * merged, financial-audit-adjacent list must not silently skip or duplicate
   * a row when a document lands mid-walk - see
   * `docs/engineering-standards.md` § When A Paginated Total Is Expensive for
   * the sibling reasoning on the invoice side).
   *
   * `opts.cursor` absent means "first page." `nextCursor` on the returned page
   * is the last row's `(createdAt, id)` when a full page was returned, else
   * `null` - the caller must not assume a short page means "more may follow,"
   * because keyset pagination (unlike `OFFSET`) cannot cheaply answer that
   * without a stable point of reference from the CURRENT page.
   */
  findManyKeyset(
    filter: FiscalRegistrationListFilters,
    opts: { limit: number; cursor?: FiscalRegistrationKeysetCursor },
  ): Promise<FiscalRegistrationKeysetPage>;
}
