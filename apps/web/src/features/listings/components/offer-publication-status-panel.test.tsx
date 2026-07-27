/**
 * Tests for OfferPublicationStatusPanel (#1760).
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { OfferPublicationStatusResponse } from '../api/listings.types';
import { OfferPublicationStatusPanel } from './offer-publication-status-panel';

const offer: OfferPublicationStatusResponse = {
  connectionId: 'conn-1',
  externalOfferId: '7781896308',
  internalVariantId: 'ol_variant_1',
  publicationStatus: 'active',
  lastStatusSyncedAt: '2026-07-22T08:00:00Z',
};

describe('OfferPublicationStatusPanel', () => {
  it('renders the live publication status of a product’s offers', async () => {
    const apiClient = createMockApiClient({
      listings: {
        getProductOfferStatus: vi.fn().mockResolvedValue([offer]),
      } as never,
    });

    renderWithProviders(<OfferPublicationStatusPanel productId="ol_product_1" />, { apiClient });

    expect(await screen.findByText('Active')).toBeInTheDocument();
    expect(screen.getByText('7781896308')).toBeInTheDocument();
  });

  it('shows the empty state when no offers are synced yet', async () => {
    const apiClient = createMockApiClient({
      listings: { getProductOfferStatus: vi.fn().mockResolvedValue([]) } as never,
    });

    renderWithProviders(<OfferPublicationStatusPanel productId="ol_product_1" />, { apiClient });

    expect(await screen.findByText('No live status yet')).toBeInTheDocument();
  });

  it('force-refreshes an offer’s live status on demand', async () => {
    const refresh = vi.fn().mockResolvedValue({ publicationStatus: 'active' });
    const apiClient = createMockApiClient({
      listings: {
        getProductOfferStatus: vi.fn().mockResolvedValue([offer]),
        refreshOfferPublicationStatus: refresh,
      } as never,
    });

    renderWithProviders(<OfferPublicationStatusPanel productId="ol_product_1" />, { apiClient });

    const button = await screen.findByRole('button', { name: 'Refresh' });
    await userEvent.click(button);

    await waitFor(() =>
      expect(refresh).toHaveBeenCalledWith('conn-1', '7781896308', 'ol_variant_1'),
    );
  });
});
