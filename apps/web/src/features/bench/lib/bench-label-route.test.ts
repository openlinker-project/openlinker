/**
 * Which label case a box is in (#3958)
 */
import { describe, expect, it } from 'vitest';

import type { BenchParcelRoute } from '../api/bench-parcel.types';
import {
  describeBenchLabelRoute,
  isCarrierAccountable,
  labelCarrierName,
} from './bench-label-route';

function route(over: Partial<BenchParcelRoute> = {}): BenchParcelRoute {
  return {
    processorKind: 'ol_managed_carrier',
    processorName: 'InPost',
    fromRule: true,
    processorAvailable: true,
    methodLabel: 'InPost Paczkomat',
    ...over,
  };
}

describe('describeBenchLabelRoute', () => {
  it('should read a carrier route as buying a label', () => {
    expect(describeBenchLabelRoute(route())).toEqual({
      kind: 'buys-label',
      carrierName: 'InPost',
      methodLabel: 'InPost Paczkomat',
    });
  });

  it('should read a marketplace-brokered route as buying a label too', () => {
    expect(describeBenchLabelRoute(route({ processorKind: 'source_brokered' })).kind).toBe(
      'buys-label'
    );
  });

  it('should read a label route through a switched-off carrier as no label coming', () => {
    expect(describeBenchLabelRoute(route({ processorAvailable: false })).kind).toBe('carrier-off');
  });

  it('should read a rule to the shop as the shop shipping it', () => {
    expect(
      describeBenchLabelRoute(route({ processorKind: 'omp_fulfilled', processorName: 'My shop' }))
    ).toEqual({ kind: 'shop-ships', shopName: 'My shop', methodLabel: 'InPost Paczkomat' });
  });

  it('should read the default route as nobody having chosen', () => {
    expect(
      describeBenchLabelRoute(
        route({ processorKind: 'omp_fulfilled', processorName: null, fromRule: false })
      )
    ).toEqual({ kind: 'no-carrier', methodLabel: 'InPost Paczkomat' });
  });

  it('should read a missing route as unknown', () => {
    expect(describeBenchLabelRoute(null).kind).toBe('unknown');
  });

  it('should read a kind this build does not know as unknown rather than guessing', () => {
    expect(describeBenchLabelRoute(route({ processorKind: 'drone' })).kind).toBe('unknown');
  });
});

describe('isCarrierAccountable', () => {
  it('should hold the carrier accountable only on a label route or an unknown one', () => {
    expect(isCarrierAccountable(describeBenchLabelRoute(route()))).toBe(true);
    expect(isCarrierAccountable(describeBenchLabelRoute(null))).toBe(true);
    expect(
      isCarrierAccountable(describeBenchLabelRoute(route({ processorKind: 'omp_fulfilled' })))
    ).toBe(false);
    expect(
      isCarrierAccountable(
        describeBenchLabelRoute(route({ processorKind: 'omp_fulfilled', fromRule: false }))
      )
    ).toBe(false);
  });
});

describe('labelCarrierName', () => {
  it('should name the carrier only on a route that buys a label', () => {
    expect(labelCarrierName(describeBenchLabelRoute(route()))).toBe('InPost');
    expect(
      labelCarrierName(describeBenchLabelRoute(route({ processorKind: 'omp_fulfilled' })))
    ).toBeNull();
    expect(labelCarrierName(describeBenchLabelRoute(null))).toBeNull();
  });
});
