import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { FulfillmentRouterPort, RoutingEvaluation } from '@openlinker/core/fulfillment';
import { OrderSnapshotUnavailableError } from '@openlinker/core/orders';

import type { DraftRuleInput } from '../interfaces/routing-dry-run.service.interface';
import { RoutingDryRunService } from './routing-dry-run.service';

const mockOrderFromReadySnapshot = jest.fn<unknown, unknown[]>();

jest.mock('@openlinker/core/orders', () => ({
  ...jest.requireActual<Record<string, unknown>>('@openlinker/core/orders'),
  orderFromReadySnapshot: (...args: unknown[]): unknown => mockOrderFromReadySnapshot(...args),
}));

const evaluation = (locationId: string): RoutingEvaluation => ({
  candidates: [
    { orderLineId: 'basket-line-1', locationId, connectionId: 'conn-oms', deliveryMethod: null, quantity: 1 },
  ],
  unfulfillable: [],
  explanation: [],
});

interface Harness {
  service: RoutingDryRunService;
  evaluate: jest.Mock;
  route: jest.Mock;
  evaluateAgainstDraft: jest.Mock;
  getOrderRecord: jest.Mock;
  resolve: jest.Mock;
}

function build(options: {
  platformType?: string;
  router?: 'plain' | 'draft-capable' | 'none';
} = {}): Harness {
  const evaluate = jest.fn(async () => await Promise.resolve(evaluation('loc-a')));
  const route = jest.fn();
  const evaluateAgainstDraft = jest.fn(
    async () => await Promise.resolve({ saved: evaluation('loc-a'), draft: evaluation('loc-b') })
  );
  const kind = options.router ?? 'draft-capable';

  const router =
    kind === 'none'
      ? null
      : ({ evaluate, route, ...(kind === 'draft-capable' ? { evaluateAgainstDraft } : {}) } as unknown as FulfillmentRouterPort);

  const resolve = jest.fn(async () => await Promise.resolve(router));
  const getOrderRecord = jest.fn();
  const connections = {
    get: jest.fn(async () => await Promise.resolve({ platformType: options.platformType ?? 'openlinker' })),
  };

  const service = new RoutingDryRunService(
    connections as never,
    { resolve } as never,
    { getOrderRecord } as never
  );
  return { service, evaluate, route, evaluateAgainstDraft, getOrderRecord, resolve };
}

const basket = {
  lines: [{ productVariantId: 'ol_variant_1', quantity: 1 }],
  countryIso2: 'PL',
  postalCode: '61-000',
};

const draft = (overrides: Partial<DraftRuleInput> = {}): DraftRuleInput => ({
  id: 'draft-1',
  position: 1,
  kind: 'sort',
  name: 'priority',
  afterAction: 'quantity-split',
  priorityLocationIds: ['loc-b'],
  ...overrides,
});

