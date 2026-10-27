/**
 * InvoicingMarketplaceUploadHandler tests (#3549) - the ADR-007 outcome table.
 */
import type { IInvoiceMarketplaceUploadService } from '@openlinker/core/orders';
import { SyncJobExecutionError, type SyncJob } from '@openlinker/core/sync';
import { InvoicingMarketplaceUploadHandler } from '../invoicing-marketplace-upload.handler';

const job = (payload: unknown): SyncJob =>
  ({
    id: 'job-1',
    jobType: 'invoicing.marketplaceUpload',
    connectionId: 'conn-1',
    payload,
  }) as unknown as SyncJob;

describe('InvoicingMarketplaceUploadHandler', () => {
  let uploads: { upload: jest.Mock };
  let handler: InvoicingMarketplaceUploadHandler;

  beforeEach(() => {
    uploads = { upload: jest.fn() };
    handler = new InvoicingMarketplaceUploadHandler(
      uploads as unknown as IInvoiceMarketplaceUploadService
    );
  });

  it.each([
    ['uploaded', { kind: 'settled', status: 'uploaded', failureCode: null }],
    ['unsupported', { kind: 'settled', status: 'unsupported', failureCode: null }],
    ['no-file', { kind: 'settled', status: 'no-file', failureCode: null }],
    ['skipped', { kind: 'skipped', reason: 'already-settled' }],
  ])('should finish ok when the result is %s', async (_label, result) => {
    uploads.upload.mockResolvedValue(result);

    expect(await handler.execute(job({ schemaVersion: 1, invoiceId: 'inv-1' }))).toEqual({
      outcome: 'ok',
    });
  });

  it('should be a terminal business failure when the marketplace rejected the file', async () => {
    uploads.upload.mockResolvedValue({ kind: 'settled', status: 'failed', failureCode: 'rejected' });

    expect(await handler.execute(job({ schemaVersion: 1, invoiceId: 'inv-1' }))).toEqual({
      outcome: 'business_failure',
    });
  });

  it.each(['transient', 'adapter-unresolved', 'order-unmapped'])(
    'should throw retryable when the upload failed with %s',
    async (failureCode) => {
      uploads.upload.mockResolvedValue({ kind: 'settled', status: 'failed', failureCode });

      await expect(
        handler.execute(job({ schemaVersion: 1, invoiceId: 'inv-1' }))
      ).rejects.toBeInstanceOf(SyncJobExecutionError);
    }
  );

  it('should throw retryable while the document is not attachable yet', async () => {
    uploads.upload.mockResolvedValue({ kind: 'waiting' });

    await expect(
      handler.execute(job({ schemaVersion: 1, invoiceId: 'inv-1' }))
    ).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('should be a business failure for a malformed payload', async () => {
    expect(await handler.execute(job({ schemaVersion: 1 }))).toEqual({
      outcome: 'business_failure',
    });
    expect(uploads.upload).not.toHaveBeenCalled();
  });
});
