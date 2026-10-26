/**
 * Inventory Movements Controller Unit Tests (#3565)
 *
 * HTTP-shape concerns: filter mapping, `withTotal=false` omitting the total (never
 * reporting 0), date serialisation, and query-DTO validation. The SQL is covered
 * by the repository spec and the integration spec.
 *
 * @module apps/api/src/inventory/http
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { IInventoryMovementService, InventoryHistoryRow } from '@openlinker/core/inventory';
import { InventoryMovementsController } from './inventory-movements.controller';
import type { IUserManagementService } from '../../users/user-management.service.interface';
import { ListInventoryMovementsQueryDto } from './dto/list-inventory-movements-query.dto';

const row = (overrides: Partial<InventoryHistoryRow> = {}): InventoryHistoryRow => ({
  kind: 'movement',
  id: 'm1',
  productId: 'p1',
  productVariantId: 'v1',
  sku: 'SKU-1',
  productName: 'Widget',
  locationId: null,
  sourceConnectionId: 'c1',
  reason: 'sale',
  status: 'applied',
  quantityDelta: -2,
  quantityBefore: 5,
  quantityAfter: 3,
  sourceKind: 'order',
  sourceRef: 'ol_order_1',
  operatorReason: null,
  note: null,
  actorUserId: null,
  refusalReason: null,
  refusalDetail: null,
  occurredAt: new Date('2026-01-01T10:00:00.000Z'),
  ...overrides,
});

const parse = (plain: Record<string, unknown>): ListInventoryMovementsQueryDto =>
  plainToInstance(ListInventoryMovementsQueryDto, plain);

describe('InventoryMovementsController', () => {
  let service: jest.Mocked<IInventoryMovementService>;
  let users: jest.Mocked<IUserManagementService>;
  let controller: InventoryMovementsController;

  beforeEach(() => {
    service = {
      listMovements: jest.fn().mockResolvedValue([row()]),
      countMovements: jest.fn().mockResolvedValue(1),
      pruneOlderThan: jest.fn(),
    } as unknown as jest.Mocked<IInventoryMovementService>;
    users = {
      getDisplayNames: jest.fn().mockResolvedValue(new Map([['u1', 'Anna Wisniewska']])),
    } as unknown as jest.Mocked<IUserManagementService>;
    controller = new InventoryMovementsController(service, users);
  });

  describe('listMovements', () => {
    it('should return the rows with an ISO timestamp and the total', async () => {
      const result = await controller.listMovements(parse({}));

      expect(result.items[0]).toMatchObject({
        id: 'm1',
        reason: 'sale',
        quantityDelta: -2,
        occurredAt: '2026-01-01T10:00:00.000Z',
      });
      expect(result).toMatchObject({ total: 1, limit: 20, offset: 0 });
    });

    it('should resolve actor names in one batched read and never expose an email', async () => {
      service.listMovements.mockResolvedValue([
        row({ id: 'a', reason: 'manual_correction', actorUserId: 'u1' }),
        row({ id: 'b', reason: 'manual_correction', actorUserId: 'u1' }),
        row({ id: 'c', reason: 'manual_correction', actorUserId: 'gone' }),
        row({ id: 'd' }),
      ]);

      const result = await controller.listMovements(parse({}));

      expect(users.getDisplayNames).toHaveBeenCalledTimes(1);
      expect(users.getDisplayNames).toHaveBeenCalledWith(['u1', 'u1', 'gone']);
      expect(result.items.map((i) => i.actorName)).toEqual(['Anna Wisniewska', 'Anna Wisniewska', null, null]);
      expect(JSON.stringify(result)).not.toContain('@');
    });

    it('should not read users when no row has an actor', async () => {
      await controller.listMovements(parse({}));

      expect(users.getDisplayNames).not.toHaveBeenCalled();
    });

    it('should map query filters, converting dates', async () => {
      await controller.listMovements(
        parse({
          productVariantId: 'v1',
          reasons: 'sale,return_restock',
          from: '2026-01-01T00:00:00.000Z',
          kind: 'movements',
          needsAttention: 'true',
          search: 'wid',
          limit: '10',
          offset: '30',
        })
      );

      expect(service.listMovements).toHaveBeenCalledWith(
        expect.objectContaining({
          productVariantId: 'v1',
          reasons: ['sale', 'return_restock'],
          from: new Date('2026-01-01T00:00:00.000Z'),
          kind: 'movements',
          needsAttention: true,
          search: 'wid',
        }),
        { limit: 10, offset: 30 }
      );
    });

    it('should omit the total entirely, and skip the count, when withTotal=false', async () => {
      const result = await controller.listMovements(parse({ withTotal: 'false' }));

      expect(result).not.toHaveProperty('total');
      expect(service.countMovements).not.toHaveBeenCalled();
    });
  });

  describe('countMovements', () => {
    it('should answer the total for the same filters', async () => {
      await expect(controller.countMovements(parse({ productId: 'p1' }))).resolves.toEqual({
        total: 1,
      });
      expect(service.countMovements).toHaveBeenCalledWith(
        expect.objectContaining({ productId: 'p1' })
      );
    });
  });

  describe('query validation', () => {
    it('should accept an empty query', async () => {
      await expect(validate(parse({}))).resolves.toHaveLength(0);
    });

    it.each([
      ['an unknown reason', { reasons: 'sale,teleport' }],
      ['an unknown kind', { kind: 'everything' }],
      ['a malformed date', { from: 'yesterday' }],
      ['a page size above 100', { limit: '500' }],
      ['a negative offset', { offset: '-1' }],
      ['a stray withTotal value', { withTotal: 'maybe' }],
      ['a non-boolean needsAttention', { needsAttention: 'sometimes' }],
    ])('should reject %s', async (_label, plain) => {
      const errors = await validate(parse(plain));

      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
