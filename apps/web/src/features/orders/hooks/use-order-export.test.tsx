/**
 * `useOrderExportBackgroundToast` unit tests (#3507 PR 8, mockup M5 `background`).
 *
 * Pins: a run handed over with `track` is polled after the dialog is gone and
 * announced once — "Export ready" with a Download action when it finishes,
 * "Export failed" with a View job action when it fails.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { useOrderExportBackgroundToast } from './use-order-export';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { OrderExportRun } from '../api/orders.types';

function makeRun(overrides: Partial<OrderExportRun> = {}): OrderExportRun {
  return {
    id: 'run-0000abcd',
    status: 'ready',
    format: 'xlsx',
    scope: 'filtered',
    rowCount: 18412,
    containsPii: false,
    errorMessage: null,
    expiresAt: '2026-10-05T00:00:00.000Z',
    createdAt: '2026-09-28T10:00:00.000Z',
    ...overrides,
  };
}

function Harness(): ReactElement {
  const toast = useOrderExportBackgroundToast();
  return (
    <button type="button" onClick={() => { toast.track('run-0000abcd'); }}>
      track
    </button>
  );
}

function renderHarness(run: OrderExportRun) {
  const orders = {
    getExportRun: vi.fn().mockResolvedValue(run),
    downloadExport: vi.fn().mockResolvedValue(new Blob()),
  };
  renderWithProviders(<Harness />, { apiClient: createMockApiClient({ orders }) });
  return orders;
}

afterEach(cleanup);

describe('useOrderExportBackgroundToast (#3507 PR 8)', () => {
  it('announces a finished run with its file and a Download action', async () => {
    const orders = renderHarness(makeRun());
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'track' }));

    expect((await screen.findAllByText('Export ready')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^18.412 orders in orders-export-2026-09-28-0000abcd\.xlsx\.$/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => { expect(orders.downloadExport).toHaveBeenCalledWith('run-0000abcd'); });
  });

  it('announces a failed run with a View job action', async () => {
    renderHarness(makeRun({ status: 'failed', rowCount: null, errorMessage: 'Timed out.' }));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'track' }));

    expect((await screen.findAllByText('Export failed')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Timed out.').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'View job' })).toBeInTheDocument();
  });

  it('stays silent until a run is tracked', async () => {
    const orders = renderHarness(makeRun());

    await screen.findByRole('button', { name: 'track' });
    expect(orders.getExportRun).not.toHaveBeenCalled();
    expect(screen.queryByText('Export ready')).toBeNull();
  });
});
