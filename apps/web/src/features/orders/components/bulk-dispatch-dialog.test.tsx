/**
 * BulkDispatchDialog tests (#1109)
 *
 * Covers the dialog's risk-bearing behaviour: the multi-source fan-out + merge
 * (incl. a rejected group synthesizing per-order failures, NOT vanishing),
 * ineligible orders surfaced with a reason, the empty-eligible guard, and the
 * per-carrier protocol affordance.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { BulkDispatchDialog, splitIdForWrap } from './bulk-dispatch-dialog';
import type { OrderRecord } from '../api/orders.types';
import type { Shipment } from '../../shipments';

const COURIER_SNAPSHOT = {
  customerEmail: 'buyer@example.com',
  shipping: { methodId: 'dpd-courier', methodName: 'DPD Kurier' },
  shippingAddress: {
    firstName: 'Anna',
    lastName: 'Nowak',
    address1: 'ul. Testowa 1',
    city: 'Warszawa',
    postalCode: '00-001',
    country: 'PL',
    phone: '+48500600700',
  },
};

function order(overrides: Partial<OrderRecord> & { snapshot?: Record<string, unknown> }): OrderRecord {
  const { snapshot, ...rest } = overrides;
  return {
    internalOrderId: 'ol_order_1',
    customerId: null,
    sourceConnectionId: 'conn_a',
    sourceEventId: null,
    orderSnapshot: snapshot ?? COURIER_SNAPSHOT,
    syncStatus: [],
    syncAttempts: [],
    recordStatus: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...rest,
  } as OrderRecord;
}

function shipment(id: string, carrier: string, connectionId: string): Shipment {
  return {
    id,
    orderId: 'ol_order_x',
    customerId: null,
    connectionId,
    shippingMethod: 'kurier',
    status: 'generated',
    providerShipmentId: 'prov_1',
    paczkomatId: null,
    sourceDeliveryMethodId: null,
    deliveryIntent: null,
    trackingNumber: null,
    carrier,
    labelPdfRef: 'ref',
    dispatchedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    failedAt: null,
    errorMessage: null,
    providerCode: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    orderSummary: null,
  };
}

async function fillProfileAndApply(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Default length in millimetres'), '300');
  await user.type(screen.getByLabelText('Default width in millimetres'), '200');
  await user.type(screen.getByLabelText('Default height in millimetres'), '100');
  await user.type(screen.getByLabelText('Default weight in grams'), '500');
  await user.click(screen.getByRole('button', { name: 'Apply to all rows' }));
}

const noop = (): void => {};

describe('BulkDispatchDialog', () => {
  it('dispatches a batch and shows per-order results + a per-carrier protocol button', async () => {
    const user = userEvent.setup();
    const bulkGenerateLabels = vi.fn().mockResolvedValue({
      results: [
        { kind: 'dispatched', orderId: 'ol_order_1', shipment: shipment('ol_shipment_1', 'inpost', 'conn_carrier') },
        { kind: 'failed', orderId: 'ol_order_2', error: 'Carrier rejected: postcode invalid' },
      ],
    });
    const apiClient = createMockApiClient({ shipments: { bulkGenerateLabels } });

    const orders = [
      order({ internalOrderId: 'ol_order_1' }),
      order({ internalOrderId: 'ol_order_2' }),
    ];

    renderWithProviders(
      <BulkDispatchDialog open orders={orders} onOpenChange={noop} channelLabelFor={() => 'Allegro'} onComplete={noop} />,
      { apiClient },
    );

    await fillProfileAndApply(user);
    await user.click(screen.getByRole('button', { name: 'Dispatch 2 orders' }));

    expect(await screen.findByRole('heading', { name: 'Batch complete' })).toBeInTheDocument();
    // Both outcomes are rendered.
    expect(screen.getByText('ol_order_1')).toBeInTheDocument();
    expect(screen.getByText('Carrier rejected: postcode invalid')).toBeInTheDocument();
    // One protocol download for the single carrier (InPost).
    expect(screen.getByRole('button', { name: /InPost \(1\)/ })).toBeInTheDocument();
    expect(bulkGenerateLabels).toHaveBeenCalledTimes(1);
  });

  it('synthesizes per-order failures when a source group request rejects (no silent drop)', async () => {
    const user = userEvent.setup();
    const bulkGenerateLabels = vi.fn().mockRejectedValue(new Error('Network error'));
    const apiClient = createMockApiClient({ shipments: { bulkGenerateLabels } });

    const orders = [
      order({ internalOrderId: 'ol_order_1', sourceConnectionId: 'conn_a' }),
      order({ internalOrderId: 'ol_order_2', sourceConnectionId: 'conn_a' }),
    ];

    renderWithProviders(
      <BulkDispatchDialog open orders={orders} onOpenChange={noop} channelLabelFor={() => 'Allegro'} onComplete={noop} />,
      { apiClient },
    );

    await fillProfileAndApply(user);
    await user.click(screen.getByRole('button', { name: 'Dispatch 2 orders' }));

    expect(await screen.findByRole('heading', { name: 'Batch complete' })).toBeInTheDocument();
    // Both orders surface as failed with the group error — neither vanishes.
    expect(screen.getByText('ol_order_1')).toBeInTheDocument();
    expect(screen.getByText('ol_order_2')).toBeInTheDocument();
    expect(screen.getAllByText('Network error')).toHaveLength(2);
    // No dispatched shipments → no protocol button.
    expect(screen.queryByRole('button', { name: /protocol|\(\d+\)/ })).not.toBeInTheDocument();
  });

  it('fans out one request per source connection', async () => {
    const user = userEvent.setup();
    const bulkGenerateLabels = vi.fn().mockResolvedValue({ results: [] });
    const apiClient = createMockApiClient({ shipments: { bulkGenerateLabels } });

    const orders = [
      order({ internalOrderId: 'ol_order_1', sourceConnectionId: 'conn_a' }),
      order({ internalOrderId: 'ol_order_2', sourceConnectionId: 'conn_b' }),
    ];

    renderWithProviders(
      <BulkDispatchDialog open orders={orders} onOpenChange={noop} channelLabelFor={() => 'Src'} onComplete={noop} />,
      { apiClient },
    );

    await fillProfileAndApply(user);
    await user.click(screen.getByRole('button', { name: 'Dispatch 2 orders' }));

    await waitFor(() => expect(bulkGenerateLabels).toHaveBeenCalledTimes(2));
  });

  it('surfaces an ineligible (COD) order with its reason and excludes it from the batch', () => {
    const orders = [
      order({ internalOrderId: 'ol_order_1' }),
      order({ internalOrderId: 'ol_order_cod', snapshot: { ...COURIER_SNAPSHOT, paymentStatus: 'cod' } }),
    ];

    renderWithProviders(
      <BulkDispatchDialog open orders={orders} onOpenChange={noop} channelLabelFor={() => 'Allegro'} onComplete={noop} />,
    );

    // Title reflects only the eligible count; the COD reason is visible.
    expect(screen.getByText('Dispatch 1 of 2 orders')).toBeInTheDocument();
    expect(screen.getByText('COD — enter amount')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dispatch 1 order' })).toBeEnabled();
  });

  it('disables dispatch when no order is eligible', () => {
    const orders = [
      order({ internalOrderId: 'ol_order_cod', snapshot: { ...COURIER_SNAPSHOT, paymentStatus: 'cod' } }),
    ];

    renderWithProviders(
      <BulkDispatchDialog open orders={orders} onOpenChange={noop} channelLabelFor={() => 'Allegro'} onComplete={noop} />,
    );

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/None of the selected orders can be bulk-dispatched/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dispatch 0 orders/ })).toBeDisabled();
  });

  describe('splitIdForWrap (#2669)', () => {
    it('splits the `ol_{type}_` prefix from the opaque id and chunks the rest', () => {
      expect(splitIdForWrap('ol_order_fce2df4d853f4499b955a6bb1a212bd1')).toEqual([
        'ol_order_',
        'fce2df',
        '4d853f',
        '4499b9',
        '55a6bb',
        '1a212bd1',
      ]);
    });

    it('falls back to chunking the whole string when there is no recognisable prefix', () => {
      expect(splitIdForWrap('abcdefghijkl', 4)).toEqual(['abcd', 'efgh', 'ijkl']);
    });

    it('returns the id as a single chunk when it is shorter than one chunk', () => {
      expect(splitIdForWrap('ol_order_1')).toEqual(['ol_order_', '1']);
    });
  });

  it('renders a long order id wrapped in chunks while keeping the full value queryable and hoverable', () => {
    const longId = 'ol_order_fce2df4d853f4499b955a6bb1a212bd1';
    const orders = [order({ internalOrderId: longId })];

    renderWithProviders(
      <BulkDispatchDialog open orders={orders} onOpenChange={noop} channelLabelFor={() => 'Allegro'} onComplete={noop} />,
    );

    // The visible text still reads as the complete, unbroken id (wrap points
    // are `<wbr>` elements, which contribute no text of their own).
    const idEl = screen.getByText(longId);
    expect(idEl).toHaveAttribute('title', longId);
    // At least one controlled wrap point was inserted (not left to
    // `overflow-wrap: anywhere`).
    expect(idEl.querySelectorAll('wbr').length).toBeGreaterThan(0);
  });
});
