/**
 * GiftAttentionController specs (#3935)
 *
 * @module apps/api/src/promotions/http/__tests__
 */
import { NotFoundException } from '@nestjs/common';
import type {
  PromotionApplicationLogPort,
  PromotionApplicationRecord,
} from '@openlinker/core/promotions';

import type { AuthenticatedUser } from '../../../auth/auth.types';
import { GiftAttentionController } from '../gift-attention.controller';

const USER = { id: 'user-1' } as AuthenticatedUser;
const RECORD_ID = '11111111-1111-4111-8111-111111111111';

function record(overrides: Partial<PromotionApplicationRecord> = {}): PromotionApplicationRecord {
  return {
    id: RECORD_ID,
    promotionId: 'promo-1',
    promotionName: 'Promo',
    internalOrderId: 'o1',
    outcome: 'skipped',
    reason: 'gift-out-of-stock',
    quantity: 0,
    message: 'secret cost 3.20',
    dismissedAt: null,
    dismissedByUserId: null,
    createdAt: new Date('2026-11-02T10:00:00Z'),
    ...overrides,
  };
}

function build(records: PromotionApplicationRecord[], byId: PromotionApplicationRecord | null = null) {
  const log = {
    findByOrder: jest.fn().mockResolvedValue(records),
    findById: jest.fn().mockResolvedValue(byId),
    dismiss: jest
      .fn()
      .mockImplementation((id: string) => Promise.resolve(record({ id, dismissedAt: new Date() }))),
  } as unknown as jest.Mocked<PromotionApplicationLogPort>;
  return { controller: new GiftAttentionController(log), log };
}

describe('GiftAttentionController', () => {
  it('should list only applications that did not give the gift, as codes without message text', async () => {
    const applied = record({ id: 'a', promotionId: 'p3', outcome: 'applied', reason: null });
    const { controller } = build([record(), applied]);

    const result = await controller.list('o1');

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      ruleId: 'promo-1',
      reasonCode: 'gift-out-of-stock',
      outcome: 'not-applied',
      dismissed: false,
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('should keep the latest application per promotion and report a failed one without a code', async () => {
    const older = record({ id: 'old', outcome: 'skipped', createdAt: new Date('2026-11-01T00:00:00Z') });
    const newerApplied = record({ id: 'new', outcome: 'applied', reason: null });
    const failed = record({ id: 'f', promotionId: 'p9', outcome: 'failed', reason: null });
    const { controller } = build([older, newerApplied, failed]);

    const result = await controller.list('o1');

    expect(result.items.map((i) => i.ruleId)).toEqual(['p9']);
    expect(result.items[0]).toMatchObject({ outcome: 'failed', reasonCode: null });
    expect(result.recordingAvailable).toBe(true);
  });

  it('should dismiss an application of this order', async () => {
    const target = record();
    const { controller, log } = build([], target);

    const item = await controller.skip('o1', target.id, USER);

    expect(log.dismiss).toHaveBeenCalledWith(target.id, 'user-1', expect.any(Date));
    expect(item.dismissed).toBe(true);
  });

  it('should answer 404 for an application that belongs to another order or does not exist', async () => {
    const foreign = record({ internalOrderId: 'o2' });
    await expect(build([], foreign).controller.skip('o1', foreign.id, USER)).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(build([], null).controller.skip('o1', foreign.id, USER)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });
});
