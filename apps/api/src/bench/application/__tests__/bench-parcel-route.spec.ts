/**
 * Who ships this box (#3958)
 *
 * The label card's four cases are decided from three facts on the route:
 * whether it buys a label (`processorKind`), whether an operator chose it
 * (`fromRule`) and whether the routed connection still works. These specs pin
 * the mapping from the core routing answer to those facts, the resolver's
 * degradation, and the wire shape.
 *
 * @module apps/api/src/bench/application/__tests__
 */
import type {
  FulfillmentRoutingResolution,
  IFulfillmentRoutingService,
} from '@openlinker/core/mappings';
import type { Connection } from '@openlinker/core/identifier-mapping';

import type { IConnectionService } from '../../../integrations/application/interfaces/connection.service.interface';
import { toParcelResponseDto } from '../../http/dto/bench-parcel.mapper';
import { toBenchParcelRoute } from '../bench-parcel-route';
import { BenchRouteResolver } from '../services/bench-route.resolver';
import type { BenchParcelView } from '../types/bench-parcel.types';

const CARRIER_ID = '22222222-2222-2222-2222-222222222222';
const SHOP_ID = '33333333-3333-3333-3333-333333333333';
const SOURCE_ID = '44444444-4444-4444-4444-444444444444';

const ruleResolution = (
  over: Partial<FulfillmentRoutingResolution> = {}
): FulfillmentRoutingResolution => ({
  processorKind: 'ol_managed_carrier',
  processorConnectionId: CARRIER_ID,
  source: 'rule',
  processorAvailable: true,
  parcelProfile: null,
  ...over,
});

const defaultResolution: FulfillmentRoutingResolution = {
  processorKind: 'omp_fulfilled',
  processorConnectionId: null,
  source: 'default',
  processorAvailable: true,
  parcelProfile: null,
};

describe('toBenchParcelRoute', () => {
  it('should report a label route from a rule with the carrier name', () => {
    expect(
      toBenchParcelRoute({
        resolution: ruleResolution(),
        processorName: 'InPost',
        methodLabel: 'InPost Paczkomat',
      })
    ).toEqual({
      processorKind: 'ol_managed_carrier',
      processorName: 'InPost',
      fromRule: true,
      processorAvailable: true,
      methodLabel: 'InPost Paczkomat',
    });
  });

  it('should read a rule that routes to the shop as a choice, not as "nobody chose"', () => {
    const route = toBenchParcelRoute({
      resolution: ruleResolution({
        processorKind: 'omp_fulfilled',
        processorConnectionId: SHOP_ID,
      }),
      processorName: 'My shop',
      methodLabel: 'Courier',
    });

    expect(route.processorKind).toBe('omp_fulfilled');
    expect(route.fromRule).toBe(true);
    expect(route.processorName).toBe('My shop');
  });

  it('should report the default route as not chosen and naming no connection', () => {
    const route = toBenchParcelRoute({
      resolution: defaultResolution,
      // A name handed in for a route that names no connection must not leak.
      processorName: 'Stale name',
      methodLabel: 'Pickup',
    });

    expect(route.fromRule).toBe(false);
    expect(route.processorName).toBeNull();
    expect(route.methodLabel).toBe('Pickup');
  });

  it('should carry a switched-off processor through as unavailable', () => {
    const route = toBenchParcelRoute({
      resolution: ruleResolution({ processorAvailable: false }),
      processorName: 'InPost',
      methodLabel: 'InPost Paczkomat',
    });

    expect(route.processorAvailable).toBe(false);
  });

  it('should treat a blank method label as no label', () => {
    const route = toBenchParcelRoute({
      resolution: defaultResolution,
      processorName: null,
      methodLabel: '   ',
    });

    expect(route.methodLabel).toBeNull();
  });
});

