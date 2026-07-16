/**
 * Offline Resubmission Service (#1702, mini-epic #1585, ADR-035)
 *
 * Core application service that retransmits one connection's `pending-submission`
 * invoice records - documents issued with legal effect during a degraded-mode
 * clearance-authority outage - by calling the `OfflineResubmitter` ADR-002
 * sub-capability once the authority recovers, then persisting the returned
 * `regulatoryStatus` / `providerInvoiceId` / `clearanceReference`. Depends ONLY on
 * ports (`InvoiceRecordRepositoryPort` + `IIntegrationsService`), never concrete
 * adapters; nothing from `libs/integrations` is imported. No
 * `faktura`/`ksef`/`NIP` vocabulary lives here (ADR-026 neutral core).
 *
 * v1 scope (#1702 task 6): resubmit whenever the authority recovers. Legal
 * deadline-window tracking (next-business-day for a bounded offline grace period)
 * is DEFERRED - a still-unreachable authority simply leaves the record
 * `pending-submission` for the next run. See part 4 (docs) for the follow-up.
 *
 * Duplicate-issue guard (#1585 I1, ADR-035): a `submitInvoice` whose request
 * reached the authority but whose response timed out is classified unavailable
 * and lands the document in `pending-submission` even though it actually cleared.
 * A blind resubmit would then double-issue. When the adapter is also a
 * `RegulatoryRecordLocator`, this sweep confirms non-receipt FIRST - it locates
 * the document on the authority side by its `documentNumber` (which
 * pending-submission rows carry) and, if FOUND, reconciles the record WITHOUT
 * resubmitting; only a confirmed non-receipt proceeds to `resubmit`. An adapter
 * that is not a locator keeps the pre-#1585 blind-resubmit behaviour (its residual
 * double-issue window is a known limitation for such providers).
 *
 * Paging is a `(updatedAt, id)` KEYSET CURSOR walked across pages WITHIN one run
 * (mirrors `RegulatoryStatusReconciliationService`). `opts.limit` is the per-PAGE
 * size; the sweep keeps fetching the next page - bounded strictly after the
 * last-seen `(updatedAt, id)` - until a short page drains the frontier, capping
 * pages at `MAX_PAGES_PER_RUN` as a runaway guard. The cursor advances PAST every
 * scanned row regardless of whether it was written, so a record whose authority
 * is still down (no write, no `updatedAt` bump) cannot pin the front of the
 * window and starve newer rows.
 *
 * Error & write discipline (mirrors the reconcile sweep):
 *  - write-on-change: the patch omits a key whose value is null/unchanged;
 *    `providerInvoiceId` / `clearanceReference` are monotonic (never clobbered
 *    back to null by a later resubmit that surfaces no reference);
 *  - per-record resubmit errors are caught, counted, and logged BOUNDED (ids +
 *    error.name / sanitized message only) - never the raw provider string;
 *  - nothing re-throws past the per-record loop (a transport failure just leaves
 *    the record for the next run).
 *
 * @module libs/core/src/invoicing/application/services
 * @implements {IOfflineResubmissionService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';

import type {
  IOfflineResubmissionService,
  OfflineResubmissionOptions,
  OfflineResubmissionResult,
} from './offline-resubmission.service.interface';
import type { InvoiceRecord } from '../../domain/entities/invoice-record.entity';
import { InvoiceRecordRepositoryPort } from '../../domain/ports/invoice-record-repository.port';
import { INVOICE_RECORD_REPOSITORY_TOKEN } from '../../invoicing.tokens';
import type { InvoicingPort } from '../../domain/ports/invoicing.port';
import { isOfflineResubmitter } from '../../domain/ports/capabilities/offline-resubmitter.capability';
import type { OfflineResubmitter } from '../../domain/ports/capabilities/offline-resubmitter.capability';
import { isRegulatoryRecordLocator } from '../../domain/ports/capabilities/regulatory-record-locator.capability';
import type { RegulatoryRecordLocator } from '../../domain/ports/capabilities/regulatory-record-locator.capability';
import type {
  InvoiceOutcomePatch,
  OfflineResubmitResult,
  RegulatoryLocateCriteria,
} from '../../domain/types/invoicing.types';

/** Capability the connection must declare; the resubmitter is a runtime-detected sub-capability. */
const INVOICING_CAPABILITY = 'Invoicing';

/**
 * Max length of a sanitized, operator-facing resubmit-error diagnostic. An
 * `OfflineResubmitter` adapter is third-party-shaped and its error may echo
 * buyer/authority-side data - bound it before logging (same idiom as the
 * reconcile sweep).
 */
const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * Runaway guard on the intra-run keyset page walk. The walk normally terminates
 * when a page returns fewer than `limit` rows; this caps the worst case so a
 * single run cannot spin unboundedly.
 */
