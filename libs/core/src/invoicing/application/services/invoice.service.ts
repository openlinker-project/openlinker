/**
 * Invoice Service (ADR-026 "SVC")
 *
 * Core application service that orchestrates fiscal document issuance. A DUMB
 * executor: it owns idempotency, the persist-intent-before-call lifecycle, and
 * per-connection adapter resolution — it does NOT decide whether/which document
 * type to issue (`documentType` is a caller-supplied pass-through; the provider
 * adapter derives it when absent). Depends ONLY on ports
 * (`InvoiceRecordRepositoryPort` + `IIntegrationsService`), never concrete
 * adapters; nothing from `libs/integrations` is imported. No `faktura`/`paragon`/
 * `NIP` vocabulary lives here.
 *
 * The accepted-risk contract (R1/R2/R3) is on {@link IInvoiceService}.
 *
 * @module libs/core/src/invoicing/application/services
 * @implements {IInvoiceService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';

import type { IInvoiceService } from './invoice.service.interface';
import { InvoiceRecordRepositoryPort } from '../../domain/ports/invoice-record-repository.port';
import { INVOICE_RECORD_REPOSITORY_TOKEN } from '../../invoicing.tokens';
import type { InvoiceRecord } from '../../domain/entities/invoice-record.entity';
import type { InvoicingPort } from '../../domain/ports/invoicing.port';
import { DuplicateInvoiceRecordException } from '../../domain/exceptions/duplicate-invoice-record.exception';
import { InvoiceRecordNotFoundException } from '../../domain/exceptions/invoice-record-not-found.exception';
import type {
  GetInvoiceByOrderQuery,
  InvoiceFailureCode,
  InvoiceFailureMode,
  InvoiceOutcomePatch,
  InvoiceRecordFilters,
  InvoiceRecordPagination,
  IssueInvoiceCommand,
  PaginatedInvoiceRecords,
} from '../../domain/types/invoicing.types';

/**
 * Capability key the connection must declare to issue a document. Open-world
 * string, registered in `integrations/domain/types/adapter.types.ts`.
 */
const INVOICING_CAPABILITY = 'Invoicing';

/**
 * Max persisted length of a sanitized `errorMessage`. The adapter is
 * third-party-shaped and may echo buyer-supplied data in a rejection message;
 * bound it before storing so `invoice_records.errorMessage` stays a small,
 * operator-facing diagnostic rather than an unbounded PII sink.
 */
const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * Max persisted length of the PII-free `failureReason` (W1). Far shorter than
 * `errorMessage` because it is a sanitized, operator-facing one-liner that is
 * SAFE to expose on the response DTO — it must never become a PII sink.
 */
const MAX_FAILURE_REASON_LENGTH = 200;

/**
 * Substrings (case-insensitive) that mark a `rejected` failure as a buyer
 * tax-identifier problem, so the FE can prompt the operator to fix the buyer
 * data. Neutral vocabulary only (no country tax-system names per ADR-026):
 * matches the generic "tax id" the adapter surfaces in its rejection reason.
 */
const TAX_ID_REJECTION_MARKERS = ['tax id', 'tax-id', 'taxid', 'tax identifier'] as const;

/**
 * Lifetime of an `issuing` CAS lease (#1200). Bounds how long a crashed
 * mid-call attempt can block same-key retries before the slot becomes
 * re-claimable.
 *
 * FISCAL SAFETY — this MUST stay strictly greater than the longest possible
 * single provider round-trip, or an expired lease could be re-claimed while the
 * original call is still in flight → a SECOND provider call → a double-issued
 * fiscal document. Today the Subiekt adapter caps its per-request `timeoutMs` at
 * 120 s at config validation (subiekt-adapter.factory.ts), so 5 min leaves a
 * comfortable 2.5× margin. The margin is now enforced BY CONSTRUCTION rather than
 * by comment: `MAX_SUPPORTED_PROVIDER_TIMEOUT_MS` records the ceiling every
 * provider adapter must keep its round-trip under, and the module-load assertion
 * below fails fast if the lease is ever lowered to (or below) that ceiling.
 *
 * @internal Exported only so the invariant is unit-testable; NOT on the
 * invoicing barrel (the barrel re-exports `InvoiceService` by name).
 */
