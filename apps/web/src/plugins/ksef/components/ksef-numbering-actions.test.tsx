/**
 * KsefNumberingActions tests (#1577)
 *
 * The row is KSeF-only by construction (it rides the KSeF plugin's
 * `ConnectionActions` slot). These tests cover its inline status: "not set up
 * yet" when unconfigured, and the rendered next number when configured.
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
import type { NumberingAssignment, NumberingSeries } from '../../../features/invoicing';
import { KsefNumberingActions } from './ksef-numbering-actions';

const ksefConnection = { ...sampleConnection, platformType: 'ksef' };

const assignment: NumberingAssignment = {
  connectionId: ksefConnection.id,
  mainSeriesId: 'series_main',
  correctionSeriesId: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

const mainSeries: NumberingSeries = {
  id: 'series_main',
  name: 'Main invoices',
  pattern: 'FV/{seq}/{MM}/{YYYY}',
  nextSeq: 42,
  seqPadding: 5,
  resetPolicy: 'monthly',
  periodKey: '2026-07',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

describe('KsefNumberingActions', () => {
  afterEach(cleanup);

  it('shows "not set up yet" and a Set up button when unconfigured', async () => {
    renderWithProviders(<KsefNumberingActions connection={ksefConnection} />);
    expect(await screen.findByText('not set up yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up…' })).toBeInTheDocument();
  });

  it('shows the rendered next number and a Configure button when configured', async () => {
    const apiClient = createMockApiClient({
      invoiceNumbering: {
        getAssignment: vi.fn().mockResolvedValue(assignment),
        getSeries: vi.fn().mockResolvedValue(mainSeries),
      },
    });
    renderWithProviders(<KsefNumberingActions connection={ksefConnection} />, { apiClient });

    expect(await screen.findByText('FV/00042/07/2026')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Configure…' })).toBeInTheDocument(),
    );
  });

  it('disables the CTA in read-only mode', async () => {
    const apiClient = createMockApiClient({
      invoiceNumbering: {
        getAssignment: vi.fn().mockResolvedValue(assignment),
        getSeries: vi.fn().mockResolvedValue(mainSeries),
      },
    });
    renderWithProviders(<KsefNumberingActions connection={ksefConnection} readOnly />, { apiClient });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Configure…' })).toBeDisabled(),
    );
  });
});
