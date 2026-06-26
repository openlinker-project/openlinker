/**
 * Regulatory Status Reconciliation Service (#1121)
 *
 * Core application service that refreshes `InvoiceRecord.regulatoryStatus` /
 * `clearanceReference` for one connection's `issued`, NON-terminal records by
 * reading authoritative provider/CTC status via the read-only
 * `RegulatoryStatusReader` ADR-002 sub-capability. The read is AUTHORITATIVE;
 * terminal reads are written back so reconciled rows drop out of the next sweep.
 * Depends ONLY on ports (`InvoiceRecordRepositoryPort` + `IIntegrationsService`),
 * never concrete adapters; nothing from `libs/integrations` is imported. No
 * `faktura`/`ksef`/`NIP` vocabulary lives here.
 *
 * Paging is a `(updatedAt, id)` KEYSET CURSOR walked across pages WITHIN one run
 * (plan decision #5, REVISED on #1206). `opts.limit` is the per-PAGE size; the
 * sweep keeps fetching the next page — bounded strictly after the last-seen
 * `(updatedAt, id)` — until a short page (fewer than `limit` rows) drains the
 * frontier, capping the number of pages at `MAX_PAGES_PER_RUN` as a runaway
 * guard. This replaces the former offset-0/cursor-free walk, which starved the
 * tail: a no-op read does NOT bump `updatedAt` (decision #8c), so under
 * `total > limit` the oldest perpetually-unchanged rows pinned the front of the
 * window every run and newer non-terminal rows behind them were never reached.
 * The keyset cursor advances PAST already-scanned rows regardless of whether
 * they were written, so every non-terminal row is visited each run (skip-free,
 * starvation-free). The cursor is intra-run only and is unrelated to the
 * issuance idempotency key — exactly-once issuance is untouched (decisions
 * #5/#8f).
 *
 * Error & write discipline (plan decision #8):
 *  - (8a) the defensive terminal skip applies to the RECORD's current status,
 *    NEVER to the read result; a terminal READ is always written.
 *  - (8b) `clearanceReference` is monotonic: the patch OMITS the key unless the
 *    read returns a non-null, changed value (Object.assign would clobber).
 *  - (8c) write-on-change; empty patch is a no-op.
 *  - (8d) per-record read errors are caught, counted, and logged BOUNDED
 *    (ids + error.name / sanitized message only) — never the raw provider string.
 *  - (8e) no raw-provider-error re-throw past the per-record loop.
 *
 * @module libs/core/src/invoicing/application/services
 * @implements {IRegulatoryStatusReconciliationService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';

import type {
  IRegulatoryStatusReconciliationService,
  RegulatoryStatusReconcileOptions,
  RegulatoryStatusReconcileResult,
} from './regulatory-status-reconciliation.service.interface';
import type { InvoiceRecord } from '../../domain/entities/invoice-record.entity';
import { InvoiceRecordRepositoryPort } from '../../domain/ports/invoice-record-repository.port';
import { INVOICE_RECORD_REPOSITORY_TOKEN } from '../../invoicing.tokens';
import type { InvoicingPort } from '../../domain/ports/invoicing.port';
import {
  isRegulatoryStatusReader,
  type RegulatoryStatusReader,
} from '../../domain/ports/capabilities/regulatory-status-reader.capability';
import type { InvoiceOutcomePatch, RegulatoryClearanceResult } from '../../domain/types/invoicing.types';
import { isTerminalRegulatoryStatus } from '../../domain/types/invoicing.types';

/** Capability the connection must declare; the reader is a runtime-detected sub-capability. */
const INVOICING_CAPABILITY = 'Invoicing';

/**
 * Max length of a sanitized, operator-facing read-error diagnostic. A
 * `RegulatoryStatusReader` adapter is third-party-shaped and its error may echo
 * buyer/KSeF-side data — bound it before logging (same idiom as `InvoiceService`).
 */
