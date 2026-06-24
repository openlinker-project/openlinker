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
 * Lifetime of an `issuing` CAS lease (#1200). Bounds how long a crashed
 * mid-call attempt can block same-key retries before the slot becomes
 * re-claimable. Kept comfortably longer than a real provider issuance round-trip
 * so a slow-but-live attempt is never stolen out from under itself.
 */
const ISSUING_LEASE_MS = 5 * 60 * 1000;

/**
 * Neutral shape the SVC reads STRUCTURALLY off a caught adapter throwable to
 * classify the failure mode (#1200) — it is NOT an adapter error subclass and is
 * NOT value-imported. Adapters expose a neutral `failureMode` on their thrown
 * errors; the SVC reads it duck-typed. Anything it cannot read as the terminal
 * `'rejected'` is treated as the fiscal-safe `'in-doubt'`.
 */
interface NeutralFailureCarrier {
  failureMode?: unknown;
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
      // Log the BOUNDED diagnostic + record id only — never the raw (unbounded,
      // possibly buyer-echoing) provider message to an external sink.
      this.logger.warn(
        `Invoice issuance failed for record ${recordId} (failureMode=${failureMode}): ${sanitized}`,
      );
      const patch: InvoiceOutcomePatch = {
        status: 'failed',
        errorMessage: sanitized,
        failureMode,
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
      // Clear any stale message + failure mode from a prior failed attempt, and
      // release the `issuing` lease — the record is now terminal `issued`.
      errorMessage: null,
      failureMode: null,
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

  async getInvoice(query: GetInvoiceByOrderQuery): Promise<InvoiceRecord | null> {
    // Projection read of OL's OWN store — NEVER the provider/adapter.
    return this.repo.findByOrderId(query.orderId, query.connectionId);
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
