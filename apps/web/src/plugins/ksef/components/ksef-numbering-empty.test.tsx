/**
 * KsefNumberingEmpty tests (#1577)
 *
 * Covers the unassigned-series re-attach flow.
 *
 * @module plugins/ksef/components
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { UnassignedNumberingSeries } from '../../../features/invoicing';
import { KsefNumberingEmpty } from './ksef-numbering-empty';

const orphan: UnassignedNumberingSeries = {
  id: 'series_orphan',
  name: 'Legacy invoices',
  pattern: 'FV/{seq}/{YYYY}',
  nextSeq: 128,
  seqPadding: 4,
  resetPolicy: 'yearly',
  periodKey: '2026',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  lastIssuedSeq: 127,
  lastIssuedNumberPreview: 'FV/0127/2026',
};

describe('KsefNumberingEmpty', () => {
  afterEach(cleanup);

  it('lists unassigned series with their last-issued number', async () => {
    const apiClient = createMockApiClient({
      invoiceNumbering: { listUnassigned: vi.fn().mockResolvedValue([orphan]) },
    });
    renderWithProviders(<KsefNumberingEmpty connectionId="conn_1" onSetup={vi.fn()} />, { apiClient });

    expect(await screen.findByText('FV/{seq}/{YYYY}')).toBeInTheDocument();
    expect(screen.getByText('FV/0127/2026')).toBeInTheDocument();
  });

  it('re-attaches a series via setAssignment', async () => {
    const setAssignment = vi.fn().mockResolvedValue({
      connectionId: 'conn_1',
      mainSeriesId: 'series_orphan',
      correctionSeriesId: null,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    const apiClient = createMockApiClient({
      invoiceNumbering: {
        listUnassigned: vi.fn().mockResolvedValue([orphan]),
        setAssignment,
      },
    });
    renderWithProviders(<KsefNumberingEmpty connectionId="conn_1" onSetup={vi.fn()} />, { apiClient });

    fireEvent.click(await screen.findByRole('button', { name: 'Re-attach' }));

    await waitFor(() =>
      expect(setAssignment).toHaveBeenCalledWith('conn_1', { mainSeriesId: 'series_orphan' }),
    );
  });

  it('offers the Set up numbering action', () => {
    renderWithProviders(<KsefNumberingEmpty connectionId="conn_1" onSetup={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Set up numbering' })).toBeInTheDocument();
  });
});
