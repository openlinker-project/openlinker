/**
 * OrderBuyerDataRetentionService tests (#4178)
 *
 * @module application/services/__tests__
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';

import type { OrderRecordRepositoryPort } from '../../../domain/ports/order-record-repository.port';
import {
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
} {
  const repository = {
    findBuyerDataRetentionCandidates: jest.fn().mockResolvedValue([]),
    redactBuyerData: jest.fn().mockResolvedValue(true),
  };
  const integrations = { listCapabilityAdapters: jest.fn().mockResolvedValue(sources) };
  const service = new OrderBuyerDataRetentionService(
    repository as unknown as OrderRecordRepositoryPort,
    integrations as unknown as IIntegrationsService,
  );
  return { service, repository, integrations };
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
});
