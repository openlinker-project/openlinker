/**
 * Invoice Marketplace Upload Service tests (#3549)
 *
 * The cases are the ones the issue names (success, adapter not implemented,
 * transient failure) plus the ones that make the service safe to retry:
 * `waiting` must not touch the row, a settled row must not be re-uploaded, and
 * a provider message must never reach persistence.
 */
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IInvoiceAttachmentService, IInvoiceService } from '@openlinker/core/invoicing';
import type { IOrderRecordService } from '../interfaces/order-record.service.interface';
import type { InvoiceMarketplaceUploadRepositoryPort } from '../../domain/ports/invoice-marketplace-upload-repository.port';
import type { InvoiceMarketplaceUpload } from '../../domain/types/invoice-marketplace-upload.types';
import type { JobEnqueuePort } from '@openlinker/core/sync';
import { InvoiceMarketplaceUploadService } from './invoice-marketplace-upload.service';

const CONNECTION = 'conn-allegro';
const claimedRow = (overrides: Partial<InvoiceMarketplaceUpload> = {}): InvoiceMarketplaceUpload => ({
  id: 'upload-1',
  invoiceRecordId: 'inv-1',
  targetConnectionId: CONNECTION,
  status: 'pending',
  attempts: 1,
  lastFailureCode: null,
  uploadedAt: null,
  createdAt: new Date('2026-10-27T10:00:00Z'),
  updatedAt: new Date('2026-10-27T10:00:00Z'),
  ...overrides,
});

