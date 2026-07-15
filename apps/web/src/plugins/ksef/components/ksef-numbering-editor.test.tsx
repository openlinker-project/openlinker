/**
 * KsefNumberingEditor tests (#1577)
 *
 * Covers the live preview (valid render + invalid dash), the lowering-next-
 * number warning, and the setup submit path (create main + correction, then
 * assign).
 *
 * @module plugins/ksef/components
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { NumberingSeries } from '../../../features/invoicing';
import { KsefNumberingEditor } from './ksef-numbering-editor';

const series: NumberingSeries = {
  id: 'series_main',
  name: 'Main invoices',
  pattern: 'FV/{seq}/{MM}/{YYYY}',
  nextSeq: 42,
  seqPadding: 0,
  resetPolicy: 'monthly',
  periodKey: '2026-07',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

describe('KsefNumberingEditor', () => {
  afterEach(cleanup);

  it('renders a live preview for the prefilled setup pattern', () => {
    renderWithProviders(
      <KsefNumberingEditor connectionId="conn_1" mode="setup" onDone={vi.fn()} onCancel={vi.fn()} />,
    );
    // Default main prefill FV/{seq}/{MM}/{YYYY}. The preview tokenises the
    // number into spans; the leading literal renders as its own "FV/" node.
    expect(screen.getAllByText('FV/').length).toBeGreaterThan(0);
  });

  it('shows a dash and an error when the pattern breaks the reset rule', async () => {
    renderWithProviders(
      <KsefNumberingEditor connectionId="conn_1" mode="setup" onDone={vi.fn()} onCancel={vi.fn()} />,
    );
    const patternInput = screen.getByPlaceholderText('FV/{seq}/{MM}/{YYYY}');
    // Drop {MM} — monthly reset now under-specified.
    fireEvent.change(patternInput, { target: { value: 'FV/{seq}/{YYYY}' } });

    expect(await screen.findAllByText('—')).not.toHaveLength(0);
    expect(
      screen.getAllByText(/Monthly reset needs \{MM\}/).length,
    ).toBeGreaterThan(0);
  });

  it('warns when lowering the next number below the persisted value', async () => {
    renderWithProviders(
      <KsefNumberingEditor
        connectionId="conn_1"
        mode="edit"
        seriesLabel="main"
        series={series}
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const nextInput = screen.getByDisplayValue('42');
    fireEvent.change(nextInput, { target: { value: '10' } });

    expect(await screen.findByText(/Lowering the next number can reproduce/)).toBeInTheDocument();
  });

  it('creates the main + correction series then assigns them on setup submit', async () => {
    const createSeries = vi
      .fn()
      .mockResolvedValueOnce({ ...series, id: 'series_main' })
      .mockResolvedValueOnce({ ...series, id: 'series_corr', pattern: 'FK/{seq}/{MM}/{YYYY}' });
    const setAssignment = vi.fn().mockResolvedValue({
      connectionId: 'conn_1',
      mainSeriesId: 'series_main',
      correctionSeriesId: 'series_corr',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    const apiClient = createMockApiClient({
      invoiceNumbering: { createSeries, setAssignment },
    });
    const onDone = vi.fn();
    renderWithProviders(
      <KsefNumberingEditor connectionId="conn_1" mode="setup" onDone={onDone} onCancel={vi.fn()} />,
      { apiClient },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save series' }));

    await waitFor(() => expect(createSeries).toHaveBeenCalledTimes(2));
    expect(setAssignment).toHaveBeenCalledWith('conn_1', {
      mainSeriesId: 'series_main',
      correctionSeriesId: 'series_corr',
    });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
