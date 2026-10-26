/**
 * Inventory Correction Controller Unit Tests (#3566)
 *
 * HTTP-shape concerns: the actor comes from the token never the body, the
 * response serialisation, and body validation. The correction rules are covered
 * by the service spec.
 *
 * @module apps/api/src/inventory/http
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type {
  IInventoryCorrectionService,
  InventoryCorrectionResult,
} from '@openlinker/core/inventory';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { InventoryCorrectionController } from './inventory-correction.controller';
import { CorrectStockDto } from './dto/correct-stock.dto';

const user = { id: 'user-1', username: 'op', role: 'operator' } as AuthenticatedUser;

const result = (over: Partial<InventoryCorrectionResult> = {}): InventoryCorrectionResult => ({
  status: 'applied',
  movementId: 'mov-1',
  requestedDelta: 5,
  quantityBefore: 10,
  quantityAfter: 15,
  adjustmentOutcome: {
    disposition: 'applied',
    idempotency: 'honoured',
    appliedAt: new Date('2026-01-01T10:00:00.000Z'),
  },
  master: { connectionId: 'c1', connectionName: 'Shop', platformType: 'prestashop' },
  refusal: null,
  deduplicated: false,
  ...over,
});

const dto = (plain: Record<string, unknown>): CorrectStockDto =>
  plainToInstance(CorrectStockDto, plain);

describe('InventoryCorrectionController', () => {
  let service: jest.Mocked<IInventoryCorrectionService>;
  let controller: InventoryCorrectionController;

  beforeEach(() => {
    service = {
      getCorrectionTarget: jest.fn(),
      correctStock: jest.fn().mockResolvedValue(result()),
    } as unknown as jest.Mocked<IInventoryCorrectionService>;
    controller = new InventoryCorrectionController(service);
  });

  describe('getCorrectionTarget', () => {
    it('should flatten a ready target', async () => {
      service.getCorrectionTarget.mockResolvedValue({
        kind: 'ready',
        productId: 'p1',
        productVariantId: 'v1',
        connectionId: 'c1',
        connectionName: 'Shop',
        platformType: 'prestashop',
        currentQuantity: 10,
      });
      await expect(controller.getCorrectionTarget('v1')).resolves.toMatchObject({
        kind: 'ready',
        reason: null,
        currentQuantity: 10,
        connectionName: 'Shop',
      });
    });

    it('should report a refused target with its reason and no master', async () => {
      service.getCorrectionTarget.mockResolvedValue({ kind: 'refused', reason: 'no-position' });
      await expect(controller.getCorrectionTarget('v1')).resolves.toMatchObject({
        kind: 'refused',
        reason: 'no-position',
        connectionId: null,
        currentQuantity: null,
      });
    });
  });

  describe('adjust', () => {
    it('should take the actor from the authenticated user and serialise appliedAt', async () => {
      const response = await controller.adjust(
        'v1',
        dto({ mode: 'delta', quantity: 5, operatorReason: 'found', actorUserId: 'attacker' }),
        user
      );
      expect(service.correctStock).toHaveBeenCalledWith(
        expect.objectContaining({ productVariantId: 'v1', actorUserId: 'user-1', note: null })
      );
      expect(response.adjustmentOutcome?.appliedAt).toBe('2026-01-01T10:00:00.000Z');
      expect(response.status).toBe('applied');
    });

    it('should return a refused outcome as a normal response', async () => {
      service.correctStock.mockResolvedValue(
        result({
          status: 'refused',
          quantityAfter: null,
          quantityBefore: null,
          adjustmentOutcome: null,
          refusal: { reason: 'master-refused', detail: 'multi-shop' },
        })
      );
      await expect(
        controller.adjust('v1', dto({ mode: 'delta', quantity: 5, operatorReason: 'found' }), user)
      ).resolves.toMatchObject({
        status: 'refused',
        refusal: { reason: 'master-refused', detail: 'multi-shop' },
        adjustmentOutcome: null,
      });
    });
  });

  describe('CorrectStockDto', () => {
    it('should accept a valid body', async () => {
      const errors = await validate(
        dto({
          mode: 'set',
          quantity: 0,
          operatorReason: 'other',
          note: 'recount',
          idempotencyKey: '7b2f2b0a-3c43-4c0b-8f3a-1d0f9d6b6f10',
          confirmLargeChange: true,
        })
      );
      expect(errors).toHaveLength(0);
    });

    it.each([
      ['unknown mode', { mode: 'add', quantity: 1, operatorReason: 'found' }],
      ['non-integer quantity', { mode: 'delta', quantity: 1.5, operatorReason: 'found' }],
      ['quantity above the upper bound', { mode: 'delta', quantity: 1_000_001, operatorReason: 'found' }],
      ['quantity below the lower bound', { mode: 'delta', quantity: -1_000_001, operatorReason: 'found' }],
      ['unknown reason', { mode: 'delta', quantity: 1, operatorReason: 'lost' }],
      ['long note', { mode: 'delta', quantity: 1, operatorReason: 'found', note: 'x'.repeat(501) }],
      ['bad key', { mode: 'delta', quantity: 1, operatorReason: 'found', idempotencyKey: 'abc' }],
      ['non-boolean confirm', { mode: 'delta', quantity: 1, operatorReason: 'found', confirmLargeChange: 'yes' }],
    ])('should reject %s', async (_label, body) => {
      expect((await validate(dto(body))).length).toBeGreaterThan(0);
    });
  });
});
