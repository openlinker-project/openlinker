/**
 * KsefNumberingActions tests
 *
 * The row is KSeF-only by construction (it rides the KSeF plugin's
 * `ConnectionActions` slot). These tests cover its inline status derived from
 * the connection's numbering routes: "not set up yet" when unrouted and the
 * routed count when configured. The CTA is pure navigation into the numbering
 * page, so it stays a live link in every mode (the read-only gate lives on the
 * save inside the editor, not here).
 *
 * @module plugins/ksef/components
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import type { NumberingRoute } from '../../../features/invoicing';
import { KsefNumberingActions } from './ksef-numbering-actions';

const ksefConnection = { ...sampleConnection, platformType: 'ksef' };

const route: NumberingRoute = {
  connectionId: ksefConnection.id,
  documentType: 'invoice',
  register: null,
  currency: null,
  source: null,
  seriesId: 'series_main',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

describe('KsefNumberingActions', () => {
  afterEach(cleanup);

  it('shows "not set up yet" and a Set up link when no routes exist', async () => {
    renderWithProviders(<KsefNumberingActions connection={ksefConnection} />);
    expect(await screen.findByText('not set up yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up…' })).toBeInTheDocument();
  });

  it('shows the routed count and a Configure link when configured', async () => {
    const apiClient = createMockApiClient({
      invoiceNumbering: {
        listRoutes: vi.fn().mockResolvedValue([route]),
      },
    });
    renderWithProviders(<KsefNumberingActions connection={ksefConnection} />, { apiClient });

    expect(await screen.findByText('1 document type routed')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Configure…' })).toBeInTheDocument(),
    );
  });

  it('keeps the CTA a live link (navigation is never gated)', async () => {
    const apiClient = createMockApiClient({
      invoiceNumbering: {
        listRoutes: vi.fn().mockResolvedValue([route]),
      },
    });
    renderWithProviders(<KsefNumberingActions connection={ksefConnection} />, { apiClient });

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Configure…' })).toHaveAttribute(
        'href',
        `/connections/${ksefConnection.id}/numbering`,
      ),
    );
  });
});
