import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';
import type { Connection } from '../api/connections.types';
import { CarrierMappingsNotice, CarrierShipsForCard } from './carrier-ships-for-card';

function channel(id: string, name: string): Connection {
  return { ...sampleConnection, id, name, enabledCapabilities: ['OrderSource'] };
}
function carrier(id: string, name: string): Connection {
  return { ...sampleConnection, id, name, enabledCapabilities: ['ShippingProviderManager'] };
}

const channelA = channel('ch_a', 'Allegro A');
const channelB = channel('ch_b', 'Allegro B');
const inpost = carrier('car_inpost', 'InPost');
const dpd = carrier('car_dpd', 'DPD');

function rule(source: string, method: string, processor: string): Record<string, unknown> {
  return {
    id: `${source}-${method}`,
    sourceConnectionId: source,
    sourceDeliveryMethodId: method,
    processorKind: 'ol-managed-carrier',
    processorConnectionId: processor,
  };
}

function client(rules: Record<string, Record<string, unknown>[]>): ReturnType<typeof createMockApiClient> {
  return createMockApiClient({
    connections: {
      list: vi.fn().mockResolvedValue([channelA, channelB, inpost, dpd]),
    },
    mappings: {
      getRoutingRules: vi.fn((id: string) => Promise.resolve(rules[id] ?? [])),
    },
  } as never);
}

describe('CarrierShipsForCard (#4137)', () => {
  afterEach(cleanup);

  it('lists per-channel methods for the carrier and links to each channel, without an editor', async () => {
    // 2 channels x 2 carriers: the carrier appears on both channels, the other only on one.
    const apiClient = client({
      ch_a: [rule('ch_a', 'm1', 'car_inpost'), rule('ch_a', 'm2', 'car_inpost'), rule('ch_a', 'm3', 'car_dpd')],
      ch_b: [rule('ch_b', 'm4', 'car_inpost')],
    });
    renderWithProviders(<CarrierShipsForCard connection={inpost} />, { apiClient });

    const rowA = await screen.findByTestId('ships-for-row-ch_a');
    expect(await screen.findByTestId('ships-for-row-ch_b')).toBeInTheDocument();
    expect(rowA).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/connections/ch_a/mappings?tab=fulfillment',
      '/connections/ch_b/mappings?tab=fulfillment',
    ]);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/is not used yet/i)).not.toBeInTheDocument();
  });

  it('says an unassigned account is not used yet and links to the channels', async () => {
    const apiClient = client({ ch_a: [rule('ch_a', 'm3', 'car_dpd')], ch_b: [] });
    renderWithProviders(<CarrierShipsForCard connection={inpost} />, { apiClient });

    expect(await screen.findByText('InPost is not used yet')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});

describe('CarrierMappingsNotice (#4137)', () => {
  afterEach(cleanup);

  it('explains that assignment lives on the sales channel and links to each', async () => {
    renderWithProviders(<CarrierMappingsNotice connection={dpd} />, { apiClient: client({}) });

    expect(await screen.findByText(/carrier account, not a sales channel/i)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Open Allegro A' })).toHaveAttribute(
      'href',
      '/connections/ch_a/mappings?tab=fulfillment'
    );
  });
});
