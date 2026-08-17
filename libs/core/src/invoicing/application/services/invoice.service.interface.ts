/**
 * Invoice Service Interface (ADR-026 "SVC")
 *
 * Outward contract of the core application service that orchestrates fiscal
 * document issuance. The SVC is a DUMB executor: it owns idempotency, the
 * persist-intent-before-call lifecycle, and per-connection adapter resolution —
 * it does NOT decide whether/which document type to issue. `documentType` is a
 * caller-supplied pass-through; the provider adapter (the country mechanic)
 * derives it when absent. No `faktura`/`paragon`/`NIP` vocabulary lives here.
 *
 * @module libs/core/src/invoicing/application/services
 */
import type {
  GetInvoiceByOrderQuery,
  InvoiceRecordFilters,
  InvoiceRecordPagination,
  IssueCorrectionCommand,
  IssueInvoiceCommand,
  PaginatedInvoiceRecords,
  RegulatoryClearanceResult,
} from '../../domain/types/invoicing.types';
import type { InvoiceRecord } from '../../domain/entities/invoice-record.entity';

export interface IInvoiceService {
  /**
   * Issue a fiscal document for the order described by `cmd`, recording OL's
   * `InvoiceRecord` projection of the outcome.
   *
   * Lifecycle: (1) idempotency read-gate on `(connectionId, idempotencyKey)`;
   * (2) persist a `pending` row BEFORE any external call; (3) resolve the
   * `'Invoicing'` capability adapter for the connection; (4) cross the boundary
   * (`adapter.issueInvoice(cmd)`) and patch the row `issued`/`failed`;
   * (5) a create-race that trips the dedup guard re-reads and returns the winner.
   *
   * FISCAL-SAFETY INVARIANT (governs all retry behaviour): a real fiscal document
   * must NEVER be double-issued. When it is UNCERTAIN whether the provider already
   * created a document, the SVC does NOT auto-re-attempt — it surfaces the record
   * for manual reconciliation. A stuck/needs-attention row is always preferable to
   * a duplicate document.
   *
   * EXACTLY-ONCE CONTRACT — one remaining caller obligation (R1) plus the now-CLOSED
   * concurrency/in-doubt gaps (R2/R3, #1200):
   *
   * - (R1) Exactly-once requires `idempotencyKey`. When omitted, NO deduplication
   *   happens (no read-gate, no DB unique guard): two keyless calls for the same
   *   order produce two pending rows and two real provider documents. Callers
   *   needing exactly-once MUST supply a stable `idempotencyKey`. (Unchanged.)
   *
   * - (R2 — CLOSED, #1200) Concurrent same-key retry no longer double-issues. Before
   *   re-crossing the provider boundary the SVC performs an ATOMIC compare-and-swap
   *   claim (`InvoiceRecordRepositoryPort.claimForIssue`) that flips the row to
   *   `issuing` under a time-bounded lease ONLY when no live attempt already holds
   *   it. Of two concurrent same-key retries exactly ONE wins the claim and calls
   *   the provider; the loser backs off WITHOUT crossing the boundary. The lease
   *   expiry lets a crash-orphaned `issuing` row be re-claimed later.
   *
   * - (R3 — CLOSED, #1200) In-doubt retry no longer double-issues. The adapter
   *   stamps a NEUTRAL `failureMode` (`rejected` | `in-doubt`) on the errors it
   *   throws; the SVC reads it STRUCTURALLY (no adapter error-subclass value-import)
   *   and persists it on the `failed` row. The read-gate then:
   *     • re-attempts a `failed` row ONLY when `failureMode === 'rejected'` — a
   *       TERMINAL rejection where the provider definitely created NO document;
   *     • NEVER auto-re-attempts an `in-doubt` `failed` row (a document MAY exist) —
   *       it is returned for manual reconciliation;
   *     • NEVER re-attempts a row under a LIVE `issuing` lease (an original attempt
   *       is still in flight) — closing the `pending` half of R3 alongside R2.
   *   Any failure whose mode cannot be read structurally collapses to the
   *   fiscal-safe `in-doubt` (never auto-re-attempted).
   *
   * Closure tracked by GitHub issue #1200 (follow-up to #1118): neutral
   * `failureMode` discriminator + CAS/lease (`claimForIssue`) on
   * `InvoiceRecordRepositoryPort`.
   *
   * ONE INVOICE PER ORDER (#2047): before anything else — before the idempotency
   * gate, before any row is created — the SVC refuses to issue when the order
   * already carries a BLOCKING record on a DIFFERENT connection, throwing
   * `OrderAlreadyInvoicedException` (409 at the HTTP boundary) and creating no
   * row. Blocking is `InvoiceRecord.blocksIssuanceElsewhere`: `pending`,
   * `issuing`, `issued`, or `failed` with any `failureMode` other than
   * `rejected`. Only a terminal `rejected` failure elsewhere leaves another
   * provider free — an `in-doubt` failure is precisely the case where a second
   * issuance produces a real duplicate, so it blocks like `pending` does.
   * Records on the REQUESTED connection are untouched by this guard; the
   * per-connection retry/replay semantics above own those.
   */
  issueInvoice(cmd: IssueInvoiceCommand): Promise<InvoiceRecord>;

