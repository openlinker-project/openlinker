/**
 * Mirakl Offer Write Reconciler
 *
 * One reconcile pass for a connection's recorded stock and price changes
 * (#4277), run by the `marketplace.offerQuantity.reconcile` job:
 *
 * 1. **Settle.** For each import still waiting, read its status (STO01 / PRI01
 *    status endpoints, and OF01 for an offer create, #4278). An import that
 *    finished is not trusted on its status alone: Mirakl reports `COMPLETE`
 *    with failed lines, so when it lists lines in error the error report is
 *    read and those offers fail, each with Mirakl's reason. A report line that
 *    names no SKU cannot be told apart, so the whole import fails rather than
 *    marking an offer applied that was not.
 * 2. **Send.** Every pending change of a kind goes out as ONE file, so a busy
 *    connection imports at the job's pace, not once per stock change. Mirakl
 *    asks sellers not to import more often than every few minutes.
 * 3. **Prune** settled rows after a week.
 *
 * Values are absolute (a quantity, a price), so a file sent twice applies the
 * same state twice: a submit whose answer was lost and which is sent again on
 * the next pass is harmless. A file Mirakl refuses outright (4xx) fails its
 * changes instead of resending them forever.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import type { PendingQuantityAckReconcileResult } from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';
import type { MiraklOfferWrite } from '../../domain/entities/mirakl-offer-write.entity';
import { MiraklApiException } from '../../domain/exceptions/mirakl-api.exception';
import { buildMiraklOfferFile } from '../../domain/policies/mirakl-offer-file.policy';
import type { MiraklOfferWriteRepositoryPort } from '../../domain/ports/mirakl-offer-write-repository.port';
import type { MiraklImportKind } from '../../domain/types/mirakl-import.types';
import {
  MiraklBufferedWriteKindValues,
  type MiraklBufferedWriteKind,
  type MiraklOfferWriteKind,
} from '../../domain/types/mirakl-offer-write.types';
import type { IMiraklHttpClient } from '../http/mirakl-http-client.interface';
import type { IMiraklImportTracker } from '../imports/mirakl-import-tracker.interface';
import { describeMiraklFailure } from './mirakl-order-reader';

/** Most lines one file carries; the rest go out on the next pass. */
const MAX_LINES_PER_FILE = 10_000;
const SETTLED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const IMPORT_KIND: Readonly<Record<MiraklOfferWriteKind, MiraklImportKind>> = {
  stock: 'stock',
  price: 'prices',
  offer: 'offers',
};

const SUBMIT_PATH: Readonly<Record<MiraklBufferedWriteKind, string>> = {
  stock: '/api/offers/stock/imports',
  price: '/api/offers/pricing/imports',
};

