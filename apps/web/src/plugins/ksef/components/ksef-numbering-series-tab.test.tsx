/**
 * KsefNumberingSeriesTab tests
 *
 * Covers the demo-event instrumentation (#1789) on the three in-file
 * editor-opening entry points: the empty-state "Add series" CTA, the toolbar
 * "Add series" button, and the per-row "Edit" button.
 *
 * @module plugins/ksef/components
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { NumberingSeries } from '../../../features/invoicing';
import { KsefNumberingSeriesTab } from './ksef-numbering-series-tab';

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

describe('KsefNumberingSeriesTab', () => {
  beforeEach(() => {
    captureDemoEvent.mockClear();
  });
  afterEach(cleanup);

  it('captures demo_ksef_series_editor_opened(mode=create) from the empty-state "Add series" CTA (#1789)', async () => {
    renderWithProviders(<KsefNumberingSeriesTab connectionId="conn_1" readOnly={false} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add series' }));

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_ksef_series_editor_opened', {
      mode: 'create',
    });
  });

  it('captures demo_ksef_series_editor_opened(mode=create) from the toolbar "Add series" button (#1789)', async () => {
    const apiClient = createMockApiClient({
      invoiceNumbering: { listSeries: vi.fn().mockResolvedValue([series]) },
    });
    renderWithProviders(<KsefNumberingSeriesTab connectionId="conn_1" readOnly={false} />, {
      apiClient,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Add series' }));

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_ksef_series_editor_opened', {
      mode: 'create',
    });
  });

  it('captures demo_ksef_series_editor_opened(mode=edit) from the row "Edit" button (#1789)', async () => {
    const apiClient = createMockApiClient({
      invoiceNumbering: { listSeries: vi.fn().mockResolvedValue([series]) },
    });
    renderWithProviders(<KsefNumberingSeriesTab connectionId="conn_1" readOnly={false} />, {
      apiClient,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_ksef_series_editor_opened', {
      mode: 'edit',
    });
  });
});
