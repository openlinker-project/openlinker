/**
 * GiftRulePage tests (#3940)
 *
 * The regression guarded here: the page rebuilt its starting values on every
 * render (a fresh names Map each time), so a pending or failed save reset the
 * form and the operator's typing vanished.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
import { GiftRulePage } from './gift-rule-page';

const RULE = {
  id: 'r1',
  name: 'Spoon with the set',
  isActive: true,
  position: 1,
  effectiveFrom: '2026-11-01T00:00:00.000Z',
  effectiveTo: null,
  conditions: [{ field: 'containsProduct', op: 'eq', value: 'v-set' }],
  gift: {
    productId: 'p-spoon',
    variantId: 'v-spoon',
    quantity: 1,
    perUnit: null,
    unitCap: null,
    skipIfPresent: true,
    doNotCombine: false,
    customerLimit: null,
  },
  status: 'active',
  pausedReason: null,
  pausedAt: null,
  unitsGiven: 0,
  effectiveCap: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

afterEach(cleanup);

describe('GiftRulePage', () => {
  it('should keep what the operator typed when a save fails', async () => {
    const replaceRule = vi.fn().mockRejectedValue(new Error('The server said no'));
    const apiClient = createMockApiClient({
      gifts: { getRule: vi.fn().mockResolvedValue(RULE), replaceRule },
      connections: { list: vi.fn().mockResolvedValue([]) },
      products: {
        getVariant: vi.fn().mockResolvedValue({ id: 'v', productId: 'p' }),
        getById: vi.fn().mockResolvedValue({ id: 'p', name: 'Morning set' }),
        getVariantCosts: vi.fn().mockResolvedValue([]),
      },
    } as never);
    renderWithProviders(
      <Routes>
        <Route path="/automations/gifts/:ruleId" element={<GiftRulePage />} />
      </Routes>,
      {
        apiClient,
        route: '/automations/gifts/r1',
        sessionAdapter: createAuthenticatedSessionAdapter(),
      },
    );

    const name = await screen.findByTestId('gift-composer-name');
    fireEvent.change(name, { target: { value: 'My own name' } });
    await waitFor(() => expect(screen.getByTestId('gift-composer-primary')).toBeEnabled());
    fireEvent.click(screen.getByTestId('gift-composer-primary'));

    expect(await screen.findByTestId('gift-composer-save-error')).toHaveTextContent('The server said no');
    expect(screen.getByTestId('gift-composer-name')).toHaveValue('My own name');
  });

  it('should carry the mockup test ids for the back link', async () => {
    const apiClient = createMockApiClient({
      gifts: { getRule: vi.fn().mockResolvedValue(RULE) },
      connections: { list: vi.fn().mockResolvedValue([]) },
      products: {
        getVariant: vi.fn().mockResolvedValue({ id: 'v', productId: 'p' }),
        getById: vi.fn().mockResolvedValue({ id: 'p', name: 'Morning set' }),
        getVariantCosts: vi.fn().mockResolvedValue([]),
      },
    } as never);
    renderWithProviders(
      <Routes>
        <Route path="/automations/gifts/:ruleId" element={<GiftRulePage />} />
      </Routes>,
      { apiClient, route: '/automations/gifts/r1', sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    expect(await screen.findByTestId('gift-composer-back')).toBeInTheDocument();
  });
});
