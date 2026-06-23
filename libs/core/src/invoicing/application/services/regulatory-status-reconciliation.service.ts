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
 * Paging is offset-0 every run (NO cursor): the non-terminal frontier is a
 * SHRINKING set (terminal/changed reads bump `updatedAt`, pushing rows to the
 * back), so it is walked from the front ordered `updatedAt ASC, id ASC`. A
 * connection with more non-terminal rows than `limit` is covered across multiple
 * 30-min ticks — skip-free and starvation-bounded by
 * `ceil(non_terminal_count / limit)` runs (plan decisions #5/#8f).
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
import type { InvoiceOutcomePatch } from '../../domain/types/invoicing.types';
import { isTerminalRegulatoryStatus } from '../../domain/types/invoicing.types';
import type { RegulatoryStatusReadResult } from '../../domain/types/regulatory-status-read.types';

/** Capability the connection must declare; the reader is a runtime-detected sub-capability. */
const INVOICING_CAPABILITY = 'Invoicing';

/**
 * Max length of a sanitized, operator-facing read-error diagnostic. A
 * `RegulatoryStatusReader` adapter is third-party-shaped and its error may echo
 * buyer/KSeF-side data — bound it before logging (same idiom as `InvoiceService`).
 */
const MAX_ERROR_MESSAGE_LENGTH = 500;

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

    const { items, total } = await this.repo.findIssuedNonTerminal(connectionId, {
      limit: opts.limit,
    });
    result.total = total;

    for (const record of items) {
      // (8a) Defensive race guard: the selection predicate already excludes
      // terminal records, but a concurrent write could have flipped one. The
      // skip applies to the RECORD's CURRENT status only — never to a read
      // result (a terminal read is always written, below).
      if (isTerminalRegulatoryStatus(record.regulatoryStatus)) {
        result.skippedTerminal += 1;
        continue;
      }

      let read: RegulatoryStatusReadResult;
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
    read: RegulatoryStatusReadResult,
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
    if (read.clearanceReference !== null && read.clearanceReference !== record.clearanceReference) {
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
  ): Promise<RegulatoryStatusReadResult> {
    return adapter.readRegulatoryStatus(record);
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