export const ISSUING_LEASE_MS = 5 * 60 * 1000;

/**
 * Hard ceiling, in milliseconds, on any single provider round-trip the system
 * supports (incl. transport retries) — the Subiekt config validation enforces
 * its 120 s `timeoutMs` cap to honour this. The CAS lease (`ISSUING_LEASE_MS`)
 * MUST strictly exceed this so an expired lease can never be re-claimed while an
 * original provider call is still in flight (the fiscal double-issue guard).
 *
 * @internal Exported only for the unit test that pins the invariant.
 */
export const MAX_SUPPORTED_PROVIDER_TIMEOUT_MS = 120 * 1000;

// Enforce the fiscal-safety margin BY CONSTRUCTION (not by comment): fail loud at
// module load if anyone lowers the lease below the supported provider-timeout
// ceiling, which would reopen the double-issue race the lease exists to close.
if (ISSUING_LEASE_MS <= MAX_SUPPORTED_PROVIDER_TIMEOUT_MS) {
  throw new Error(
    `Fiscal-safety invariant violated: ISSUING_LEASE_MS (${ISSUING_LEASE_MS}ms) must strictly exceed ` +
      `MAX_SUPPORTED_PROVIDER_TIMEOUT_MS (${MAX_SUPPORTED_PROVIDER_TIMEOUT_MS}ms) so an expired CAS lease ` +
      `can never be re-claimed mid-flight and double-issue a fiscal document.`,
  );
}

/**
 * Neutral shape the SVC reads STRUCTURALLY off a caught adapter throwable to
 * classify the failure mode (#1200) — it is NOT an adapter error subclass and is
 * NOT value-imported. Adapters expose a neutral `failureMode` on their thrown
 * errors; the SVC reads it duck-typed. Anything it cannot read as the terminal
 * `'rejected'` is treated as the fiscal-safe `'in-doubt'`.
 */
interface NeutralFailureCarrier {
  failureMode?: unknown;
  /**
   * Operator-readable rejection reason some adapters stamp on a TERMINAL
   * `rejected` throwable (e.g. Subiekt's `SubiektInvoiceRejectedError.reason`).
   * Read STRUCTURALLY (duck-typed) — core never value-imports the adapter class.
   */
  reason?: unknown;
}

