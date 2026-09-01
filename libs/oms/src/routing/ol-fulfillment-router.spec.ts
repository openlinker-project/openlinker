import { checkRoutingPlanConservesQuantities, type RoutingInput } from '@openlinker/core/fulfillment';
import { runFulfillmentRouterContract } from '@openlinker/core/fulfillment/testing';

import type { createOlFulfillmentRouter} from './ol-fulfillment-router';
import { OlFulfillmentRouter } from './ol-fulfillment-router';
import type { RoutingRule } from './routing-rule.types';

const CONNECTION_ID = 'conn-oms';

interface FakeLocation {
  id: string;
  countryIso2: string | null;
  postcode: string | null;
}

interface FakeStock {
  locationId: string;
  productVariantId: string;
  availableQuantity: number;
  /** The inventory row's own identity. Defaults to `(location, variant)`. */
  id?: string;
}

function buildRouter(options: {
  rules?: readonly RoutingRule[];
  locations?: readonly FakeLocation[];
  stock?: readonly FakeStock[];
  blocked?: readonly string[];
  /** When true, every variant asked about is abundantly stocked at every location. */
  abundant?: boolean;
}): OlFulfillmentRouter {
  const locations = options.locations ?? [{ id: 'loc-a', countryIso2: 'PL', postcode: '00-001' }];

  const rules = {
    listActiveRules: async () => await Promise.resolve(options.rules ?? []),
  };

  const locationService = {
    listLocations: async () => await Promise.resolve({ items: locations, total: locations.length, page: 1, limit: 200 }),
  } as unknown as Parameters<typeof createOlFulfillmentRouter>[0]['locations'];

  const inventory = {
    listInventoryItems: async (filters: { productVariantId?: string }) => {
      const variantId = filters.productVariantId ?? '';
      const rows = options.abundant
        ? locations.map((location) => ({
            item: {
              id: `inv-${location.id}-${variantId}`,
              locationId: location.id,
              availableQuantity: 999,
              productVariantId: variantId,
            },
          }))
        : (options.stock ?? [])
            .filter((entry) => entry.productVariantId === variantId)
            .map((entry) => ({
              item: {
                id: entry.id ?? `inv-${entry.locationId}-${variantId}`,
                locationId: entry.locationId,
                availableQuantity: entry.availableQuantity,
                productVariantId: variantId,
              },
            }));
      return await Promise.resolve({ items: rows, total: rows.length });
    },
  } as unknown as Parameters<typeof createOlFulfillmentRouter>[0]['inventory'];

  const works = {
    listBlockingRejectionConnectionIds: async () => await Promise.resolve(options.blocked ?? []),
  } as unknown as Parameters<typeof createOlFulfillmentRouter>[0]['works'];

  return new OlFulfillmentRouter({
    connectionId: CONNECTION_ID,
    rules,
    locations: locationService,
    inventory,
    works,
    now: () => new Date('2026-08-31T00:00:00.000Z'),
  });
}

const filter = (
  name: RoutingRule['name'],
  afterAction: RoutingRule['afterAction'] = 'quantity-split',
  id = `f-${name}`
): RoutingRule => ({ id, position: 1, kind: 'filter', name, afterAction }) as RoutingRule;

const sort = (
  name: RoutingRule['name'],
  priorityLocationIds: string[] = [],
  afterAction: RoutingRule['afterAction'] = 'quantity-split',
  id = `s-${name}`
): RoutingRule => ({ id, position: 2, kind: 'sort', name, afterAction, priorityLocationIds }) as RoutingRule;

const input = (overrides: Partial<RoutingInput> = {}): RoutingInput => ({
  orderId: 'ol_order_1',
  lines: [{ orderLineId: 'line-1', productVariantId: 'ol_variant_1', quantity: 2 }],
  shipTo: { mode: 'plain', countryIso2: 'PL', postalCode: '00-001', city: 'Warszawa' },
  requestedDeliveryMethod: null,
  ...overrides,
});

