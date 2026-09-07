/**
 * OMS fulfilment-router resolver — unit spec (#2408)
 *
 * @module libs/oms/src/routing
 */
import type { IFulfillmentWorkQueryService } from '@openlinker/core/fulfillment';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { IInventoryQueryService, ILocationService } from '@openlinker/core/inventory';

import { OMS_PLATFORM_TYPE } from '../oms.constants';
import { createOmsFulfillmentRouterResolver } from './oms-fulfillment-router.resolver';
import type { RoutingRuleSourcePort } from './routing-rule-source.port';

function build(connections: Pick<ConnectionPort, 'get'>) {
  return createOmsFulfillmentRouterResolver({
    connections: connections as ConnectionPort,
    rules: { listActiveRules: jest.fn().mockResolvedValue([]) } as RoutingRuleSourcePort,
    locations: {} as ILocationService,
    inventory: {} as IInventoryQueryService,
    works: {} as IFulfillmentWorkQueryService,
  });
}

describe('createOmsFulfillmentRouterResolver', () => {
  it('returns a router for an OMS connection', async () => {
    const resolver = build({
      get: jest.fn().mockResolvedValue({ id: 'c1', platformType: OMS_PLATFORM_TYPE }),
    });

    const router = await resolver.resolve('c1');

    expect(router).not.toBeNull();
    expect(typeof router?.route).toBe('function');
    expect(typeof router?.evaluate).toBe('function');
  });

  it('returns null for a connection that claims A2 but is not an OMS connection', async () => {
    // A2 is `config-only`, so ANY connection may claim `sourcingAuthority`
    // (#2403; #2407 gates the claim on having a location, not on the platform).
    // Building the OL router for someone else's connection would scope the
    // ruleset to their id, find none, and report every line unfulfillable —
    // a configuration mistake dressed as a routing bug.
    const resolver = build({
      get: jest.fn().mockResolvedValue({ id: 'c2', platformType: 'prestashop' }),
    });

    await expect(resolver.resolve('c2')).resolves.toBeNull();
  });

  it('degrades to null rather than throwing when the connection cannot be read', async () => {
    // The safe direction: an unrouted order is recoverable by hand, two
    // shipments are not. Ingestion must not fail because of this read.
    const resolver = build({
      get: jest.fn().mockRejectedValue(new Error('connection gone')),
    });

    await expect(resolver.resolve('missing')).resolves.toBeNull();
  });

  it('scopes the router to the connection it was asked about', async () => {
    const rules = { listActiveRules: jest.fn().mockResolvedValue([]) } as RoutingRuleSourcePort;
    const resolver = createOmsFulfillmentRouterResolver({
      connections: {
        get: jest.fn().mockResolvedValue({ id: 'c3', platformType: OMS_PLATFORM_TYPE }),
      } as unknown as ConnectionPort,
      rules,
      locations: {
        listLocations: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      } as unknown as ILocationService,
      inventory: {
        listInventoryItems: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      } as unknown as IInventoryQueryService,
      works: {
        listBlockingRejectionConnectionIds: jest.fn().mockResolvedValue([]),
      } as unknown as IFulfillmentWorkQueryService,
    });

    const router = await resolver.resolve('c3');
    await router?.evaluate({
      orderId: 'ol_order_1',
      lines: [],
      shipTo: { mode: 'plain', countryIso2: 'PL', postalCode: '00-001', city: 'Warszawa' },
      requestedDeliveryMethod: null,
    });

    // The ruleset is read for THIS connection, never for a fixed or default one.
    expect(rules.listActiveRules).toHaveBeenCalledWith('c3', expect.any(Date));
  });
});
