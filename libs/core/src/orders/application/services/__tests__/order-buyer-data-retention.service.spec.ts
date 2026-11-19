/**
 * OrderBuyerDataRetentionService tests (#4178)
 *
 * @module application/services/__tests__
 */
import type { ICustomerProjectionService } from '@openlinker/core/customers';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IDocumentEmailDeliveryService } from '@openlinker/core/sales-documents';

import type { BuyerEmailDeliveryRepositoryPort } from '../../../domain/ports/buyer-email-delivery-repository.port';
import type { OrderRecordRepositoryPort } from '../../../domain/ports/order-record-repository.port';
import {
  BUYER_DATA_RETENTION_CUSTOMER_BATCH,
  BUYER_DATA_RETENTION_PAGE_SIZE,
  OrderBuyerDataRetentionService,
} from '../order-buyer-data-retention.service';

const NOW = new Date('2026-11-17T12:00:00.000Z');

function source(connectionId: string, buyerDataRetentionDays?: number): Record<string, unknown> {
  return { connectionId, metadata: { buyerDataRetentionDays } };
}

function setup(sources: Record<string, unknown>[]): {
  service: OrderBuyerDataRetentionService;
  repository: jest.Mocked<Pick<OrderRecordRepositoryPort, 'findBuyerDataRetentionCandidates' | 'redactBuyerData'>>;
  integrations: { listCapabilityAdapters: jest.Mock };
  buyerEmails: { clearRecipientsForOrder: jest.Mock };
  documentEmails: { clearRecipientsForOrder: jest.Mock };
  customers: { redactPersonalDataLastSeenBefore: jest.Mock };
} {
  const repository = {
    findBuyerDataRetentionCandidates: jest.fn().mockResolvedValue([]),
    redactBuyerData: jest.fn().mockResolvedValue(true),
  };
  const integrations = { listCapabilityAdapters: jest.fn().mockResolvedValue(sources) };
  const buyerEmails = { clearRecipientsForOrder: jest.fn().mockResolvedValue(0) };
  const documentEmails = { clearRecipientsForOrder: jest.fn().mockResolvedValue(0) };
  const customers = { redactPersonalDataLastSeenBefore: jest.fn().mockResolvedValue(0) };
  const service = new OrderBuyerDataRetentionService(
    repository as unknown as OrderRecordRepositoryPort,
    integrations as unknown as IIntegrationsService,
    buyerEmails as unknown as BuyerEmailDeliveryRepositoryPort,
    documentEmails as unknown as IDocumentEmailDeliveryService,
    customers as unknown as ICustomerProjectionService,
  );
  return { service, repository, integrations, buyerEmails, documentEmails, customers };
}

describe('OrderBuyerDataRetentionService', () => {
  it('should look only at sources that declare a retention period, without building adapters', async () => {
    const { service, repository, integrations } = setup([source('amz', 30), source('shop'), source('bad', 0)]);

    await service.runOnce(NOW);

    expect(integrations.listCapabilityAdapters).toHaveBeenCalledWith({
      capability: 'OrderSource',
      lazy: true,
      includeAllStatuses: true,
    });
    expect(repository.findBuyerDataRetentionCandidates).toHaveBeenCalledTimes(1);
    expect(repository.findBuyerDataRetentionCandidates).toHaveBeenCalledWith({
      sourceConnectionId: 'amz',
      anchorBefore: new Date('2026-10-18T12:00:00.000Z'),
      limit: BUYER_DATA_RETENTION_PAGE_SIZE,
    });
  });

  it('should write the redacted snapshot and a search text without the buyer', async () => {
    const { service, repository } = setup([source('amz', 30)]);
    repository.findBuyerDataRetentionCandidates.mockResolvedValueOnce([
      {
        internalOrderId: 'ol_order_1',
        orderSnapshot: {
          orderNumber: '302-1',
          customerEmail: 'abc@marketplace.amazon.de',
          shippingAddress: { firstName: 'Anna', lastName: 'Schmidt', address1: 'A 1', city: 'B', postalCode: '1', country: 'DE' },
        },
      },
    ]);

    const result = await service.runOnce(NOW);

    expect(result.redacted).toBe(1);
    const written = repository.redactBuyerData.mock.calls[0][0];
    expect(written.internalOrderId).toBe('ol_order_1');
    expect(written.orderSnapshot).not.toHaveProperty('customerEmail');
    expect(written.searchText).not.toMatch(/anna|schmidt|amazon/);
    expect(written.searchText).toContain('302-1');
  });

  it('should page until a short page and count only rows it actually redacted', async () => {
    const { service, repository } = setup([source('amz', 30)]);
    const full = Array.from({ length: BUYER_DATA_RETENTION_PAGE_SIZE }, (_, i) => ({
      internalOrderId: `o${String(i)}`,
      orderSnapshot: {},
    }));
    repository.findBuyerDataRetentionCandidates
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([{ internalOrderId: 'last', orderSnapshot: {} }]);
    repository.redactBuyerData.mockResolvedValueOnce(false);

    const result = await service.runOnce(NOW);

    expect(repository.findBuyerDataRetentionCandidates).toHaveBeenCalledTimes(2);
    expect(result.connections[0]).toMatchObject({ redacted: BUYER_DATA_RETENTION_PAGE_SIZE, budgetExhausted: false });
  });

  it('should keep going when one connection fails', async () => {
    const { service, repository } = setup([source('broken', 30), source('amz', 30)]);
    repository.findBuyerDataRetentionCandidates
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce([{ internalOrderId: 'o1', orderSnapshot: {} }]);

    const result = await service.runOnce(NOW);

    expect(result.connections.map((entry) => entry.sourceConnectionId)).toEqual(['amz']);
    expect(result.redacted).toBe(1);
  });

  it('should clear the email delivery recipients of each order it redacted, and only those', async () => {
    const { service, repository, buyerEmails, documentEmails } = setup([source('amz', 30)]);
    repository.findBuyerDataRetentionCandidates.mockResolvedValueOnce([
      { internalOrderId: 'o1', orderSnapshot: {} },
      { internalOrderId: 'o2', orderSnapshot: {} },
    ]);
    repository.redactBuyerData.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await service.runOnce(NOW);

    expect(buyerEmails.clearRecipientsForOrder.mock.calls).toEqual([['o1']]);
    expect(documentEmails.clearRecipientsForOrder.mock.calls).toEqual([['o1']]);
  });

  it('should clear the customers last seen through the source before the same cutoff, in batches', async () => {
    const { service, customers } = setup([source('amz', 30)]);
    customers.redactPersonalDataLastSeenBefore
      .mockResolvedValueOnce(BUYER_DATA_RETENTION_CUSTOMER_BATCH)
      .mockResolvedValueOnce(3);

    const result = await service.runOnce(NOW);

    expect(customers.redactPersonalDataLastSeenBefore).toHaveBeenCalledTimes(2);
    expect(customers.redactPersonalDataLastSeenBefore).toHaveBeenCalledWith({
      sourceConnectionId: 'amz',
      lastSeenBefore: new Date('2026-10-18T12:00:00.000Z'),
      limit: BUYER_DATA_RETENTION_CUSTOMER_BATCH,
    });
    expect(result.connections[0]).toMatchObject({
      customersRedacted: BUYER_DATA_RETENTION_CUSTOMER_BATCH + 3,
      budgetExhausted: false,
    });
  });
});