const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * Runaway guard on the intra-run keyset page walk (#1206). The walk normally
 * terminates when a page returns fewer than `limit` rows; this caps the worst
 * case (e.g. a frontier that keeps growing under concurrent issuance) so a
 * single run cannot spin unboundedly. At the default page size (100) this is
 * 100k records/run — far above any realistic MVP frontier.
 */
const MAX_PAGES_PER_RUN = 1000;

@Injectable()
export class RegulatoryStatusReconciliationService
  implements IRegulatoryStatusReconciliationService
{
  private readonly logger = new Logger(RegulatoryStatusReconciliationService.name);

  constructor(
    @Inject(INVOICE_RECORD_REPOSITORY_TOKEN)
    private readonly repo: InvoiceRecordRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
  ) {}

  async reconcile(
    connectionId: string,
    opts: RegulatoryStatusReconcileOptions,
  ): Promise<RegulatoryStatusReconcileResult> {
    const result: RegulatoryStatusReconcileResult = {
      scanned: 0,
      updated: 0,
      skippedTerminal: 0,
      readErrors: 0,
      total: 0,
    };

    // Resolve the per-connection Invoicing adapter. The reader is a runtime
    // sub-capability (ADR-002) — an adapter that cannot read regulatory status
    // is a clean no-op (warn + zeroed result), NEVER a throw: the scheduler
    // fans out to every Invoicing connection and most never implement it.
    const adapter = await this.integrations.getCapabilityAdapter<InvoicingPort>(
      connectionId,
      INVOICING_CAPABILITY,
    );

    if (!isRegulatoryStatusReader(adapter)) {
      this.logger.warn(
        `Connection ${connectionId} Invoicing adapter does not implement RegulatoryStatusReader — skipping reconciliation (no-op).`,
      );
      return result;
    }

    // Intra-run KEYSET page walk (#1206). `opts.limit` is the per-page size; we
    // page forward by a `(updatedAt, id)` cursor — strictly AFTER the last row
    // of the previous page — so the cursor advances independently of whether a
    // scanned row was written. This visits every non-terminal row each run,
    // even when the oldest rows are perpetually unchanged (a no-op read does
    // NOT bump `updatedAt`, decision #8c) and `total > limit`. `total` (full
    // frontier count, cursor-independent) is captured from the first page.
    let cursor: { updatedAt: Date; id: string } | undefined;
    let pages = 0;
    let totalCaptured = false;

    while (pages < MAX_PAGES_PER_RUN) {
      const { items, total } = await this.repo.findIssuedNonTerminal(connectionId, {
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
        // skip/continue) so the next page never re-reads it — this is what
        // breaks tail starvation: forward progress does not depend on a write.
        cursor = { updatedAt: record.updatedAt, id: record.id };

        // (8a) Defensive race guard: the selection predicate already excludes
        // terminal records, but a concurrent write could have flipped one. The
        // skip applies to the RECORD's CURRENT status only — never to a read
        // result (a terminal read is always written, below).
        if (isTerminalRegulatoryStatus(record.regulatoryStatus)) {
          result.skippedTerminal += 1;
          continue;
        }

        let read: RegulatoryClearanceResult;
        try {
          read = await this.readStatus(adapter, record);
        } catch (error) {
          // (8d) Per-record read errors are caught, counted, and logged BOUNDED
          // (ids + error.name + sanitized message) — never the raw provider
          // string. (8e) The sweep continues; nothing re-throws past the loop.
          result.readErrors += 1;
          const err = error instanceof Error ? error : new Error(String(error));
          this.logger.error(
            `Regulatory status read failed (connection=${connectionId}, record=${record.id}): ${err.name}: ${this.sanitizeError(error)}`,
          );
          continue;
        }

        result.scanned += 1;

        // (8b/8c) Write-on-change. The patch omits the clearanceReference key
        // unless the read returns a non-null, changed value — an empty patch is
        // a no-op (idempotent, safe to re-run).
        const patch = this.buildPatch(record, read);
        if (Object.keys(patch).length === 0) {
          continue;
        }

        await this.repo.updateOutcome(record.id, patch);
        result.updated += 1;
      }

      // A short (or empty) page means the frontier is drained — stop. A full
      // page means more rows may follow the cursor; fetch the next page.
      if (items.length < opts.limit) {
        break;
      }
    }

    if (pages >= MAX_PAGES_PER_RUN) {
      this.logger.warn(
        `Regulatory reconcile hit the per-run page cap (${MAX_PAGES_PER_RUN}) for connection ${connectionId}; remaining rows will be picked up next run (no permanent skip).`,
      );
    }

    return result;
  }

  /**
   * Build the outcome patch by CONDITIONAL KEY INSERTION (plan decision #8b/#8c).
   * `clearanceReference` is set ONLY when the read returns a non-null, changed
   * value — the key is OMITTED otherwise so `updateOutcome`'s `Object.assign` +
   * `save` cannot NULL a prior reference. Terminal reads ARE included (#8a).
   */
  private buildPatch(
    record: InvoiceRecord,
    read: RegulatoryClearanceResult,
  ): InvoiceOutcomePatch {
    const patch: InvoiceOutcomePatch = {};

    // (8a) The read is authoritative — a terminal read IS written so the row
    // drops out of the next sweep. Only set the key when the status changed.
    if (read.regulatoryStatus !== record.regulatoryStatus) {
      patch.regulatoryStatus = read.regulatoryStatus;
    }

    // (8b) clearanceReference is monotonic: set the key ONLY when the read
    // returns a non-null, CHANGED value. Omitting the key prevents
    // `updateOutcome`'s `Object.assign` from clobbering a prior reference with
    // null (a later read that returns null must not wipe an earlier reference).
    if (read.clearanceReference != null && read.clearanceReference !== record.clearanceReference) {
      patch.clearanceReference = read.clearanceReference;
    }

    return patch;
  }

  /**
   * Read authoritative status for one record via the narrowed reader adapter.
   * Wrapped by the per-record try/catch in `reconcile` (#8d/#8e).
   */
  private async readStatus(
    adapter: InvoicingPort & RegulatoryStatusReader,
    record: InvoiceRecord,
  ): Promise<RegulatoryClearanceResult> {
    return adapter.getClearanceStatus(record);
  }

  /**
   * Length-bounded, operator-facing diagnostic for a per-record read error.
   * INTERNAL-ONLY; may contain provider-echoed data — never log the raw,
   * unbounded message to an external sink (#8d).
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