export class MiraklOfferWriteReconciler {
  private readonly logger = new Logger(MiraklOfferWriteReconciler.name);

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IMiraklHttpClient,
    private readonly importTracker: IMiraklImportTracker,
    private readonly writes: MiraklOfferWriteRepositoryPort,
    private readonly now: () => Date = (): Date => new Date()
  ) {}

  async reconcile(limit: number): Promise<PendingQuantityAckReconcileResult> {
    const settled = await this.settleImports(limit);
    let stillPending = settled.stillPending;
    for (const kind of MiraklBufferedWriteKindValues) {
      stillPending += await this.send(kind);
    }
    await this.writes.deleteSettledBefore(
      this.connectionId,
      new Date(this.now().getTime() - SETTLED_RETENTION_MS)
    );
    return { reconciled: settled.reconciled, stillPending };
  }

  private async settleImports(limit: number): Promise<PendingQuantityAckReconcileResult> {
    let reconciled = 0;
    let stillPending = 0;
    const imports = await this.writes.findSubmittedImports(this.connectionId, limit);
    for (const { importId, kind } of imports) {
      try {
        if (await this.settleOne(importId, kind)) {
          reconciled++;
        } else {
          stillPending++;
        }
      } catch (error) {
        // One unreadable import must not hold back the others or the next file.
        stillPending++;
        this.logger.warn(
          `Could not read ${kind} import ${importId} on connection ${this.connectionId}: ${describeError(error)}`
        );
      }
    }
    return { reconciled, stillPending };
  }

  /** `true` when the import reached an outcome and its writes were settled. */
  private async settleOne(importId: string, kind: MiraklOfferWriteKind): Promise<boolean> {
    const importKind = IMPORT_KIND[kind];
    const status = await this.importTracker.getStatus(importKind, importId);
    switch (status.state) {
      case 'pending':
      case 'awaiting-operator':
        return false;
      case 'failed':
        await this.writes.failImport(
          this.connectionId,
          importId,
          `Import ${importId} ended as ${status.rawStatus ?? 'failed'}`
        );
        this.logger.warn(
          `${kind} import ${importId} on connection ${this.connectionId} failed (${status.rawStatus ?? 'no status'})`
        );
        return true;
      case 'done':
        break;
    }

    const hasErrors = (status.linesInError ?? 0) > 0 || status.hasErrorReport;
    if (!hasErrors) {
      await this.writes.settleImport(this.connectionId, importId, new Map());
      return true;
    }
    const lineErrors = await this.importTracker.getErrorReport(importKind, importId);
    if (lineErrors.length === 0 || lineErrors.some((error) => !error.sku)) {
      // Mirakl said lines failed but did not say which offers: fail them all.
      const reason = lineErrors[0]?.reason ?? 'Mirakl reported failed lines without naming them';
      await this.writes.failImport(this.connectionId, importId, reason);
    } else {
      const failures = new Map(lineErrors.map((error) => [error.sku as string, error.reason]));
      await this.writes.settleImport(this.connectionId, importId, failures);
    }
    this.logger.warn(
      `${kind} import ${importId} on connection ${this.connectionId} finished with ` +
        `${status.linesInError ?? lineErrors.length} failed line(s)`
    );
    return true;
  }

  /** Send every pending change of one kind as one file; returns the lines sent. */
  private async send(kind: MiraklBufferedWriteKind): Promise<number> {
    const pending = await this.writes.findPending(this.connectionId, kind, MAX_LINES_PER_FILE);
    if (pending.length === 0) {
      return 0;
    }
    const content = buildMiraklOfferFile(kind, pending);
    let importId: string;
    try {
      const { data } = await this.httpClient.postFile<{ import_id?: string | number }>(
        SUBMIT_PATH[kind],
        {
          fieldName: 'file',
          fileName: `${kind}-${this.now().toISOString().replace(/[:.]/g, '-')}.csv`,
          contentType: 'text/csv',
          content,
        }
      );
      if (data?.import_id === undefined || data.import_id === null || data.import_id === '') {
        throw new MiraklApiException(`Mirakl answered the ${kind} import without an import_id`);
      }
      importId = String(data.import_id);
    } catch (error) {
      if (error instanceof MiraklApiException) {
        await this.failRefused(kind, pending, error);
        return 0;
      }
      throw error;
    }
    const submitted = await this.writes.markSubmitted(pending, importId);
    this.logger.log(
      `Sent ${submitted} ${kind} line(s) to Mirakl as import ${importId} [connectionId=${this.connectionId}]`
    );
    return submitted;
  }

  private async failRefused(
    kind: MiraklBufferedWriteKind,
    pending: readonly MiraklOfferWrite[],
    error: MiraklApiException
  ): Promise<void> {
    const reason = `Mirakl refused the ${kind} file: ${describeMiraklFailure(error.statusCode, error.miraklCode)}`;
    await this.writes.failPending(pending, reason);
    this.logger.warn(`${reason} [connectionId=${this.connectionId}, lines=${pending.length}]`);
  }
}

function describeError(error: unknown): string {
  if (error instanceof MiraklApiException) {
    return describeMiraklFailure(error.statusCode, error.miraklCode);
  }
  return error instanceof Error ? error.name : 'error';
}
