import { describe, expect, it } from 'vitest';

import type { Connection } from '../api/connections.types';
import { channelsForShippingSummary } from './channel-shipping-summary-section';
import { shippingAssignmentPath } from './shipping-assignment-path';

function conn(id: string, over: Partial<Connection> = {}): Connection {
  return {
    id,
    name: id,
    platformType: 'x',
    status: 'active',
    config: {},
    credentialsBacked: true,
    enabledCapabilities: [],
    supportedCapabilities: [],
    ...over,
  } as Connection;
}

describe('channelsForShippingSummary', () => {
  const shop = conn('shop', { enabledCapabilities: ['ProductMaster'] });
  const a = conn('A', { enabledCapabilities: ['OrderSource'], config: { masterCatalogConnectionId: 'shop' } });
  const b = conn('B', { enabledCapabilities: ['OrderSource'], config: { masterCatalogConnectionId: 'shop' } });
  const other = conn('C', { enabledCapabilities: ['OrderSource'], config: { masterCatalogConnectionId: 'else' } });

  it('should list every paired channel when the connection is the shop', () => {
    expect(channelsForShippingSummary(shop, [shop, a, b, other]).map((c) => c.id)).toEqual(['A', 'B']);
  });

  it('should list only itself when the connection is a channel', () => {
    expect(channelsForShippingSummary(a, [shop, a, b]).map((c) => c.id)).toEqual(['A']);
  });

  it('should link to the fulfilment tab of the channel', () => {
    expect(shippingAssignmentPath('A')).toBe('/connections/A/mappings?tab=fulfillment');
  });
});
