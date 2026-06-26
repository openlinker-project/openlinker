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
  IssueInvoiceCommand,
  PaginatedInvoiceRecords,
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
   */
  issueInvoice(cmd: IssueInvoiceCommand): Promise<InvoiceRecord>;

  /**
   * Read OL's OWN `InvoiceRecord` projection by `(orderId, connectionId)`. NEVER
   * queries the provider/adapter — this is a projection read, not a live lookup.
   * Returns `null` when no record holds the order on the connection.
   */
  getInvoice(query: GetInvoiceByOrderQuery): Promise<InvoiceRecord | null>;

  /**
   * Read OL's OWN `InvoiceRecord` projection by its primary id. Projection read —
   * NEVER queries the provider/adapter. Returns `null` when no record exists.
   * Backs the batch-retry endpoint's per-id eligibility check (#1245), which
   * keys retry-eligibility on `InvoiceRecord.isReattemptableFailure`.
   */
  getInvoiceById(invoiceId: string): Promise<InvoiceRecord | null>;

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
}
