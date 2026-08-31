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
import type { FiscalRegistrationRequestAccepted } from '../../domain/types/fiscal-registration-request.types';
import type { FiscalRegistrationProgress } from '../../domain/types/fiscal-registration-progress.types';
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

/**
 * Where one order's registration is on one connection, as a poll can read it
 * (#2526).
 *
 * Three facts, each answering a different question, none derivable from another:
 * the single progress value a surface renders, the record it renders the detail
 * from, and the neutral in-flight signal shared with invoicing.
 *
 * `record` is `null` in exactly the states where none exists - `not-requested`,
 * and the `queued` window before the job runs - which is the window this read
 * exists for.
 */
export interface FiscalRegistrationProgressView {
  progress: FiscalRegistrationProgress;
  /** The record held under this (connection, order) key; `null` when none. */
  record: FiscalRegistrationRecord | null;
  /**
   * The order's live claim, ACROSS connections - the M2 signal, unchanged. It is
   * order-scoped where `progress` is connection-scoped, deliberately: an
   * operator needs to know a document is being produced for this sale even when
   * it is being produced somewhere they did not ask.
   */
  inFlight: SalesDocumentInFlight | null;
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

  /**
   * ASK for a registration, without performing one (#2525).
   *
   * Writes a `fiscalization.register` job and returns. The sale is registered
   * later, by {@link register} running inside that job, so this method never
   * reaches a provider and never produces a record. Its answer says the request
   * was accepted and nothing more; a caller learns the outcome by reading the
   * order's registration state afterwards.
   *
   * This is the path an operator-initiated registration takes. Performing the
   * work inline inside the HTTP request instead tied a fiscal act to a browser
   * tab: the provider poll can outlast the request, and a closed tab cut the
   * request off while the record it had already written stayed behind, so the
   * operator lost sight of a registration that was still happening.
   *
   * EXACTLY-ONCE IS UNCHANGED, and is not weakened by there now being a queue in
   * front of it. Three layers hold, and this method adds nothing of its own:
   *   1. the job's `idempotencyKey` is the same deterministic
   *      `(connectionId, orderId)` key the record uses, so two requests for one
   *      sale produce ONE job row and the second joins the first;
   *   2. the job payload carries that key into `register`, which applies the
   *      read gate, the unique index and the in-flight claim exactly as before;
   *   3. the order-level guard is re-applied under the per-order lock when the
   *      job runs, so nothing decided here can license a second document.
   *
   * A job left `dead` after exhausting its retries is re-driven rather than
   * ignored, because otherwise a lost job would leave an order permanently
   * un-registrable from the UI: the enqueue would keep returning the dead row.
   * Re-driving re-runs the SAME key against the SAME record, which is a resume,
   * not a resend.
   *
   * Throws the same refusals {@link assertRegistrable} does when the order
   * already carries a blocking document, so an operator is told at the point of
   * asking rather than by a job that quietly fails later.
   */
  requestRegistration(
    cmd: RegisterTransactionCommand,
    provenance: { sourceConnectionId: string; sourceEventId?: string },
  ): Promise<FiscalRegistrationRequestAccepted>;

  /**
   * Refuse, as a READ, an order that already carries a blocking sales document.
   *
   * The same predicate the write path enforces under the per-order lock, exposed
   * so a caller that is only ASKING for a registration can be refused at that
   * point instead of being told the request was accepted and then having a job
   * fail out of sight. It takes no lock, writes nothing and calls no provider.
   *
   * ADVISORY BY CONSTRUCTION. Passing here does not license anything: the
   * authoritative guard is the one {@link register} runs inside the lock, and a
   * peer can persist a blocking record between this read and that write. Nothing
   * may treat a clean answer here as permission.
   *
   * Throws `OrderAlreadyRegisteredException` for a blocking fiscal record on any
   * connection, and `OrderAlreadyHasInvoiceException` for a blocking invoice.
   *
   * It is the guard for a NEW originating registration, so a caller resuming an
   * existing attempt under the same key must not run it - a `pending` row and a
   * `registering` row both block, correctly, and a resume is not a second
   * document. {@link requestRegistration} makes that distinction itself.
   */
  assertRegistrable(orderId: string, requestedConnectionId: string): Promise<void>;

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
   *
   * Consumed by the per-order sales-document projection, which reports both
   * document kinds through this one neutral shape. The fiscal-registration HTTP
   * read deliberately does NOT call it: that endpoint already holds the order's
   * records and derives its per-record `inFlight` from the same `isLeaseLive`
   * predicate, so routing through here would repeat the read to answer a
   * question it can already answer. The seam exists for the caller that has an
   * order id and no records - which is the projection, not the list endpoint.
   */
  getInFlightRegistration(orderId: string): Promise<SalesDocumentInFlight | null>;

  /**
   * Where this order's registration is on this connection (#2526).
   *
   * The poll target for a registration that outlives the request which asked for
   * it. A PURE READ: it takes no lock, writes nothing, calls no provider and
   * cannot cause a registration. Polling it a thousand times is exactly as
   * consequential as not polling it at all.
   *
   * Connection-scoped because the exactly-once key is, and because the answer is
   * about one attempt. It resolves the record under the deterministic
   * `(connection, order)` key together with the liveness of the job enqueued
   * under that same key, which is the only way the window between enqueueing and
   * the job running can be reported at all - in that window no record exists,
   * and reading the record alone would report the sale as never requested.
   */
  getRegistrationProgress(
    orderId: string,
    connectionId: string,
  ): Promise<FiscalRegistrationProgressView>;

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
   * not authority to re-send. A check that neither confirms a registration nor
   * establishes an absence reports `still-unknown` (ADR-042 amendment #2502,
   * decisions 1 and 3): the record is left exactly where it was, which is a
   * legitimate answer rather than a failure, and the check may be repeated
   * later. It does NOT assert that the provider is holding the sale - that is
   * the usual cause, but the same outcome covers an answer core could not read.
   *
   * Throws `FiscalRegistrationNotInDoubtException` when the record is in any
   * other state, and `FiscalReconcileCheckFailedException` when the provider
   * could not be ASKED - a transport failure is not an answer, and reporting it
   * as `unsupported` would state a structural fact about the adapter where the
   * truth is a transient one about the network. Neither throw writes anything.
   */
  reconcileInDoubt(recordId: string): Promise<FiscalReconcileResult>;
}
