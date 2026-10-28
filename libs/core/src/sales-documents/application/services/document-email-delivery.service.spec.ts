import type { DocumentEmailDeliveryRepositoryPort } from '../../domain/ports/document-email-delivery-repository.port';
import { DocumentEmailDeliveryService } from './document-email-delivery.service';

const input = {
  internalOrderId: 'ol_order_1',
  documentKind: 'invoice',
  documentId: 'inv-1',
  sentVia: 'openlinker' as const,
  outcome: 'sent' as const,
  failureReason: null,
  recipient: 'buyer@example.com',
  actorUserId: 'user-1',
};

describe('DocumentEmailDeliveryService', () => {
  let repository: jest.Mocked<DocumentEmailDeliveryRepositoryPort>;
  let service: DocumentEmailDeliveryService;
  const original = process.env.OL_STORE_PII;

  beforeEach(() => {
    repository = { record: jest.fn(), listByOrder: jest.fn() };
    service = new DocumentEmailDeliveryService(repository);
  });

  afterEach(() => {
    if (original === undefined) delete process.env.OL_STORE_PII;
    else process.env.OL_STORE_PII = original;
  });

  it('should store the recipient while OL_STORE_PII is on', async () => {
    delete process.env.OL_STORE_PII;

    await service.record(input);

    expect(repository.record).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: 'buyer@example.com' })
    );
  });

  it('should drop the recipient when OL_STORE_PII is off', async () => {
    process.env.OL_STORE_PII = 'false';

    await service.record(input);

    expect(repository.record).toHaveBeenCalledWith(expect.objectContaining({ recipient: null }));
  });

  it('should swallow a write failure and report null, never throw', async () => {
    repository.record.mockRejectedValue(new Error('db down'));

    await expect(service.record(input)).resolves.toBeNull();
  });

  it('should list an order newest first with a bounded page', async () => {
    repository.listByOrder.mockResolvedValue([]);

    await service.listForOrder('ol_order_1');

    expect(repository.listByOrder).toHaveBeenCalledWith('ol_order_1', 50);
  });
});