describe('RoutingDryRunService', () => {
  beforeEach(() => {
    mockOrderFromReadySnapshot.mockReset();
  });

  it('should evaluate a basket and never call route()', async () => {
    const h = build();

    const result = await h.service.dryRun('conn-oms', { subject: { basket } });

    expect(h.evaluate).toHaveBeenCalledTimes(1);
    expect(h.route).not.toHaveBeenCalled();
    expect(result.saved.candidates[0]?.locationId).toBe('loc-a');
    expect(result.draft).toBeUndefined();
    expect(result.changedLines).toBeUndefined();
  });

  it('should tell the router only the allowlisted fields for a basket', async () => {
    const h = build();

    await h.service.dryRun('conn-oms', { subject: { basket: { ...basket, deliveryMethod: 'kurier' } } });

    const sent = (h.evaluate.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['lines', 'orderId', 'requestedDeliveryMethod', 'shipTo']);
    expect(sent['requestedDeliveryMethod']).toBe('kurier');
  });

  it('should reject a connection that is not the OMS', async () => {
    const h = build({ platformType: 'prestashop' });

    await expect(h.service.dryRun('conn-ps', { subject: { basket } })).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(h.evaluate).not.toHaveBeenCalled();
  });

  it('should reject when no router can be resolved', async () => {
    const h = build({ router: 'none' });

    await expect(h.service.dryRun('conn-oms', { subject: { basket } })).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  describe('with a draft ruleset', () => {
    it('should evaluate both and report the lines that moved', async () => {
      const h = build();

      const result = await h.service.dryRun('conn-oms', { subject: { basket }, draftRules: [draft()] });

      expect(h.evaluateAgainstDraft).toHaveBeenCalledTimes(1);
      // One snapshot: the saved side comes from the same call, not a second evaluate().
      expect(h.evaluate).not.toHaveBeenCalled();
      expect(h.route).not.toHaveBeenCalled();
      expect(result.draft?.candidates[0]?.locationId).toBe('loc-b');
      expect(result.changedLines).toEqual([
        { orderLineId: 'basket-line-1', saved: ['loc-a:1'], draft: ['loc-b:1'] },
      ]);
    });

    it('should refuse a draft rule that could not have been saved, naming it', async () => {
      const h = build();

      const attempt = h.service.dryRun('conn-oms', {
        subject: { basket },
        draftRules: [draft({ id: 'bad-1', name: 'not-a-sort' })],
      });

      await expect(attempt).rejects.toMatchObject({
        response: { invalidRuleIds: ['bad-1'] },
      });
      expect(h.evaluate).not.toHaveBeenCalled();
    });

    it('should order the draft by position before handing it to the router', async () => {
      const h = build();

      await h.service.dryRun('conn-oms', {
        subject: { basket },
        draftRules: [draft({ id: 'late', position: 5 }), draft({ id: 'early', position: 1 })],
      });

      const rules = (h.evaluateAgainstDraft.mock.calls as unknown[][])[0]?.[1] as Array<{ id: string }>;
      expect(rules.map((r) => r.id)).toEqual(['early', 'late']);
    });

    it('should refuse two draft rules sharing an id, naming it', async () => {
      const h = build();

      const attempt = h.service.dryRun('conn-oms', {
        subject: { basket },
        draftRules: [draft({ id: 'same' }), draft({ id: 'same', position: 2 })],
      });

      await expect(attempt).rejects.toMatchObject({ response: { duplicateRuleIds: ['same'] } });
      expect(h.evaluateAgainstDraft).not.toHaveBeenCalled();
    });

    it('should refuse when the router cannot evaluate a draft', async () => {
      const h = build({ router: 'plain' });

      await expect(
        h.service.dryRun('conn-oms', { subject: { basket }, draftRules: [draft()] })
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('for an existing order', () => {
    it('should answer not-found for an unknown order', async () => {
      const h = build();
      h.getOrderRecord.mockResolvedValue(null);

      await expect(h.service.dryRun('conn-oms', { subject: { orderId: 'ol_order_x' } })).rejects.toBeInstanceOf(
        NotFoundException
      );
    });

    it('should reject an order that is not fully ingested', async () => {
      const h = build();
      h.getOrderRecord.mockResolvedValue({ shippingAddressHash: null });
      mockOrderFromReadySnapshot.mockImplementation(() => {
        throw new OrderSnapshotUnavailableError('ol_order_1', 'awaiting_mapping');
      });

      await expect(h.service.dryRun('conn-oms', { subject: { orderId: 'ol_order_1' } })).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it('should reject an order without a shipping address', async () => {
      const h = build();
      h.getOrderRecord.mockResolvedValue({ shippingAddressHash: null });
      mockOrderFromReadySnapshot.mockReturnValue({ items: [], shippingAddress: undefined });

      await expect(h.service.dryRun('conn-oms', { subject: { orderId: 'ol_order_1' } })).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it('should project the order and evaluate it without routing', async () => {
      const h = build();
      h.getOrderRecord.mockResolvedValue({ shippingAddressHash: 'h'.repeat(64) });
      mockOrderFromReadySnapshot.mockReturnValue({
        items: [{ id: 'line-1', productId: 'ol_product_1', variantId: 'ol_variant_1', quantity: 2 }],
        shippingAddress: { country: 'PL', postalCode: '61-000', city: 'Poznań' },
        shipping: { methodId: 'kurier' },
      });

      const result = await h.service.dryRun('conn-oms', { subject: { orderId: 'ol_order_1' } });

      expect(h.route).not.toHaveBeenCalled();
      expect(result.input.lines).toEqual([
        { orderLineId: 'line-1', productVariantId: 'ol_variant_1', quantity: 2 },
      ]);
      expect(result.input.requestedDeliveryMethod).toBe('kurier');
    });
  });
});
