/**
 * Tests for OfferPublicationStatusPanel (#1760, extended by #2039).
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

/** A mapped offer the marketplace has never been read for (#2039). */
const unsyncedOffer: OfferPublicationStatusResponse = {
  connectionId: 'conn-1',
  externalOfferId: '7781896309',
  internalVariantId: 'ol_variant_2',
  publicationStatus: null,
  lastStatusSyncedAt: null,
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

  it('shows the empty state only when the product has no offers at all', async () => {
    const apiClient = createMockApiClient({
      listings: { getProductOfferStatus: vi.fn().mockResolvedValue([]) } as never,
    });

    renderWithProviders(<OfferPublicationStatusPanel productId="ol_product_1" />, { apiClient });

    expect(await screen.findByText('No offers on marketplaces')).toBeInTheDocument();
  });

  it('lists an offer with no status yet instead of falling through to the empty state (#2039)', async () => {
    const apiClient = createMockApiClient({
      listings: { getProductOfferStatus: vi.fn().mockResolvedValue([unsyncedOffer]) } as never,
    });

    renderWithProviders(<OfferPublicationStatusPanel productId="ol_product_1" />, { apiClient });

    expect(await screen.findByText('Not synced yet')).toBeInTheDocument();
    expect(screen.getByText('Never synced')).toBeInTheDocument();
    expect(screen.queryByText('No offers on marketplaces')).not.toBeInTheDocument();
  });

  it('lets the operator read the live status of an offer that has none yet (#2039)', async () => {
    const refresh = vi.fn().mockResolvedValue({ publicationStatus: 'active' });
    const apiClient = createMockApiClient({
      listings: {
        getProductOfferStatus: vi.fn().mockResolvedValue([unsyncedOffer]),
        refreshOfferPublicationStatus: refresh,
      } as never,
    });

    renderWithProviders(<OfferPublicationStatusPanel productId="ol_product_1" />, { apiClient });

    // Pre-#2039 this action was unreachable in exactly this state: the offer was
    // omitted from the read, so the panel rendered an empty state and the
    // per-offer button — the only mitigation — never mounted.
    const button = await screen.findByRole('button', { name: 'Check status' });
    await userEvent.click(button);

    await waitFor(() =>
      expect(refresh).toHaveBeenCalledWith('conn-1', '7781896309', 'ol_variant_2'),
    );
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
