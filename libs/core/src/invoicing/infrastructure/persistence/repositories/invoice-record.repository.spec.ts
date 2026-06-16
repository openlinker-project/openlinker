/**
 * InvoiceRecordRepository — unit tests
 *
 * Mocks the TypeORM repository; asserts ORM↔domain mapping, the dedup
 * unique-violation → `DuplicateInvoiceRecordException` conversion, and the
 * not-found throw on the update path.
 *
 * @module libs/core/src/invoicing/infrastructure/persistence/repositories
 */
import type { Repository } from 'typeorm';
import { QueryFailedError } from 'typeorm';

import { InvoiceRecordRepository } from './invoice-record.repository';
import { InvoiceRecordOrmEntity } from '../entities/invoice-record.orm-entity';
import { DuplicateInvoiceRecordException } from '../../../domain/exceptions/duplicate-invoice-record.exception';
import { InvoiceRecordNotFoundException } from '../../../domain/exceptions/invoice-record-not-found.exception';
import type { CreateInvoiceRecordInput } from '../../../domain/types/invoicing.types';

function ormRow(overrides: Partial<InvoiceRecordOrmEntity> = {}): InvoiceRecordOrmEntity {
  const now = new Date('2026-06-16T00:00:00.000Z');
  const entity = new InvoiceRecordOrmEntity();
  Object.assign(
    entity,
    {
      id: 'ol_invoice_1',
      connectionId: 'conn_1',
      orderId: 'ol_order_1',
      providerType: 'subiekt',
      documentType: 'invoice',
      status: 'pending',
      providerInvoiceId: null,
      providerInvoiceNumber: null,
      regulatoryStatus: 'not-applicable',
      clearanceReference: null,
      idempotencyKey: 'idem-1',
      pdfUrl: null,
      issuedAt: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    },
    overrides,
  );
  return entity;
}

const createInput: CreateInvoiceRecordInput = {
  connectionId: 'conn_1',
  orderId: 'ol_order_1',
  providerType: 'subiekt',
  documentType: 'invoice',
  status: 'pending',
  idempotencyKey: 'idem-1',
};

describe('InvoiceRecordRepository', () => {
  let ormRepo: jest.Mocked<Repository<InvoiceRecordOrmEntity>>;
  let repository: InvoiceRecordRepository;

  beforeEach(() => {
    ormRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<InvoiceRecordOrmEntity>>;
    repository = new InvoiceRecordRepository(ormRepo);
  });

  describe('create', () => {
    it('persists and maps to a domain entity', async () => {
      ormRepo.save.mockResolvedValue(ormRow());

      const result = await repository.create(createInput);

      expect(ormRepo.save).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('ol_invoice_1');
      expect(result.documentType).toBe('invoice');
      expect(result.regulatoryStatus).toBe('not-applicable');
      expect(result.isIssued).toBe(false);
    });

    it('converts a unique-violation into DuplicateInvoiceRecordException', async () => {
      ormRepo.save.mockRejectedValue(
        new QueryFailedError(
          '',
          undefined,
          new Error('duplicate key value violates unique constraint "UQ_invoice_records_connection_idempotency"'),
        ),
      );

      await expect(repository.create(createInput)).rejects.toBeInstanceOf(
        DuplicateInvoiceRecordException,
      );
    });

    it('rethrows non-duplicate query failures unchanged', async () => {
      const other = new QueryFailedError('', undefined, new Error('connection reset'));
      ormRepo.save.mockRejectedValue(other);

      await expect(repository.create(createInput)).rejects.toBe(other);
    });
  });

  describe('findByOrderId', () => {
    it('scopes the lookup by order + connection', async () => {
      ormRepo.findOne.mockResolvedValue(ormRow());

      const result = await repository.findByOrderId('ol_order_1', 'conn_1');

      expect(ormRepo.findOne).toHaveBeenCalledWith({
        where: { orderId: 'ol_order_1', connectionId: 'conn_1' },
      });
      expect(result?.orderId).toBe('ol_order_1');
    });

    it('returns null when absent', async () => {
      ormRepo.findOne.mockResolvedValue(null);
      expect(await repository.findByOrderId('missing', 'conn_1')).toBeNull();
    });
  });

  describe('findByIdempotencyKey', () => {
    it('reads the dedup gate by connection + key', async () => {
      ormRepo.findOne.mockResolvedValue(ormRow());
      await repository.findByIdempotencyKey('conn_1', 'idem-1');
      expect(ormRepo.findOne).toHaveBeenCalledWith({
        where: { connectionId: 'conn_1', idempotencyKey: 'idem-1' },
      });
    });
  });

  describe('updateOutcome', () => {
    it('applies the patch and maps the result', async () => {
      ormRepo.findOne.mockResolvedValue(ormRow());
      ormRepo.save.mockResolvedValue(
        ormRow({ status: 'issued', providerInvoiceId: 'FV/2026/01', issuedAt: new Date() }),
      );

      const result = await repository.updateOutcome('ol_invoice_1', {
        status: 'issued',
        providerInvoiceId: 'FV/2026/01',
      });

      expect(result.status).toBe('issued');
      expect(result.providerInvoiceId).toBe('FV/2026/01');
    });

    it('throws InvoiceRecordNotFoundException when the row is absent', async () => {
      ormRepo.findOne.mockResolvedValue(null);
      await expect(
        repository.updateOutcome('missing', { status: 'failed' }),
      ).rejects.toBeInstanceOf(InvoiceRecordNotFoundException);
    });
  });
});
