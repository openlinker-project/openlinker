/**
 * Amazon Return Reader (#4184)
 *
 * `ReturnSourceReader` over the seller-fulfilled returns report
 * (`GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE`). Amazon has no returns API for
 * seller-fulfilled orders; the report is the only read, and it is built
 * asynchronously, so one report cycle spans several feed calls (see
 * `amazon-return-feed-cursor.policy`):
 *
 *   1. request a report for returns requested since the last cycle, reaching
 *      back `AMAZON_RETURN_RECHECK_DAYS` so a return whose status changed is
 *      read again (the report states each return's current status, and a
 *      report is the only way to see it); Amazon allows at most 60 days a
 *      report, so the window never starts further back than that;
 *   2. while Amazon builds it, report no returns and keep the cursor;
 *   3. when it is done, hand the returns to core a page at a time.
 *
 * A new cycle starts at most once per `AMAZON_RETURN_REPORT_INTERVAL_MS`.
 *
 * Each return read from a report is kept in the host cache under its RMA id,
 * which is what `getReturn` answers from: re-requesting a report per return
 * would take minutes and spend the report quota. A return no longer in the
 * cache (older than the re-check window and the cache lifetime) reads as not
 * found, which the status sweep counts and moves past. The feed's `eventKey`
 * carries the status, so a changed status is a new item while an unchanged
 * one is the same item core has already handled.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/returns
 */
import type { IncomingReturn, ReturnFeedInput, ReturnFeedOutput } from '@openlinker/core/returns';
import type { CachePort } from '@openlinker/shared';

import { AmazonApiError } from '../../../domain/exceptions/amazon-api.error';
import {
  decodeAmazonReturnFeedCursor,
  encodeAmazonReturnFeedCursor,
  type AmazonReturnFeedCursor,
} from '../../../domain/policies/amazon-return-feed-cursor.policy';
import type { AmazonReportsClient } from '../../http/amazon-reports.client';
import { parseAmazonFlatFile } from '../../mappers/amazon-flat-file';
import {
  groupAmazonReturnRows,
  toIncomingReturn,
  type AmazonReturnObservation,
} from '../../mappers/amazon-return.mapper';

export const AMAZON_RETURNS_REPORT_TYPE = 'GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Returns requested this long before the last cycle are read again for a status change. */
export const AMAZON_RETURN_RECHECK_DAYS = 30;
/** Amazon's limit is 60 days a report; one day of margin. */
const MAX_WINDOW_DAYS = 59;
/** A report is not requested more often than this. */
export const AMAZON_RETURN_REPORT_INTERVAL_MS = 60 * 60 * 1000;
/** The report covers up to a little before now, so a return still being written is read next cycle. */
const REPORT_END_LAG_MS = 2 * 60 * 1000;
const RETURN_CACHE_TTL_SECONDS = 40 * 24 * 60 * 60;

export class AmazonReturnReader {
  private readonly local = new Map<string, AmazonReturnObservation>();

  constructor(
    private readonly reports: AmazonReportsClient,
    private readonly connectionId: string,
    private readonly marketplaceIds: readonly string[],
    private readonly cache?: CachePort,
    private readonly now: () => Date = (): Date => new Date(),
  ) {}

  async listReturnFeed(input: ReturnFeedInput): Promise<ReturnFeedOutput> {
    const now = this.now();
    const cursor = decodeAmazonReturnFeedCursor(input.fromCursor, now);
    switch (cursor.step) {
      case 'idle':
        return this.startCycle(cursor, now, input.fromCursor);
      case 'pending':
        return this.checkReport(cursor, input.limit);
      case 'reading':
        return this.readPage(cursor.reportDocumentId, cursor.until, cursor.offset, input.limit);
    }
  }

  async getReturn(input: { externalReturnId: string }): Promise<IncomingReturn> {
    const observation = await this.cached(input.externalReturnId);
    if (observation === null) {
      throw new AmazonApiError(
        404,
        'ReturnNotInReport',
        `return ${input.externalReturnId} is not in a recent returns report`,
        undefined,
      );
    }
    return toIncomingReturn(observation);
  }

