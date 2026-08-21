/**
 * Catalog Trust Controller Tests (#2258)
 *
 * @module apps/api/src/catalog-trust/http
 */
import { NotFoundException } from '@nestjs/common';
import { CatalogTrustController } from './catalog-trust.controller';
import type { ICatalogTrustService } from '@openlinker/core/catalog-trust';

describe('CatalogTrustController', () => {
  let service: jest.Mocked<ICatalogTrustService>;
  let controller: CatalogTrustController;

  beforeEach(() => {
    service = { getConnectionCatalogTrust: jest.fn() };
    controller = new CatalogTrustController(service);
  });

  it('should project the trust facts field-by-field with ISO dates', async () => {
    service.getConnectionCatalogTrust.mockResolvedValue({
      connectionId: 'conn-1',
      rung: 'modified-since',
      deltaPassEnabled: false,
      lastReconcileCompletedAt: new Date('2026-08-20T12:00:00.000Z'),
      reconcileCycleOpen: true,
    });

    const dto = await controller.getCatalogTrust('conn-1');

    expect(dto).toEqual({
      connectionId: 'conn-1',
      rung: 'modified-since',
      deltaPassEnabled: false,
      lastReconcileCompletedAt: '2026-08-20T12:00:00.000Z',
      reconcileCycleOpen: true,
    });
  });

  it('should serialize a never-completed reconcile as null, not a zero date', async () => {
    service.getConnectionCatalogTrust.mockResolvedValue({
      connectionId: 'conn-1',
      rung: 'full-enumeration',
      deltaPassEnabled: false,
      lastReconcileCompletedAt: null,
      reconcileCycleOpen: false,
    });

    const dto = await controller.getCatalogTrust('conn-1');

    expect(dto.lastReconcileCompletedAt).toBeNull();
  });

  it('should return 404 when the read is not applicable (missing connection or no ProductMaster)', async () => {
    service.getConnectionCatalogTrust.mockResolvedValue(null);

    await expect(controller.getCatalogTrust('conn-x')).rejects.toThrow(NotFoundException);
  });
});
