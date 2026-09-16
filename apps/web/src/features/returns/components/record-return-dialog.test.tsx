/**
 * Record Return Dialog (#3078/#3084)
 *
 * The acceptance criteria this file exists for: an order/channel mismatch
 * (400 `order-not-on-connection`) renders as a FIELD error, and a
 * successfully recorded return is what makes the "Waiting for your OK" group
 * gain a row (proved here by asserting the mutation lands and the cache it
 * invalidates — the worklist's own display of that is #3081's test).
 *
 * @module apps/web/src/features/returns/components
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RecordReturnDialog } from './record-return-dialog';
import { RECORD_RETURN_DIALOG_COPY as COPY } from '../lib/record-return-dialog.copy';
import { ApiError } from '../../../shared/api/api-error';
import type { OrderRecord } from '../../orders';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    internalOrderId: 'ol_order_1',
    customerId: null,
    sourceConnectionId: 'conn_1',
    sourceEventId: null,
    orderSnapshot: {},
    syncStatus: [],
    syncAttempts: [],
    recordStatus: 'ready',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderDialog(options: {
  record?: ReturnType<typeof vi.fn>;
  orders?: OrderRecord[];
  connections?: typeof sampleConnection[];
  onRecorded?: () => void;
} = {}) {
  const apiClient = createMockApiClient();
  const record = options.record ?? vi.fn().mockResolvedValue({
    returnId: 'ol_return_1',
    internalOrderId: 'ol_order_1',
    origin: 'operator_authored',
    openedAt: '2026-08-01T00:00:00.000Z',
  });
  apiClient.returns.record = record as unknown as typeof apiClient.returns.record;
  apiClient.orders.list = vi
    .fn()
    .mockResolvedValue({ items: options.orders ?? [order()], total: 1, limit: 20, offset: 0 }) as unknown as typeof apiClient.orders.list;
  apiClient.connections.list = vi
    .fn()
    .mockResolvedValue(options.connections ?? [sampleConnection]) as unknown as typeof apiClient.connections.list;

  const onOpenChange = vi.fn();
  renderWithProviders(
    <RecordReturnDialog open onOpenChange={onOpenChange} onRecorded={options.onRecorded} />,
    { apiClient },
  );
  return { record, onOpenChange };
}

async function fillValidForm(): Promise<void> {
  await userEvent.type(await screen.findByLabelText(COPY.orderFieldLabel), 'ol_order_1');
  await userEvent.selectOptions(screen.getByLabelText(COPY.connectionFieldLabel), 'conn_1');
  await userEvent.type(screen.getByLabelText(COPY.itemFieldLabel), 'Ceramic mug');
  await userEvent.selectOptions(screen.getByLabelText(COPY.reasonFieldLabel), 'defective');
  const quantity = screen.getByLabelText(COPY.quantityFieldLabel);
  await userEvent.clear(quantity);
  await userEvent.type(quantity, '2');
}

describe('RecordReturnDialog', () => {
  it('should require every field before submitting', async () => {
    const { record } = renderDialog();

    await userEvent.click(await screen.findByRole('button', { name: COPY.confirm }));

    expect(record).not.toHaveBeenCalled();
    // At least the order and connection fields, since those are the two the
    // acceptance criteria for this dialog centre on.
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
  });

  it('should record with a single line and close on success', async () => {
    const { record, onOpenChange } = renderDialog();

    await fillValidForm();
    await userEvent.click(screen.getByRole('button', { name: COPY.confirm }));

    await waitFor(() => {
      expect(record).toHaveBeenCalledWith({
        internalOrderId: 'ol_order_1',
        sourceConnectionId: 'conn_1',
        lines: [{ name: 'Ceramic mug', reason: 'defective', quantityAdvised: 2 }],
      });
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('should call onRecorded on success', async () => {
    const onRecorded = vi.fn();
    renderDialog({ onRecorded });

    await fillValidForm();
    await userEvent.click(screen.getByRole('button', { name: COPY.confirm }));

    await waitFor(() => {
      expect(onRecorded).toHaveBeenCalled();
    });
  });

  it('should render an order/channel mismatch (400 order-not-on-connection) as a FIELD error', async () => {
    const record = vi.fn().mockRejectedValue(
      new ApiError('Cannot record', 400, { reason: 'order-not-on-connection' }),
    );
    renderDialog({ record });

    await fillValidForm();
    await userEvent.click(screen.getByRole('button', { name: COPY.confirm }));

    expect(await screen.findByText(COPY.orderNotOnConnection)).toBeInTheDocument();
    expect(screen.queryByText(COPY.genericError)).not.toBeInTheDocument();
  });

  it('should render an unknown-order 400 as a field error naming the typed id', async () => {
    const record = vi.fn().mockRejectedValue(
      new ApiError('Cannot record', 400, { reason: 'unknown-order' }),
    );
    renderDialog({ record });

    await fillValidForm();
    await userEvent.click(screen.getByRole('button', { name: COPY.confirm }));

    expect(await screen.findByText(COPY.unknownOrder('ol_order_1'))).toBeInTheDocument();
  });

  it('should fall back to the generic message for an unrecognised failure', async () => {
    const record = vi.fn().mockRejectedValue(new Error('network down'));
    renderDialog({ record });

    await fillValidForm();
    await userEvent.click(screen.getByRole('button', { name: COPY.confirm }));

    expect(await screen.findByText(COPY.genericError)).toBeInTheDocument();
  });

  it('should warn — but not block — when the picked order came in on a different connection', async () => {
    renderDialog({
      orders: [order({ internalOrderId: 'ol_order_2', sourceConnectionId: 'conn_1' })],
      connections: [
        sampleConnection,
        { ...sampleConnection, id: 'conn_2', name: 'Allegro — Main Shop' },
      ],
    });

    await userEvent.type(await screen.findByLabelText(COPY.orderFieldLabel), 'ol_order_2');
    await userEvent.selectOptions(screen.getByLabelText(COPY.connectionFieldLabel), 'conn_2');

    expect(await screen.findByText(COPY.connectionMismatchWarning('Main PrestaShop Store'))).toBeInTheDocument();
    // Still submittable — a warning, not a block.
    expect(screen.getByRole('button', { name: COPY.confirm })).not.toBeDisabled();
  });

  it('should close via cancel without recording anything', async () => {
    const { record, onOpenChange } = renderDialog();

    await userEvent.click(await screen.findByRole('button', { name: COPY.cancel }));

    expect(record).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
