/**
 * Shipments list filter system (#4044): status tabs, "Needs a look", the joined
 * Processor / Method / Connection group, pills, sort and the peek walk. The
 * older behaviours (redaction, order cell, triage strips) live in
 * `shipments-page.test.tsx`.
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
import { ShipmentsPage } from './shipments-page';
import type {
  PaginatedShipments,
  Shipment,
  ShipmentSummary,
} from '../../features/shipments/api/shipments.types';
import type { Connection } from '../../features/connections/api/connections.types';

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: 'ol_shipment_1',
    orderId: 'ol_order_1',
    customerId: null,
    connectionId: 'conn_inpost',
    shippingMethod: 'paczkomat',
    status: 'generated',
    providerShipmentId: 'shipx-1',
    paczkomatId: 'POZ08A',
    sourceDeliveryMethodId: null,
    deliveryIntent: null,
    trackingNumber: '6800000001',
    carrier: 'inpost',
    labelPdfRef: 'shipx:label:1',
    dispatchedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    failedAt: null,
    errorMessage: null,
    providerCode: null,
    createdAt: '2026-05-20T10:00:00.000Z',
    updatedAt: '2026-05-20T10:00:00.000Z',
    orderSummary: null,
    waybillRelay: null,
    ...overrides,
  };
}

function page(items: Shipment[]): PaginatedShipments {
  return { items, total: items.length, limit: 20, offset: 0 };
}

const connection: Connection = {
  id: 'conn_inpost',
  name: 'InPost',
  platformType: 'inpost',
  status: 'active',
  config: {},
  credentialsBacked: true,
  enabledCapabilities: [],
  supportedCapabilities: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const SUMMARY: ShipmentSummary = {
  total: 42,
  byStatus: { draft: 3, generated: 5, dispatched: 6, 'in-transit': 7, delivered: 15, failed: 4, cancelled: 2 },
  byProcessor: { omp: 9, carrier: 33 },
  byMethod: { paczkomat: 20, kurier: 11, pickup: 2, omp: 9 },
  byConnection: { conn_inpost: 30 },
  waybillRelayStuck: 2,
  toSend: 8,
  failedCauseGroups: [
    { connectionId: 'conn_inpost', providerCode: 'POINT_UNAVAILABLE', sampleReason: 'Target point unavailable', count: 3 },
  ],
};

function setup(options: { route?: string; rows?: Shipment[]; summary?: ShipmentSummary | Promise<never> } = {}): {
  list: ReturnType<typeof vi.fn>;
  summary: ReturnType<typeof vi.fn>;
} {
  const list = vi.fn().mockResolvedValue(page(options.rows ?? [makeShipment()]));
  const summary =
    options.summary instanceof Promise
      ? vi.fn().mockReturnValue(options.summary)
      : vi.fn().mockResolvedValue(options.summary ?? SUMMARY);
  renderWithProviders(<ShipmentsPage />, {
    apiClient: createMockApiClient({
      shipments: { list, summary },
      connections: { list: vi.fn().mockResolvedValue([connection]) },
    }),
    route: options.route ?? '/shipments',
    sessionAdapter: createAuthenticatedSessionAdapter(),
  });
  return { list, summary };
}

function lastListFilters(list: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return list.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

describe('ShipmentsPage filter system (#4044)', () => {
  afterEach(cleanup);

  it('should show a status tab per status with the summary counts', async () => {
    setup();
    const tabs = await screen.findByRole('tablist', { name: 'Shipments by status' });
    await waitFor(() => {
      expect(within(tabs).getByRole('tab', { name: /All shipments/ })).toHaveTextContent('42');
    });
    expect(within(tabs).getByRole('tab', { name: /In transit/ })).toHaveTextContent('7');
    expect(within(tabs).getByRole('tab', { name: /Failed/ })).toHaveTextContent('4');
  });

  it('should never render a 0 count while the summary is still loading', async () => {
    setup({ summary: new Promise<never>(() => {}) });
    const tabs = await screen.findByRole('tablist', { name: 'Shipments by status' });
    expect(within(tabs).getByRole('tab', { name: /All shipments/ })).not.toHaveTextContent('0');
  });

  it('should filter by status when a tab is picked', async () => {
    const { list } = setup();
    fireEvent.click(await screen.findByRole('tab', { name: /Delivered/ }));
    await waitFor(() => {
      expect(lastListFilters(list)).toMatchObject({ status: 'delivered' });
    });
  });

  it('should show "Needs a look" totals and toggle the failed filter from "to fix"', async () => {
    const { list } = setup();
    const group = await screen.findByRole('group', { name: 'Needs a look' });
    await waitFor(() => {
      expect(group).toHaveTextContent('4to fix');
    });
    expect(group).toHaveTextContent('2tracking not sent');
    expect(group).toHaveTextContent('8to send');

    fireEvent.click(within(group).getByText('to fix'));
    fireEvent.click(await screen.findByRole('button', { name: /Failed shipments/ }));
    await waitFor(() => {
      expect(lastListFilters(list)).toMatchObject({ status: 'failed' });
    });
  });

  it('should list a cross-page cause group under "to fix" and show its failures', async () => {
    const { list } = setup();
    const group = await screen.findByRole('group', { name: 'Needs a look' });
    await waitFor(() => {
      expect(group).toHaveTextContent('4to fix');
    });
    fireEvent.click(within(group).getByText('to fix'));
    const pop = await screen.findByRole('dialog', { name: 'Failed - needs fixing' });
    expect(within(pop).getByText('POINT_UNAVAILABLE')).toBeInTheDocument();
    expect(within(pop).getByText('3 on InPost')).toBeInTheDocument();

    fireEvent.click(within(pop).getByRole('button', { name: 'Show' }));
    await waitFor(() => {
      expect(lastListFilters(list)).toMatchObject({ status: 'failed', connectionId: 'conn_inpost' });
    });
  });

  it('should toggle the tracking-not-sent filter from "Needs a look"', async () => {
    const { list } = setup();
    const group = await screen.findByRole('group', { name: 'Needs a look' });
    fireEvent.click(within(group).getByText('tracking not sent'));
    fireEvent.click(await screen.findByRole('button', { name: /Tracking not sent to channel/ }));
    await waitFor(() => {
      expect(lastListFilters(list)).toMatchObject({ waybillRelayStuck: true });
    });
  });

  it('should show option counts in the Processor dropdown and filter by it', async () => {
    const { list } = setup();
    const filters = await screen.findByRole('group', { name: 'Filters' });
    fireEvent.click(within(filters).getByRole('button', { name: /Processor/ }));
    const carrier = await screen.findByRole('button', { name: /Carrier/ });
    await waitFor(() => {
      expect(carrier).toHaveTextContent('33');
    });
    fireEvent.click(carrier);
    await waitFor(() => {
      expect(lastListFilters(list)).toMatchObject({ hasProviderShipmentId: true });
    });
  });

  it('should keep Method visible and explain why it is locked while a processor is set', async () => {
    setup({ route: '/shipments?processor=omp' });
    const filters = await screen.findByRole('group', { name: 'Filters' });
    fireEvent.click(within(filters).getByRole('button', { name: /^Method/ }));
    expect(
      await screen.findByText('A processor already picks the method. Clear Processor to choose one.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Kurier/ })).toBeDisabled();
  });

  it('should show applied pills and keep the status tab when Clear all is used', async () => {
    const { list } = setup({ route: '/shipments?status=failed&connectionId=conn_inpost&hasTracking=true' });
    await screen.findByRole('table');
    expect(document.querySelector('.filter-chip__value')?.textContent).toBe('InPost');
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear all' })[0]);
    await waitFor(() => {
      const filters = lastListFilters(list);
      expect(filters).toMatchObject({ status: 'failed' });
      expect(filters.connectionId).toBeUndefined();
      expect(filters.hasTracking).toBeUndefined();
    });
  });

  it('should sort the page by status from the Sort menu', async () => {
    setup({
      rows: [
        makeShipment({ id: 'ol_shipment_d', status: 'delivered', orderSummary: { orderNumber: 'D-1', firstItemName: null, firstItemImageUrl: null, itemCount: 1 } }),
        makeShipment({ id: 'ol_shipment_a', status: 'draft', orderSummary: { orderNumber: 'A-1', firstItemName: null, firstItemImageUrl: null, itemCount: 1 } }),
      ],
    });
    await screen.findByText('D-1');
    fireEvent.click(screen.getByRole('button', { name: /Sort/ }));
    // The last match is the menu entry; the first is the column header button.
    await screen.findByRole('dialog', { name: 'Sort shipments' }).catch(() => null);
    fireEvent.click(screen.getAllByRole('button', { name: /^Status/ }).at(-1) as HTMLElement);
    await waitFor(() => {
      const rows = screen.getAllByRole('row').slice(1);
      expect(rows[0]).toHaveTextContent('A-1');
    });
  });

  it('should open the peek on a row click and walk rows with j and k', async () => {
    setup({
      rows: [
        makeShipment({ id: 'ol_shipment_1', createdAt: '2026-05-21T10:00:00.000Z', orderSummary: { orderNumber: 'FIRST-1', firstItemName: null, firstItemImageUrl: null, itemCount: 1 } }),
        makeShipment({ id: 'ol_shipment_2', createdAt: '2026-05-20T10:00:00.000Z', orderSummary: { orderNumber: 'SECOND-2', firstItemName: null, firstItemImageUrl: null, itemCount: 1 } }),
      ],
    });
    await screen.findByText('FIRST-1');
    fireEvent.click(screen.getAllByRole('row')[1]);
    const peek = await screen.findByRole('dialog');
    expect(within(peek).getByText('1 of 2')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'j' });
    await waitFor(() => {
      expect(within(screen.getByRole('dialog')).getByText('2 of 2')).toBeInTheDocument();
    });
    fireEvent.keyDown(document, { key: 'k' });
    await waitFor(() => {
      expect(within(screen.getByRole('dialog')).getByText('1 of 2')).toBeInTheDocument();
    });
  });

  it('should not show the triage strips outside the Failed tab', async () => {
    setup({
      rows: [
        makeShipment({ id: 'a', status: 'failed', errorMessage: 'alpha rejection' }),
        makeShipment({ id: 'b', status: 'failed', errorMessage: 'alpha rejection 2' }),
      ],
    });
    await screen.findByRole('table');
    expect(screen.queryByText(/report the same carrier message/i)).not.toBeInTheDocument();
  });
});
