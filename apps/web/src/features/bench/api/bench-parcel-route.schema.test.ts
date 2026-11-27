/**
 * Bench wire parsing: who ships the box (#3958)
 *
 * The route is defaulted to `null` rather than required, so an API that
 * predates it still parses and the box is never hidden from the packer.
 */
import { describe, expect, it } from 'vitest';

import { parseBenchParcel } from './bench-parcel.schema';

const BASE_PARCEL = {
  workId: 'w-1',
  version: 1,
  orderReference: 'OL-1',
  parcelIndex: 1,
  parcelTotal: 1,
  lines: [],
};

describe('bench parcel route parsing (#3958)', () => {
  it('should read an API that predates the route as no route known', () => {
    expect(parseBenchParcel(BASE_PARCEL).route).toBeNull();
    expect(parseBenchParcel({ ...BASE_PARCEL, route: null }).route).toBeNull();
  });

  it('should carry the route the API resolved', () => {
    const parcel = parseBenchParcel({
      ...BASE_PARCEL,
      route: {
        processorKind: 'ol_managed_carrier',
        processorName: 'InPost',
        fromRule: true,
        processorAvailable: true,
        methodLabel: 'InPost Paczkomat',
      },
    });

    expect(parcel.route).toEqual({
      processorKind: 'ol_managed_carrier',
      processorName: 'InPost',
      fromRule: true,
      processorAvailable: true,
      methodLabel: 'InPost Paczkomat',
    });
  });

  it('should keep an unrecognised processor kind as a string for the card to read as unknown', () => {
    const parcel = parseBenchParcel({
      ...BASE_PARCEL,
      route: { processorKind: 'drone', processorName: null, fromRule: true, methodLabel: null },
    });

    expect(parcel.route?.processorKind).toBe('drone');
    // An older API without the availability flag reads as available.
    expect(parcel.route?.processorAvailable).toBe(true);
  });
});
