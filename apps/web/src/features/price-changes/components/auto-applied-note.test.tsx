import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient, sampleConnection } from '../../../test/test-utils';
import { AUTO_APPLIED_ITEM_LIMIT } from '../lib/auto-applied-count-label';
import { AutoAppliedNote } from './auto-applied-note';

const DESTINATION = { ...sampleConnection, id: 'dest-1', name: 'Erli — PL' };

const AUTO_APPLIED_ITEM = {
  id: 'log-1',
  productVariantId: 'ol_variant_1',
  productName: 'Ceramic Coffee Mug',
  variantLabel: '350 ml',
  sku: 'MUG-350',
  destinationConnectionId: 'dest-1',
  sourceConnectionId: 'src-1',
  oldAmount: 34.9,
  newAmount: 36.9,
  currency: 'PLN',
  appliedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
};

const AUTOMATIC_SYNC_VIEW = {
  default: { mode: 'automatic' as const, rule: { type: 'passthrough' as const, percent: 0, rounding: 'none' as const } },
  sources: [],
};

describe('AutoAppliedNote', () => {
  it('renders nothing when there are no recently auto-applied changes, and never fires the per-connection config fan-out for it (#3168 review)', async () => {
    const autoApplied = vi.fn().mockResolvedValue([]);
    const pricingSyncGet = vi.fn().mockResolvedValue(AUTOMATIC_SYNC_VIEW);
    const apiClient = createMockApiClient({
      priceChanges: { autoApplied },
      pricingSync: { get: pricingSyncGet },
    });

    renderWithProviders(<AutoAppliedNote destinationConnections={[DESTINATION]} />, { apiClient });

    await waitFor(() => expect(autoApplied).toHaveBeenCalled());
    expect(screen.queryByText(/went live automatically/)).not.toBeInTheDocument();
    // The log has nothing to show regardless of config, so the N-request
    // config check must never fire — asserting this rather than only the
    // negative render outcome is the point of the finding this test covers.
    expect(pricingSyncGet).not.toHaveBeenCalled();
  });

  it('renders nothing when the log has entries but every connection is manual', async () => {
    // Default `pricingSync.get` mock already answers `mode: 'manual'`.
    const apiClient = createMockApiClient({
      priceChanges: { autoApplied: vi.fn().mockResolvedValue([AUTO_APPLIED_ITEM]) },
    });

    renderWithProviders(<AutoAppliedNote destinationConnections={[DESTINATION]} />, { apiClient });

    await waitFor(() => expect(apiClient.pricingSync.get).toHaveBeenCalled());
    expect(screen.queryByText(/went live automatically/)).not.toBeInTheDocument();
  });

  it('shows the banner with a count when a connection is automatic and the log has entries, and opens the mini-list dialog', async () => {
    const apiClient = createMockApiClient({
      priceChanges: { autoApplied: vi.fn().mockResolvedValue([AUTO_APPLIED_ITEM]) },
      pricingSync: { get: vi.fn().mockResolvedValue(AUTOMATIC_SYNC_VIEW) },
    });

    renderWithProviders(<AutoAppliedNote destinationConnections={[DESTINATION]} />, { apiClient });

    expect(await screen.findByText('see them')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();

    const seeThemButton = screen.getByRole('button', { name: 'see them' });
    await userEvent.click(seeThemButton);

    expect(await screen.findByText('Applied automatically recently')).toBeInTheDocument();
    expect(screen.getByText('Ceramic Coffee Mug')).toBeInTheDocument();
    expect(screen.getByText('350 ml', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Erli — PL', { exact: false })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByText('Applied automatically recently')).not.toBeInTheDocument();
    });
  });

  it('renders "20+", never a bare capped number, when the log read comes back exactly at its limit (#3168 review)', async () => {
    const cappedItems = Array.from({ length: AUTO_APPLIED_ITEM_LIMIT }, (_, i) => ({
      ...AUTO_APPLIED_ITEM,
      id: `log-${i}`,
    }));
    const apiClient = createMockApiClient({
      priceChanges: { autoApplied: vi.fn().mockResolvedValue(cappedItems) },
      pricingSync: { get: vi.fn().mockResolvedValue(AUTOMATIC_SYNC_VIEW) },
    });

    renderWithProviders(<AutoAppliedNote destinationConnections={[DESTINATION]} />, { apiClient });

    expect(await screen.findByText(`${AUTO_APPLIED_ITEM_LIMIT}+`)).toBeInTheDocument();
    expect(screen.getByText(/price changes went live/)).toBeInTheDocument();
  });

  it('renders the "Product not found" placeholder instead of asserting a name when productName is null', async () => {
    const unresolvedItem = { ...AUTO_APPLIED_ITEM, productName: null, variantLabel: null, sku: null };
    const apiClient = createMockApiClient({
      priceChanges: { autoApplied: vi.fn().mockResolvedValue([unresolvedItem]) },
      pricingSync: { get: vi.fn().mockResolvedValue(AUTOMATIC_SYNC_VIEW) },
    });

    renderWithProviders(<AutoAppliedNote destinationConnections={[DESTINATION]} />, { apiClient });

    await userEvent.click(await screen.findByRole('button', { name: 'see them' }));

    expect(await screen.findByText('Applied automatically recently')).toBeInTheDocument();
    expect(screen.getByText('Product not found')).toBeInTheDocument();
    expect(screen.queryByText('Ceramic Coffee Mug')).not.toBeInTheDocument();
  });
});
