/**
 * `OrderExportDialog` unit tests (#3534/#3535, D35, mockup M5).
 *
 * One test per `data-mk-state` the mockup declares that this component
 * itself renders (`default`, `selected`, `preparing`, `ready`, `large`,
 * `error` — `background`/`viewer` are Jobs & Logs / role states rendered
 * elsewhere, per the component's own docblock).
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderExportDialog } from './order-export-dialog';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { CreateOrderExportRequest, OrderExportRun, OrderRecord } from '../api/orders.types';

function makeOrder(id: string): OrderRecord {
  return {
    internalOrderId: id,
    sourceConnectionId: 'conn-1',
    orderSnapshot: {},
    syncStatus: [],
    recordStatus: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as OrderRecord;
}

function makeRun(overrides: Partial<OrderExportRun> = {}): OrderExportRun {
  return {
    id: 'run-1',
    status: 'pending',
    format: 'csv',
    scope: 'filtered',
    rowCount: null,
    containsPii: null,
    errorMessage: null,
    expiresAt: '2026-10-05T00:00:00.000Z',
    createdAt: '2026-09-28T00:00:00.000Z',
    ...overrides,
  };
}

function renderDialog(overrides: {
  filteredCount?: number | null;
  selectedOrders?: OrderRecord[];
  requestExport?: (body: CreateOrderExportRequest) => Promise<OrderExportRun>;
  getExportRun?: (runId: string) => Promise<OrderExportRun>;
} = {}) {
  const orders = {
    listColumnPresets: vi.fn().mockResolvedValue([]),
    getWorkspaceDefaultColumnPreset: vi.fn().mockResolvedValue(null),
    requestExport: overrides.requestExport ?? vi.fn().mockResolvedValue(makeRun()),
    getExportRun: overrides.getExportRun ?? vi.fn().mockResolvedValue(makeRun()),
    downloadExport: vi.fn().mockResolvedValue(new Blob()),
  };
  const api = createMockApiClient({ orders });
  renderWithProviders(
    <OrderExportDialog
      open
      onOpenChange={vi.fn()}
      filters={{}}
      filteredCount={overrides.filteredCount ?? 100}
      selectedOrders={overrides.selectedOrders ?? []}
    />,
    { apiClient: api },
  );
  return orders;
}

afterEach(cleanup);

describe('OrderExportDialog (#3534/#3535, D35)', () => {
  it('data-mk-state="default": the form, current-view scope and Export action', async () => {
    renderDialog();

    expect(await screen.findByText('Export orders')).toBeInTheDocument();
    const dialog = screen.getByTestId('order-export-dialog');
    expect(dialog).toHaveAttribute('data-mk-state', 'default');
    expect(screen.getByText('Current view (100 orders)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('data-mk-state="large": more than the background threshold warns it will run in the background', async () => {
    renderDialog({ filteredCount: 6000 });

    await screen.findByText('Export orders');
    expect(screen.getByTestId('order-export-dialog')).toHaveAttribute('data-mk-state', 'large');
    expect(screen.getByText(/will run in the background/)).toBeInTheDocument();
  });

  it('data-mk-state="selected": picking the row-selection scope switches the state', async () => {
    renderDialog({ selectedOrders: [makeOrder('ol_order_1'), makeOrder('ol_order_2')] });
    const user = userEvent.setup();

    await screen.findByText('Export orders');
    await user.click(screen.getByLabelText('Selected rows only (2)'));

    expect(screen.getByTestId('order-export-dialog')).toHaveAttribute('data-mk-state', 'selected');
  });

  it('data-mk-state="preparing": submitting opens the run and polls', async () => {
    const requestExport = vi.fn().mockResolvedValue(makeRun({ status: 'pending' }));
    const getExportRun = vi.fn().mockResolvedValue(makeRun({ status: 'pending' }));
    renderDialog({ requestExport, getExportRun });
    const user = userEvent.setup();

    await screen.findByText('Export orders');
    await user.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => { expect(requestExport).toHaveBeenCalled(); });
    expect(await screen.findByText('Preparing export')).toBeInTheDocument();
    expect(screen.getByTestId('order-export-dialog')).toHaveAttribute('data-mk-state', 'preparing');
  });

  it('data-mk-state="ready": a resolved run offers the download', async () => {
    const requestExport = vi.fn().mockResolvedValue(makeRun({ status: 'pending' }));
    const getExportRun = vi.fn().mockResolvedValue(
      makeRun({ status: 'ready', rowCount: 42, containsPii: false }),
    );
    const orders = renderDialog({ requestExport, getExportRun });
    const user = userEvent.setup();

    await screen.findByText('Export orders');
    await user.click(screen.getByRole('button', { name: 'Export' }));

    expect(await screen.findByText('Export ready')).toBeInTheDocument();
    expect(screen.getByTestId('order-export-dialog')).toHaveAttribute('data-mk-state', 'ready');
    expect(screen.getByText('42')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Download file' }));
    await waitFor(() => { expect(orders.downloadExport).toHaveBeenCalledWith('run-1'); });
  });

  it('data-mk-state="error": a failed run surfaces its message and offers to change settings', async () => {
    const requestExport = vi.fn().mockResolvedValue(makeRun({ status: 'pending' }));
    const getExportRun = vi.fn().mockResolvedValue(
      makeRun({ status: 'failed', errorMessage: 'Reading orders from the database timed out.' }),
    );
    renderDialog({ requestExport, getExportRun });
    const user = userEvent.setup();

    await screen.findByText('Export orders');
    await user.click(screen.getByRole('button', { name: 'Export' }));

    expect(await screen.findByText('Export failed')).toBeInTheDocument();
    expect(screen.getByTestId('order-export-dialog')).toHaveAttribute('data-mk-state', 'error');
    expect(screen.getByText('Reading orders from the database timed out.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Change settings' }));
    expect(await screen.findByText('Export orders')).toBeInTheDocument();
  });
});
