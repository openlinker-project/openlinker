import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient, sampleConnection } from '../../../test/test-utils';
import { AutoAppliedNote } from './auto-applied-note';

describe('AutoAppliedNote', () => {
  it('renders nothing when there are no recently auto-applied changes', async () => {
    const apiClient = createMockApiClient({
      priceChanges: { autoApplied: vi.fn().mockResolvedValue([]) },
    });

    const { container } = renderWithProviders(<AutoAppliedNote />, { apiClient });

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows the banner with a count when at least one change was auto-applied, and opens the mini-list dialog', async () => {
    const apiClient = createMockApiClient({
      priceChanges: {
        autoApplied: vi.fn().mockResolvedValue([
          {
            id: 'log-1',
            productVariantId: 'ol_variant_1',
            destinationConnectionId: 'dest-1',
            sourceConnectionId: 'src-1',
            oldAmount: 34.9,
            newAmount: 36.9,
            currency: 'PLN',
            appliedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          },
        ]),
      },
      products: {
        getVariant: vi.fn().mockResolvedValue({
          id: 'ol_variant_1',
          productId: 'ol_product_1',
          sku: 'MUG-350',
          ean: null,
          name: 'Ceramic Coffee Mug — 350 ml',
          isStale: false,
          staleAt: null,
        }),
      },
      connections: {
        list: vi.fn().mockResolvedValue([{ ...sampleConnection, id: 'dest-1', name: 'Erli — PL' }]),
      },
    });

    renderWithProviders(<AutoAppliedNote />, { apiClient });

    expect(await screen.findByText('see them')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();

    await userEvent.click(screen.getByText('see them'));

    expect(await screen.findByText('Applied automatically today')).toBeInTheDocument();
    expect(screen.getByText('Ceramic Coffee Mug — 350 ml')).toBeInTheDocument();
    expect(screen.getByText('Erli — PL', { exact: false })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByText('Applied automatically today')).not.toBeInTheDocument();
    });
  });
});
