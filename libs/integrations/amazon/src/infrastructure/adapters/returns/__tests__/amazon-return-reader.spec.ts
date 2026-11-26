/**
 * AmazonReturnReader tests (#4184)
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/returns/__tests__
 */
import { InMemoryCacheAdapter } from '@openlinker/shared/cache/testing';

import { decodeAmazonReturnFeedCursor, encodeAmazonReturnFeedCursor } from '../../../../domain/policies/amazon-return-feed-cursor.policy';
import type { AmazonReportsClient } from '../../../http/amazon-reports.client';
import { AmazonReturnReader } from '../amazon-return-reader';

const NOW = new Date('2026-11-18T12:00:00Z');
const REPORT = [
  'Order ID\tReturn request date\tReturn request status\tAmazon RMA ID\tMerchant SKU\tReturn quantity',
  '302-2\t2026-11-12T00:00:00Z\tApproved\tRMA2\tCUP\t1',
  '302-1\t2026-11-10T00:00:00Z\tClosed\tRMA1\tMUG\t1',
  '302-3\t2026-11-14T00:00:00Z\tApproved\tRMA3\tPLATE\t1',
].join('\n');

function setup(): { reader: AmazonReturnReader; reports: jest.Mocked<AmazonReportsClient>; cache: InMemoryCacheAdapter } {
  const reports = {
    createReport: jest.fn().mockResolvedValue('R1'),
    getReport: jest.fn(),
    downloadDocument: jest.fn().mockResolvedValue(REPORT),
  } as unknown as jest.Mocked<AmazonReportsClient>;
  const cache = new InMemoryCacheAdapter();
  return { reader: new AmazonReturnReader(reports, 'conn-amz', ['A1PA6795UKMFR9'], cache, () => NOW), reports, cache };
}

describe('AmazonReturnReader', () => {
  it('should request a report on the first call and report no returns yet', async () => {
    const { reader, reports } = setup();

    const page = await reader.listReturnFeed({ fromCursor: null, limit: 10 });

    expect(reports.createReport).toHaveBeenCalledWith({
      reportType: 'GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE',
      marketplaceIds: ['A1PA6795UKMFR9'],
      dataStartTime: '2026-09-20T11:58:00.000Z',
      dataEndTime: '2026-11-18T11:58:00.000Z',
    });
    expect(page.items).toEqual([]);
    expect(decodeAmazonReturnFeedCursor(page.nextCursor, NOW)).toEqual({
      step: 'pending',
      reportId: 'R1',
      until: '2026-11-18T11:58:00.000Z',
    });
  });

  it('should not request a new report within the hour', async () => {
    const { reader, reports } = setup();
    const cursor = encodeAmazonReturnFeedCursor({ step: 'idle', until: '2026-11-18T11:30:00.000Z' });

    const page = await reader.listReturnFeed({ fromCursor: cursor, limit: 10 });

    expect(reports.createReport).not.toHaveBeenCalled();
    expect(page).toEqual({ items: [], nextCursor: cursor });
  });

  it('should keep the cursor while Amazon builds the report', async () => {
    const { reader, reports } = setup();
    reports.getReport.mockResolvedValue({ reportId: 'R1', processingStatus: 'IN_PROGRESS' });
    const cursor = encodeAmazonReturnFeedCursor({ step: 'pending', reportId: 'R1', until: '2026-11-18T11:58:00.000Z' });

    await expect(reader.listReturnFeed({ fromCursor: cursor, limit: 10 })).resolves.toEqual({ items: [], nextCursor: cursor });
  });

  it('should hand the returns of a finished report to core a page at a time, oldest first', async () => {
    const { reader, reports } = setup();
    reports.getReport.mockResolvedValue({ reportId: 'R1', processingStatus: 'DONE', reportDocumentId: 'D1' });
    const pending = encodeAmazonReturnFeedCursor({ step: 'pending', reportId: 'R1', until: '2026-11-18T11:58:00.000Z' });

    const first = await reader.listReturnFeed({ fromCursor: pending, limit: 2 });
    const second = await reader.listReturnFeed({ fromCursor: first.nextCursor, limit: 2 });

    expect(first.items.map((item) => item.eventKey)).toEqual(['RMA1:Closed', 'RMA2:Approved']);
    expect(second.items.map((item) => item.externalReturnId)).toEqual(['RMA3']);
    expect(decodeAmazonReturnFeedCursor(second.nextCursor, NOW)).toEqual({ step: 'idle', until: '2026-11-18T11:58:00.000Z' });
  });

  it('should close the cycle on a cancelled report and on a fatal one', async () => {
    const { reader, reports } = setup();
    const pending = encodeAmazonReturnFeedCursor({ step: 'pending', reportId: 'R1', until: '2026-11-18T11:58:00.000Z' });
    reports.getReport.mockResolvedValueOnce({ reportId: 'R1', processingStatus: 'CANCELLED' });
    const cancelled = await reader.listReturnFeed({ fromCursor: pending, limit: 10 });
    expect(decodeAmazonReturnFeedCursor(cancelled.nextCursor, NOW).step).toBe('idle');

    // A FATAL report never changes; the feed must move on, not fail every tick.
    reports.getReport.mockResolvedValueOnce({ reportId: 'R1', processingStatus: 'FATAL' });
    const fatal = await reader.listReturnFeed({ fromCursor: pending, limit: 10 });
    expect(fatal.items).toEqual([]);
    expect(decodeAmazonReturnFeedCursor(fatal.nextCursor, NOW)).toEqual({
      step: 'idle',
      until: '2026-11-18T11:58:00.000Z',
    });
  });

  it('should read a return back from the cache, and report one it never saw as not found', async () => {
    const { reader, reports, cache } = setup();
    reports.getReport.mockResolvedValue({ reportId: 'R1', processingStatus: 'DONE', reportDocumentId: 'D1' });
    await reader.listReturnFeed({
      fromCursor: encodeAmazonReturnFeedCursor({ step: 'pending', reportId: 'R1', until: '2026-11-18T11:58:00.000Z' }),
      limit: 10,
    });

    const fresh = new AmazonReturnReader(reports, 'conn-amz', ['A1PA6795UKMFR9'], cache, () => NOW);
    await expect(fresh.getReturn({ externalReturnId: 'RMA2' })).resolves.toEqual(
      expect.objectContaining({ externalReturnId: 'RMA2', externalOrderId: '302-2', rawStatus: 'Approved' }),
    );
    await expect(fresh.getReturn({ externalReturnId: 'NOPE' })).rejects.toMatchObject({ statusCode: 404 });
  });
});
