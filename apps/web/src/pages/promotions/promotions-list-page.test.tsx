/**
 * Promotions list page tests (#3935, mockup `promotions-list`)
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../test/test-utils';
import type { Promotion } from '../../features/promotions/api/promotions.types';
import { PromotionsListPage } from './promotions-list-page';

const allegro = { ...sampleConnection, id: 'c-allegro', name: 'Allegro shop', platformType: 'allegro', enabledCapabilities: ['OrderSource'] };

const make = (id: string, position: number, over: Partial<Promotion> = {}): Promotion => ({
  id,
  name: `Promotion ${id}`,
  isActive: true,
  position,
  effectiveFrom: '2026-11-01T00:00:00.000Z',
  effectiveTo: null,
  conditions: [{ field: 'orderTotalGross', op: 'gte', amount: '200', currency: 'PLN' }],
  benefit: { kind: 'free-gift', productId: `p-${id}`, variantId: `v-${id}`, quantity: 1, perUnit: null, skipIfPresent: true },
  combinesWith: { mode: 'all' },
  limits: { unitCap: null, customerLimit: null },
  status: 'active',
  pausedReason: null,
  pausedAt: null,
  unitsGiven: 0,
  effectiveCap: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...over,
});

const ROWS = [
  make('a', 1),
  make('b', 2, { status: 'paused', pausedReason: 'gift-out-of-stock' }),
  make('c', 3, { status: 'inactive', isActive: false }),
];

function mount(route = '/promotions', over: Record<string, unknown> = {}) {
  const apiClient = createMockApiClient({
    connections: { list: vi.fn().mockResolvedValue([allegro]) },
    promotions: { list: vi.fn().mockResolvedValue(ROWS), reorder: vi.fn().mockResolvedValue(ROWS), ...over },
    products: { getVariant: vi.fn().mockRejectedValue(new Error('no')) },
  } as never);
  renderWithProviders(<PromotionsListPage />, {
    apiClient,
    route,
    sessionAdapter: createAuthenticatedSessionAdapter({
      id: 'u',
      username: 'admin',
      email: 'a@example.com',
      role: 'admin',
      permissions: ['gifts:write'],
      analyticsConsent: true,
    }),
  });
  return apiClient;
}

afterEach(cleanup);

describe('PromotionsListPage', () => {
  it('should list every promotion in check order with counts on the status tabs', async () => {
    mount();

    expect(await screen.findByTestId('promotion-row-a')).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: 'Promotion state' });
    expect(within(tabs).getByRole('tab', { name: /All\s*3/ })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: /Paused\s*1/ })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: /Drafts\s*1/ })).toBeInTheDocument();
  });

  it('should narrow the list to a tab named in the address', async () => {
    mount('/promotions?tab=paused');

    expect(await screen.findByTestId('promotion-row-b')).toBeInTheDocument();
    expect(screen.queryByTestId('promotion-row-a')).not.toBeInTheDocument();
  });

  it('should ask the server to move a promotion when its arrow is pressed', async () => {
    const api = mount();

    await screen.findByTestId('promotion-row-b');
    fireEvent.click(screen.getByRole('button', { name: 'Move up: Promotion b' }));

    await waitFor(() => expect(api.promotions.reorder).toHaveBeenCalledWith(['b', 'a', 'c']));
  });

  it('should not offer the move arrows while a filter hides some promotions', async () => {
    mount('/promotions?tab=paused');

    await screen.findByTestId('promotion-row-b');
    expect(screen.queryByRole('button', { name: /Move up/ })).not.toBeInTheDocument();
  });

  it('should show the empty state with a way to start when there are no promotions', async () => {
    mount('/promotions', { list: vi.fn().mockResolvedValue([]) });

    expect(await screen.findByTestId('promotions-empty')).toBeInTheDocument();
  });
});
