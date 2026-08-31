/**
 * FiscalRegistrationRecordRepository - unit tests (#2516)
 *
 * Covers the batched read behind the per-order sales-document projection: one
 * query for a whole page of orders, and no query at all for an empty page.
 *
 * @module libs/core/src/fiscalization/infrastructure/persistence/repositories
 */
import { In } from 'typeorm';
import type { Repository } from 'typeorm';

import { FiscalRegistrationRecordRepository } from './fiscal-registration-record.repository';
import type { FiscalRegistrationRecordOrmEntity } from '../entities/fiscal-registration-record.orm-entity';

function ormRow(
  overrides: Partial<FiscalRegistrationRecordOrmEntity> = {},
): FiscalRegistrationRecordOrmEntity {
  const now = new Date('2026-08-01T08:00:00.000Z');
  return {
    id: 'fis-1',
    connectionId: 'conn-1',
    orderId: 'ol_order_1',
    providerType: 'test-provider',
    idempotencyKey: 'fiscal:conn-1:ol_order_1',
    status: 'registered',
    providerReference: 'prov-1',
    documentReference: 'DOC/1',
    signingIdentity: null,
    registeredAt: now,
    regimeExtras: null,
    artefacts: null,
    failureMode: null,
    failureReason: null,
    errorMessage: null,
    leaseExpiresAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as FiscalRegistrationRecordOrmEntity;
}

describe('FiscalRegistrationRecordRepository', () => {
  let ormRepository: jest.Mocked<Repository<FiscalRegistrationRecordOrmEntity>>;
  let repository: FiscalRegistrationRecordRepository;

  beforeEach(() => {
    ormRepository = {
      find: jest.fn(),
    } as unknown as jest.Mocked<Repository<FiscalRegistrationRecordOrmEntity>>;
    repository = new FiscalRegistrationRecordRepository(ormRepository);
  });

  describe('findAllByOrderIds', () => {
    it('reads nothing for an empty input', async () => {
      await expect(repository.findAllByOrderIds([])).resolves.toEqual([]);
      expect(ormRepository.find).not.toHaveBeenCalled();
    });

    it('issues ONE query for the whole page, newest-first within each order', async () => {
      ormRepository.find.mockResolvedValue([ormRow(), ormRow({ id: 'fis-2', orderId: 'ol_order_2' })]);

      const records = await repository.findAllByOrderIds(['ol_order_1', 'ol_order_2']);

      expect(ormRepository.find).toHaveBeenCalledTimes(1);
      expect(ormRepository.find).toHaveBeenCalledWith({
        where: { orderId: In(['ol_order_1', 'ol_order_2']) },
        order: { orderId: 'ASC', createdAt: 'DESC', id: 'DESC' },
      });
      expect(records.map((record) => record.id)).toEqual(['fis-1', 'fis-2']);
    });
  });
});
