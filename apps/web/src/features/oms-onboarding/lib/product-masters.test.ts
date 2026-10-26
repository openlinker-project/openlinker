import { describe, expect, it } from 'vitest';

import type { Connection } from '../../connections';
import { selectProductMasters } from './product-masters';

function connection(overrides: Partial<Connection>): Connection {
  return {
    id: 'c1',
    name: 'Shop',
    platformType: 'prestashop',
    status: 'active',
    config: {},
    credentialsBacked: true,
    enabledCapabilities: ['ProductMaster', 'InventoryMaster'],
    supportedCapabilities: ['ProductMaster', 'InventoryMaster'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('selectProductMasters', () => {
  it('should return nothing when there are no connections', () => {
    expect(selectProductMasters([])).toEqual({ eligible: [], partial: [] });
  });

  it('should select an active connection with both capabilities advertised and enabled', () => {
    const shop = connection({});
    expect(selectProductMasters([shop]).eligible).toEqual([shop]);
  });

  it('should select two product masters', () => {
    const a = connection({ id: 'a' });
    const b = connection({ id: 'b', platformType: 'woocommerce' });
    expect(selectProductMasters([a, b]).eligible).toEqual([a, b]);
  });

  it('should qualify a platform the wizard has never heard of when it declares both', () => {
    // D19: capability alone, so a Subiekt-shaped connection needs no wizard change.
    const subiekt = connection({ id: 's', platformType: 'subiekt' });
    expect(selectProductMasters([subiekt]).eligible).toEqual([subiekt]);
  });

  it('should list a single-capability connection as partial and name what is missing', () => {
    const shop = connection({ enabledCapabilities: ['ProductMaster'] });
    const result = selectProductMasters([shop]);
    expect(result.eligible).toEqual([]);
    expect(result.partial).toEqual([{ connection: shop, missing: ['InventoryMaster'] }]);
  });

  it('should not count a capability the adapter advertises but the connection has not enabled', () => {
    const shop = connection({ enabledCapabilities: ['InventoryMaster'] });
    expect(selectProductMasters([shop]).partial[0].missing).toEqual(['ProductMaster']);
  });

  it('should skip a disabled connection entirely', () => {
    const shop = connection({ status: 'disabled' });
    expect(selectProductMasters([shop])).toEqual({ eligible: [], partial: [] });
  });

  it('should ignore a connection with neither capability', () => {
    const marketplace = connection({
      platformType: 'allegro',
      enabledCapabilities: ['OrderSource'],
      supportedCapabilities: ['OrderSource', 'OfferManager'],
    });
    expect(selectProductMasters([marketplace])).toEqual({ eligible: [], partial: [] });
  });
});
