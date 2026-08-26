/**
 * Fiscal Registration Service - contract
 *
 * The core application service that owns the exactly-once guarantee for fiscal
 * registration (ADR-042 decision 6). Adapters never deduplicate; this is the one
 * place the guarantee lives, so no adapter can weaken it.
 *
 * @module libs/core/src/fiscalization/application/services
 */
import type { FiscalRegistrationRecord } from '../../domain/entities/fiscal-registration-record.entity';
import type {
  FiscalReconcileOutcome,
  RegisterTransactionCommand,
} from '../../domain/types/fiscalization.types';

/** Result of one reconciliation attempt against an in-doubt record. */
export interface FiscalReconcileResult {
  outcome: FiscalReconcileOutcome;
  record: FiscalRegistrationRecord;
}

export interface IFiscalRegistrationService {
  /**
   * Register a completed sale, exactly once per `(connectionId,
   * idempotencyKey)`.
   *
   * The guarantee is upheld by five things acting together, none of which is
   * sufficient alone:
   *
   *   1. a MANDATORY caller-supplied key - there is no keyless mode;
   *   2. a PLAIN unique index on `(connectionId, idempotencyKey)`;
   *   3. the record written BEFORE the outbound call, so an indeterminate crash
   *      still leaves durable evidence;
   *   4. an ATOMIC in-flight claim, without which two concurrent same-key calls
   *      both pass the read gate and both reach the provider;
   *   5. an AT-MOST-ONE-ORIGINATING-REGISTRATION guard on the ORDER, without
   *      which re-posting the same sale under a DIFFERENT key misses the read
   *      gate entirely - the index is keyed on `(connectionId, idempotencyKey)`
   *      and knows nothing about orders. Throws
   *      `OrderAlreadyRegisteredException` when the order already carries a
   *      record that is `pending` / `registering` / `registered`, or `failed`
   *      with any `failureMode` other than the terminal `rejected` - the same
   *      predicate ADR-041 §3b states for originating documents.
   *
   * A repeat RESUMES the existing record under a status-aware invariant, never
   * blindly:
   *
   *   - `registered`                    -> returned verbatim;
   *   - a live in-flight lease          -> returned as-is, no second call;
   *   - an `in-doubt` failure           -> returned as-is for reconciliation;
   *   - `pending` / expired lease /
   *     a terminal `rejected` failure   -> re-attemptable under the same key.
   *
   * Never throws on a provider rejection: the outcome is persisted on the record
   * and the record is returned, so a failure surfaces on the order with an
   * actionable reason instead of interrupting other order processing.
   *
   * That is a DELIBERATE FORK from `InvoiceService.issueInvoice`, which rethrows.
   * The two contexts therefore have opposite error contracts for the same shape
   * of operation, and a caller must not port assumptions across: an HTTP 200 here
   * says the request was handled, NOT that the sale was registered. A caller -
   * including the FE - reads `status` / `failureMode`, never the status code.
   * A refusal (missing key, order already registered) still throws, because
   * nothing was attempted and there is no record to reason about.
   */
  register(cmd: RegisterTransactionCommand): Promise<FiscalRegistrationRecord>;

  /** Every registration record held by an order, across connections, newest-first. */
  getByOrderId(orderId: string): Promise<FiscalRegistrationRecord[]>;

  /**
   * Batch counterpart of {@link getByOrderId} (#2516): every registration
   * record held by any of the given orders, across ALL connections,
   * newest-first within each order. Projection read - NEVER queries the
   * provider/adapter. One query for a whole page of orders, which is what the
   * per-order sales-document projection (ADR-065) needs. Orders with no record
   * are absent; returns `[]` for an empty input.
   */
  getByOrderIds(orderIds: readonly string[]): Promise<FiscalRegistrationRecord[]>;

  /**
   * Read one record by id. Throws `FiscalRegistrationRecordNotFoundException`
   * when it does not exist.
   */
  getById(id: string): Promise<FiscalRegistrationRecord>;

  /**
   * Settle an INDETERMINATE outcome by asking the provider whether the sale is
   * registered (ADR-042 decision 7).
   *
   * This is the ONLY sanctioned way out of `in-doubt` other than an operator
   * decision, and it is deliberately not a resend: a resend of a registration
   * that already landed is precisely the double registration the contract
   * exists to prevent. A provider that cannot be queried by business
   * coordinates reports `unsupported` and the record is left for the operator.
   * A `not-found` answer likewise leaves the record in doubt - it is evidence,
   * not authority to re-send.
   *
   * Throws `FiscalRegistrationNotInDoubtException` when the record is in any
   * other state.
   */
  reconcileInDoubt(recordId: string): Promise<FiscalReconcileResult>;
}
