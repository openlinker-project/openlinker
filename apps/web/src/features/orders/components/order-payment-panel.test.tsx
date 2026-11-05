/**
 * OrderPaymentPanel tests (#3963)
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { OrderPaymentWritebackEntry } from '../api/orders.types';
import { OrderPaymentPanel } from './order-payment-panel';

const AT = '2026-11-04T13:07:40.000Z';

function entry(overrides: Partial<OrderPaymentWritebackEntry>): OrderPaymentWritebackEntry {
  return {
    destinationConnectionId: 'dest-ps',
    state: 'paid-in-shop',
    at: AT,
    attempts: 1,
    reason: null,
    detail: null,
    problem: false,
    ...overrides,
  };
}

function render(entries: OrderPaymentWritebackEntry[], retry = vi.fn().mockResolvedValue({ enqueued: 1 })) {
  const api = createMockApiClient({
    connections: {
      getById: vi.fn().mockImplementation((id: string) =>
        Promise.resolve({
          id,
          name: id === 'dest-ps' ? 'Sklep PrestaShop' : id === 'dest-woo' ? 'Sklep WooCommerce' : 'Subiekt GT',
          platformType: 'prestashop',
          status: 'active',
          config: {},
          credentialsBacked: true,
          enabledCapabilities: [],
          supportedCapabilities: [],
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z',
        })
      ),
    },
    orders: {
      retryPaymentWriteback: retry,
      markPaymentWritebackHandled: vi.fn().mockResolvedValue({ updated: 1 }),
    },
  });
  renderWithProviders(
    <OrderPaymentPanel
      internalOrderId="ol_order_1"
      entries={entries}
      sourceName="Allegro"
      amountLabel="PLN 389.00"
    />,
    { apiClient: api }
  );
  return { retry };
}

describe('OrderPaymentPanel', () => {
  afterEach(() => cleanup());

  it('should render nothing when no shop has a payment entry', () => {
    render([]);
    expect(screen.queryByText('Payment')).toBeNull();
  });

  it('should state where the money was paid and how many shops were updated', () => {
    render([entry({}), entry({ destinationConnectionId: 'dest-woo' })]);

    expect(screen.getByText('Paid on Allegro')).toBeInTheDocument();
    expect(screen.getByText('PLN 389.00')).toBeInTheDocument();
    expect(screen.getByText('2 of 2 shops updated')).toBeInTheDocument();
    expect(screen.getAllByText('Paid in shop')).toHaveLength(2);
  });

  it('should keep a retrying shop quiet: no warning, one Retry now on its row', async () => {
    const { retry } = render([
      entry({}),
      entry({ destinationConnectionId: 'dest-woo', state: 'retrying', attempts: 2 }),
    ]);

    expect(screen.getByText('1 of 2 shops updated')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith(['ol_order_1']));
  });

  it('should warn and offer Retry and Mark as handled once retries stopped', () => {
    render([
      entry({}),
      entry({
        destinationConnectionId: 'dest-woo',
        state: 'not-sent',
        reason: 'retries-exhausted',
        problem: true,
      }),
    ]);

    expect(screen.getByText('still shows this order as unpaid', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as handled' })).toBeInTheDocument();
    expect(screen.getByText('Not sent')).toBeInTheDocument();
    expect(screen.getByText('Retries stopped')).toBeInTheDocument();
  });

  it('should never call a cash-on-delivery order paid', () => {
    render([entry({ state: 'cod' }), entry({ destinationConnectionId: 'dest-woo', state: 'cod' })]);

    expect(screen.getAllByText('Cash on delivery').length).toBeGreaterThan(0);
    expect(screen.queryByText('Paid on Allegro')).toBeNull();
    expect(screen.queryByText(/shops updated/)).toBeNull();
  });

  it('should explain a payment on a cancelled order instead of a shop failure', () => {
    render([entry({ state: 'not-sent', reason: 'cancelled' })]);

    expect(screen.getByText('Paid after cancellation')).toBeInTheDocument();
    expect(screen.getByText('The buyer paid a cancelled order')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as handled' })).toBeNull();
  });

  it('should move a shop with no payment status to a footnote', async () => {
    render([entry({}), entry({ destinationConnectionId: 'dest-gt', state: 'not-tracked' })]);

    expect(screen.getByText('1 of 1 shops updated')).toBeInTheDocument();
    expect(await screen.findByText("doesn't track payment.", { exact: false })).toBeInTheDocument();
  });
});
