import { Promotion } from '../../../domain/entities/promotion.entity';
import {
  PromotionConflictError,
  PromotionInvalidError,
  PromotionNotFoundError,
  PromotionReorderMismatchError,
} from '../../../domain/exceptions/promotion.errors';
import type { PromotionPersistInput } from '../../../domain/ports/promotion-repository.port';
import { PROMOTION_DRAFT_ID, type PromotionInput } from '../../interfaces/promotion.service.interface';
import { PromotionService } from '../promotion.service';

const NOW = new Date('2026-11-05T00:00:00Z');

const BENEFIT = {
  kind: 'free-gift',
  productId: 'p-gift',
  variantId: 'v-gift',
  quantity: 1,
  perUnit: null,
  skipIfPresent: true,
};

function input(overrides: Partial<PromotionInput> = {}): PromotionInput {
  return {
    name: 'Free mug',
    conditions: [{ field: 'containsProduct', op: 'eq', value: 'p-book' }],
    benefit: BENEFIT,
    effectiveFrom: new Date('2026-11-01'),
    effectiveTo: null,
    ...overrides,
  };
}

function fromPersist(id: string, position: number, p: PromotionPersistInput): Promotion {
  return new Promotion(id, p.name, p.isActive, position, p.effectiveFrom, p.effectiveTo, p.conditions, p.benefit, p.combinable, p.limits, p.definitionHash, NOW, NOW);
}

describe('PromotionService', () => {
  let rows: Promotion[];
  let repository: Record<string, jest.Mock>;
  let ledger: Record<string, jest.Mock>;
  let service: PromotionService;
  let nextId: number;

  beforeEach(() => {
    rows = [];
    nextId = 1;
    repository = {
      findById: jest.fn().mockImplementation((id: string) => Promise.resolve(rows.find((r) => r.id === id) ?? null)),
      findAllOrdered: jest.fn().mockImplementation(() => Promise.resolve([...rows])),
      findByDefinitionHash: jest
        .fn()
        .mockImplementation((hash: string) => Promise.resolve(rows.filter((r) => r.definitionHash === hash))),
      create: jest.fn().mockImplementation((p: PromotionPersistInput) => {
        const created = fromPersist(`p${nextId++}`, rows.length + 1, p);
        rows.push(created);
        return Promise.resolve(created);
      }),
      update: jest.fn().mockImplementation((id: string, p: PromotionPersistInput) => {
        const index = rows.findIndex((r) => r.id === id);
        rows[index] = fromPersist(id, rows[index].position, p);
        return Promise.resolve(rows[index]);
      }),
      delete: jest.fn().mockResolvedValue(undefined),
      setPositions: jest.fn().mockResolvedValue(undefined),
    };
    ledger = {
      findStates: jest.fn().mockResolvedValue(new Map()),
      sumUnitsGiven: jest.fn().mockResolvedValue(new Map([['p1', 4]])),
      extendCap: jest.fn().mockResolvedValue(undefined),
    };
    service = new PromotionService(repository as never, ledger as never);
  });

  it('should create a promotion inactive by default and report its ledger view', async () => {
    const view = await service.create(input({ limits: { unitCap: 10 } }));

    expect(view.promotion.isActive).toBe(false);
    expect(view.promotion.combinable).toBe(true);
    expect(view.unitsGiven).toBe(4);
    expect(view.effectiveCap).toBe(10);
  });

  it('should add the capExtension of a resumed state to the effective cap', async () => {
    await service.create(input({ limits: { unitCap: 10 } }));
    ledger.findStates.mockResolvedValue(
      new Map([['p1', { promotionId: 'p1', pausedReason: null, pausedAt: null, capExtension: 5 }]])
    );

    expect((await service.get('p1')).effectiveCap).toBe(15);
  });

  it.each([
    ['a blank name', input({ name: '  ' }), 'name'],
    ['a malformed condition', input({ conditions: [{ field: 'nope' }] }), 'condition'],
    ['an unknown benefit', input({ benefit: { kind: 'percent-off' } }), 'benefit'],
    ['a fractional limit', input({ limits: { unitCap: 1.5 } }), 'limits'],
    ['an end before the start', input({ effectiveTo: new Date('2026-10-01') }), 'window'],
  ])('should refuse %s', async (_name, bad, part) => {
    await expect(service.create(bad)).rejects.toMatchObject({ name: 'PromotionInvalidError', part });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('should refuse an identical definition on an overlapping window', async () => {
    await service.create(input());

    await expect(service.create(input({ name: 'Another name' }))).rejects.toBeInstanceOf(
      PromotionConflictError
    );
  });

  it('should accept an identical definition on a window that does not overlap', async () => {
    await service.create(input({ effectiveTo: new Date('2026-11-30') }));

    await expect(service.create(input({ effectiveFrom: new Date('2026-12-15') }))).resolves.toBeDefined();
  });

  it('should not conflict an edit with the promotion being edited', async () => {
    await service.create(input());

    await expect(service.update('p1', input({ name: 'Renamed' }))).resolves.toBeDefined();
  });

  it('should answer not found for an unknown promotion on get, update, delete and resume', async () => {
    await expect(service.get('x')).rejects.toBeInstanceOf(PromotionNotFoundError);
    await expect(service.update('x', input())).rejects.toBeInstanceOf(PromotionNotFoundError);
    await expect(service.delete('x')).rejects.toBeInstanceOf(PromotionNotFoundError);
    await expect(service.resumeAfterCap('x', 5)).rejects.toBeInstanceOf(PromotionNotFoundError);
  });

  it('should refuse a reorder that is not exactly the set of promotions, naming both halves', async () => {
    await service.create(input());
    await service.create(input({ conditions: [{ field: 'orderCountry', op: 'eq', value: 'PL' }] }));

    const error = await service.reorder(['p1', 'ghost']).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PromotionReorderMismatchError);
    expect((error as PromotionReorderMismatchError).missingPromotionIds).toEqual(['p2']);
    expect((error as PromotionReorderMismatchError).unknownPromotionIds).toEqual(['ghost']);
    expect(repository.setPositions).not.toHaveBeenCalled();
  });

  it('should refuse a reorder that repeats an id', async () => {
    await service.create(input());
    await service.create(input({ conditions: [{ field: 'orderCountry', op: 'eq', value: 'PL' }] }));

    await expect(service.reorder(['p1', 'p1'])).rejects.toBeInstanceOf(PromotionReorderMismatchError);
  });

  it('should stamp the new order when the list is exhaustive', async () => {
    await service.create(input());
    await service.create(input({ conditions: [{ field: 'orderCountry', op: 'eq', value: 'PL' }] }));

    await service.reorder(['p2', 'p1']);

    expect(repository.setPositions).toHaveBeenCalledWith(['p2', 'p1']);
  });

  it('should raise the cap by at least one unit on resume', async () => {
    await service.create(input({ limits: { unitCap: 10 } }));

    await service.resumeAfterCap('p1', 0);

    expect(ledger.extendCap).toHaveBeenCalledWith('p1', 1);
  });

  it('should build a draft with the draft id without persisting anything', () => {
    const draft = service.buildDraft(input());

    expect(draft.id).toBe(PROMOTION_DRAFT_ID);
    expect(repository.create).not.toHaveBeenCalled();
    expect(() => service.buildDraft(input({ benefit: {} }))).toThrow(PromotionInvalidError);
  });
});
