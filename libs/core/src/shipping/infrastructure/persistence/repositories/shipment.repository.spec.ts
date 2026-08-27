/**
 * Shipment Repository — Unit Tests
 *
 * Mocks the TypeORM repository; no Docker. Verifies CRUD, append-only
 * order multiplicity, active-shipment lookup, ID-format invariant
 * (`ol_shipment_*`), partial-patch update semantics, and not-found
 * exception handling.
 *
 * @module libs/core/src/shipping/infrastructure/persistence/repositories
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, IsNull, Not, type Repository, type UpdateResult } from 'typeorm';

import { ShipmentNotFoundException } from '../../../domain/exceptions/shipment-not-found.exception';
import { TerminalShipmentStatusValues } from '../../../domain/types/shipment-status.types';
import { ShipmentOrmEntity } from '../entities/shipment.orm-entity';
import { ShipmentRepository } from './shipment.repository';

describe('ShipmentRepository', () => {
  let repository: ShipmentRepository;
  let ormRepository: jest.Mocked<Repository<ShipmentOrmEntity>>;

  const now = new Date('2026-05-19T10:00:00Z');

  const buildOrm = (overrides: Partial<ShipmentOrmEntity> = {}): ShipmentOrmEntity => ({
    id: 'ol_shipment_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    orderId: 'ol_order_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    connectionId: '00000000-0000-0000-0000-000000000001',
    direction: 'outbound',
    shippingMethod: 'paczkomat',
    deliveryIntent: 'pickup_point',
    status: 'draft',
    providerShipmentId: null,
    paczkomatId: 'POZ08A',
    sourceDeliveryMethodId: null,
    trackingNumber: null,
    carrier: null,
    labelPdfRef: null,
    dispatchedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    failedAt: null,
    errorMessage: null,
    providerCode: null,
    waybillRelayedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  const buildUpdateResult = (affected: number): UpdateResult =>
    ({ affected, raw: [], generatedMaps: [] }) as UpdateResult;

  beforeEach(async () => {
    const mockOrmRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<Repository<ShipmentOrmEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShipmentRepository,
        {
          provide: getRepositoryToken(ShipmentOrmEntity),
          useValue: mockOrmRepo,
        },
      ],
    }).compile();

    repository = module.get<ShipmentRepository>(ShipmentRepository);
    ormRepository = module.get(getRepositoryToken(ShipmentOrmEntity));
  });

  describe('create', () => {
    it('should persist a draft shipment with an ol_shipment_* identifier', async () => {
      ormRepository.save.mockImplementation((entity) =>
        Promise.resolve(entity as ShipmentOrmEntity),
      );

      const result = await repository.create({
        orderId: 'ol_order_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        connectionId: '00000000-0000-0000-0000-000000000001',
        shippingMethod: 'paczkomat',
        paczkomatId: 'POZ08A',
      });

      expect(result.id).toMatch(/^ol_shipment_[a-f0-9]{32}$/);
      expect(result.status).toBe('draft');
      expect(result.shippingMethod).toBe('paczkomat');
      expect(result.paczkomatId).toBe('POZ08A');
      expect(result.providerShipmentId).toBeNull();
      expect(result.trackingNumber).toBeNull();
      expect(result.labelPdfRef).toBeNull();
      expect(result.dispatchedAt).toBeNull();
      expect(result.deliveredAt).toBeNull();
      expect(result.cancelledAt).toBeNull();
      expect(result.failedAt).toBeNull();
      expect(result.errorMessage).toBeNull();
      expect(ormRepository.save).toHaveBeenCalledTimes(1);
    });

    it('should default paczkomatId to null for a kurier shipment', async () => {
      ormRepository.save.mockImplementation((entity) =>
        Promise.resolve(entity as ShipmentOrmEntity),
      );

      const result = await repository.create({
        orderId: 'ol_order_x',
        connectionId: '00000000-0000-0000-0000-000000000001',
        shippingMethod: 'kurier',
      });

      expect(result.shippingMethod).toBe('kurier');
      expect(result.paczkomatId).toBeNull();
    });

    it('should support the branch-1 atomic-terminal mode (#834) — initialStatus + terminal timestamps + trackingNumber at create time', async () => {
      ormRepository.save.mockImplementation((entity) =>
        Promise.resolve(entity as ShipmentOrmEntity),
      );
      const deliveredAt = new Date('2026-05-28T12:00:00.000Z');

      const result = await repository.create({
        orderId: 'ol_order_b1',
        connectionId: '00000000-0000-0000-0000-000000000001',
        shippingMethod: 'omp',
        initialStatus: 'delivered',
        trackingNumber: 'PS-TRK-9',
        deliveredAt,
      });

      expect(result.status).toBe('delivered');
      expect(result.providerShipmentId).toBeNull();
      expect(result.trackingNumber).toBe('PS-TRK-9');
      expect(result.deliveredAt).toEqual(deliveredAt);
      expect(result.dispatchedAt).toBeNull();
      expect(result.cancelledAt).toBeNull();
    });
  });

  describe('findById', () => {
    it('should return the domain entity when the row exists', async () => {
      ormRepository.findOne.mockResolvedValue(buildOrm());

      const result = await repository.findById('ol_shipment_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('ol_shipment_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'ol_shipment_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      });
    });

    it('should return null when the row does not exist', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      const result = await repository.findById('ol_shipment_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz');

      expect(result).toBeNull();
    });
  });

  describe('findByOrderId', () => {
    it('should return an empty array when the order has no shipments', async () => {
      ormRepository.find.mockResolvedValue([]);

      const result = await repository.findByOrderId('ol_order_none', 'outbound');

      expect(result).toEqual([]);
    });

    it('should return a single shipment when there is only one', async () => {
      ormRepository.find.mockResolvedValue([buildOrm()]);

      const result = await repository.findByOrderId('ol_order_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'outbound');

      expect(result).toHaveLength(1);
      expect(ormRepository.find).toHaveBeenCalledWith({
        where: { orderId: 'ol_order_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', direction: 'outbound' },
        order: { createdAt: 'ASC' },
      });
    });

    it('should return multiple shipments preserving the cancel + re-issue ordering (ASC by createdAt)', async () => {
      const earlier = new Date('2026-05-19T09:00:00Z');
      const later = new Date('2026-05-19T11:00:00Z');
      const cancelled = buildOrm({
        id: 'ol_shipment_11111111111111111111111111111111',
        status: 'cancelled',
        cancelledAt: earlier,
        createdAt: earlier,
        updatedAt: earlier,
      });
      const reissued = buildOrm({
        id: 'ol_shipment_22222222222222222222222222222222',
        status: 'draft',
        paczkomatId: 'POZ12B',
        createdAt: later,
        updatedAt: later,
      });
      ormRepository.find.mockResolvedValue([cancelled, reissued]);

      const result = await repository.findByOrderId('ol_order_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'outbound');

      expect(result).toHaveLength(2);
      expect(result[0]?.status).toBe('cancelled');
      expect(result[0]?.paczkomatId).toBe('POZ08A');
      expect(result[1]?.status).toBe('draft');
      expect(result[1]?.paczkomatId).toBe('POZ12B');
    });
  });

  describe('direction (#2373)', () => {
    it('should default an unstated direction to outbound on create', async () => {
      ormRepository.save.mockImplementation((e) => Promise.resolve(e as ShipmentOrmEntity));

      const result = await repository.create({
        orderId: 'ol_order_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        connectionId: '00000000-0000-0000-0000-000000000001',
        shippingMethod: 'kurier',
      });

      // The ONE application-side default — the DB column carries none, so this
      // is what keeps every pre-#2373 caller byte-for-byte unchanged.
      expect(result.direction).toBe('outbound');
    });

    it('should persist an explicitly requested return direction', async () => {
      ormRepository.save.mockImplementation((e) => Promise.resolve(e as ShipmentOrmEntity));

      const result = await repository.create({
        orderId: 'ol_order_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        connectionId: '00000000-0000-0000-0000-000000000001',
        direction: 'return',
        shippingMethod: 'kurier',
      });

      expect(result.direction).toBe('return');
    });

    it('should apply the direction filter on findMany, and omit it when unset', async () => {
      ormRepository.findAndCount.mockResolvedValue([[buildOrm()], 1]);

      await repository.findMany({ direction: 'return' }, { limit: 10, offset: 0 });
      expect(ormRepository.findAndCount.mock.calls[0][0]?.where).toMatchObject({
        direction: 'return',
      });

      await repository.findMany({}, { limit: 10, offset: 0 });
      // Deliberately absent rather than defaulted: the operator-facing
      // `/shipments` list must show both cohorts unless asked otherwise.
      expect(ormRepository.findAndCount.mock.calls[1][0]?.where).not.toHaveProperty('direction');
    });
  });

  describe('findActiveByOrderId', () => {
    it('should query with the terminal-status filter and most-recent ordering, then return the row', async () => {
      ormRepository.findOne.mockResolvedValue(buildOrm({ status: 'generated' }));

      const result = await repository.findActiveByOrderId(
        'ol_order_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'outbound',
      );

      expect(result?.status).toBe('generated');
      // Pin the full query shape — both the WHERE clause (orderId + status
      // filter that excludes every terminal value) and the ordering. A
      // regression that drops the status filter would change the WHERE
      // shape and fail this assertion.
      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: {
          orderId: 'ol_order_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          direction: 'outbound',
          status: Not(In([...TerminalShipmentStatusValues])),
        },
        order: { createdAt: 'DESC' },
      });
    });

    it('should return null when the query returns no rows (no shipments, or every shipment terminal)', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      const result = await repository.findActiveByOrderId('ol_order_none', 'outbound');

      expect(result).toBeNull();
    });
  });

  describe('findByProviderShipmentId', () => {
    it('should return the domain entity when found', async () => {
      ormRepository.findOne.mockResolvedValue(buildOrm({ providerShipmentId: 'INPOST-123' }));

      const result = await repository.findByProviderShipmentId('INPOST-123');

      expect(result?.providerShipmentId).toBe('INPOST-123');
    });

    it('should return null when not found', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByProviderShipmentId('UNKNOWN');

      expect(result).toBeNull();
    });
  });

  describe('findBranchOneByOrderAndConnection (#834)', () => {
    it('should match the partial-unique-index predicate', async () => {
      ormRepository.findOne.mockResolvedValue(
        buildOrm({ providerShipmentId: null, shippingMethod: 'omp', status: 'dispatched' }),
      );

      const result = await repository.findBranchOneByOrderAndConnection(
        'ol_order_b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1',
        '00000000-0000-0000-0000-000000000001',
        'outbound',
      );

      expect(result?.providerShipmentId).toBeNull();
      const args = ormRepository.findOne.mock.calls[0][0];
      expect(args.where).toMatchObject({
        orderId: 'ol_order_b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1',
        connectionId: '00000000-0000-0000-0000-000000000001',
        // #2373: `direction` is part of the widened partial-unique index KEY,
        // so the lookup must carry it or it would match a sibling row the
        // index deliberately permits.
        direction: 'outbound',
      });
      // providerShipmentId is filtered via TypeORM's IsNull() — verify the
      // type-of marker rather than asserting the raw shape.
      const where = args.where as { providerShipmentId: unknown };
      expect(where.providerShipmentId).toBeDefined();
    });

    it('should return null when no branch-1 row exists', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      const result = await repository.findBranchOneByOrderAndConnection(
        'ol_order_none',
        '00000000-0000-0000-0000-000000000001',
        'outbound',
      );

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should apply a partial patch and return the refreshed entity', async () => {
      ormRepository.update.mockResolvedValue(buildUpdateResult(1));
      const generatedAt = new Date('2026-05-19T10:30:00Z');
      ormRepository.findOne.mockResolvedValue(
        buildOrm({
          status: 'generated',
          providerShipmentId: 'INPOST-123',
          trackingNumber: 'TRK456',
          labelPdfRef: 'https://example/label.pdf',
          updatedAt: generatedAt,
        }),
      );

      const result = await repository.update('ol_shipment_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', {
        status: 'generated',
        providerShipmentId: 'INPOST-123',
        trackingNumber: 'TRK456',
        labelPdfRef: 'https://example/label.pdf',
      });

      expect(result.status).toBe('generated');
      expect(result.providerShipmentId).toBe('INPOST-123');
      expect(result.trackingNumber).toBe('TRK456');
      expect(result.labelPdfRef).toBe('https://example/label.pdf');
      // Unspecified fields untouched.
      expect(result.dispatchedAt).toBeNull();
      expect(result.deliveredAt).toBeNull();
      // Only the patched fields hit the ORM update call.
      expect(ormRepository.update).toHaveBeenCalledWith(
        { id: 'ol_shipment_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
        {
          status: 'generated',
          providerShipmentId: 'INPOST-123',
          trackingNumber: 'TRK456',
          labelPdfRef: 'https://example/label.pdf',
        },
      );
    });

    it('should allow clearing errorMessage via explicit null', async () => {
      ormRepository.update.mockResolvedValue(buildUpdateResult(1));
      ormRepository.findOne.mockResolvedValue(buildOrm({ errorMessage: null }));

      await repository.update('ol_shipment_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', {
        errorMessage: null,
      });

      expect(ormRepository.update).toHaveBeenCalledWith(
        { id: 'ol_shipment_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
        { errorMessage: null },
      );
    });

    it('should throw ShipmentNotFoundException when no row matches', async () => {
      ormRepository.update.mockResolvedValue(buildUpdateResult(0));

      await expect(
        repository.update('ol_shipment_missing', { status: 'failed' }),
      ).rejects.toBeInstanceOf(ShipmentNotFoundException);
    });

    it('should throw ShipmentNotFoundException when the row was deleted between update and read', async () => {
      ormRepository.update.mockResolvedValue(buildUpdateResult(1));
      ormRepository.findOne.mockResolvedValue(null);

      await expect(
        repository.update('ol_shipment_raced', { status: 'failed' }),
      ).rejects.toBeInstanceOf(ShipmentNotFoundException);
    });
  });

  describe('waybill-relay claim (#1947)', () => {
    const ID = 'ol_shipment_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const at = new Date('2026-05-19T11:00:00Z');

    it('should claim conditionally on the marker still being NULL', async () => {
      // The `IsNull()` predicate in the WHERE is what makes this atomic under two
      // concurrent triggers (status-sync poll + carrier webhook): exactly one
      // UPDATE can affect the row.
      ormRepository.update.mockResolvedValue(buildUpdateResult(1));

      const won = await repository.claimWaybillRelay(ID, at);

      expect(won).toBe(true);
      expect(ormRepository.update).toHaveBeenCalledWith(
        { id: ID, waybillRelayedAt: IsNull() },
        { waybillRelayedAt: at },
      );
    });

    it('should report the claim lost when another caller already holds it', async () => {
      ormRepository.update.mockResolvedValue(buildUpdateResult(0));

      await expect(repository.claimWaybillRelay(ID, at)).resolves.toBe(false);
    });

    it('should release the claim so a later tick can retry', async () => {
      ormRepository.update.mockResolvedValue(buildUpdateResult(1));

      await repository.releaseWaybillRelay(ID);

      expect(ormRepository.update).toHaveBeenCalledWith({ id: ID }, { waybillRelayedAt: null });
    });
  });

  describe('mapper round-trip', () => {
    it('should preserve every field including nullables', async () => {
      const fullyPopulated = buildOrm({
        providerShipmentId: 'INPOST-999',
        trackingNumber: 'TRK-X',
        carrier: 'inpost',
        labelPdfRef: 'https://example/label.pdf',
        sourceDeliveryMethodId: 'allegro-courier',
        dispatchedAt: new Date('2026-05-20T08:00:00Z'),
        deliveredAt: new Date('2026-05-21T15:00:00Z'),
        cancelledAt: null,
        failedAt: null,
        errorMessage: null,
        providerCode: 'preflight.missing-parcel-template',
        status: 'delivered',
      });
      ormRepository.findOne.mockResolvedValue(fullyPopulated);

      const domain = await repository.findById('ol_shipment_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

      expect(domain).toEqual({
        id: fullyPopulated.id,
        orderId: fullyPopulated.orderId,
        connectionId: fullyPopulated.connectionId,
        shippingMethod: fullyPopulated.shippingMethod,
        deliveryIntent: fullyPopulated.deliveryIntent,
        status: fullyPopulated.status,
        providerShipmentId: fullyPopulated.providerShipmentId,
        paczkomatId: fullyPopulated.paczkomatId,
        sourceDeliveryMethodId: fullyPopulated.sourceDeliveryMethodId,
        trackingNumber: fullyPopulated.trackingNumber,
        carrier: fullyPopulated.carrier,
        labelPdfRef: fullyPopulated.labelPdfRef,
        dispatchedAt: fullyPopulated.dispatchedAt,
        deliveredAt: fullyPopulated.deliveredAt,
        cancelledAt: fullyPopulated.cancelledAt,
        failedAt: fullyPopulated.failedAt,
        errorMessage: fullyPopulated.errorMessage,
        providerCode: fullyPopulated.providerCode,
        waybillRelayedAt: fullyPopulated.waybillRelayedAt,
        direction: fullyPopulated.direction,
        createdAt: fullyPopulated.createdAt,
        updatedAt: fullyPopulated.updatedAt,
      });
    });
  });
});
