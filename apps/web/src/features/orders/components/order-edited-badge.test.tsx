/**
 * `OrderEditedBadge` and the edited figures on the order panels (#3544).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OrderEditedBadge } from './order-edited-badge';
import { OrderPricingPanel } from './order-pricing-panel';
import { OrderDeliveryPanel } from './order-delivery-panel';
import { buildOrderEditTimelineEvents } from './order-edit-timeline-events';
import type { OrderEditsView } from '../api/order-edit.types';
import { renderWithProviders } from '../../../test/test-utils';

afterEach(cleanup);

const edits: OrderEditsView = {
  editedAt: '2026-09-25T09:41:00.000Z',
  address: {
    original: { address1: 'ul. Dluga 12', city: 'Krakow', postalCode: '31-147', country: 'PL' },
    current: { address1: 'ul. Dluga 12/4', city: 'Krakow', postalCode: '31-147', country: 'PL' },
  },
  lines: [{ orderLineId: 'line_a', channelQuantity: 3, quantity: 2 }],
  deliveryMethod: {
    original: { id: 'inpost_kurier', name: 'InPost Kurier' },
    current: { id: 'dpd', name: 'DPD Kurier' },
  },
  totals: { currency: 'PLN', channelTotal: 348.99, total: 294.99, difference: 54, taxRestated: false },
  discount: null,
  discountProposals: [
    {
      changeId: 'refund_1',
      kind: 'order.discount_refund',
      status: 'requested',
      requestedAt: '2026-09-25T09:41:00.000Z',
      currency: 'PLN',
      amount: '15.00',
      invoiceRecordId: null,
      documentNumber: null,
      lines: null,
    },
  ],
  cod: null,
  history: [
    {
      changeId: 'change_1',
      kind: 'order.address_change',
      at: '2026-09-25T09:41:00.000Z',
      byUserId: 'user_1',
      channelKeeps: true,
      channelConnectionId: 'conn_1',
    },
  ],
};

describe('OrderEditedBadge needs attention', () => {
  it('should show the attention badge when an edit no longer applies', () => {
    render(<OrderEditedBadge edited needsAttention />);
    expect(screen.getByTestId('order-edit-attention-badge')).toHaveTextContent('needs attention');
    expect(screen.queryByTestId('order-edit-saved-badge')).not.toBeInTheDocument();
  });
});

describe('OrderEditedBadge (#3544)', () => {
  it('should mark an edited order and say nothing for any other value', () => {
    const { rerender } = render(<OrderEditedBadge edited />);
    expect(screen.getByTestId('order-edit-saved-badge')).toHaveTextContent('Edited in OpenLinker');

    rerender(<OrderEditedBadge edited={false} />);
    expect(screen.queryByTestId('order-edit-saved-badge')).not.toBeInTheDocument();
    rerender(<OrderEditedBadge edited={undefined} />);
    expect(screen.queryByTestId('order-edit-saved-badge')).not.toBeInTheDocument();
  });
});

describe('edited figures on the panels (#3544)', () => {
  it('should show what the buyer paid beside the edited total and the channel quantity beside a lowered line', () => {
    renderWithProviders(
      <OrderPricingPanel
        items={[{ id: 'line_a', name: 'Kubek', sku: 'K', quantity: 2, price: 39 }]}
        totals={{ subtotal: 78, tax: 0, shipping: 14.99, total: 294.99, currency: 'PLN' }}
        edits={edits}
        channelName="Allegro"
      />,
    );

    const note = screen.getByTestId('order-edit-pricing-note');
    expect(note).toHaveTextContent(/The buyer paid/);
    expect(note).toHaveTextContent(/348[.,]99/);
    expect(note).toHaveTextContent(/294[.,]99/);
    expect(screen.getByTestId('order-edit-line-was')).toHaveTextContent('was 3');
  });

  it('should show what the channel shows beside the edited address and method', () => {
    renderWithProviders(
      <OrderDeliveryPanel
        shippingAddress={{ address1: 'ul. Dluga 12/4', city: 'Krakow', postalCode: '31-147', country: 'PL' }}
        shipping={{ methodId: 'dpd', methodName: 'DPD Kurier' }}
        edits={edits}
        channelName="Allegro"
      />,
    );

    expect(screen.getByTestId('order-edit-address-original')).toHaveTextContent(
      'Edited in OpenLinker · Allegro shows ul. Dluga 12',
    );
    expect(screen.getByTestId('order-edit-method-original')).toHaveTextContent(
      'Allegro shows InPost Kurier',
    );
  });

  it('should add neither note to an order nobody edited', () => {
    renderWithProviders(
      <OrderDeliveryPanel
        shippingAddress={{ address1: 'ul. Dluga 12', city: 'Krakow', postalCode: '31-147', country: 'PL' }}
        edits={null}
      />,
    );
    expect(screen.queryByTestId('order-edit-address-original')).not.toBeInTheDocument();
  });
});

describe('buildOrderEditTimelineEvents (#3544)', () => {
  it('should state, per edit, that the channel keeps the original', () => {
    const { dated } = buildOrderEditTimelineEvents(edits, 'Allegro');
    const entry = dated.find((event) => event.id === 'order-edit:change_1');
    expect(entry?.title).toBe('Shipping address changed');
    expect(entry?.description).toBe('Changed in OpenLinker only - Allegro keeps the original.');
    expect(entry?.timestamp).toBe('2026-09-25T09:41:00.000Z');
  });

  it('should keep "Refund not confirmed yet" undated', () => {
    const { trailing } = buildOrderEditTimelineEvents(edits, 'Allegro');
    expect(trailing).toHaveLength(1);
    expect(trailing[0].timestamp).toBeNull();
    expect(trailing[0].title).toBe('Refund not confirmed yet');
    expect(trailing[0].description).toBe('Refund 15.00 PLN on Allegro, then use Confirm refund.');
  });

  it('should contribute nothing for an unedited order', () => {
    expect(buildOrderEditTimelineEvents(null, 'Allegro')).toEqual({ dated: [], trailing: [] });
  });
});
