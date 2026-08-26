/**
 * Fiscal Registration Service - contract
 *
 * The core application service that owns the exactly-once guarantee for fiscal
 * registration (ADR-042 decision 6). Adapters never deduplicate; this is the one
 * place the guarantee lives, so no adapter can weaken it.
 *
 * @module libs/core/src/fiscalization/application/services
 */
import type { SalesDocumentInFlight } from '@openlinker/core/sales-documents';

import type { FiscalRegistrationRecord } from '../../domain/entities/fiscal-registration-record.entity';
import type {
  FiscalReconcileOutcome,
  RegisterTransactionCommand,
} from '../../domain/types/fiscalization.types';

/**
 * Result of one reconciliation attempt against an in-doubt record.
 *
 * `outcome` is drawn from the CLOSED {@link FiscalReconcileOutcome} vocabulary,
 * so a surface offering "check with the provider" can state every answer it may
 * get back rather than promising a resolution the check cannot always deliver
 * (ADR-042 amendment #2502, decision 3). Exactly one of the four values is
 * returned; a failed CHECK is not among them and throws
 * `FiscalReconcileCheckFailedException` instead.
 *
 * Only `resolved` writes to the record. The other three leave it exactly as it
 * was, and none of them licenses a resend.
 */
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
   * Is a registration for this order being attempted RIGHT NOW (#2521, ADR-042
   * amendment #2502 decision 2)?
   *
   * A pure READ over persisted state - it takes no lock, calls no provider and
   * attempts nothing. Before it, the fact existed only as the 409 a concurrent
   * write received, which is the correct answer to a write and useless to a
   * reader: a surface could not tell *someone else is registering this right
   * now* from an error.
   *
   * Answers from the same predicate the write path enforces
   * (`FiscalRegistrationRecord.isLeaseLive`), so what an operator is shown and
   * what a second attempt would hit cannot drift. `null` means no live claim -
   * including the case where a claim EXPIRED, which is deliberately not
   * reported as in flight: an expired lease means the previous attempt died,
   * not that one is running.
   *
   * VISIBILITY ONLY. The lease semantics, the exactly-once guarantee and the
   * 409 are all unchanged.
   */
  getInFlightRegistration(orderId: string): Promise<SalesDocumentInFlight | null>;

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
   * not authority to re-send. A provider that HOLDS the sale without having
   * registered it yet reports `still-unknown` (ADR-042 amendment #2502,
   * decisions 1 and 3): the record is left exactly where it was, which is a
   * legitimate answer rather than a failure, and the check may be repeated
   * later.
   *
   * Throws `FiscalRegistrationNotInDoubtException` when the record is in any
   * other state, and `FiscalReconcileCheckFailedException` when the provider
   * could not be ASKED - a transport failure is not an answer, and reporting it
   * as `unsupported` would state a structural fact about the adapter where the
   * truth is a transient one about the network. Neither throw writes anything.
   */
  reconcileInDoubt(recordId: string): Promise<FiscalReconcileResult>;
}
