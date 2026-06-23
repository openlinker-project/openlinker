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
   * ACCEPTED-RISK CONTRACT — three explicit risks the future ECA caller MUST heed:
   *
   * - (R1) Exactly-once requires `idempotencyKey`. When omitted, NO deduplication
   *   happens (no read-gate, no DB unique guard): two keyless calls for the same
   *   order produce two pending rows and two real provider documents. Callers
   *   needing exactly-once MUST supply a stable `idempotencyKey`.
   *
   * - (R2) non-`issued`-row retry is single-flight-only. A same-key call whose
   *   prior attempt left a non-`issued` row (`failed` OR `pending`) re-attempts by
   *   REUSING that row (`updateOutcome`, not `create`). The partial unique index
   *   only guards the create path, so two CONCURRENT same-key retries can both read
   *   the row and both call the provider — two documents. Non-`issued`-row retries
   *   are exactly-once ONLY when serialized.
   *
   * - (R3) non-`issued`-row retry may double-issue an in-doubt document. The
   *   read-gate re-attempts on ANY non-`issued` hit — `failed` AND `pending` (it
   *   only short-circuits on `issued`). The SVC cannot distinguish a terminal
   *   provider rejection from a transient transport failure (it must not
   *   value-import the adapter error subclasses), so any non-`issued` row is always
   *   treated as re-attemptable. Two double-issue exposures result:
   *     • A `failed` hit may correspond to an in-doubt transport failure where the
   *       provider actually DID issue; the retry re-crosses the boundary and may
   *       double-issue a real fiscal document.
   *     • A `pending` hit is the STRONGEST in-doubt case: it means a prior same-key
   *       attempt persisted intent and crashed/raced mid-adapter-call, OR an
   *       ORIGINAL attempt for that key is STILL IN FLIGHT. The SVC does not exclude
   *       a concurrent in-flight original, so a retry on a `pending` hit can
   *       double-issue alongside it. This is the path with the highest exactly-once
   *       exposure.
   *   Deliberate MVP trade-off: never-retrying non-`issued` rows would brick
   *   transient failures and orphan crash-interrupted `pending` intents (worse),
   *   while a deterministic terminal rejection simply fails again with no
   *   double-issue.
   *
   * Follow-up (R2/R3 closure): see GitHub issue TODO(#<follow-up>) — neutral
   * `retryable` discriminator (so `failed` rows from terminal vs. transient
   * outcomes are distinguishable) + compare-and-swap/lease on
   * `InvoiceRecordRepositoryPort` (so a `pending` row's still-in-flight original is
   * excluded before a retry re-crosses the boundary). (Number recorded during the
   * LOGIC pass.)
   */
  issueInvoice(cmd: IssueInvoiceCommand): Promise<InvoiceRecord>;

  /**
   * Read OL's OWN `InvoiceRecord` projection by `(orderId, connectionId)`. NEVER
   * queries the provider/adapter — this is a projection read, not a live lookup.
   * Returns `null` when no record holds the order on the connection.
   */
  getInvoice(query: GetInvoiceByOrderQuery): Promise<InvoiceRecord | null>;

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
