import { waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../test/test-utils';
import { useNavCounts, type NavCounts } from './use-nav-counts';

function Probe({ onCounts }: { onCounts: (counts: NavCounts) => void }): null {
  const counts = useNavCounts();
  onCounts(counts);
  return null;
}

describe('useNavCounts', () => {
  afterEach(cleanup);

  it('returns null for every count while queries are loading', () => {
    const snapshots: NavCounts[] = [];
    const apiClient = createMockApiClient();
    renderWithProviders(<Probe onCounts={(c) => snapshots.push(c)} />, { apiClient });

    expect(snapshots[0]).toEqual({
      connections: null,
      customers: null,
      jobsFailed: null,
      listings: null,
      orders: null,
      webhooksFailed: null,
    });
  });

  it('maps totals from feature queries once they settle', async () => {
    const snapshots: NavCounts[] = [];
    const apiClient = createMockApiClient({
      connections: {
        list: vi.fn().mockResolvedValue([
          { id: 'c1' },
          { id: 'c2' },
          { id: 'c3' },
        ]),
      },
      orders: {
        list: vi.fn().mockResolvedValue({ items: [], total: 42, limit: 1, offset: 0 }),
      },
      customers: {
        list: vi.fn().mockResolvedValue({ items: [], total: 12, limit: 1, offset: 0 }),
      },
      listings: {
        list: vi.fn().mockResolvedValue({ items: [], total: 5, limit: 1, offset: 0 }),
      },
      syncJobs: {
        list: vi.fn().mockResolvedValue({ items: [], total: 9, limit: 1, offset: 0 }),
      },
      webhookDeliveries: {
        list: vi.fn().mockResolvedValue({ items: [], total: 4, limit: 1, offset: 0 }),
      },
    });

    renderWithProviders(<Probe onCounts={(c) => snapshots.push(c)} />, { apiClient });

    await waitFor(() => {
      const latest = snapshots[snapshots.length - 1];
      expect(latest.connections).toBe(3);
      expect(latest.orders).toBe(42);
      expect(latest.customers).toBe(12);
      expect(latest.listings).toBe(5);
      expect(latest.jobsFailed).toBe(9);
      expect(latest.webhooksFailed).toBe(4);
    });
  });

  it('keeps the failing probe at null while the others settle', async () => {
    const snapshots: NavCounts[] = [];
    const apiClient = createMockApiClient({
      orders: {
        list: vi.fn().mockResolvedValue({ items: [], total: 20, limit: 1, offset: 0 }),
      },
      syncJobs: {
        list: vi.fn().mockRejectedValue(new Error('scheduler down')),
      },
    });

    renderWithProviders(<Probe onCounts={(c) => snapshots.push(c)} />, { apiClient });

    await waitFor(() => {
      const latest = snapshots[snapshots.length - 1];
      expect(latest.orders).toBe(20);
      expect(latest.jobsFailed).toBeNull();
    });
  });

  it('passes `{ limit: 1 }` to paginated probes to keep payloads small', async () => {
    const ordersList = vi.fn().mockResolvedValue({ items: [], total: 0, limit: 1, offset: 0 });
    const apiClient = createMockApiClient({
      orders: { list: ordersList },
    });

    renderWithProviders(<Probe onCounts={() => {}} />, { apiClient });

    await waitFor(() => expect(ordersList).toHaveBeenCalled());
    expect(ordersList).toHaveBeenCalledWith(undefined, { limit: 1 });
  });
});
