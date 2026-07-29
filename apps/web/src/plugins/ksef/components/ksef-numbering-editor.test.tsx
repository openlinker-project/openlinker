/**
 * KsefNumberingEditor tests
 *
 * Covers the live preview (valid render + invalid dash), the length meter, the
 * lowering-next-number warning, the create submit path, and the field-level
 * mapping of a server 400 `errors[]` onto the pattern field.
 *
 * @module plugins/ksef/components
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import type { NumberingSeries } from '../../../features/invoicing';
import { KsefNumberingEditor } from './ksef-numbering-editor';

const captureDemoEvent = vi.fn();
vi.mock('../../../features/demo', () => ({
  captureDemoEvent: (...args: unknown[]): unknown => captureDemoEvent(...args),
}));

const series: NumberingSeries = {
  id: 'series_main',
  name: 'Sales invoices',
  pattern: 'FV/{seq}/{MM}/{YYYY}',
  nextSeq: 42,
  seqPadding: 0,
  resetPolicy: 'monthly',
  documentType: 'invoice',
  register: null,
  fiscalYearStartMonth: 1,
  periodKey: '2026-07',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

describe('KsefNumberingEditor', () => {
  beforeEach(() => {
    captureDemoEvent.mockClear();
  });
  afterEach(cleanup);

  it('captures demo_ksef_numbering_variable_inserted when a variable chip is clicked (#1789)', () => {
    renderWithProviders(
      <KsefNumberingEditor connectionId="conn_1" onDone={vi.fn()} onCancel={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Insert {seq}' }));

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_ksef_numbering_variable_inserted', {
      variable: '{seq}',
    });
  });

  it('captures demo_ksef_series_save_attempted when a read-only viewer clicks the locked Save series button (#1789)', () => {
    renderWithProviders(
      <KsefNumberingEditor
        connectionId="conn_1"
        series={series}
        readOnly
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(document.querySelector('.read-only-lock') as Element);

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_ksef_series_save_attempted', {
      mode: 'edit',
    });
  });

  it('renders a live preview for the prefilled create pattern', () => {
    renderWithProviders(
      <KsefNumberingEditor connectionId="conn_1" onDone={vi.fn()} onCancel={vi.fn()} />,
    );
    // Default prefill FV/{seq}/{MM}/{YYYY} — the preview tokenises into spans.
    expect(screen.getAllByText('FV/').length).toBeGreaterThan(0);
  });

  it('shows a dash and an error when the pattern breaks the reset rule', async () => {
    renderWithProviders(
      <KsefNumberingEditor connectionId="conn_1" onDone={vi.fn()} onCancel={vi.fn()} />,
    );
    const patternInput = screen.getByPlaceholderText('FV/{seq}/{MM}/{YYYY}');
    fireEvent.change(patternInput, { target: { value: 'FV/{seq}/{YYYY}' } });

    expect(await screen.findAllByText('—')).not.toHaveLength(0);
    expect(screen.getAllByText(/Monthly reset needs \{MM\}/).length).toBeGreaterThan(0);
  });

  it('shows the fiscal-year start picker only when the pattern uses {FY}', async () => {
    renderWithProviders(
      <KsefNumberingEditor connectionId="conn_1" onDone={vi.fn()} onCancel={vi.fn()} />,
    );
    // Default prefill has no {FY} — the picker is hidden.
    expect(screen.queryByLabelText('Fiscal year starts in')).not.toBeInTheDocument();

    const patternInput = screen.getByPlaceholderText('FV/{seq}/{MM}/{YYYY}');
    fireEvent.change(patternInput, { target: { value: 'FV/{seq}/{FY}' } });

    expect(await screen.findByLabelText('Fiscal year starts in')).toBeInTheDocument();
  });

  it('sends fiscalYearStartMonth from the picker on submit', async () => {
    const createSeries = vi.fn().mockResolvedValue(series);
    const apiClient = createMockApiClient({ invoiceNumbering: { createSeries } });
    renderWithProviders(
      <KsefNumberingEditor connectionId="conn_1" onDone={vi.fn()} onCancel={vi.fn()} />,
      { apiClient },
    );

    // Keep {MM} so the pattern stays valid under the default monthly reset.
    const patternInput = screen.getByPlaceholderText('FV/{seq}/{MM}/{YYYY}');
    fireEvent.change(patternInput, { target: { value: 'FV/{seq}/{MM}/{FY}' } });
    const monthSelect = await screen.findByLabelText('Fiscal year starts in');
    fireEvent.change(monthSelect, { target: { value: '4' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save series' }));

    await waitFor(() => expect(createSeries).toHaveBeenCalledTimes(1));
    expect(createSeries).toHaveBeenCalledWith(
      expect.objectContaining({ fiscalYearStartMonth: 4, pattern: 'FV/{seq}/{MM}/{FY}' }),
    );
  });

  it('warns when lowering the next number below the persisted value', async () => {
    renderWithProviders(
      <KsefNumberingEditor connectionId="conn_1" series={series} onDone={vi.fn()} onCancel={vi.fn()} />,
    );
    const nextInput = screen.getByDisplayValue('42');
    fireEvent.change(nextInput, { target: { value: '10' } });

    expect(await screen.findByText(/Lowering the next number can reproduce/)).toBeInTheDocument();
  });

  it('creates a series on submit', async () => {
    const createSeries = vi.fn().mockResolvedValue(series);
    const apiClient = createMockApiClient({ invoiceNumbering: { createSeries } });
    const onDone = vi.fn();
    renderWithProviders(
      <KsefNumberingEditor connectionId="conn_1" onDone={onDone} onCancel={vi.fn()} />,
      { apiClient },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save series' }));

    await waitFor(() => expect(createSeries).toHaveBeenCalledTimes(1));
    expect(createSeries).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: 'invoice', pattern: 'FV/{seq}/{MM}/{YYYY}' }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('maps a server 400 errors[] onto the pattern field', async () => {
    const createSeries = vi
      .fn()
      .mockRejectedValue(new ApiError('Invalid pattern', 400, { errors: ['Pattern must contain the {seq} variable.'] }));
    const apiClient = createMockApiClient({ invoiceNumbering: { createSeries } });
    renderWithProviders(
      <KsefNumberingEditor connectionId="conn_1" onDone={vi.fn()} onCancel={vi.fn()} />,
      { apiClient },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save series' }));

    // Surfaced on the pattern field (and mirrored in the error summary).
    const shown = await screen.findAllByText('Pattern must contain the {seq} variable.');
    expect(shown.length).toBeGreaterThan(0);
    expect(document.querySelector('.form-field__error')?.textContent).toContain(
      'Pattern must contain the {seq} variable.',
    );
  });
});
