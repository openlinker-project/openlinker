/**
 * Sync Pacing Page — tests
 *
 * The page-level properties worth pinning are the ones an operator's safety
 * depends on: the provenance comes from the API rather than a client-side
 * comparison, the save button is inert until something moves, and a rejected
 * value lands beside the control that produced it rather than in one banner.
 *
 * The arithmetic is asserted on the pure model, not here.
 *
 * @module apps/web/src/pages/settings
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../shared/api/api-error';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
import { OperationalSettingsPage } from './operational-settings-page';

function view(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    catalogueSweepBudget: { value: 500, source: 'default' },
    inventorySweepBudget: { value: 100, source: 'default' },
    sweepPageSize: { value: 100, source: 'default' },
    deletionAuditBudget: { value: 100, source: 'default' },
    deletionAuditCadence: { value: '0 * * * *', source: 'default' },
    deletionAuditAlwaysEnabled: true,
    cadenceAppliesAt: 'next-scheduler-start',
    updatedAt: null,
    updatedBy: null,
    bounds: {
      catalogueSweepBudget: { min: 1, max: 2000, default: 500, envVar: 'OL_PRODUCT_SYNC_PAGE_LIMIT' },
      inventorySweepBudget: { min: 1, max: 2000, default: 100, envVar: 'OL_INVENTORY_SYNC_PAGE_LIMIT' },
      sweepPageSize: { min: 1, max: 100, default: 100, envVar: 'OL_SWEEP_PAGE_SIZE' },
      deletionAuditBudget: {
        min: 1,
        max: 2000,
        default: 100,
        envVar: 'OL_MASTER_PRODUCT_RECONCILE_PAGE_LIMIT',
      },
    },
    ...overrides,
  };
}

function renderPage(
  overrides: {
    get?: ReturnType<typeof vi.fn>;
    update?: ReturnType<typeof vi.fn>;
  } = {},
): void {
  const apiClient = createMockApiClient({
    operationalSettings: {
      get: overrides.get ?? vi.fn().mockResolvedValue(view()),
      update: overrides.update ?? vi.fn().mockResolvedValue(undefined),
    },
  });

  renderWithProviders(<OperationalSettingsPage />, {
    apiClient,
    sessionAdapter: createAuthenticatedSessionAdapter(),
  });
}

describe('OperationalSettingsPage', () => {
  it('should render each value with the provenance the API reported', async () => {
    renderPage({
      get: vi.fn().mockResolvedValue(
        view({ catalogueSweepBudget: { value: 2000, source: 'setting' } }),
      ),
    });

    expect(await screen.findByText('2000 (you set this)')).toBeInTheDocument();
    expect(screen.getAllByText('100 (default)').length).toBeGreaterThan(0);
  });

  it('should keep the save button inert until something changes', async () => {
    renderPage();

    const save = await screen.findByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();
    expect(screen.getByText('No changes yet.')).toBeInTheDocument();
  });

  it('should open no modal while nothing has changed', async () => {
    renderPage();

    await screen.findByRole('button', { name: 'Save changes' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should mark a changed field and enable the save', async () => {
    const user = userEvent.setup();
    renderPage();

    const numberBox = await screen.findByRole('spinbutton', {
      name: 'Products per shop request',
    });
    await user.clear(numberBox);
    await user.type(numberBox, '50');

    await waitFor(() => {
      expect(screen.getByText('changed from 100')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('should put a rejected value beside its own control, not in one banner', async () => {
    const update = vi.fn().mockRejectedValue(
      new ApiError('Bad Request', 400, {
        message: ['catalogueSweepBudget must not be greater than 2000'],
      }),
    );
    const user = userEvent.setup();
    renderPage({ update });

    const numberBox = await screen.findByRole('spinbutton', { name: 'Products per catalogue run' });
    await user.clear(numberBox);
    await user.type(numberBox, '900');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const confirm = await screen.findByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText('catalogueSweepBudget must not be greater than 2000'),
    ).toBeInTheDocument();
  });

  it('should refuse a non-admin session', async () => {
    const apiClient = createMockApiClient();
    renderWithProviders(<OperationalSettingsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'user_2',
        username: 'viewer',
        email: 'viewer@example.com',
        role: 'user',
        permissions: [],
        analyticsConsent: true,
      }),
    });

    expect(await screen.findByText('Admin role required')).toBeInTheDocument();
  });

  it('should say nothing about timing until the cadence is actually changed', async () => {
    renderPage();

    await screen.findByRole('button', { name: 'Save changes' });
    expect(screen.queryByText('When this starts')).not.toBeInTheDocument();
  });

  it('should say when a cadence change lands, once it is changed', async () => {
    const user = userEvent.setup();
    renderPage();

    const cadence = await screen.findByLabelText(/How often it runs/);
    await user.selectOptions(cadence, '0 */4 * * *');

    expect(await screen.findByText('When this starts')).toBeInTheDocument();
    expect(
      screen.getByText(/picked up the next time OpenLinker's background service restarts/),
    ).toBeInTheDocument();
  });
});
