import { describe, expect, it } from 'vitest';

import { resolveDeliveryOwner, type DeliveryOwnerConnectionInfo } from './delivery-owner';
import type { OrderDeliveryResolution } from '../api/orders.types';

const connections = new Map<string, DeliveryOwnerConnectionInfo>([
  ['conn-dpd', { name: 'DPD test', platformType: 'dpd' }],
  ['conn-ps', { name: 'PrestaShop (master)', platformType: 'prestashop' }],
]);

const carrierRoute: OrderDeliveryResolution = {
  source: 'rule',
  processorKind: 'ol_managed_carrier',
  processorConnectionId: 'conn-dpd',
  processorAvailable: true,
};

describe('resolveDeliveryOwner (#1776)', () => {
  it('names the CARRIER connection for a live own-carrier route', () => {
    expect(resolveDeliveryOwner(carrierRoute, undefined, connections)).toEqual({
      name: 'DPD test',
      platformType: 'dpd',
      variant: 'carrier',
    });
  });

  it('falls back to the rider candidate carrier when the processor id is unknown', () => {
    const owner = resolveDeliveryOwner(
      { ...carrierRoute, processorConnectionId: 'conn-missing' },
      { rider: 'none', candidateCarrier: { platformType: 'inpost', displayName: 'InPost' } },
      connections,
    );
    expect(owner).toEqual({ name: 'InPost', platformType: 'inpost', variant: 'carrier' });
  });

  it('names the shop connection for an explicit omp rule', () => {
    const owner = resolveDeliveryOwner(
      {
        source: 'rule',
        processorKind: 'omp_fulfilled',
        processorConnectionId: 'conn-ps',
        processorAvailable: true,
      },
      undefined,
      connections,
    );
    expect(owner).toEqual({
      name: 'PrestaShop (master)',
      platformType: 'prestashop',
      variant: 'shop',
    });
  });

  it('returns a generic, name-less shop owner for the default omp fallback', () => {
    const owner = resolveDeliveryOwner(
      {
        source: 'default',
        processorKind: 'omp_fulfilled',
        processorConnectionId: null,
        processorAvailable: true,
      },
      undefined,
      connections,
    );
    expect(owner).toEqual({ name: null, platformType: null, variant: 'shop' });
  });

  it('treats a disabled carrier route as a shop owner (not a live carrier)', () => {
    // processorAvailable false => not a live OL route, so it must not badge as a carrier.
    const owner = resolveDeliveryOwner(
      { ...carrierRoute, processorAvailable: false },
      undefined,
      connections,
    );
    expect(owner.variant).toBe('shop');
  });

  it('returns a generic shop owner when there is no resolution at all', () => {
    expect(resolveDeliveryOwner(undefined, undefined, connections)).toEqual({
      name: null,
      platformType: null,
      variant: 'shop',
    });
  });
});