describe('BenchRouteResolver', () => {
  function build(options: { resolve?: jest.Mock; get?: jest.Mock }): {
    resolver: BenchRouteResolver;
    routing: IFulfillmentRoutingService;
    connections: IConnectionService;
  } {
    const routing = {
      resolve: options.resolve ?? jest.fn().mockResolvedValue(ruleResolution()),
    } as unknown as IFulfillmentRoutingService;
    const connections = {
      get:
        options.get ??
        jest.fn().mockResolvedValue({ id: CARRIER_ID, name: 'InPost' } as unknown as Connection),
    } as unknown as IConnectionService;
    return { resolver: new BenchRouteResolver(routing, connections), routing, connections };
  }

  it('should resolve with the same inputs the label purchase uses', async () => {
    const { resolver, routing } = build({});

    await resolver.resolve({
      sourceConnectionId: SOURCE_ID,
      sourceDeliveryMethodId: 'ip-locker',
      methodLabel: 'InPost Paczkomat',
    });

    expect(routing.resolve).toHaveBeenCalledWith({
      sourceConnectionId: SOURCE_ID,
      sourceDeliveryMethodId: 'ip-locker',
    });
  });

  it('should name the routed connection when a rule names one', async () => {
    const { resolver, connections } = build({});

    const route = await resolver.resolve({
      sourceConnectionId: SOURCE_ID,
      sourceDeliveryMethodId: 'ip-locker',
      methodLabel: 'InPost Paczkomat',
    });

    expect(connections.get).toHaveBeenCalledWith(CARRIER_ID);
    expect(route?.processorName).toBe('InPost');
  });

  it('should not read any connection on the default route', async () => {
    const { resolver, connections } = build({
      resolve: jest.fn().mockResolvedValue(defaultResolution),
    });

    const route = await resolver.resolve({
      sourceConnectionId: SOURCE_ID,
      sourceDeliveryMethodId: 'pickup',
      methodLabel: 'Pickup',
    });

    expect(connections.get).not.toHaveBeenCalled();
    expect(route?.fromRule).toBe(false);
  });

  it('should keep the route but drop the name when the connection cannot be read', async () => {
    const { resolver } = build({ get: jest.fn().mockRejectedValue(new Error('gone')) });

    const route = await resolver.resolve({
      sourceConnectionId: SOURCE_ID,
      sourceDeliveryMethodId: 'ip-locker',
      methodLabel: 'InPost Paczkomat',
    });

    expect(route?.processorKind).toBe('ol_managed_carrier');
    expect(route?.processorName).toBeNull();
  });

  it('should answer no route when the routing read fails', async () => {
    const { resolver } = build({ resolve: jest.fn().mockRejectedValue(new Error('db down')) });

    await expect(
      resolver.resolve({
        sourceConnectionId: SOURCE_ID,
        sourceDeliveryMethodId: 'ip-locker',
        methodLabel: null,
      })
    ).resolves.toBeNull();
  });

  it('should answer no route when there is no order to resolve from', async () => {
    const { resolver, routing } = build({});

    await expect(resolver.resolve(null)).resolves.toBeNull();
    expect(routing.resolve).not.toHaveBeenCalled();
  });
});

describe('toParcelResponseDto route', () => {
  const baseView = {
    lines: [],
    otherParcelBuyerNoteAcknowledgements: [],
    packerNotes: [],
    sourceChange: null,
  };

  it('should map the route field by field when it is resolved', () => {
    const dto = toParcelResponseDto({
      ...baseView,
      route: {
        processorKind: 'source_brokered',
        processorName: 'Allegro',
        fromRule: true,
        processorAvailable: true,
        methodLabel: 'Allegro One Box',
      },
    } as unknown as BenchParcelView);

    expect(dto.route).toEqual({
      processorKind: 'source_brokered',
      processorName: 'Allegro',
      fromRule: true,
      processorAvailable: true,
      methodLabel: 'Allegro One Box',
    });
    // An allowlist: nothing beyond the five named fields crosses the wire.
    expect(Object.keys(dto.route ?? {}).sort()).toEqual(
      ['fromRule', 'methodLabel', 'processorAvailable', 'processorKind', 'processorName'].sort()
    );
  });

  it('should serialise an unresolved route as null', () => {
    const dto = toParcelResponseDto({ ...baseView, route: null } as unknown as BenchParcelView);

    expect(dto.route).toBeNull();
  });

  it('should serialise a view without a route key as null rather than throwing', () => {
    const dto = toParcelResponseDto(baseView as unknown as BenchParcelView);

    expect(dto.route).toBeNull();
  });
});
