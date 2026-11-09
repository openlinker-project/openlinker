/**
 * GiftPromotionsPage tests (#3940, mockup M31 `promotions/list`, `viewer-readonly`)
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const GIFT = {
  productId: 'p',
  variantId: 'v',
  quantity: 1,
  perUnit: null,
  unitCap: null,
  skipIfPresent: true,
  doNotCombine: false,
  customerLimit: null,
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

  it('should reorder through the API with the whole new list, from the row menu', async () => {
    const reorderRules = vi.fn().mockResolvedValue([]);
    const apiClient = createMockApiClient({
      gifts: { listRules: vi.fn().mockResolvedValue([RULE, { ...RULE, id: 'r2', name: 'Second' }]), reorderRules },
    } as never);
    renderWithProviders(<GiftPromotionsPage />, { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('gift-rule-menu-r1'));
    await user.click(await screen.findByTestId('gift-rule-down-r1'));

    await waitFor(() => expect(reorderRules).toHaveBeenCalledWith(['r2', 'r1']));
  });

  it('should pause a promotion through the API from the row menu', async () => {
    const replaceRule = vi.fn().mockResolvedValue({ ...RULE, status: 'inactive' });
    const apiClient = createMockApiClient({
      gifts: { listRules: vi.fn().mockResolvedValue([{ ...RULE, gift: GIFT }]), replaceRule },
    } as never);
    renderWithProviders(<GiftPromotionsPage />, { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('gift-rule-menu-r1'));
    await user.click(await screen.findByTestId('gift-rule-toggle-r1'));

    await waitFor(() =>
      expect(replaceRule).toHaveBeenCalledWith('r1', expect.objectContaining({ isActive: false })),
    );
  });

  it('should delete a promotion only after the confirm', async () => {
    const deleteRule = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({
      gifts: { listRules: vi.fn().mockResolvedValue([RULE]), deleteRule },
    } as never);
    renderWithProviders(<GiftPromotionsPage />, { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('gift-rule-menu-r1'));
    await user.click(await screen.findByTestId('gift-rule-delete-r1'));
    expect(deleteRule).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Delete promotion' }));

    await waitFor(() => expect(deleteRule).toHaveBeenCalledWith('r1'));
  });

  it('should show the report figures in the cards, and the rule counts', async () => {
    const apiClient = createMockApiClient({
      gifts: { listRules: vi.fn().mockResolvedValue([RULE, { ...RULE, id: 'r2', status: 'paused', pausedReason: 'unit-cap' }]) },
      giftReport: {
        getGiftReport: vi.fn().mockResolvedValue({
          groups: [
            { key: 'a', giftSource: 'rule', ruleRef: 'r1', ruleName: 'x', productId: 'p', variantId: 'v', sku: null, name: null, currency: 'PLN', units: 12, orders: 9, paidGross: 0, costNet: 50, unknownCostUnits: 0 },
          ],
          totals: [],
        }),
      },
    } as never);
    renderWithProviders(<GiftPromotionsPage />, { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });

    const kpis = await screen.findByTestId('gift-rule-kpis');
    await waitFor(() => expect(kpis).toHaveTextContent('in orders: 9'));
    expect(kpis).toHaveTextContent('12');
    expect(kpis).toHaveTextContent('0 out of stock · 1 limit');
  });

  it('should say the figures are unknown, never 0, when the gift report cannot be loaded', async () => {
    const apiClient = createMockApiClient({
      gifts: { listRules: vi.fn().mockResolvedValue([RULE]) },
      giftReport: { getGiftReport: vi.fn().mockRejectedValue(new Error('boom')) },
    } as never);
    renderWithProviders(<GiftPromotionsPage />, { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });

    const kpis = await screen.findByTestId('gift-rule-kpis');
    await waitFor(() => expect(kpis).toHaveTextContent('The gift report could not be loaded.'));
    expect(kpis).not.toHaveTextContent('in orders');
  });

  it('should show a viewer the list with a read-only notice and no way to create', async () => {
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
  });

  it('should say so when there are no promotions yet', async () => {
    const apiClient = createMockApiClient({ gifts: { listRules: vi.fn().mockResolvedValue([]) } } as never);
    renderWithProviders(<GiftPromotionsPage />, { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });

    expect(await screen.findByText('No gift promotions yet')).toBeInTheDocument();
  });
});
