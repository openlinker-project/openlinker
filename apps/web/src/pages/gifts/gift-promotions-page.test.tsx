/**
 * GiftPromotionsPage tests (#3940, mockup M31 `promotions/list`, `viewer-readonly`)
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
import { GiftPromotionsPage } from './gift-promotions-page';

const RULE = {
  id: 'r1',
  name: 'Spoon with the set',
  isActive: true,
  position: 1,
  effectiveFrom: '2026-11-01T00:00:00.000Z',
  effectiveTo: null,
  conditions: [],
  gift: null,
  status: 'active',
  pausedReason: null,
  pausedAt: null,
  unitsGiven: 3,
  effectiveCap: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

afterEach(cleanup);

describe('GiftPromotionsPage', () => {
  it('should list the promotions and let an operator create one', async () => {
    const apiClient = createMockApiClient({ gifts: { listRules: vi.fn().mockResolvedValue([RULE]) } } as never);
    renderWithProviders(<GiftPromotionsPage />, { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });

    expect(await screen.findByTestId('gift-rule-row-r1')).toBeInTheDocument();
    expect(screen.getByTestId('gift-rule-new')).toBeEnabled();
    expect(screen.queryByTestId('gift-rule-readonly-notice')).not.toBeInTheDocument();
  });

  it('should reorder through the API with the whole new list', async () => {
    const reorderRules = vi.fn().mockResolvedValue([]);
    const apiClient = createMockApiClient({
      gifts: { listRules: vi.fn().mockResolvedValue([RULE, { ...RULE, id: 'r2', name: 'Second' }]), reorderRules },
    } as never);
    renderWithProviders(<GiftPromotionsPage />, { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });

    fireEvent.click(await screen.findByTestId('gift-rule-down-r1'));

    await waitFor(() => expect(reorderRules).toHaveBeenCalledWith(['r2', 'r1']));
  });

  it('should show a viewer the list with a read-only notice and no way to create or reorder', async () => {
    const apiClient = createMockApiClient({ gifts: { listRules: vi.fn().mockResolvedValue([RULE]) } } as never);
    renderWithProviders(<GiftPromotionsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'u',
        username: 'viewer',
        email: 'v@example.com',
        role: 'viewer',
        permissions: ['automations:read'],
        analyticsConsent: true,
      }),
    });

    expect(await screen.findByTestId('gift-rule-row-r1')).toBeInTheDocument();
    expect(screen.getAllByTestId('gift-rule-readonly-notice').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('gift-rule-new')).not.toBeInTheDocument();
    expect(screen.getByTestId('gift-rule-up-r1')).toBeDisabled();
  });

  it('should say so when there are no promotions yet', async () => {
    const apiClient = createMockApiClient({ gifts: { listRules: vi.fn().mockResolvedValue([]) } } as never);
    renderWithProviders(<GiftPromotionsPage />, { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });

    expect(await screen.findByText('No gift promotions yet')).toBeInTheDocument();
  });
});
