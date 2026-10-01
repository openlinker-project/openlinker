/**
 * `OrderExportDialog` unit tests (#3534/#3535, D35, mockup M5, #3507 PR 8).
 *
 * Covers every `data-mk-state` the mockup declares that this component itself
 * renders (`default`, `selected`, `preparing`, `ready`, `large`, `error` —
 * `background`/`viewer` are the page toast and a role state), plus the PR 8
 * contract: the 7 default columns start ticked, "Selected orders" is always
 * offered, a PII column raises the warning, an unknown count is never 0, and
 * "Try again" re-sends the request that failed.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderExportDialog } from './order-export-dialog';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import {
  ORDER_EXPORT_COLUMN_IDS,
  ORDER_EXPORT_COLUMN_LABELS,
  ORDER_EXPORT_DEFAULT_COLUMNS,
  type CreateOrderExportRequest,
  type OrderExportRun,
  type OrderRecord,
} from '../api/orders.types';

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
    id: 'run-0000abcd',
    status: 'pending',
    format: 'csv',
    scope: 'filtered',
    rowCount: null,
    containsPii: null,
    errorMessage: null,
    expiresAt: '2026-10-05T00:00:00.000Z',
    createdAt: '2026-09-28T10:00:00.000Z',
    ...overrides,
  };
}

interface RenderOptions {
  filteredCount?: number | null;
  selectedOrders?: OrderRecord[];
  initialScope?: 'view' | 'selected';
  requestExport?: (body: CreateOrderExportRequest) => Promise<OrderExportRun>;
  getExportRun?: (runId: string) => Promise<OrderExportRun>;
  onContinueInBackground?: (runId: string) => void;
}

function renderDialog(options: RenderOptions = {}) {
  const orders = {
    listColumnPresets: vi.fn().mockResolvedValue([]),
    getWorkspaceDefaultColumnPreset: vi.fn().mockResolvedValue(null),
    requestExport: options.requestExport ?? vi.fn().mockResolvedValue(makeRun()),
    getExportRun: options.getExportRun ?? vi.fn().mockResolvedValue(makeRun()),
    downloadExport: vi.fn().mockResolvedValue(new Blob()),
  };
  const api = createMockApiClient({ orders });
  renderWithProviders(
    <OrderExportDialog
      open
      onOpenChange={vi.fn()}
      filters={{ sourceConnectionId: 'conn-1' }}
      filteredCount={'filteredCount' in options ? (options.filteredCount ?? null) : 100}
      selectedOrders={options.selectedOrders ?? []}
      initialScope={options.initialScope}
      scopeDescription="Created 1–25 Sep 2026 · Source Allegro"
      onContinueInBackground={options.onContinueInBackground}
    />,
    { apiClient: api },
  );
  return orders;
}

const dialog = (): HTMLElement => screen.getByTestId('order-export-dialog');
const summary = (): string => screen.getByTestId('order-export-summary').textContent ?? '';

afterEach(cleanup);

describe('OrderExportDialog (#3534/#3535, D35, #3507 PR 8)', () => {
  it('data-mk-state="default": starts with the 7 default columns ticked and the count in the footer', async () => {
    renderDialog();

    expect(await screen.findByRole('heading', { name: 'Export orders' })).toBeInTheDocument();
    expect(dialog()).toHaveAttribute('data-mk-state', 'default');
    expect(screen.getByText('Created 1–25 Sep 2026 · Source Allegro')).toBeInTheDocument();

    for (const id of ORDER_EXPORT_COLUMN_IDS) {
      const box = screen.getByRole('checkbox', { name: ORDER_EXPORT_COLUMN_LABELS[id] });
      if ((ORDER_EXPORT_DEFAULT_COLUMNS as readonly string[]).includes(id)) expect(box).toBeChecked();
      else expect(box).not.toBeChecked();
    }
    expect(screen.getByText(`7 of ${ORDER_EXPORT_COLUMN_IDS.length}`)).toBeInTheDocument();
    expect(summary()).toBe('100 rows · 7 columns · CSV');
    expect(screen.getByRole('button', { name: 'Export 100 orders' })).toBeInTheDocument();
  });

  it('always offers "Selected orders", disabled with a hint while nothing is ticked', async () => {
    renderDialog();

    await screen.findByRole('heading', { name: 'Export orders' });
    expect(screen.getByRole('radio', { name: 'Selected orders' })).toBeDisabled();
    expect(screen.getByText('Tick orders in the table first')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Current view' })).toBeChecked();
  });

  it('data-mk-state="selected": picking the ticked rows switches the state and sends their ids', async () => {
    const requestExport = vi.fn().mockResolvedValue(makeRun());
    renderDialog({ selectedOrders: [makeOrder('ol_order_1'), makeOrder('ol_order_2')], requestExport });
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Export orders' });
    await user.click(screen.getByRole('radio', { name: 'Selected orders' }));

    expect(dialog()).toHaveAttribute('data-mk-state', 'selected');
    expect(summary()).toBe('2 rows · 7 columns · CSV');
    await user.click(screen.getByRole('button', { name: 'Export 2 orders' }));
    await waitFor(() => { expect(requestExport).toHaveBeenCalled(); });
    expect(requestExport.mock.calls[0][0]).toMatchObject({
      scope: 'selected',
      selectedOrderIds: ['ol_order_1', 'ol_order_2'],
      columns: [...ORDER_EXPORT_DEFAULT_COLUMNS],
    });
  });

  it('opens on the selection when initialScope="selected"', async () => {
    renderDialog({ selectedOrders: [makeOrder('ol_order_1')], initialScope: 'selected' });

    await screen.findByRole('heading', { name: 'Export orders' });
    expect(dialog()).toHaveAttribute('data-mk-state', 'selected');
    expect(screen.getByRole('radio', { name: 'Selected orders' })).toBeChecked();
  });

  it('warns about personal data exactly while a PII column is selected', async () => {
    renderDialog();
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Export orders' });
    // "Buyer name" is one of the 7 defaults, so the file starts with PII in it.
    expect(screen.getByText('This file will contain personal data')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Buyer name' }));
    expect(screen.queryByText('This file will contain personal data')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Buyer email' }));
    expect(screen.getByText('This file will contain personal data')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Include personal data/ }));
    expect(screen.queryByText('This file will contain personal data')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Buyer email' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Buyer email' })).not.toBeChecked();
  });

  it('says "Counting…" in the footer while the count is unknown — never 0', async () => {
    renderDialog({ filteredCount: null });

    await screen.findByRole('heading', { name: 'Export orders' });
    expect(summary()).toBe('Counting… · 7 columns · CSV');
    expect(screen.getByRole('button', { name: 'Export orders' })).toBeInTheDocument();
    expect(screen.queryByText(/^0 rows/)).toBeNull();
  });

  it('data-mk-state="large": above the background threshold the action becomes "Start background export"', async () => {
    renderDialog({ filteredCount: 6000 });

    await screen.findByRole('heading', { name: 'Export orders' });
    expect(dialog()).toHaveAttribute('data-mk-state', 'large');
    expect(screen.getByText('This export runs in the background')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start background export' })).toBeInTheDocument();
  });

  it('data-mk-state="preparing": submitting opens the run, and closing it hands the run to the background', async () => {
    const requestExport = vi.fn().mockResolvedValue(makeRun({ status: 'pending' }));
    const getExportRun = vi.fn().mockResolvedValue(makeRun({ status: 'pending' }));
    const onContinueInBackground = vi.fn();
    renderDialog({ requestExport, getExportRun, onContinueInBackground });
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Export orders' });
    await user.click(screen.getByRole('button', { name: 'Export 100 orders' }));

    expect(await screen.findByText('Preparing export')).toBeInTheDocument();
    expect(dialog()).toHaveAttribute('data-mk-state', 'preparing');
    expect(screen.getByText('orders-export-2026-09-28-0000abcd.csv')).toBeInTheDocument();
    expect(screen.getByText(/You can close this window/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onContinueInBackground).toHaveBeenCalledWith('run-0000abcd');
  });

  it('data-mk-state="ready": a resolved run describes the file and offers the download', async () => {
    const requestExport = vi.fn().mockResolvedValue(makeRun({ status: 'pending' }));
    const getExportRun = vi.fn().mockResolvedValue(
      makeRun({ status: 'ready', rowCount: 42, containsPii: false }),
    );
    const orders = renderDialog({ requestExport, getExportRun });
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Export orders' });
    await user.click(screen.getByRole('button', { name: 'Export 100 orders' }));

    expect(await screen.findByText('Export ready')).toBeInTheDocument();
    expect(dialog()).toHaveAttribute('data-mk-state', 'ready');
    const list = dialog().querySelector('dl') as HTMLElement;
    expect(within(list).getByText('42')).toBeInTheDocument();
    expect(within(list).getByText('7, Default preset')).toBeInTheDocument();
    expect(within(list).getByText('Not included')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Jobs & Logs' })).toHaveAttribute(
      'href',
      '/jobs-logs?jobType=orders.export',
    );

    await user.click(screen.getByRole('button', { name: 'Download file' }));
    await waitFor(() => { expect(orders.downloadExport).toHaveBeenCalledWith('run-0000abcd'); });
  });

  it('data-mk-state="error": "Try again" re-sends the same request', async () => {
    const requestExport = vi
      .fn()
      .mockResolvedValueOnce(makeRun({ id: 'run-1', status: 'pending' }))
      .mockResolvedValueOnce(makeRun({ id: 'run-2', status: 'pending' }));
    const getExportRun = vi.fn((id: string) =>
      Promise.resolve(
        id === 'run-1'
          ? makeRun({ id, status: 'failed', errorMessage: 'Reading orders from the database timed out.' })
          : makeRun({ id, status: 'pending' }),
      ),
    );
    renderDialog({ requestExport, getExportRun });
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Export orders' });
    await user.click(screen.getByRole('button', { name: 'Export 100 orders' }));

    expect(await screen.findByText('Export failed')).toBeInTheDocument();
    expect(dialog()).toHaveAttribute('data-mk-state', 'error');
    expect(screen.getByText('Reading orders from the database timed out.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => { expect(requestExport).toHaveBeenCalledTimes(2); });
    expect(requestExport.mock.calls[1][0]).toEqual(requestExport.mock.calls[0][0]);
    expect(await screen.findByText('Preparing export')).toBeInTheDocument();
  });

  it('"Change settings" from the error state returns to the form with the settings kept', async () => {
    const requestExport = vi.fn().mockResolvedValue(makeRun({ status: 'pending' }));
    const getExportRun = vi.fn().mockResolvedValue(makeRun({ status: 'failed' }));
    renderDialog({ requestExport, getExportRun });
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Export orders' });
    await user.click(screen.getByRole('radio', { name: 'Excel (XLSX)' }));
    await user.click(screen.getByRole('button', { name: 'Export 100 orders' }));
    await screen.findByText('Export failed');

    await user.click(screen.getByRole('button', { name: 'Change settings' }));
    expect(await screen.findByRole('heading', { name: 'Export orders' })).toBeInTheDocument();
    expect(dialog()).toHaveAttribute('data-mk-state', 'default');
    expect(summary()).toBe('100 rows · 7 columns · Excel');
  });
});
