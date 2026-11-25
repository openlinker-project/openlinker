/**
 * Two sales channels, two carriers (#4135): each channel's summary shows its
 * own assignments and nothing implies a single carrier or channel.
 */
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import type { RoutingRule } from '../../mappings';
import type { Connection } from '../api/connections.types';
import { ChannelShippingSummarySection } from './channel-shipping-summary-section';

afterEach(cleanup);

const shop: Connection = {
  ...sampleConnection,
  id: 'shop-1',
  name: 'Main shop',
  platformType: 'prestashop',
  config: {},
  enabledCapabilities: ['ProductMaster'],
};
const channel = (id: string, name: string): Connection => ({
  ...sampleConnection,
  id,
  name,
  platformType: 'allegro',
  config: { masterCatalogConnectionId: 'shop-1' },
  enabledCapabilities: ['OrderSource'],
  supportedCapabilities: ['OrderSource'],
});
const chA = channel('ch-a', 'Allegro A');
const chB = channel('ch-b', 'Allegro B');
const inpost: Connection = { ...sampleConnection, id: 'c-inpost', name: 'InPost carrier', platformType: 'inpost', config: {}, enabledCapabilities: ['ShippingProviderManager'] };
const dpd: Connection = { ...sampleConnection, id: 'c-dpd', name: 'DPD carrier', platformType: 'dpd-polska', config: {}, enabledCapabilities: ['ShippingProviderManager'] };

const rule = (src: string, method: string, carrier: string): RoutingRule => ({
  id: `${src}-${method}`,
  sourceConnectionId: src,
  sourceDeliveryMethodId: method,
  processorKind: 'ol_managed_carrier',
  processorConnectionId: carrier,
});

describe('ChannelShippingSummarySection', () => {
  it('should show each channel its own carrier assignments when two channels use two carriers', async () => {
    const rules: Record<string, RoutingRule[]> = {
      'ch-a': [rule('ch-a', 'locker', 'c-inpost'), rule('ch-a', 'courier', 'c-dpd')],
      'ch-b': [rule('ch-b', 'locker', 'c-dpd')],
    };
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([shop, chA, chB, inpost, dpd]) },
      mappings: {
        getRoutingRules: vi.fn((id: string) => Promise.resolve(rules[id] ?? [])),
        getMappingOptions: vi.fn((_id: string, side: string, kind: string) =>
          side === 'source' && kind === 'delivery-methods'
            ? Promise.resolve([
                { value: 'locker', label: 'Locker' },
                { value: 'courier', label: 'Courier' },
              ])
            : Promise.resolve([])
        ),
      },
    });

    renderWithProviders(<ChannelShippingSummarySection connection={shop} />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    const items = await screen.findAllByRole('listitem');
    const a = items.find((li) => within(li).queryByText(/Allegro A/))!;
    const b = items.find((li) => within(li).queryByText(/Allegro B/))!;
    expect(await within(a).findByText(/InPost carrier/)).toBeInTheDocument();
    expect(within(a).getByText(/DPD carrier/)).toBeInTheDocument();
    expect(within(a).getByText('2 of 2', { exact: false })).toBeInTheDocument();
    expect(await within(b).findByText(/DPD carrier/)).toBeInTheDocument();
    expect(within(b).queryByText(/InPost carrier/)).toBeNull();
    expect(within(b).getByText('1 of 2', { exact: false })).toBeInTheDocument();
    expect(within(b).getByRole('link', { name: 'Configure in Mappings' })).toHaveAttribute(
      'href',
      '/connections/ch-b/mappings?tab=fulfillment'
    );
  });
});