// The #2404 shared port-contract kit — this router is its first real subject.
runFulfillmentRouterContract(() => buildRouter({ abundant: true }), { subject: 'OlFulfillmentRouter' });

describe('OlFulfillmentRouter', () => {
  describe('the shared pipeline', () => {
    it('should explain evaluate() and route() identically for the same input', async () => {
      const router = buildRouter({ abundant: true, rules: [filter('in-stock'), sort('most-complete')] });
      const request = input();

      const evaluation = await router.evaluate(request);
      const plan = await router.route(request, { idempotencyKey: 'route:d1' });

      expect(plan.status).toBe('resolved');
      if (plan.status !== 'resolved') return;
      expect(plan.explanation).toEqual(evaluation.explanation);
    });

    it('should conserve every line quantity when stock is available', async () => {
      const router = buildRouter({ abundant: true, rules: [filter('in-stock')] });
      const request = input();

      const plan = await router.route(request, { idempotencyKey: 'route:d2' });
      expect(plan.status).toBe('resolved');
      if (plan.status !== 'resolved') return;
      expect(checkRoutingPlanConservesQuantities(request, plan)).toBe(true);
    });

    it('should report the same decision reference for a retry under the same key', async () => {
      const router = buildRouter({ abundant: true });
      const first = await router.route(input(), { idempotencyKey: 'route:same' });
      const second = await router.route(input(), { idempotencyKey: 'route:same' });
      expect(first.decisionId).toBe(second.decisionId);
    });
  });

  describe('filters', () => {
    it('should eliminate a location holding no stock for any line', async () => {
      const router = buildRouter({
        rules: [filter('in-stock')],
        locations: [
          { id: 'loc-empty', countryIso2: 'PL', postcode: '00-001' },
          { id: 'loc-full', countryIso2: 'PL', postcode: '00-001' },
        ],
        stock: [{ locationId: 'loc-full', productVariantId: 'ol_variant_1', availableQuantity: 5 }],
      });

      const plan = await router.route(input(), { idempotencyKey: 'route:d3' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      expect(plan.explanation[0]?.eliminated).toEqual(['loc-empty']);
      expect(plan.assignments.every((a) => a.locationId === 'loc-full')).toBe(true);
    });

    it('should eliminate a location whose own country differs from the ship-to country', async () => {
      const router = buildRouter({
        abundant: true,
        rules: [filter('country-served')],
        locations: [
          { id: 'loc-pl', countryIso2: 'PL', postcode: '00-001' },
          { id: 'loc-de', countryIso2: 'DE', postcode: '10115' },
        ],
      });

      const plan = await router.route(input(), { idempotencyKey: 'route:d4' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      expect(plan.explanation[0]?.eliminated).toEqual(['loc-de']);
    });

    it('should not eliminate a location with no country recorded, and should say so', async () => {
      const router = buildRouter({
        abundant: true,
        rules: [filter('country-served')],
        locations: [{ id: 'loc-unknown', countryIso2: null, postcode: null }],
      });

      const plan = await router.route(input(), { idempotencyKey: 'route:d5' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      expect(plan.explanation[0]?.eliminated).toEqual([]);
      expect(plan.explanation[0]?.detail).toContain('no country recorded');
    });

    it('should eliminate a holder that rejected this order with a blocking reason', async () => {
      const router = buildRouter({
        abundant: true,
        rules: [filter('not-blocked-by-reject')],
        blocked: [CONNECTION_ID],
      });

      const plan = await router.route(input(), { idempotencyKey: 'route:d6' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      expect(plan.explanation[0]?.eliminated).toEqual(['loc-a']);
    });

    it('should leave candidates untouched when no holder is blocked', async () => {
      const router = buildRouter({ abundant: true, rules: [filter('not-blocked-by-reject')], blocked: [] });
      const plan = await router.route(input(), { idempotencyKey: 'route:d7' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      expect(plan.explanation[0]?.eliminated).toEqual([]);
    });
  });

  describe('sorts', () => {
    it('should rank by the operator-authored priority order', async () => {
      const router = buildRouter({
        abundant: true,
        rules: [sort('priority', ['loc-b', 'loc-a'])],
        locations: [
          { id: 'loc-a', countryIso2: 'PL', postcode: '00-001' },
          { id: 'loc-b', countryIso2: 'PL', postcode: '00-001' },
        ],
      });

      const plan = await router.route(input(), { idempotencyKey: 'route:d8' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      expect(plan.assignments[0]?.locationId).toBe('loc-b');
    });

    it('should state that `nearest` ranked by country alone when ship-to is hashed', async () => {
      const router = buildRouter({ abundant: true, rules: [sort('nearest')] });

      const plan = await router.route(
        input({ shipTo: { mode: 'hashed', countryIso2: 'PL', locationHash: 'abc' } }),
        { idempotencyKey: 'route:d9' }
      );
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      expect(plan.explanation[0]?.detail).toContain('ranked by country only');
    });

    it('should describe `nearest` as a proxy rather than a distance on the plain arm', async () => {
      const router = buildRouter({ abundant: true, rules: [sort('nearest')] });
      const plan = await router.route(input(), { idempotencyKey: 'route:d10' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      expect(plan.explanation[0]?.detail).toContain('not a geodesic distance');
    });

    it('should say that `priority` ranked nothing when no order was authored', async () => {
      const router = buildRouter({ abundant: true, rules: [sort('priority', [])] });
      const plan = await router.route(input(), { idempotencyKey: 'route:d11' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      expect(plan.explanation[0]?.detail).toContain('ranked nothing');
    });
  });

  describe('a line that cannot be sourced', () => {
    it('should report the shortfall as unfulfillable rather than throwing', async () => {
      const router = buildRouter({ rules: [filter('in-stock')], stock: [] });

      const request = input();
      const plan = await router.route(request, { idempotencyKey: 'route:d12' });

      expect(plan.status).toBe('resolved');
      if (plan.status !== 'resolved') return;
      expect(plan.unfulfillable).toEqual([
        expect.objectContaining({ orderLineId: 'line-1', quantity: 2, resolution: 'refund' }),
      ]);
      // Still conserving: the committer refuses this plan (#2730), but it
      // refuses a WELL-FORMED one, with a durable named reason.
      expect(checkRoutingPlanConservesQuantities(request, plan)).toBe(true);
    });

    it('should never emit a hold, which Wave 3a cannot commit', async () => {
      const router = buildRouter({ rules: [filter('in-stock')], stock: [] });
      const plan = await router.route(input(), { idempotencyKey: 'route:d13' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      expect(plan.holds).toEqual([]);
    });

    it('should split a line across locations when no single one can cover it', async () => {
      const router = buildRouter({
        rules: [filter('in-stock'), sort('priority', ['loc-a', 'loc-b'])],
        locations: [
          { id: 'loc-a', countryIso2: 'PL', postcode: '00-001' },
          { id: 'loc-b', countryIso2: 'PL', postcode: '00-001' },
        ],
        stock: [
          { locationId: 'loc-a', productVariantId: 'ol_variant_1', availableQuantity: 1 },
          { locationId: 'loc-b', productVariantId: 'ol_variant_1', availableQuantity: 1 },
        ],
      });

      const request = input();
      const plan = await router.route(request, { idempotencyKey: 'route:d14' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      expect(plan.assignments).toHaveLength(2);
      expect(checkRoutingPlanConservesQuantities(request, plan)).toBe(true);
    });
  });

  describe('the split ladder (`afterAction`)', () => {
    // Two lines, and only `loc-b` can carry BOTH. Under `quantity-split` /
    // `line-split` the priority order puts line-1 at `loc-a`, so a plan that
    // splits the order across two locations is the observable difference the
    // rungs have to produce.
    const twoLocationsTwoLines = {
      locations: [
        { id: 'loc-a', countryIso2: 'PL', postcode: '00-001' },
        { id: 'loc-b', countryIso2: 'PL', postcode: '00-001' },
      ],
      stock: [
        { locationId: 'loc-a', productVariantId: 'ol_variant_1', availableQuantity: 9 },
        { locationId: 'loc-b', productVariantId: 'ol_variant_1', availableQuantity: 9 },
        { locationId: 'loc-b', productVariantId: 'ol_variant_2', availableQuantity: 9 },
      ],
    };

    const twoLines = input({
      lines: [
        { orderLineId: 'line-1', productVariantId: 'ol_variant_1', quantity: 2 },
        { orderLineId: 'line-2', productVariantId: 'ol_variant_2', quantity: 2 },
      ],
    });

    it('should spread the order across locations under `quantity-split`', async () => {
      const router = buildRouter({
        ...twoLocationsTwoLines,
        rules: [sort('priority', ['loc-a', 'loc-b'], 'quantity-split')],
      });

      const plan = await router.route(twoLines, { idempotencyKey: 'route:s1' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      expect(new Set(plan.assignments.map((a) => a.locationId))).toEqual(new Set(['loc-a', 'loc-b']));
      expect(checkRoutingPlanConservesQuantities(twoLines, plan)).toBe(true);
    });

    it('should source the WHOLE order from one location under `no-split`', async () => {
      const router = buildRouter({
        ...twoLocationsTwoLines,
        rules: [sort('priority', ['loc-a', 'loc-b'], 'no-split')],
      });

      const plan = await router.route(twoLines, { idempotencyKey: 'route:s2' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      // `loc-a` outranks `loc-b` and holds line-1 outright, so a rung that only
      // forbade QUANTITY splitting would still place line-1 there and split the
      // order across two locations. `no-split` is strictly stronger than that.
      expect(plan.assignments.map((a) => a.locationId)).toEqual(['loc-b', 'loc-b']);
      expect(plan.unfulfillable).toEqual([]);
      expect(checkRoutingPlanConservesQuantities(twoLines, plan)).toBe(true);
    });

    it('should say in the explanation which locations `no-split` ruled out', async () => {
      const router = buildRouter({
        ...twoLocationsTwoLines,
        rules: [sort('priority', ['loc-a', 'loc-b'], 'no-split')],
      });

      const plan = await router.route(twoLines, { idempotencyKey: 'route:s3' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      const step = plan.explanation.at(-1);
      expect(step?.detail).toContain('no-split');
      expect(step?.eliminated).toEqual(['loc-a']);
      // The step cites a REAL rule id an operator can go and edit.
      expect(step?.rule.ruleId).toBe('s-priority');
    });

    it('should report the order unfulfillable when `no-split` leaves no single location', async () => {
      const router = buildRouter({
        locations: twoLocationsTwoLines.locations,
        // Neither location holds both lines.
        stock: [
          { locationId: 'loc-a', productVariantId: 'ol_variant_1', availableQuantity: 9 },
          { locationId: 'loc-b', productVariantId: 'ol_variant_2', availableQuantity: 9 },
        ],
        rules: [sort('priority', ['loc-a', 'loc-b'], 'no-split')],
      });

      const plan = await router.route(twoLines, { idempotencyKey: 'route:s4' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      expect(plan.assignments).toEqual([]);
      expect(plan.unfulfillable.map((u) => u.orderLineId)).toEqual(['line-1', 'line-2']);
      expect(plan.unfulfillable[0]?.reason).toContain('forbids splitting it');
      expect(checkRoutingPlanConservesQuantities(twoLines, plan)).toBe(true);
    });

    it('should refuse to split a single line across locations under `line-split`', async () => {
      const router = buildRouter({
        rules: [filter('in-stock', 'line-split'), sort('priority', ['loc-a', 'loc-b'], 'line-split')],
        locations: twoLocationsTwoLines.locations,
        stock: [
          { locationId: 'loc-a', productVariantId: 'ol_variant_1', availableQuantity: 1 },
          { locationId: 'loc-b', productVariantId: 'ol_variant_1', availableQuantity: 1 },
        ],
      });

      const request = input();
      const plan = await router.route(request, { idempotencyKey: 'route:s5' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      // Two units, one at each location: `quantity-split` would take one from
      // each. `line-split` must not, and must say so.
      expect(plan.assignments).toEqual([]);
      expect(plan.unfulfillable[0]?.reason).toContain('forbids splitting a line');
      expect(checkRoutingPlanConservesQuantities(request, plan)).toBe(true);
    });

    it('should still place different lines at different locations under `line-split`', async () => {
      const router = buildRouter({
        ...twoLocationsTwoLines,
        rules: [sort('priority', ['loc-a', 'loc-b'], 'line-split')],
      });

      const plan = await router.route(twoLines, { idempotencyKey: 'route:s6' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      expect(plan.assignments.map((a) => a.locationId)).toEqual(['loc-a', 'loc-b']);
    });

    it('should let the most restrictive rule in a mixed ruleset govern', async () => {
      const router = buildRouter({
        ...twoLocationsTwoLines,
        rules: [filter('in-stock', 'quantity-split'), sort('priority', ['loc-a', 'loc-b'], 'no-split')],
      });

      const plan = await router.route(twoLines, { idempotencyKey: 'route:s7' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      // A permissive sibling must not lift a restriction the operator authored.
      expect(plan.assignments.map((a) => a.locationId)).toEqual(['loc-b', 'loc-b']);
    });

    it('should emit no split step when every rule permits `quantity-split`', async () => {
      const router = buildRouter({ abundant: true, rules: [filter('in-stock', 'quantity-split')] });
      const plan = await router.route(input(), { idempotencyKey: 'route:s8' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      expect(plan.explanation).toHaveLength(1);
      expect(plan.explanation[0]?.rule.name).toBe('in-stock');
    });
  });

  describe('reading stock', () => {
    it('should count an inventory row once even when paging returns it twice', async () => {
      // `InventoryRepository.findMany` orders by `updatedAt DESC` with no
      // tie-break, so an offset read can hand the same row back on two pages.
      // Summing there would over-count available stock and commit a work row
      // for units that do not exist — the one failure
      // `checkRoutingPlanConservesQuantities` cannot see.
      const router = buildRouter({
        rules: [filter('in-stock')],
        stock: [
          { id: 'inv-1', locationId: 'loc-a', productVariantId: 'ol_variant_1', availableQuantity: 1 },
          { id: 'inv-1', locationId: 'loc-a', productVariantId: 'ol_variant_1', availableQuantity: 1 },
        ],
      });

      const request = input();
      const plan = await router.route(request, { idempotencyKey: 'route:p1' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      // One unit really exists; the order wants two.
      expect(plan.assignments.reduce((sum, a) => sum + a.quantity, 0)).toBe(1);
      expect(plan.unfulfillable[0]?.quantity).toBe(1);
      expect(checkRoutingPlanConservesQuantities(request, plan)).toBe(true);
    });

    it('should still add up genuinely distinct rows at one location', async () => {
      const router = buildRouter({
        rules: [filter('in-stock')],
        stock: [
          { id: 'inv-1', locationId: 'loc-a', productVariantId: 'ol_variant_1', availableQuantity: 1 },
          { id: 'inv-2', locationId: 'loc-a', productVariantId: 'ol_variant_1', availableQuantity: 1 },
        ],
      });

      const request = input();
      const plan = await router.route(request, { idempotencyKey: 'route:p2' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      expect(plan.assignments.reduce((sum, a) => sum + a.quantity, 0)).toBe(2);
      expect(plan.unfulfillable).toEqual([]);
    });
  });

  describe('with no rules configured', () => {
    it('should still conserve quantities and explain nothing', async () => {
      const router = buildRouter({ abundant: true, rules: [] });
      const request = input();
      const plan = await router.route(request, { idempotencyKey: 'route:d15' });
      if (plan.status !== 'resolved') throw new Error('expected resolved');
      expect(plan.explanation).toEqual([]);
      expect(checkRoutingPlanConservesQuantities(request, plan)).toBe(true);
    });
  });
});