  private async startCycle(
    cursor: Extract<AmazonReturnFeedCursor, { step: 'idle' }>,
    now: Date,
    rawCursor: string | null,
  ): Promise<ReturnFeedOutput> {
    const end = new Date(now.getTime() - REPORT_END_LAG_MS);
    const last = Date.parse(cursor.until);
    if (rawCursor !== null && end.getTime() - last < AMAZON_RETURN_REPORT_INTERVAL_MS) {
      return { items: [], nextCursor: rawCursor };
    }
    const start = Math.max(last - AMAZON_RETURN_RECHECK_DAYS * DAY_MS, end.getTime() - MAX_WINDOW_DAYS * DAY_MS);
    const reportId = await this.reports.createReport({
      reportType: AMAZON_RETURNS_REPORT_TYPE,
      marketplaceIds: this.marketplaceIds,
      dataStartTime: new Date(start).toISOString(),
      dataEndTime: end.toISOString(),
    });
    return {
      items: [],
      nextCursor: encodeAmazonReturnFeedCursor({ step: 'pending', reportId, until: end.toISOString() }),
    };
  }

  private async checkReport(
    cursor: Extract<AmazonReturnFeedCursor, { step: 'pending' }>,
    limit: number,
  ): Promise<ReturnFeedOutput> {
    const report = await this.reports.getReport(cursor.reportId);
    switch (report.processingStatus) {
      case 'IN_QUEUE':
      case 'IN_PROGRESS':
        return { items: [], nextCursor: encodeAmazonReturnFeedCursor(cursor) };
      case 'CANCELLED':
        // Amazon cancels a report that has no data: no returns in the window.
        return { items: [], nextCursor: encodeAmazonReturnFeedCursor({ step: 'idle', until: cursor.until }) };
      case 'DONE':
        if (report.reportDocumentId === undefined) {
          return { items: [], nextCursor: encodeAmazonReturnFeedCursor({ step: 'idle', until: cursor.until }) };
        }
        return this.readPage(report.reportDocumentId, cursor.until, 0, limit);
      case 'FATAL':
        throw new AmazonApiError(
          502,
          'ReportFatal',
          `Amazon could not build returns report ${cursor.reportId} (connection: ${this.connectionId})`,
          undefined,
        );
    }
  }

  private async readPage(
    reportDocumentId: string,
    until: string,
    offset: number,
    limit: number,
  ): Promise<ReturnFeedOutput> {
    const text = await this.reports.downloadDocument(reportDocumentId);
    const observations = groupAmazonReturnRows(parseAmazonFlatFile(text), until).sort(
      (a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.rmaId.localeCompare(b.rmaId),
    );
    const page = observations.slice(offset, offset + Math.max(1, limit));
    for (const observation of page) {
      await this.remember(observation);
    }
    const next = offset + page.length;
    const nextCursor: AmazonReturnFeedCursor =
      next < observations.length
        ? { step: 'reading', reportDocumentId, until, offset: next }
        : { step: 'idle', until };
    return {
      items: page.map((observation) => ({
        externalReturnId: observation.rmaId,
        externalOrderId: observation.orderId,
        occurredAt: observation.requestedAt,
        eventKey: `${observation.rmaId}:${observation.status}`,
      })),
      nextCursor: encodeAmazonReturnFeedCursor(nextCursor),
    };
  }

  private cacheKey(rmaId: string): string {
    return `amazon:return:${this.connectionId}:${rmaId}`;
  }

  private async remember(observation: AmazonReturnObservation): Promise<void> {
    this.local.set(observation.rmaId, observation);
    await this.cache?.set(this.cacheKey(observation.rmaId), observation, RETURN_CACHE_TTL_SECONDS).catch(() => undefined);
  }

  /** The return as the last report stated it, or `null`. Also used by the refund executor. */
  async cached(rmaId: string): Promise<AmazonReturnObservation | null> {
    const local = this.local.get(rmaId);
    if (local !== undefined) {
      return local;
    }
    if (this.cache === undefined) {
      return null;
    }
    const stored = await this.cache.get<AmazonReturnObservation>(this.cacheKey(rmaId)).catch(() => null);
    return stored ?? null;
  }
}
