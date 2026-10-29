import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsSettingsDialog } from './analytics-settings-dialog';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';

afterEach(cleanup);

const admin = createAuthenticatedSessionAdapter({
  id: 'u1',
  username: 'admin',
  email: 'admin@example.com',
  role: 'admin',
  permissions: ['analytics:write'],
  analyticsConsent: true,
});
const viewer = createAuthenticatedSessionAdapter({
  id: 'u2',
  username: 'viewer',
  email: 'viewer@example.com',
  role: 'viewer',
  permissions: [],
  analyticsConsent: true,
});

function renderDialog(adapter: typeof admin, trackMargin: boolean): ReturnType<typeof vi.fn> {
  const updateSettings = vi.fn().mockResolvedValue(undefined);
  renderWithProviders(
    <AnalyticsSettingsDialog
      open
      onOpenChange={() => undefined}
      displayCurrency={null}
      rateBasis="current-rate"
      reportingCurrency="PLN"
      onApplyView={() => undefined}
      coverageFilters={{ from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' }}
    />,
    {
      sessionAdapter: adapter,
      apiClient: createMockApiClient({
        analyticsSettings: {
          getSettings: vi.fn().mockResolvedValue({
            displayCurrency: 'PLN',
            displayCurrencySource: 'default',
            rateBasis: 'current',
            includeBackfilledTaxRatesInNetSales: false,
            netGrossBasis: 'gross',
            trackMargin,
            updatedAt: null,
            updatedByUserId: null,
          }),
          updateSettings,
        },
        system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false }) },
      }),
    }
  );
  return updateSettings;
}

describe('Analytics settings: track margin', () => {
  it('should save trackMargin false when an admin switches it off', async () => {
    const updateSettings = renderDialog(admin, true);
    const toggle = await screen.findByTestId('settings-margin-tracking-toggle');
    await waitFor(() => {
      expect(toggle).toBeEnabled();
    });
    await userEvent.click(toggle);
    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ trackMargin: false }));
    });
  });

  it('should show the setting read only with the reason for a non-admin', async () => {
    renderDialog(viewer, false);
    const toggle = await screen.findByTestId('settings-margin-tracking-toggle');
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
    expect(
      await screen.findByText('Margin is off for everyone on this account. Only an admin can change this.')
    ).toBeInTheDocument();
  });
});