  /**
   * Read OL's OWN `InvoiceRecord` projection by `(orderId, connectionId)`. NEVER
   * queries the provider/adapter — this is a projection read, not a live lookup.
   * Returns `null` when no record holds the order on the connection.
   */
  getInvoice(query: GetInvoiceByOrderQuery): Promise<InvoiceRecord | null>;

  /**
   * Issue a correction of an already-issued document. Creates a new
   * `InvoiceRecord` for the correcting document (status `pending` → `issued` on
   * success). The original record is NOT mutated — corrections co-exist alongside
   * the original in the projection. Throws `CapabilityNotSupportedException` if
   * the connection's adapter does not implement `CorrectionIssuer`. Throws
   * `CapabilityNotEnabledException` if the capability is not enabled on the
   * connection.
   */
  issueCorrection(cmd: IssueCorrectionCommand): Promise<InvoiceRecord>;

  /**
   * Read OL's OWN `InvoiceRecord` projection by its primary id. Projection read —
   * NEVER queries the provider/adapter. Returns `null` when no record exists.
   * Backs the batch-retry endpoint's per-id eligibility check (#1245), which
   * keys retry-eligibility on `InvoiceRecord.isReattemptableFailure`.
   */
  getInvoiceById(invoiceId: string): Promise<InvoiceRecord | null>;

  /**
   * Read the most recently created `InvoiceRecord` for an order by its internal
   * order id. Projection read — NEVER queries the provider/adapter. Returns `null`
   * when no record exists for the order. Backs the order-detail invoice projection.
   */
  getLatestInvoiceForOrder(orderId: string): Promise<InvoiceRecord | null>;

  /**
   * Distinct invoicing connection ids that hold ANY `InvoiceRecord` for this
   * order, in newest-record-first order (#2047). Projection read — NEVER queries
   * the provider/adapter. Returns `[]` for an order with no records.
   *
   * More than one entry means one sale carries documents on several providers.
   * The #2047 guard makes that unreachable going forward, but it says nothing
   * about rows that already existed — and those are exactly the population that
   * needs looking at. Without this read the order-detail panel, which now shows
   * only the single latest record, would quietly hide the duplicate instead of
   * naming it.
   */
  listInvoiceConnectionIdsForOrder(orderId: string): Promise<string[]>;

  /**
   * Batch counterpart of {@link getLatestInvoiceForOrder} (#1713): the latest
   * `InvoiceRecord` for each of the given order ids, at most one per order.
   * Projection read — NEVER queries the provider/adapter. Backs the orders-list
   * invoice projection (one query per page, not an N+1). Orders with no record
   * are absent from the result; returns `[]` for an empty input.
   */
  getLatestInvoicesForOrders(orderIds: string[]): Promise<InvoiceRecord[]>;

  /**
   * Read-only AC-6 list (#1119) of OL's OWN `InvoiceRecord` projection, filtered
   * + paginated. The cross-context list seam the HTTP layer calls — apps/** reach
   * the invoice projection through this service interface, NEVER the repository
   * port (per architecture-overview.md § Cross-context dependencies in core).
   * Delegates to `InvoiceRecordRepositoryPort.findMany`. NEVER queries the
   * provider/adapter — this is a projection read.
   */
  listInvoices(
    filter: InvoiceRecordFilters,
    pagination: InvoiceRecordPagination,
  ): Promise<PaginatedInvoiceRecords>;

  /**
   * Persist a refreshed regulatory-clearance outcome onto an existing record
   * (#1356). Patches ONLY `regulatoryStatus` + `clearanceReference` — the
   * issuance lifecycle (`status`, provider ids, line snapshot) is untouched.
   * Backs the operator "resend to authority" action: after an adapter that
   * implements `RegulatoryResubmitter` re-triggers transmission, the caller
   * writes the returned {@link RegulatoryClearanceResult} back so the projection
   * reflects the new (typically `submitted`) status and the reconciliation sweep
   * (#1121) resumes polling it. NEVER queries the provider/adapter itself.
   * Throws `InvoiceRecordNotFoundException` when the id is unknown.
   */
  applyRegulatoryClearance(
    invoiceId: string,
    result: RegulatoryClearanceResult,
  ): Promise<InvoiceRecord>;

  /**
   * The BLOCKING `InvoiceRecord` for an order, if any, across ALL connections
   * (#2157, ADR-041 §3a/3b). "Blocking" is `InvoiceRecord.blocksIssuanceElsewhere`
   * — `pending`, `issuing`, `issued`, or `failed` with any `failureMode` other
   * than the terminal `rejected`. Projection read — NEVER queries the
   * provider/adapter. Returns `null` when no record blocks.
   *
   * This is the cross-context read `FiscalRegistrationService.register` calls
   * (via `IInvoiceService`) to enforce ADR-041's cross-KIND exclusivity: an
   * order gets at most one originating sales document, invoice **or** fiscal
   * receipt, never both.
   */
  findBlockingInvoiceForOrder(orderId: string): Promise<InvoiceRecord | null>;
}
