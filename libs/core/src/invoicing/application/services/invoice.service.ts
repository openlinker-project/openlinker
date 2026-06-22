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
import type {
  GetInvoiceByOrderQuery,
  InvoiceOutcomePatch,
  IssueInvoiceCommand,
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
    // second provider document. ANY non-`issued` hit (`failed` AND `pending`)
    // re-attempts by REUSING that row (R2/R3): any non-`issued` row is treated as
    // re-attemptable. A `pending` hit may be a still-in-flight original attempt for
    // the same key — not excluded here — so a retry can double-issue alongside it
    // (R3, highest exactly-once exposure).
    const key = cmd.idempotencyKey;
    if (key !== undefined) {
      const existing = await this.repo.findByIdempotencyKey(cmd.connectionId, key);
      if (existing) {
        if (existing.status === 'issued') {
          return existing;
        }
        return this.issueWithAdapter(cmd, existing.id);
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
      // our read-gate and create. Re-read by key and return/continue the winner.
      // Guarded by `key !== undefined` — the guard cannot fire keyless.
      if (key !== undefined && error instanceof DuplicateInvoiceRecordException) {
        const winner = await this.repo.findByIdempotencyKey(cmd.connectionId, key);
        if (winner) {
          if (winner.status === 'issued') {
            return winner;
          }
          return this.issueWithAdapter(cmd, winner.id);
        }
      }
      throw error;
    }

    return this.issueWithAdapter(cmd, pending.id);
  }

  /**
   * Steps (3)+(4): resolve the per-connection `'Invoicing'` adapter, cross the
   * CORE<->Integration boundary, and patch the `recordId` row with the outcome.
   * On success -> `issued` + the six provider fields. On any throw (terminal
   * rejection OR unreachable transport — indistinguishable by design, see R3) ->
   * `failed` + a sanitized errorMessage, then rethrow (per-design propagation).
   */
  private async issueWithAdapter(
    cmd: IssueInvoiceCommand,
    recordId: string,
  ): Promise<InvoiceRecord> {
    const adapter = await this.integrations.getCapabilityAdapter<InvoicingPort>(
      cmd.connectionId,
      INVOICING_CAPABILITY,
    );

    let issued: InvoiceRecord;
    try {
      issued = await adapter.issueInvoice(cmd);
    } catch (error) {
      const sanitized = this.sanitizeError(error);
      // Log the BOUNDED diagnostic + record id only — never the raw (unbounded,
      // possibly buyer-echoing) provider message to an external sink.
      this.logger.warn(
        `Invoice issuance failed for record ${recordId}: ${sanitized}`,
      );
      const patch: InvoiceOutcomePatch = {
        status: 'failed',
        errorMessage: sanitized,
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
      // Clear any stale message from a prior failed attempt on this row.
      errorMessage: null,
    };
    return this.repo.updateOutcome(recordId, patch);
  }

  async getInvoice(query: GetInvoiceByOrderQuery): Promise<InvoiceRecord | null> {
    // Projection read of OL's OWN store — NEVER the provider/adapter.
    return this.repo.findByOrderId(query.orderId, query.connectionId);
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
