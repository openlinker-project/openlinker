/**
 * Dispatch Risk Page tests (#2306)
 *
 * The load-bearing assertions are the two scope ones: both reads must carry
 * `cancelled: false`, and the list must be pinned to the server-side ship-by
 * ascending sort. If either drifts, the tab counts stop describing the rows.
 */
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { DispatchRiskPage } from './dispatch-risk-page';
import type {
  PaginatedOrders,
  OrderRecord,
  OrderSlaSummary,
  OrderFilters,
  OrderPagination,
  OrderHealthSummaryFilters,
} from '../../features/orders/api/orders.types';

function makeOrderRecord(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    internalOrderId: 'ol_order_aabbccdd1122334455',
    customerId: null,
    sourceConnectionId: 'conn-1111-2222-3333-444444444444',
    sourceEventId: 'evt-001',
    orderSnapshot: {
      externalOrderId: 'EXT-123',
      items: [
        { id: 'item-1', productRef: { type: 'offer', externalId: 'offer-a' }, quantity: 1, price: 9.99 },
      ],
    },
    syncStatus: [],
    syncAttempts: [],
    recordStatus: 'ready',
    slaState: 'overdue',
    fulfillmentState: 'not-shipped',
    dispatchByAt: '2026-04-10T08:00:00.000Z',
    createdAt: '2026-04-10T08:00:00.000Z',
    updatedAt: '2026-04-10T10:00:00.000Z',
    ...overrides,
  };
}

const sampleData: PaginatedOrders = {
  items: [makeOrderRecord()],
  total: 1,
  limit: 25,
  offset: 0,
};

const sampleSummary: OrderSlaSummary = {
  total: 9,
  onTrack: 4,
  atRisk: 2,
  overdue: 3,
  none: 0,
};

type ListMock = (
  filters?: OrderFilters,
  pagination?: OrderPagination,
) => Promise<PaginatedOrders>;
type SlaSummaryMock = (filters?: OrderHealthSummaryFilters) => Promise<OrderSlaSummary>;

function mockApiWith(overrides: {
  list?: ListMock;
  slaSummary?: SlaSummaryMock;
}): ReturnType<typeof createMockApiClient> {
  return createMockApiClient({
    orders: {
      list: overrides.list ?? vi.fn<ListMock>().mockResolvedValue(sampleData),
      slaSummary: overrides.slaSummary ?? vi.fn<SlaSummaryMock>().mockResolvedValue(sampleSummary),
    },
    connections: { list: vi.fn().mockResolvedValue([]) },
  });
}

describe('DispatchRiskPage', () => {
  afterEach(cleanup);

  it('should show loading state initially', () => {
    const mockApi = mockApiWith({ list: vi.fn().mockReturnValue(new Promise(() => {})) });

    renderWithProviders(<DispatchRiskPage />, { apiClient: mockApi });

    expect(screen.getByText('Loading dispatch risk')).toBeInTheDocument();
  });

  it('should pin the list to the server-side ship-by ascending sort and exclude cancelled orders', async () => {
    const list = vi.fn().mockResolvedValue(sampleData);
    const mockApi = mockApiWith({ list });

    renderWithProviders(<DispatchRiskPage />, { apiClient: mockApi });

    await screen.findByText('ol_order_aabbccdd1122334455');

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        slaState: 'overdue',
        cancelled: false,
        sort: 'dispatchBy',
        dir: 'asc',
      }),
      expect.any(Object),
    );
  });

  it('should scope the bucket-count summary identically to the rows', async () => {
    const slaSummary = vi.fn().mockResolvedValue(sampleSummary);
    const mockApi = mockApiWith({ slaSummary });

    renderWithProviders(<DispatchRiskPage />, { apiClient: mockApi });

    await screen.findByText('ol_order_aabbccdd1122334455');

    expect(slaSummary).toHaveBeenCalledWith(expect.objectContaining({ cancelled: false }));
  });

  it('should render bucket counts from the summary', async () => {
    const mockApi = mockApiWith({});

    renderWithProviders(<DispatchRiskPage />, { apiClient: mockApi });

    // #2441 review S2 — bare-number form, matching the orders-list chips.
    expect(await screen.findByRole('button', { name: /Overdue 3/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Due soon 2/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /On track 4/ })).toBeInTheDocument();
  });

  it('should refetch with the selected bucket when a tab is clicked', async () => {
    const list = vi.fn().mockResolvedValue(sampleData);
    const mockApi = mockApiWith({ list });

    renderWithProviders(<DispatchRiskPage />, { apiClient: mockApi });

    await screen.findByText('ol_order_aabbccdd1122334455');
    await userEvent.click(screen.getByRole('button', { name: /Due soon/ }));

    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ slaState: 'at_risk', cancelled: false }),
      expect.any(Object),
    );
  });

  it('should link each row to the order detail page', async () => {
    const mockApi = mockApiWith({});

    renderWithProviders(<DispatchRiskPage />, { apiClient: mockApi });

    const link = await screen.findByRole('link', { name: /ol_order_aabbccdd1122334455/ });
    expect(link).toHaveAttribute('href', '/orders/ol_order_aabbccdd1122334455');
  });

  it('should render the Operations eyebrow to match sibling pages', async () => {
    const mockApi = mockApiWith({});

    renderWithProviders(<DispatchRiskPage />, { apiClient: mockApi });

    await screen.findByText('ol_order_aabbccdd1122334455');
    expect(screen.getByText('Operations')).toBeInTheDocument();
  });

  it('should distinguish an empty bucket from a catalogue with no deadlines at all', async () => {
    const emptyList: PaginatedOrders = { items: [], total: 0, limit: 25, offset: 0 };
    const mockApi = mockApiWith({
      list: vi.fn().mockResolvedValue(emptyList),
      slaSummary: vi
        .fn()
        .mockResolvedValue({ total: 5, onTrack: 0, atRisk: 0, overdue: 0, none: 5 }),
    });

    renderWithProviders(<DispatchRiskPage />, { apiClient: mockApi });

    expect(await screen.findByText('No ship-by deadlines')).toBeInTheDocument();
  });

  it('should report an empty bucket when other buckets are populated', async () => {
    const emptyList: PaginatedOrders = { items: [], total: 0, limit: 25, offset: 0 };
    const mockApi = mockApiWith({ list: vi.fn().mockResolvedValue(emptyList) });

    renderWithProviders(<DispatchRiskPage />, { apiClient: mockApi });

    expect(await screen.findByText('Nothing overdue')).toBeInTheDocument();
  });

  it('should show the error state with a retry action', async () => {
    const mockApi = mockApiWith({ list: vi.fn().mockRejectedValue(new Error('boom')) });

    renderWithProviders(<DispatchRiskPage />, { apiClient: mockApi });

    expect(await screen.findByText('Could not load dispatch risk')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