const MAX_PAGES_PER_RUN = 1000;

/**
 * Half-width of the issue-date window handed to the authority lookup that
 * confirms non-receipt before a resubmit (#1585 I1). Anchored on the record's
 * issue/last-touch instant with a full day either side - wide enough to catch a
 * document whose authority-side issue date drifted from OL's recorded instant,
 * narrow enough that the metadata query stays selective. Mirrors the same window
 * `PendingRecoveryService` uses.
 */
const LOCATE_DATE_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class OfflineResubmissionService implements IOfflineResubmissionService {
  private readonly logger = new Logger(OfflineResubmissionService.name);

  constructor(
    @Inject(INVOICE_RECORD_REPOSITORY_TOKEN)
    private readonly repo: InvoiceRecordRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
  ) {}

  async resubmit(
    connectionId: string,
    opts: OfflineResubmissionOptions,
  ): Promise<OfflineResubmissionResult> {
    const result: OfflineResubmissionResult = {
      scanned: 0,
      updated: 0,
      resubmitErrors: 0,
      total: 0,
    };

    // Resolve the per-connection Invoicing adapter. The resubmitter is a runtime
    // sub-capability (ADR-002) - an adapter with no degraded-mode window is a
    // clean no-op (warn + zeroed result), NEVER a throw: the scheduler fans out
    // to every Invoicing connection and most never implement it.
    const adapter = await this.integrations.getCapabilityAdapter<InvoicingPort>(
      connectionId,
      INVOICING_CAPABILITY,
    );

    if (!isOfflineResubmitter(adapter)) {
      this.logger.warn(
        `Connection ${connectionId} Invoicing adapter does not implement OfflineResubmitter - skipping offline resubmission (no-op).`,
      );
      return result;
    }

    // The locator is a runtime-detected sub-capability (ADR-002) used to confirm
    // non-receipt before a resubmit (#1585 I1). An adapter without it keeps the
    // blind-resubmit behaviour; one with it never resubmits a document already at
    // the authority (the submit-timeout-after-landing double-issue guard).
    const locator = isRegulatoryRecordLocator(adapter) ? adapter : null;
    if (!locator) {
      this.logger.warn(
        `Connection ${connectionId} Invoicing adapter does not implement RegulatoryRecordLocator - ` +
          `offline resubmission cannot confirm non-receipt first (residual double-issue window on a submit-timeout-after-landing).`,
      );
    }

    // Intra-run KEYSET page walk. `opts.limit` is the per-page size; we page
    // forward by a `(updatedAt, id)` cursor - strictly AFTER the last row of the
    // previous page - so the cursor advances independently of whether a scanned
    // row was written. This visits every pending-submission row each run, even
    // when the oldest rows stay untouched (their authority is still down).
    // `total` (full frontier count, cursor-independent) is captured from page 1.
    let cursor: { updatedAt: Date; id: string } | undefined;
    let pages = 0;
    let totalCaptured = false;

    while (pages < MAX_PAGES_PER_RUN) {
      const { items, total } = await this.repo.findPendingSubmission(connectionId, {
        limit: opts.limit,
        cursor,
      });
      if (!totalCaptured) {
        result.total = total;
        totalCaptured = true;
      }
      pages += 1;

      for (const record of items) {
        // Advance the keyset cursor for EVERY scanned row (before any
        // skip/continue) so the next page never re-reads it - forward progress
        // does not depend on a successful resubmit.
        cursor = { updatedAt: record.updatedAt, id: record.id };
        // Count every record read + attempted this run (matches the interface
        // JSDoc), so an errored record is still reflected in coverage metrics.
        result.scanned += 1;

        try {
          // Confirm non-receipt BEFORE resubmitting (#1585 I1). If the document
          // already landed at the authority (e.g. a submit whose response timed
          // out), reconcile it in place and skip the resubmit - a blind resubmit
          // would double-issue.
          if (locator && (await this.reconcileIfAlreadyLanded(connectionId, locator, record, result))) {
            continue;
          }

          const outcome = await this.resubmitOne(adapter, record);

          // Write-on-change. An empty patch is a no-op (idempotent, safe to re-run).
          const patch = this.buildPatch(record, outcome);
          if (Object.keys(patch).length === 0) {
            continue;
          }
          await this.repo.updateOutcome(record.id, patch);
          result.updated += 1;
        } catch (error) {
          // Per-record errors (locate OR resubmit) are caught, counted, and
          // logged BOUNDED (ids + error.name + sanitized message) - never the raw
          // provider string. The sweep continues; nothing re-throws past the loop.
          // A still-unreachable authority just leaves the record for the next run.
          result.resubmitErrors += 1;
          const err = error instanceof Error ? error : new Error(String(error));
          this.logger.error(
            `Offline resubmission failed (connection=${connectionId}, record=${record.id}): ${err.name}: ${this.sanitizeError(error)}`,
          );
          continue;
        }
      }

      // A short (or empty) page means the frontier is drained - stop. A full page
      // means more rows may follow the cursor; fetch the next page.
      if (items.length < opts.limit) {
        break;
      }
    }

    if (pages >= MAX_PAGES_PER_RUN) {
      this.logger.warn(
        `Offline resubmission hit the per-run page cap (${MAX_PAGES_PER_RUN}) for connection ${connectionId}; remaining rows will be picked up next run (no permanent skip).`,
      );
    }

    return result;
  }

  /**
   * Build the outcome patch by CONDITIONAL KEY INSERTION. Each field is set ONLY
   * when the resubmit surfaced a non-null, changed value so `updateOutcome`'s
   * `Object.assign` cannot NULL a prior value: `providerInvoiceId` /
   * `clearanceReference` are monotonic (an offline issuance could not know them,
   * and a later resubmit that yields none must not wipe an earlier one).
   */
  private buildPatch(record: InvoiceRecord, outcome: OfflineResubmitResult): InvoiceOutcomePatch {
    const patch: InvoiceOutcomePatch = {};

    if (outcome.regulatoryStatus !== record.regulatoryStatus) {
      patch.regulatoryStatus = outcome.regulatoryStatus;
    }

    if (outcome.providerInvoiceId != null && outcome.providerInvoiceId !== record.providerInvoiceId) {
      patch.providerInvoiceId = outcome.providerInvoiceId;
    }

    if (
      outcome.clearanceReference != null &&
      outcome.clearanceReference !== record.clearanceReference
    ) {
      patch.clearanceReference = outcome.clearanceReference;
    }

    return patch;
  }

  /**
   * Confirm-non-receipt gate (#1585 I1). Locate the record on the authority side
   * by its `documentNumber`; when FOUND, reconcile it in place (write-on-change)
   * and return `true` so the caller skips the resubmit - the document already
   * landed, so resubmitting would double-issue. Returns `false` when the authority
   * holds no match (a genuine non-receipt), leaving the caller to resubmit. A
   * transport/infra failure of the lookup throws for the caller's per-record catch.
   */
  private async reconcileIfAlreadyLanded(
    connectionId: string,
    locator: InvoicingPort & RegulatoryRecordLocator,
    record: InvoiceRecord,
    result: OfflineResubmissionResult,
  ): Promise<boolean> {
    const located = await locator.locateByQuery(this.buildLocateCriteria(record));
    if (!located) {
      return false;
    }

    // `RegulatoryLocateResult` is structurally the same triple as
    // `OfflineResubmitResult`, so the write-on-change patch builder handles it.
    const patch = this.buildPatch(record, located);
    if (Object.keys(patch).length > 0) {
      await this.repo.updateOutcome(record.id, patch);
      result.updated += 1;
    }
    this.logger.warn(
      `Offline record ${record.id} (connection=${connectionId}) was already present on the authority side ` +
        `(regulatoryStatus=${located.regulatoryStatus}); reconciled WITHOUT resubmitting (duplicate-issue guard).`,
    );
    return true;
  }

  /**
   * Derive the authority-lookup criteria for the confirm-non-receipt gate.
   * `documentNumber` uses the OL-allocated legal number (present on every
   * pending-submission row) with the provider number as a fallback; the issue-date
   * window is anchored on the record's issue/last-touch instant. `sellerTaxId` is
   * omitted (the adapter falls back to its own configured seller identity).
   */
  private buildLocateCriteria(record: InvoiceRecord): RegulatoryLocateCriteria {
    const anchor = record.issuedAt ?? record.updatedAt;
    return {
      documentNumber: record.documentNumber ?? record.providerInvoiceNumber ?? undefined,
      issuedFrom: new Date(anchor.getTime() - LOCATE_DATE_WINDOW_MS),
      issuedTo: new Date(anchor.getTime() + LOCATE_DATE_WINDOW_MS),
    };
  }

  /**
   * Resubmit one record via the narrowed resubmitter adapter. Wrapped by the
   * per-record try/catch in `resubmit`.
   */
  private async resubmitOne(
    adapter: InvoicingPort & OfflineResubmitter,
    record: InvoiceRecord,
  ): Promise<OfflineResubmitResult> {
    return adapter.resubmit(record);
  }

  /**
   * Length-bounded, operator-facing diagnostic for a per-record resubmit error.
   * INTERNAL-ONLY; may contain provider-echoed data - never log the raw,
   * unbounded message to an external sink.
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
