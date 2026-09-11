import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { PricingAndSyncSection } from './pricing-and-sync-section';
import type { ConnectionPricingSyncView } from '../../price-changes';

function buildView(overrides: Partial<ConnectionPricingSyncView> = {}): ConnectionPricingSyncView {
  return {
    default: { mode: 'manual', rule: { type: 'margin', percent: 22, rounding: 'endingIn99' } },
    sources: [
      {
        sourceConnectionId: 'src-1',
        sourceLabel: 'PrestaShop — Main Store',
        isCustomOverride: false,
        effective: { mode: 'manual', rule: { type: 'margin', percent: 22, rounding: 'endingIn99' } },
        openEpisodeCount: 3,
      },
    ],
    ...overrides,
  };
}

describe('PricingAndSyncSection', () => {
  it('renders the default rule sentence and every known source, override or not', async () => {
    const apiClient = createMockApiClient({
      pricingSync: { get: vi.fn().mockResolvedValue(buildView()) },
    });

    renderWithProviders(<PricingAndSyncSection connectionId="dest-1" />, { apiClient });

    expect(await screen.findByText(/Keeps a 22% margin/)).toBeInTheDocument();
    expect(screen.getByText('PrestaShop — Main Store')).toBeInTheDocument();
    expect(screen.getByText(/using the default rule/)).toBeInTheDocument();
  });

  it('flips the mode switch, shows the unsaved bar, and saves both default + overrides in one call', async () => {
    const update = vi.fn().mockResolvedValue(buildView({ default: { mode: 'automatic', rule: { type: 'margin', percent: 22, rounding: 'endingIn99' } } }));
    const apiClient = createMockApiClient({
      pricingSync: { get: vi.fn().mockResolvedValue(buildView()), update },
    });

    renderWithProviders(<PricingAndSyncSection connectionId="dest-1" />, { apiClient });
    await screen.findByText(/Keeps a 22% margin/);

    expect(screen.queryByText("You've changed something and haven't saved it yet.")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('default-mode-automatic'));
    expect(await screen.findByText("You've changed something and haven't saved it yet.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({
        default: { mode: 'automatic', rule: { type: 'margin', percent: 22, rounding: 'endingIn99' } },
        sourceOverrides: {},
      });
    });
  });

  it('discards local changes back to the last-fetched state', async () => {
    const apiClient = createMockApiClient({
      pricingSync: { get: vi.fn().mockResolvedValue(buildView()) },
    });

    renderWithProviders(<PricingAndSyncSection connectionId="dest-1" />, { apiClient });
    await screen.findByText(/Keeps a 22% margin/);

    await userEvent.click(screen.getByTestId('default-mode-automatic'));
    expect(await screen.findByText("You've changed something and haven't saved it yet.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));

    await waitFor(() => {
      expect(
        screen.queryByText("You've changed something and haven't saved it yet."),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('default-mode-manual')).toHaveClass('is-active');
  });

  it('toggling a source override on copies from the default, and off drops it from the saved payload', async () => {
    const update = vi.fn().mockResolvedValue(buildView());
    const apiClient = createMockApiClient({
      pricingSync: { get: vi.fn().mockResolvedValue(buildView()), update },
    });

    renderWithProviders(<PricingAndSyncSection connectionId="dest-1" />, { apiClient });
    await screen.findByText('PrestaShop — Main Store');

    await userEvent.click(screen.getByTestId('source-custom-toggle'));

    // Copied from the current default (margin/22/endingIn99), so the summary
    // no longer reads "using the default rule".
    expect(screen.queryByText(/using the default rule/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({
        default: { mode: 'manual', rule: { type: 'margin', percent: 22, rounding: 'endingIn99' } },
        sourceOverrides: {
          'src-1': { mode: 'manual', rule: { type: 'margin', percent: 22, rounding: 'endingIn99' } },
        },
      });
    });

    // Toggling back off reverts to "using the default rule" and drops the
    // override from what gets saved.
    await userEvent.click(screen.getByTestId('source-custom-toggle'));
    expect(await screen.findByText(/using the default rule/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({ sourceOverrides: {} }),
      );
    });
  });

  it('links the pending-changes count to the Price changes tab pre-filtered to this connection', async () => {
    const apiClient = createMockApiClient({
      pricingSync: { get: vi.fn().mockResolvedValue(buildView()) },
    });

    renderWithProviders(<PricingAndSyncSection connectionId="dest-1" />, { apiClient });

    expect(await screen.findByText('3 changes waiting')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'review them' })).toHaveAttribute(
      'href',
      '/listings?view=queue&connectionId=dest-1',
    );
  });
});
