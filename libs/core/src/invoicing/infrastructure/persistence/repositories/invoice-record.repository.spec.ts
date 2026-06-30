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
import { InvoiceRecord } from '../../../domain/entities/invoice-record.entity';
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
      hasBuyerTaxId: false,
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

  let qb: {
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    skip: jest.Mock;
    take: jest.Mock;
    getManyAndCount: jest.Mock;
  };

  beforeEach(() => {
    qb = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    ormRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      // `create` hydrates a RETURNING raw row into an entity (#1200 claimForIssue);
      // the real impl copies fields, so a pass-through is faithful enough here.
      create: jest.fn((raw) => raw as InvoiceRecordOrmEntity),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
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

    it('maps the W1 failureCode/failureReason from a failed-create input onto the ORM row', async () => {
      ormRepo.save.mockImplementation((e) => Promise.resolve(e as InvoiceRecordOrmEntity));

      await repository.create({
        ...createInput,
        status: 'failed',
        failureMode: 'rejected',
        failureCode: 'buyer-tax-id-invalid',
        failureReason: 'The buyer tax identifier was rejected as invalid.',
      });

      const saved = ormRepo.save.mock.calls[0][0] as InvoiceRecordOrmEntity;
      expect(saved.failureCode).toBe('buyer-tax-id-invalid');
      expect(saved.failureReason).toBe('The buyer tax identifier was rejected as invalid.');
    });

    it('defaults the W1 failureCode/failureReason to null on a pending create', async () => {
      ormRepo.save.mockImplementation((e) => Promise.resolve(e as InvoiceRecordOrmEntity));

      await repository.create(createInput);

      const saved = ormRepo.save.mock.calls[0][0] as InvoiceRecordOrmEntity;
      expect(saved.failureCode).toBeNull();
      expect(saved.failureReason).toBeNull();
    });

    it('should persist hasBuyerTaxId=true and map it back when the input carries the flag (#1202)', async () => {
      let savedEntity: InvoiceRecordOrmEntity | undefined;
      ormRepo.save.mockImplementation((entity) => {
        savedEntity = entity as InvoiceRecordOrmEntity;
        return Promise.resolve(ormRow({ hasBuyerTaxId: savedEntity.hasBuyerTaxId }));
      });

      const result = await repository.create({ ...createInput, hasBuyerTaxId: true });

      expect(savedEntity?.hasBuyerTaxId).toBe(true);
      expect(result.hasBuyerTaxId).toBe(true);
    });

    it('should default hasBuyerTaxId to false when the input omits the flag (#1202)', async () => {
      let savedEntity: InvoiceRecordOrmEntity | undefined;
      ormRepo.save.mockImplementation((entity) => {
        savedEntity = entity as InvoiceRecordOrmEntity;
        return Promise.resolve(ormRow({ hasBuyerTaxId: savedEntity.hasBuyerTaxId }));
      });

      const result = await repository.create(createInput);

      expect(savedEntity?.hasBuyerTaxId).toBe(false);
      expect(result.hasBuyerTaxId).toBe(false);
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

    it('round-trips the issued-document content snapshot', async () => {
      const content = {
        seller: null,
        buyer: {
          name: 'Jan',
          taxId: null,
          address: { line1: 'a', line2: null, city: 'c', postalCode: 'p', countryIso2: 'PL' },
        },
        lines: [{ name: 'Widget', quantity: 1, unitNet: 100, taxRate: '23', net: 100, tax: 23, gross: 123 }],
        taxBreakdown: [{ rate: '23', net: 100, tax: 23, gross: 123 }],
        totals: { net: 100, tax: 23, gross: 123 },
        currency: 'PLN',
        issueDate: null,
        saleDate: null,
        payment: null,
      };
      ormRepo.save.mockImplementation((entity) =>
        Promise.resolve(ormRow({ documentContent: (entity as InvoiceRecordOrmEntity).documentContent })),
      );

      const result = await repository.create({ ...createInput, documentContent: content });

      expect(result.documentContent).toEqual(content);
    });

    it('round-trips the persisted source document blob', async () => {
      const sourceDocument = {
        contentType: 'application/xml',
        contentBase64: 'PERvY3VtZW50PmZha2U8L0RvY3VtZW50Pg==',
      };
      ormRepo.save.mockImplementation((entity) =>
        Promise.resolve(ormRow({ sourceDocument: (entity as InvoiceRecordOrmEntity).sourceDocument })),
      );

      const result = await repository.create({ ...createInput, sourceDocument });

      expect(result.sourceDocument).toEqual(sourceDocument);
    });
  });

  describe('findById', () => {
    it('maps the documentContent column to the domain entity', async () => {
      const content = {
        seller: null,
        buyer: {
          name: 'Jan',
          taxId: null,
          address: { line1: 'a', line2: null, city: 'c', postalCode: 'p', countryIso2: 'PL' },
        },
        lines: [],
        taxBreakdown: [],
        totals: { net: 0, tax: 0, gross: 0 },
        currency: 'PLN',
        issueDate: null,
        saleDate: null,
        payment: null,
      };
      ormRepo.findOne.mockResolvedValue(ormRow({ documentContent: content }));

      const result = await repository.findById('ol_invoice_1');

      expect(ormRepo.findOne).toHaveBeenCalledWith({ where: { id: 'ol_invoice_1' } });
      expect(result?.documentContent).toEqual(content);
    });

    it('returns null when absent', async () => {
      ormRepo.findOne.mockResolvedValue(null);
      expect(await repository.findById('missing')).toBeNull();
    });
  });

  describe('findByOrderId', () => {
    it('scopes the lookup by order + connection', async () => {
      ormRepo.findOne.mockResolvedValue(ormRow());

      const result = await repository.findByOrderId('ol_order_1', 'conn_1');

      expect(ormRepo.findOne).toHaveBeenCalledWith({
        where: { orderId: 'ol_order_1', connectionId: 'conn_1' },
        order: { createdAt: 'DESC' },
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

    it('backfills providerType and documentType from the patch onto the persisted row', async () => {
      // The pending row was created with providerType '' and documentType '';
      // a success patch carries the adapter's authoritative values.
      ormRepo.findOne.mockResolvedValue(ormRow({ providerType: '', documentType: '' }));
      ormRepo.save.mockImplementation((e) => Promise.resolve(e as InvoiceRecordOrmEntity));

      const result = await repository.updateOutcome('ol_invoice_1', {
        status: 'issued',
        providerType: 'subiekt',
        documentType: 'invoice',
      });

      const saved = ormRepo.save.mock.calls[0][0] as InvoiceRecordOrmEntity;
      expect(saved.providerType).toBe('subiekt');
      expect(saved.documentType).toBe('invoice');
      expect(result.providerType).toBe('subiekt');
      expect(result.documentType).toBe('invoice');
    });

    it('throws InvoiceRecordNotFoundException when the row is absent', async () => {
      ormRepo.findOne.mockResolvedValue(null);
      await expect(
        repository.updateOutcome('missing', { status: 'failed' }),
      ).rejects.toBeInstanceOf(InvoiceRecordNotFoundException);
    });

    it('persists the #1200 failureMode + lease fields and the W1 failureCode/failureReason when patched', async () => {
      ormRepo.findOne.mockResolvedValue(ormRow({ status: 'issuing' }));
      ormRepo.save.mockImplementation((e) => Promise.resolve(e as InvoiceRecordOrmEntity));

      const result = await repository.updateOutcome('ol_invoice_1', {
        status: 'failed',
        failureMode: 'in-doubt',
        failureCode: 'transport-timeout',
        failureReason: 'The invoicing request timed out.',
        leaseExpiresAt: null,
      });

      const saved = ormRepo.save.mock.calls[0][0] as InvoiceRecordOrmEntity;
      expect(saved.failureMode).toBe('in-doubt');
      expect(saved.failureCode).toBe('transport-timeout');
      expect(saved.failureReason).toBe('The invoicing request timed out.');
      expect(saved.leaseExpiresAt).toBeNull();
      expect(result.failureMode).toBe('in-doubt');
      expect(result.failureCode).toBe('transport-timeout');
      expect(result.failureReason).toBe('The invoicing request timed out.');
    });
  });

  describe('claimForIssue (#1200 CAS)', () => {
    let updateQb: {
      update: jest.Mock;
      set: jest.Mock;
      where: jest.Mock;
      andWhere: jest.Mock;
      returning: jest.Mock;
      execute: jest.Mock;
    };

    beforeEach(() => {
      updateQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        returning: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      };
      ormRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(updateQb) as unknown as typeof ormRepo.createQueryBuilder;
    });

    it('returns the claimed (issuing) record from the RETURNING row on a winning CAS (affected > 0)', async () => {
      const lease = new Date('2026-06-25T12:05:00.000Z');
      // Single-statement win: the row comes back via RETURNING (`raw`), NOT a
      // follow-up read — closes the won-but-stale-re-read race (#1200).
      updateQb.execute.mockResolvedValue({
        affected: 1,
        raw: [ormRow({ status: 'issuing', leaseExpiresAt: lease })],
      });

      const result = await repository.claimForIssue('ol_invoice_1', lease);

      expect(updateQb.set).toHaveBeenCalledWith({ status: 'issuing', leaseExpiresAt: lease });
      expect(updateQb.returning).toHaveBeenCalledWith('*');
      // Fiscal guard at the persistence boundary (#1200): the claim predicate
      // must only re-claim a TERMINAL-`rejected` failed row — never an in-doubt
      // one — so an in-doubt failure can never be re-issued even via a direct
      // claimForIssue call that bypasses the service gate.
      const claimSql = (updateQb.andWhere.mock.calls as unknown[][])[0][0] as string;
      expect(claimSql).toContain(`"failureMode" = 'rejected'`);
      expect(claimSql).not.toMatch(/status IN \('pending', 'failed'\)/);
      // No separate re-read on the happy path.
      expect(ormRepo.findOne).not.toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result?.status).toBe('issuing');
    });

    it('falls back to a re-read when a win returns no RETURNING row, and NEVER downgrades a win to null', async () => {
      // Driver that does not honour RETURNING: affected > 0 but empty raw. A WON
      // claim must resolve to the row, never to a (false) contended-loss null.
      updateQb.execute.mockResolvedValue({ affected: 1, raw: [] });
      ormRepo.findOne.mockResolvedValue(ormRow({ status: 'issuing' }));

      const result = await repository.claimForIssue('ol_invoice_1', new Date());

      expect(result).not.toBeNull();
      expect(result?.status).toBe('issuing');
    });

    it('throws (does NOT return null) when a win cannot be read back at all', async () => {
      // affected > 0 (we provably hold the lease) but the row is unreadable: fail
      // loud rather than silently report a loss that would orphan the held row.
      updateQb.execute.mockResolvedValue({ affected: 1, raw: [] });
      ormRepo.findOne.mockResolvedValue(null);

      await expect(repository.claimForIssue('ol_invoice_1', new Date())).rejects.toBeInstanceOf(
        InvoiceRecordNotFoundException,
      );
    });

    it('returns null on a LOST CAS (affected 0) when the row still exists', async () => {
      updateQb.execute.mockResolvedValue({ affected: 0, raw: [] });
      // Existence disambiguation read finds the (contended) row.
      ormRepo.findOne.mockResolvedValue(ormRow({ status: 'issuing' }));

      const result = await repository.claimForIssue('ol_invoice_1', new Date());

      expect(result).toBeNull();
    });

    it('throws InvoiceRecordNotFoundException when affected 0 and the row is absent', async () => {
      updateQb.execute.mockResolvedValue({ affected: 0, raw: [] });
      ormRepo.findOne.mockResolvedValue(null);

      await expect(repository.claimForIssue('missing', new Date())).rejects.toBeInstanceOf(
        InvoiceRecordNotFoundException,
      );
    });
  });

  describe('findMany', () => {
    const PAGE = { limit: 20, offset: 0 };

    it('applies no filters when none are present', async () => {
      await repository.findMany({}, PAGE);
      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('applies status filter via andWhere', async () => {
      await repository.findMany({ status: 'issued' }, PAGE);
      expect(qb.andWhere).toHaveBeenCalledWith('inv.status = :status', { status: 'issued' });
    });

    it('applies connectionId filter via andWhere', async () => {
      await repository.findMany({ connectionId: 'conn_1' }, PAGE);
      expect(qb.andWhere).toHaveBeenCalledWith('inv.connectionId = :connectionId', {
        connectionId: 'conn_1',
      });
    });

    it('applies regulatoryStatus filter via andWhere', async () => {
      await repository.findMany({ regulatoryStatus: 'cleared' }, PAGE);
      expect(qb.andWhere).toHaveBeenCalledWith('inv.regulatoryStatus = :regulatoryStatus', {
        regulatoryStatus: 'cleared',
      });
    });

    it('applies issuedFrom/issuedTo range against inv.issuedAt', async () => {
      const from = new Date('2026-06-01T00:00:00.000Z');
      const to = new Date('2026-06-30T00:00:00.000Z');
      await repository.findMany({ issuedFrom: from, issuedTo: to }, PAGE);
      expect(qb.andWhere).toHaveBeenCalledWith('inv.issuedAt >= :issuedFrom', { issuedFrom: from });
      expect(qb.andWhere).toHaveBeenCalledWith('inv.issuedAt <= :issuedTo', { issuedTo: to });
    });

    it('should filter by hasBuyerTaxId = true when taxId=with is provided (#1202)', async () => {
      await repository.findMany({ taxId: 'with' }, PAGE);
      expect(qb.andWhere).toHaveBeenCalledWith('inv.hasBuyerTaxId = :hasBuyerTaxId', {
        hasBuyerTaxId: true,
      });
    });

    it('should filter by hasBuyerTaxId = false when taxId=without is provided (#1202)', async () => {
      await repository.findMany({ taxId: 'without' }, PAGE);
      expect(qb.andWhere).toHaveBeenCalledWith('inv.hasBuyerTaxId = :hasBuyerTaxId', {
        hasBuyerTaxId: false,
      });
    });

    it('orders by inv.createdAt DESC and applies skip/take from pagination', async () => {
      await repository.findMany({}, { limit: 25, offset: 50 });
      expect(qb.orderBy).toHaveBeenCalledWith('inv.createdAt', 'DESC');
      expect(qb.skip).toHaveBeenCalledWith(50);
      expect(qb.take).toHaveBeenCalledWith(25);
    });

    it('returns { items, total } from getManyAndCount mapped via toDomain', async () => {
      qb.getManyAndCount.mockResolvedValue([[ormRow(), ormRow({ id: 'ol_invoice_2' })], 7]);
      const result = await repository.findMany({}, PAGE);
      expect(result.total).toBe(7);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toBeInstanceOf(InvoiceRecord);
      expect(result.items[1].id).toBe('ol_invoice_2');
    });
  });
});
