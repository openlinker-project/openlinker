/**
 * Invoice Attachment Service tests (#3548)
 *
 * One read, every provider: the cases below are the provider matrix the issue
 * names (bytes, stored url, verification link) plus the two states a surface must
 * tell apart - `waiting` ("not yet") and `none` ("not going to be").
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import { InvoiceRecord } from '../../domain/entities/invoice-record.entity';
import { RegulatoryDocumentNotReadyError } from '../../domain/exceptions/regulatory-document-not-ready.error';
import { UnsupportedRegulatoryDocumentKindError } from '../../domain/exceptions/unsupported-regulatory-document-kind.error';
import type { InvoiceRecordRepositoryPort } from '../../domain/ports/invoice-record-repository.port';
import type { RegulatoryStatus } from '../../domain/types/invoicing.types';
import { InvoiceAttachmentService } from './invoice-attachment.service';

type Status = 'pending' | 'issued' | 'failed';

function record(
  overrides: { status?: Status; regulatoryStatus?: RegulatoryStatus; pdfUrl?: string | null } = {}
): InvoiceRecord {
  return new InvoiceRecord(
    'rec-1',
    'conn-1',
    'ol_order_1',
    'provider',
    'invoice',
    overrides.status ?? 'issued',
    'prov-1',
    null,
    overrides.regulatoryStatus ?? 'accepted',
    null,
    null,
    overrides.pdfUrl === undefined ? null : overrides.pdfUrl,
    new Date('2026-02-01T10:00:00Z'),
    null,
    new Date('2026-02-01T10:00:00Z'),
    new Date('2026-02-01T10:00:00Z')
  );
}

describe('InvoiceAttachmentService', () => {
  let repo: jest.Mocked<Pick<InvoiceRecordRepositoryPort, 'findById'>>;
  let integrations: jest.Mocked<Pick<IIntegrationsService, 'getCapabilityAdapter'>>;
  let service: InvoiceAttachmentService;

  beforeEach(() => {
    repo = { findById: jest.fn() };
    integrations = { getCapabilityAdapter: jest.fn() };
    service = new InvoiceAttachmentService(
      repo as unknown as InvoiceRecordRepositoryPort,
      integrations as unknown as IIntegrationsService
    );
  });

  /** A bare adapter: no document reader, no link reader. */
  const bareAdapter = (): object => ({});

  it('should answer null for an unknown invoice', async () => {
    repo.findById.mockResolvedValue(null);

    expect(await service.resolveAttachment('missing')).toBeNull();
    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
  });

  describe('readiness', () => {
    it.each([
      ['a document still being issued', { status: 'pending' as const }],
      [
        'an issued document the authority has not cleared',
        { regulatoryStatus: 'submitted' as const },
      ],
      [
        'an offline document awaiting submission',
        { regulatoryStatus: 'pending-submission' as const },
      ],
    ])('should report waiting for %s, without touching the provider', async (_label, overrides) => {
      repo.findById.mockResolvedValue(record(overrides));

      expect(await service.resolveAttachment('rec-1')).toEqual({ state: 'waiting' });
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it.each([
      ['a failed document', { status: 'failed' as const }],
      ['a rejected clearance', { regulatoryStatus: 'rejected' as const }],
    ])('should report none for %s, because it will never have one', async (_label, overrides) => {
      repo.findById.mockResolvedValue(record(overrides));

      expect(await service.resolveAttachment('rec-1')).toEqual({ state: 'none' });
    });

    it('should treat a document with nothing to clear as ready', async () => {
      repo.findById.mockResolvedValue(
        record({ regulatoryStatus: 'not-applicable', pdfUrl: 'https://x.test/a.pdf' })
      );
      integrations.getCapabilityAdapter.mockResolvedValue(bareAdapter());

      expect(await service.resolveAttachment('rec-1')).toEqual({
        state: 'link',
        url: 'https://x.test/a.pdf',
      });
    });
  });

  describe('sources, most useful first', () => {
    it('should return real bytes when the provider renders a document', async () => {
      repo.findById.mockResolvedValue(record({ pdfUrl: 'https://x.test/a.pdf' }));
      integrations.getCapabilityAdapter.mockResolvedValue({
        getRegulatoryDocument: jest.fn().mockResolvedValue({
          content: new Uint8Array([1, 2]),
          contentType: 'application/pdf',
        }),
      });

      const result = await service.resolveAttachment('rec-1');

      expect(result).toEqual({
        state: 'pdf',
        content: new Uint8Array([1, 2]),
        contentType: 'application/pdf',
      });
    });

    it('should prefer bytes over a stored url', async () => {
      repo.findById.mockResolvedValue(record({ pdfUrl: 'https://x.test/a.pdf' }));
      integrations.getCapabilityAdapter.mockResolvedValue({
        getRegulatoryDocument: jest
          .fn()
          .mockResolvedValue({ content: new Uint8Array([9]), contentType: 'application/pdf' }),
      });

      expect((await service.resolveAttachment('rec-1'))?.state).toBe('pdf');
    });

    it('should fall back to the stored url when the provider has no document reader', async () => {
      repo.findById.mockResolvedValue(record({ pdfUrl: 'https://x.test/a.pdf' }));
      integrations.getCapabilityAdapter.mockResolvedValue(bareAdapter());

      expect(await service.resolveAttachment('rec-1')).toEqual({
        state: 'link',
        url: 'https://x.test/a.pdf',
      });
    });

    it('should fall back to the verification link when there is no bytes and no stored url', async () => {
      repo.findById.mockResolvedValue(record());
      integrations.getCapabilityAdapter.mockResolvedValue({
        getVerificationLink: jest.fn().mockResolvedValue({ url: 'https://qr.example/invoice/1' }),
      });

      expect(await service.resolveAttachment('rec-1')).toEqual({
        state: 'link',
        url: 'https://qr.example/invoice/1',
      });
    });

    it('should report none when a cleared document has nothing attachable at all', async () => {
      repo.findById.mockResolvedValue(record());
      integrations.getCapabilityAdapter.mockResolvedValue(bareAdapter());

      expect(await service.resolveAttachment('rec-1')).toEqual({ state: 'none' });
    });
  });

  describe('degradation', () => {
    it('should report waiting when the provider says its document is not ready yet', async () => {
      repo.findById.mockResolvedValue(record({ pdfUrl: 'https://x.test/a.pdf' }));
      integrations.getCapabilityAdapter.mockResolvedValue({
        getRegulatoryDocument: jest
          .fn()
          .mockRejectedValue(new RegulatoryDocumentNotReadyError('rendered')),
      });

      expect(await service.resolveAttachment('rec-1')).toEqual({ state: 'waiting' });
    });

    it.each([
      ['an unsupported kind', new UnsupportedRegulatoryDocumentKindError('rendered')],
      ['a transport failure', new Error('socket hang up')],
    ])('should fall through to the stored url on %s rather than fail', async (_label, error) => {
      repo.findById.mockResolvedValue(record({ pdfUrl: 'https://x.test/a.pdf' }));
      integrations.getCapabilityAdapter.mockResolvedValue({
        getRegulatoryDocument: jest.fn().mockRejectedValue(error),
      });

      expect(await service.resolveAttachment('rec-1')).toEqual({
        state: 'link',
        url: 'https://x.test/a.pdf',
      });
    });

    it('should not ask for a rendered document the provider says it cannot produce', async () => {
      const getRegulatoryDocument = jest.fn();
      repo.findById.mockResolvedValue(record({ pdfUrl: 'https://x.test/a.pdf' }));
      integrations.getCapabilityAdapter.mockResolvedValue({
        getRegulatoryDocument,
        supportedRegulatoryDocumentKinds: () => ['confirmation'],
      });

      expect(await service.resolveAttachment('rec-1')).toEqual({
        state: 'link',
        url: 'https://x.test/a.pdf',
      });
      expect(getRegulatoryDocument).not.toHaveBeenCalled();
    });

    it('should still serve the stored url when the provider cannot be resolved', async () => {
      repo.findById.mockResolvedValue(record({ pdfUrl: 'https://x.test/a.pdf' }));
      integrations.getCapabilityAdapter.mockRejectedValue(new Error('connection disabled'));

      expect(await service.resolveAttachment('rec-1')).toEqual({
        state: 'link',
        url: 'https://x.test/a.pdf',
      });
    });

    it('should report none, not an error, when the provider cannot be resolved and there is no url', async () => {
      repo.findById.mockResolvedValue(record());
      integrations.getCapabilityAdapter.mockRejectedValue(new Error('connection disabled'));

      expect(await service.resolveAttachment('rec-1')).toEqual({ state: 'none' });
    });

    it('should fall through when the verification link read throws', async () => {
      repo.findById.mockResolvedValue(record());
      integrations.getCapabilityAdapter.mockResolvedValue({
        getVerificationLink: jest.fn().mockRejectedValue(new Error('boom')),
      });

      expect(await service.resolveAttachment('rec-1')).toEqual({ state: 'none' });
    });
  });
});
