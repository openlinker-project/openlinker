import { Promotion } from '../../../domain/entities/promotion.entity';
import type { PromotionGrant } from '../../../domain/types/promotion-application.types';
import type { FreeGiftBenefit } from '../../../domain/types/promotion-benefit.types';
import type { ApplyPromotionsInput } from '../../interfaces/promotion-application.service.interface';
import { PromotionApplicationService } from '../promotion-application.service';

const CREATED = new Date('2026-11-01T00:00:00Z');
const PLACED = new Date('2026-11-02T10:00:00Z');

const GIFT: FreeGiftBenefit = {
  kind: 'free-gift',
  productId: 'p-gift',
  variantId: 'v-gift',
  quantity: 1,
  perUnit: null,
  skipIfPresent: true,
  documentForm: 'technical-cent',
};

function promotion(overrides: { unitCap?: number | null; combinable?: boolean } = {}): Promotion {
  return new Promotion(
    'p1',
    'Free mug',
    true,
    1,
    CREATED,
    null,
    [{ field: 'containsProduct', op: 'eq', value: 'p-book' }],
    GIFT,
    overrides.combinable ?? true,
    { unitCap: overrides.unitCap ?? null, customerLimit: null },
    'hash',
    CREATED,
    CREATED
  );
}

describe('PromotionApplicationService', () => {
  let promotions: { findAllOrdered: jest.Mock };
  let ledger: Record<string, jest.Mock>;
  let log: { append: jest.Mock };
  let readStock: jest.Mock;
  let service: PromotionApplicationService;
  let events: string[];

  const baseInput = (overrides: Partial<ApplyPromotionsInput> = {}): ApplyPromotionsInput => ({
    facts: {
      orderId: 'o1',
      occurredAt: PLACED,
      sourceConnectionId: 'c1',
      totalGross: 100,
      currency: 'PLN',
      lineProductIds: ['p-book'],
      lineVariantIds: ['v-book'],
    },
    lines: [{ productId: 'p-book', variantId: 'v-book', quantity: 1, isGift: false }],
    customerId: 'cust-1',
    presentPromotionIds: new Set(),
    readStock,
    isFirstIngestion: true,
    ...overrides,
  });

  beforeEach(() => {
    events = [];
    promotions = { findAllOrdered: jest.fn().mockResolvedValue([promotion()]) };
    ledger = {
      withPromotionsLocked: jest.fn().mockImplementation((_ids: string[], work: () => Promise<unknown>) => {
        events.push('lock');
        return work();
      }),
      findGrantsForOrder: jest.fn().mockResolvedValue([]),
      findStates: jest.fn().mockResolvedValue(new Map()),
      sumUnitsGiven: jest.fn().mockResolvedValue(new Map()),
      sumUnitsForCustomer: jest.fn().mockResolvedValue(new Map()),
      sumPendingUnitsForVariants: jest.fn().mockResolvedValue(new Map()),
      recordGrant: jest.fn().mockImplementation(() => {
        events.push('grant');
        return Promise.resolve(true);
      }),
      setPause: jest.fn().mockResolvedValue(undefined),
      releaseGrantsForOrder: jest.fn().mockResolvedValue(2),
    };
    log = { append: jest.fn().mockResolvedValue(undefined) };
    readStock = jest.fn().mockResolvedValue(new Map([['v-gift', { kind: 'known', available: 10 }]]));
    service = new PromotionApplicationService(promotions as never, ledger as never, log as never);
  });

  it('should record the grant under the lock and hand back the line to write', async () => {
    const result = await service.apply(baseInput());

    expect(events).toEqual(['lock', 'grant']);
    expect(ledger.withPromotionsLocked).toHaveBeenCalledWith(['p1'], expect.any(Function));
    expect(ledger.recordGrant).toHaveBeenCalledWith({
      promotionId: 'p1',
      internalOrderId: 'o1',
      customerId: 'cust-1',
      quantity: 1,
      productId: 'p-gift',
      variantId: 'v-gift',
      documentForm: 'technical-cent',
    });
    expect(result.lineGrants).toEqual([
      expect.objectContaining({ origin: 'new', quantity: 1, variantId: 'v-gift' }),
    ]);
    expect(log.append).toHaveBeenCalledWith([
      expect.objectContaining({ promotionId: 'p1', outcome: 'applied', quantity: 1 }),
    ]);
  });

  it('should give nothing a second time when the line is already on the order (re-ingestion)', async () => {
    const result = await service.apply(baseInput({ presentPromotionIds: new Set(['p1']) }));

    expect(ledger.recordGrant).not.toHaveBeenCalled();
    expect(result.lineGrants).toEqual([]);
    expect(result.outcomes[0]).toMatchObject({ applied: true, alreadyApplied: true });
    expect(log.append).not.toHaveBeenCalled();
  });

  it('should rebuild a missing line from the stored grant, not from the promotion, without recounting', async () => {
    const grant: PromotionGrant = {
      promotionId: 'p1',
      internalOrderId: 'o1',
      customerId: 'cust-1',
      quantity: 3,
      productId: 'p-old',
      variantId: 'v-old',
      documentForm: null,
      createdAt: PLACED,
    };
    ledger.findGrantsForOrder.mockResolvedValue([grant]);

    const result = await service.apply(baseInput());

    expect(ledger.recordGrant).not.toHaveBeenCalled();
    expect(result.lineGrants).toEqual([
      expect.objectContaining({ origin: 'self-heal', quantity: 3, productId: 'p-old', variantId: 'v-old' }),
    ]);
  });

  it('should refuse to reach back to an order placed before the promotion was saved', async () => {
    const result = await service.apply(
      baseInput({ facts: { ...baseInput().facts, occurredAt: new Date('2026-10-01T00:00:00Z') } })
    );

    expect(result.lineGrants).toEqual([]);
    expect(result.outcomes[0]).toMatchObject({ reason: 'rule-not-matching', nonFiringReason: 'fact-precedes-rule' });
  });

  it('should pause for stock after subtracting units granted to other orders but not yet reserved', async () => {
    readStock.mockResolvedValue(new Map([['v-gift', { kind: 'known', available: 1 }]]));
    ledger.sumPendingUnitsForVariants.mockResolvedValue(new Map([['v-gift', 1]]));

    const result = await service.apply(baseInput());

    expect(ledger.sumPendingUnitsForVariants).toHaveBeenCalledWith(['v-gift'], 'o1', expect.any(Date));
    expect(ledger.setPause).toHaveBeenCalledWith('p1', 'gift-out-of-stock');
    expect(result.lineGrants).toEqual([]);
    expect(log.append).toHaveBeenCalledWith([
      expect.objectContaining({ outcome: 'skipped', reason: 'gift-out-of-stock' }),
    ]);
  });

  it('should treat a failing supply read as unknown stock and add nothing', async () => {
    readStock.mockRejectedValue(new Error('availability down'));

    const result = await service.apply(baseInput());

    expect(result.outcomes[0]).toMatchObject({ applied: false, reason: 'gift-stock-unknown' });
    expect(ledger.setPause).not.toHaveBeenCalled();
  });

  it('should log non-applications only on the first ingestion', async () => {
    readStock.mockResolvedValue(new Map([['v-gift', { kind: 'known', available: 0 }]]));

    await service.apply(baseInput({ isFirstIngestion: false }));

    expect(log.append).not.toHaveBeenCalled();
  });

  it('should not fail the application when the log cannot be written', async () => {
    log.append.mockRejectedValue(new Error('db down'));

    await expect(service.apply(baseInput())).resolves.toBeDefined();
  });

  it('should plan against an empty ledger and write nothing when previewing', async () => {
    const draft = promotion();
    promotions.findAllOrdered.mockResolvedValue([]);

    const preview = await service.preview({ ...baseInput(), draft: new Promotion('draft', draft.name, true, 99, CREATED, null, draft.conditions, GIFT, true, draft.limits, 'h', CREATED, CREATED) });

    expect(preview.outcomes[0]).toMatchObject({ promotionId: 'draft', applied: true });
    expect(ledger.recordGrant).not.toHaveBeenCalled();
    expect(log.append).not.toHaveBeenCalled();
  });

  it('should record a failed application for every promotion in play', async () => {
    await service.recordFailure([{ id: 'p1', name: 'Free mug' }], 'o1', 'boom');

    expect(log.append).toHaveBeenCalledWith([
      expect.objectContaining({ promotionId: 'p1', internalOrderId: 'o1', outcome: 'failed', message: 'boom' }),
    ]);
  });

  it('should release the grants of a cancelled order', async () => {
    await expect(service.releaseForOrder('o1')).resolves.toBe(2);
  });
});