describe('InvoiceMarketplaceUploadService', () => {
  let uploads: jest.Mocked<InvoiceMarketplaceUploadRepositoryPort>;
  let invoices: { getInvoiceById: jest.Mock };
  let attachments: jest.Mocked<IInvoiceAttachmentService>;
  let orders: { getOrderRecord: jest.Mock };
  let mapping: { getExternalIds: jest.Mock };
  let integrations: { getCapabilityAdapter: jest.Mock };
  let enqueue: { enqueueJob: jest.Mock };
  let service: InvoiceMarketplaceUploadService;

  const pdf = {
    state: 'pdf' as const,
    content: new Uint8Array([1, 2, 3]),
    contentType: 'application/pdf',
  };

  beforeEach(() => {
    uploads = {
      findByInvoiceId: jest.fn(),
      claimAttempt: jest.fn().mockResolvedValue(claimedRow()),
      recordOutcome: jest.fn().mockResolvedValue(true),
    };
    invoices = {
      getInvoiceById: jest.fn().mockResolvedValue({
        id: 'inv-1',
        orderId: 'ol_order_1',
        documentNumber: 'FV/2026/10/0001',
        providerInvoiceNumber: null,
      }),
    };
    attachments = { resolveAttachment: jest.fn().mockResolvedValue(pdf) };
    orders = { getOrderRecord: jest.fn().mockResolvedValue({ sourceConnectionId: CONNECTION }) };
    mapping = {
      getExternalIds: jest
        .fn()
        .mockResolvedValue([{ connectionId: CONNECTION, externalId: 'ext-order-1' }]),
    };
    integrations = {
      getCapabilityAdapter: jest.fn().mockResolvedValue({
        uploadBillingDocument: jest.fn().mockResolvedValue({ outcome: 'uploaded' }),
      }),
    };
    enqueue = { enqueueJob: jest.fn().mockResolvedValue({ jobId: 'j1' }) };
    service = new InvoiceMarketplaceUploadService(
      uploads,
      invoices as unknown as IInvoiceService,
      attachments,
      orders as unknown as IOrderRecordService,
      mapping as unknown as IIdentifierMappingService,
      integrations as unknown as IIntegrationsService,
      enqueue as unknown as JobEnqueuePort,
    );
  });

  it('should upload the PDF to the order and record it as uploaded', async () => {
    const uploader = { uploadBillingDocument: jest.fn().mockResolvedValue({ outcome: 'uploaded' }) };
    integrations.getCapabilityAdapter.mockResolvedValue(uploader);

    const result = await service.upload('inv-1');

    expect(uploader.uploadBillingDocument).toHaveBeenCalledWith({
      externalOrderId: 'ext-order-1',
      documentNumber: 'FV/2026/10/0001',
      fileName: 'FV-2026-10-0001.pdf',
      contentType: 'application/pdf',
      content: pdf.content,
    });
    expect(uploads.recordOutcome).toHaveBeenCalledWith('upload-1', { status: 'uploaded' });
    expect(result).toEqual({ kind: 'settled', status: 'uploaded', failureCode: null });
  });

  it('should read an already-present document as uploaded, so a retry that actually landed is done', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue({
      uploadBillingDocument: jest.fn().mockResolvedValue({ outcome: 'already-present' }),
    });

    expect(await service.upload('inv-1')).toEqual({
      kind: 'settled',
      status: 'uploaded',
      failureCode: null,
    });
  });

  it('should answer waiting without claiming an attempt when the document is not attachable yet', async () => {
    attachments.resolveAttachment.mockResolvedValue({ state: 'waiting' });

    expect(await service.upload('inv-1')).toEqual({ kind: 'waiting' });
    expect(uploads.claimAttempt).not.toHaveBeenCalled();
  });

  it.each([
    ['a link only', { state: 'link' as const, url: 'https://x.test/d' }],
    ['nothing attachable', { state: 'none' as const }],
  ])('should record no-file, and upload nothing, when the document is %s', async (_label, attachment) => {
    attachments.resolveAttachment.mockResolvedValue(attachment);

    expect(await service.upload('inv-1')).toEqual({
      kind: 'settled',
      status: 'no-file',
      failureCode: null,
    });
    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
  });

  it('should record unsupported when the marketplace adapter cannot take a billing document', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue({ getOrder: jest.fn() });

    expect(await service.upload('inv-1')).toEqual({
      kind: 'settled',
      status: 'unsupported',
      failureCode: null,
    });
  });

  it('should record unsupported when the adapter itself declines', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue({
      uploadBillingDocument: jest.fn().mockResolvedValue({ outcome: 'unsupported' }),
    });

    expect((await service.upload('inv-1'))).toMatchObject({ status: 'unsupported' });
  });

  it('should record a transient failure and never persist the adapter detail', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue({
      uploadBillingDocument: jest
        .fn()
        .mockResolvedValue({ outcome: 'transient-failure', detail: 'buyer@example.com timed out' }),
    });

    const result = await service.upload('inv-1');

    expect(result).toEqual({ kind: 'settled', status: 'failed', failureCode: 'transient' });
    expect(JSON.stringify(uploads.recordOutcome.mock.calls)).not.toContain('buyer@example.com');
  });

  it('should record a rejection as a failure no retry can change', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue({
      uploadBillingDocument: jest.fn().mockResolvedValue({ outcome: 'rejected', detail: 'too large' }),
    });

    expect(await service.upload('inv-1')).toEqual({
      kind: 'settled',
      status: 'failed',
      failureCode: 'rejected',
    });
  });

  it('should treat an adapter that throws as a transient failure', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue({
      uploadBillingDocument: jest.fn().mockRejectedValue(new Error('socket hang up')),
    });

    expect(await service.upload('inv-1')).toEqual({
      kind: 'settled',
      status: 'failed',
      failureCode: 'transient',
    });
  });

  it('should record adapter-unresolved when the marketplace connection cannot be built', async () => {
    integrations.getCapabilityAdapter.mockRejectedValue(new Error('connection disabled'));

    expect(await service.upload('inv-1')).toEqual({
      kind: 'settled',
      status: 'failed',
      failureCode: 'adapter-unresolved',
    });
  });

  it('should record order-unmapped when the order has no id on its source connection', async () => {
    mapping.getExternalIds.mockResolvedValue([{ connectionId: 'someone-else', externalId: 'x' }]);

    expect(await service.upload('inv-1')).toEqual({
      kind: 'settled',
      status: 'failed',
      failureCode: 'order-unmapped',
    });
  });

  it('should skip a row that is already terminal, without calling the marketplace', async () => {
    uploads.claimAttempt.mockResolvedValue(null);

    expect(await service.upload('inv-1')).toEqual({ kind: 'skipped', reason: 'already-settled' });
    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
  });

  it('should not overwrite a row another attempt settled first', async () => {
    uploads.recordOutcome.mockResolvedValue(false);

    expect(await service.upload('inv-1')).toEqual({ kind: 'skipped', reason: 'already-settled' });
  });

  it.each([
    ['an unknown invoice', () => invoices.getInvoiceById.mockResolvedValue(null), 'invoice-not-found'],
    ['an unknown order', () => orders.getOrderRecord.mockResolvedValue(null), 'order-not-found'],
  ])('should skip %s', async (_label, arrange, reason) => {
    arrange();

    expect(await service.upload('inv-1')).toEqual({ kind: 'skipped', reason });
    expect(uploads.claimAttempt).not.toHaveBeenCalled();
  });

  it('should fall back to a safe file name when the number has nothing usable', async () => {
    invoices.getInvoiceById.mockResolvedValue({
      id: 'inv-1',
      orderId: 'ol_order_1',
      documentNumber: '///',
      providerInvoiceNumber: null,
    });
    const uploader = { uploadBillingDocument: jest.fn().mockResolvedValue({ outcome: 'uploaded' }) };
    integrations.getCapabilityAdapter.mockResolvedValue(uploader);

    await service.upload('inv-1');

    expect(uploader.uploadBillingDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'document.pdf' }),
    );
  });

  describe('enqueueUpload', () => {
    it('should enqueue under the marketplace connection with a stable key', async () => {
      expect(await service.enqueueUpload('inv-1')).toBe('enqueued');
      expect(enqueue.enqueueJob).toHaveBeenCalledWith({
        jobType: 'invoicing.marketplaceUpload',
        connectionId: CONNECTION,
        payload: { schemaVersion: 1, invoiceId: 'inv-1' },
        idempotencyKey: 'invoice-upload:inv-1',
      });
    });

    it('should mint a fresh key for an operator retry', async () => {
      await service.enqueueUpload('inv-1', { retry: true });
      const key = enqueue.enqueueJob.mock.calls[0][0].idempotencyKey as string;
      expect(key).toMatch(/^invoice-upload:inv-1:retry:\d+$/);
    });

    it('should report failed instead of throwing when the enqueue breaks', async () => {
      enqueue.enqueueJob.mockRejectedValue(new Error('redis down'));
      expect(await service.enqueueUpload('inv-1')).toBe('failed');
    });

    it('should skip an unknown invoice', async () => {
      invoices.getInvoiceById.mockResolvedValue(null);
      expect(await service.enqueueUpload('inv-1')).toBe('skipped');
    });
  });
});