@Injectable()
export class InvoiceService implements IInvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    @Inject(INVOICE_RECORD_REPOSITORY_TOKEN)
    private readonly repo: InvoiceRecordRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
  ) {}

  async issueInvoice(cmd: IssueInvoiceCommand): Promise<InvoiceRecord> {
    // (1) Idempotency read-gate. Only when a key is supplied (R1: keyless calls
    // are never deduplicated). An already-`issued` hit is returned verbatim — no
    // second provider document. A non-`issued` hit is resumed under the
    // fiscal-safety invariant (see resumeExisting): R2/R3 closure (#1200).
    const key = cmd.idempotencyKey;
    if (key !== undefined) {
      const existing = await this.repo.findByIdempotencyKey(cmd.connectionId, key);
      if (existing) {
        return this.resumeExisting(cmd, existing);
      }
    }

    // (2) Persist intent: a `pending` row BEFORE any external call, so an
    // in-doubt crash leaves a durable trace to reconcile against.
    let pending: InvoiceRecord;
    try {
      pending = await this.repo.create({
        connectionId: cmd.connectionId,
        orderId: cmd.orderId,
        // providerType is unknown to the SVC up front; the adapter owns the
        // authoritative value and the success patch backfills it (see
        // issueWithAdapter). The pending row records '' until then.
        providerType: '',
        // documentType is a caller PASS-THROUGH; "" means "let the adapter
        // derive it". No derivation here.
        documentType: cmd.documentType ?? '',
        status: 'pending',
        idempotencyKey: key ?? null,
        // Neutral denormalized presence flag (#1202): captured at create time
        // from the command's buyer so the taxId list filter needs no Order join.
        hasBuyerTaxId: cmd.buyer.taxId !== null,
      });
    } catch (error) {
      // (5) Create-race: a concurrent same-key call won the dedup guard between
      // our read-gate and create. Re-read by key and resume the winner under the
      // SAME fiscal-safety gate. Guarded by `key !== undefined` — the guard
      // cannot fire keyless.
      if (key !== undefined && error instanceof DuplicateInvoiceRecordException) {
        const winner = await this.repo.findByIdempotencyKey(cmd.connectionId, key);
        if (winner) {
          return this.resumeExisting(cmd, winner);
        }
      }
      throw error;
    }

    return this.issueWithAdapter(cmd, pending.id);
  }

  /**
   * Decide how to resume an EXISTING same-key record, enforcing the fiscal-safety
   * invariant before any retry re-crosses the provider boundary (#1200). Shared
   * by the read-gate and the create-race re-read so both honour the same rules:
   *
   *   - `issued`           -> return verbatim (idempotent replay).
   *   - live `issuing`     -> return as-is; another attempt holds the slot. NO
   *                           provider call (closes R2 + the `pending` half of R3).
   *   - in-doubt `failed`  -> return as-is for manual reconciliation. NO provider
   *                           call (a document may already exist — closes R3's
   *                           `failed` half).
   *   - re-attemptable     -> `pending`, expired `issuing`, or a terminal
   *                           `rejected` `failed`: claim the slot atomically and,
   *                           only on a WIN, re-cross the boundary. A lost claim
   *                           returns the contended row WITHOUT a provider call.
   */
  private async resumeExisting(
    cmd: IssueInvoiceCommand,
    existing: InvoiceRecord,
  ): Promise<InvoiceRecord> {
    if (existing.status === 'issued') {
      return existing;
    }

    const now = new Date();
    if (existing.isLeaseLive(now)) {
      // R2/R3: an original attempt is still in flight under a live lease. Surface
      // the in-flight row; NEVER race a second provider call alongside it.
      this.logger.warn(
        `Invoice record ${existing.id} is claimed by a live in-flight attempt; not re-attempting`,
      );
      return existing;
    }

    if (existing.status === 'failed' && !existing.isReattemptableFailure) {
      // R3: an in-doubt failure — the provider MAY have issued a document. Block
      // the auto-re-attempt and surface for manual reconciliation.
      this.logger.warn(
        `Invoice record ${existing.id} failed in-doubt (failureMode=${existing.failureMode ?? 'unknown'}); ` +
          `not auto-re-attempting — surfaced for manual reconciliation`,
      );
      return existing;
    }

    // Re-attemptable: `pending`, an expired `issuing` lease, or a terminal
    // `rejected` `failed`. issueWithAdapter claims the slot atomically first so
    // exactly one concurrent same-key retry crosses the boundary (R2).
    return this.issueWithAdapter(cmd, existing.id);
  }

  /**
   * Steps (3)+(4): atomically CLAIM the in-flight slot, resolve the per-connection
   * `'Invoicing'` adapter, cross the CORE<->Integration boundary, and patch the
   * `recordId` row with the outcome. On success -> `issued` + the six provider
   * fields (lease cleared). On a throw -> `failed` + a sanitized errorMessage + a
   * neutral `failureMode` read STRUCTURALLY off the throwable (lease cleared),
   * then rethrow (per-design propagation).
   *
   * The CAS claim (claimForIssue) is the R2 single-flight guard: a concurrent
   * same-key retry that fails to claim backs off WITHOUT calling the provider.
   */
  private async issueWithAdapter(
    cmd: IssueInvoiceCommand,
    recordId: string,
  ): Promise<InvoiceRecord> {
    // (3a) Atomic claim. A null return means a live attempt already holds the
    // slot (or the row went terminal): back off WITHOUT crossing the boundary.
    const leaseExpiresAt = new Date(Date.now() + ISSUING_LEASE_MS);
    const claimed = await this.repo.claimForIssue(recordId, leaseExpiresAt);
    if (claimed === null) {
      this.logger.warn(
        `Could not claim invoice record ${recordId} for issuance ` +
          `(held by a live attempt or already terminal); not re-attempting`,
      );
      const current = await this.repo.findById(recordId);
      if (current) {
        return current;
      }
      // Vanished between claim and re-read — surface as not-found per contract.
      throw new InvoiceRecordNotFoundException(recordId);
    }

    const adapter = await this.integrations.getCapabilityAdapter<InvoicingPort>(
      cmd.connectionId,
      INVOICING_CAPABILITY,
    );

    let issued: InvoiceRecord;
    try {
      issued = await adapter.issueInvoice(cmd);
    } catch (error) {
      const sanitized = this.sanitizeError(error);
      const failureMode = this.classifyFailure(error);
      const failureCode = this.classifyFailureCode(error, failureMode);
      const failureReason = this.deriveFailureReason(failureCode);
      // Log the BOUNDED diagnostic + record id only — never the raw (unbounded,
      // possibly buyer-echoing) provider message to an external sink.
      this.logger.warn(
        `Invoice issuance failed for record ${recordId} (failureMode=${failureMode}, failureCode=${failureCode}): ${sanitized}`,
      );
      const patch: InvoiceOutcomePatch = {
        status: 'failed',
        errorMessage: sanitized,
        failureMode,
        // W1: machine-readable code + PII-free reason for the response DTO.
        failureCode,
        failureReason,
        // Release the lease: the attempt is over (terminal rejection or in-doubt).
        leaseExpiresAt: null,
      };
      await this.repo.updateOutcome(recordId, patch);
      throw error;
    }

    const patch: InvoiceOutcomePatch = {
      status: 'issued',
      // Backfill the authoritative provider identity + document type from the
      // adapter result. The pending row was created with providerType '' (the
      // SVC does not know the connection's provider up front) and documentType
      // = the caller pass-through (possibly ''); the adapter owns both, so the
      // projection would otherwise misreport them for every issued record.
      providerType: issued.providerType,
      documentType: issued.documentType,
      providerInvoiceId: issued.providerInvoiceId,
      providerInvoiceNumber: issued.providerInvoiceNumber,
      regulatoryStatus: issued.regulatoryStatus,
      clearanceReference: issued.clearanceReference,
      pdfUrl: issued.pdfUrl,
      issuedAt: issued.issuedAt,
      // Clear any stale message + failure mode/code/reason from a prior failed
      // attempt, and release the `issuing` lease — the record is now `issued`.
      errorMessage: null,
      failureMode: null,
      failureCode: null,
      failureReason: null,
      leaseExpiresAt: null,
    };
    return this.repo.updateOutcome(recordId, patch);
  }

  /**
   * Classify a caught adapter throwable into the neutral {@link InvoiceFailureMode}
   * (#1200) WITHOUT value-importing any adapter error subclass. The adapter stamps
   * a neutral `failureMode` on the errors it throws; the SVC reads it STRUCTURALLY
   * (duck-typed) here.
   *
   * Fiscal-safe default: ONLY an explicit, recognised `'rejected'` is treated as a
   * terminal no-document failure (safe to re-attempt). EVERYTHING else — an
   * absent/unknown/`'in-doubt'` marker, a plain `Error`, a non-error throwable —
   * collapses to `'in-doubt'`, which the read-gate will NOT auto-re-attempt. An
   * unclassifiable failure must never be assumed safe to re-issue.
   */
  private classifyFailure(error: unknown): InvoiceFailureMode {
    const mode = (error as NeutralFailureCarrier | null)?.failureMode;
    return mode === 'rejected' ? 'rejected' : 'in-doubt';
  }

  /**
   * Derive the neutral, closed {@link InvoiceFailureCode} (W1) from the already-
   * classified {@link InvoiceFailureMode} plus a STRUCTURAL read of the adapter
   * throwable's `reason`/message — never value-importing an adapter error class.
   *
   *   - `rejected` (TERMINAL): a tax-identifier rejection → `buyer-tax-id-invalid`
   *     (operator-fixable); anything else → `provider-rejected`.
   *   - `in-doubt` (transient/indeterminate transport): `transport-timeout`.
   *
   * The mode is the source of truth for re-attemptability; the code is the FE-
   * facing cause refinement. An unrecognised mode can never reach here (the only
   * two values are exhaustively handled), so there is no need for a separate
   * `provider-error` branch on the mode — it is the fiscal-safe code reserved for
   * a future widening of the mode set.
   */
  private classifyFailureCode(
    error: unknown,
    failureMode: InvoiceFailureMode,
  ): InvoiceFailureCode {
    if (failureMode === 'in-doubt') {
      return 'transport-timeout';
    }
    // failureMode === 'rejected': refine off the provider's neutral reason text.
    const carrier = error as NeutralFailureCarrier | null;
    const reasonText =
      typeof carrier?.reason === 'string'
        ? carrier.reason
        : error instanceof Error
          ? error.message
          : '';
    const haystack = reasonText.toLowerCase();
    return TAX_ID_REJECTION_MARKERS.some((marker) => haystack.includes(marker))
      ? 'buyer-tax-id-invalid'
      : 'provider-rejected';
  }

  /**
   * Map the neutral {@link InvoiceFailureCode} to a fixed, PII-free, operator-
   * facing one-liner safe to expose on the response DTO. Deliberately NOT derived
   * from the (possibly buyer-echoing) provider message — a constant per code — so
   * `failureReason` can never leak PII. Bounded for defence in depth.
   */
  private deriveFailureReason(failureCode: InvoiceFailureCode): string {
    const reasons: Record<InvoiceFailureCode, string> = {
      'buyer-tax-id-invalid': 'The buyer tax identifier was rejected as invalid.',
      'provider-rejected': 'The invoicing provider rejected the request.',
      'transport-timeout':
        'The invoicing request timed out; the document may or may not have been created.',
      'provider-error': 'The invoicing provider returned an unexpected error.',
    };
    const reason = reasons[failureCode];
    return reason.length <= MAX_FAILURE_REASON_LENGTH
      ? reason
      : reason.slice(0, MAX_FAILURE_REASON_LENGTH);
  }

  async getInvoice(query: GetInvoiceByOrderQuery): Promise<InvoiceRecord | null> {
    // Projection read of OL's OWN store — NEVER the provider/adapter.
    return this.repo.findByOrderId(query.orderId, query.connectionId);
  }

  async getInvoiceById(invoiceId: string): Promise<InvoiceRecord | null> {
    // Projection read of OL's OWN store by primary id — NEVER the provider/adapter.
    return this.repo.findById(invoiceId);
  }

  async listInvoices(
    filter: InvoiceRecordFilters,
    pagination: InvoiceRecordPagination,
  ): Promise<PaginatedInvoiceRecords> {
    // Cross-context list seam (#1119): the HTTP layer reaches the invoice
    // projection through here, never the repository port. Pure projection read.
    return this.repo.findMany(filter, pagination);
  }

  /**
   * Derive a length-bounded, operator-facing diagnostic from a thrown error.
   *
   * The returned text is INTERNAL-ONLY: it is persisted to
   * `invoice_records.errorMessage` and surfaced via `getInvoice` to operators,
   * is NOT returned to untrusted external callers, and MAY contain provider-echoed
   * buyer data — hence the length bound. Do NOT log the raw (unbounded) provider
   * message at any level that ships to an external log sink; log the bounded value
   * and/or only `error.name` / the record id.
   */
  private sanitizeError(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    if (raw.length <= MAX_ERROR_MESSAGE_LENGTH) {
      return raw;
    }
    const marker = '…[truncated]';
    return raw.slice(0, MAX_ERROR_MESSAGE_LENGTH - marker.length) + marker;
  }
}
