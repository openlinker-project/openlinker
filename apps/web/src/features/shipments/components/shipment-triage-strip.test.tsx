/**
 * Unit tests for the cause-first triage strip (#1826).
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../../test/test-utils';
import type { Shipment } from '../api/shipments.types';
import { ShipmentTriageStrip } from './shipment-triage-strip';

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: 'ol_shipment_1',
    orderId: 'ol_order_1',
    customerId: null,
    connectionId: 'conn-dpd',
    shippingMethod: 'kurier',
    status: 'failed',
    providerShipmentId: null,
    paczkomatId: null,
    sourceDeliveryMethodId: null,
    deliveryIntent: null,
    trackingNumber: null,
    carrier: null,
    labelPdfRef: null,
    dispatchedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    failedAt: '2026-07-24T09:12:00.000Z',
    errorMessage: 'sender postcode "22-213" invalid',
    createdAt: '2026-07-24T09:11:00.000Z',
    updatedAt: '2026-07-24T09:12:00.000Z',
    ...overrides,
  };
}

describe('ShipmentTriageStrip', () => {
  it('renders singular-safe copy for a 2-row group', () => {
    renderWithProviders(
      <ShipmentTriageStrip
        group={{
          connectionId: 'conn-dpd',
          cause: 'sender postcode invalid',
          shipments: [makeShipment({ id: 'ol_shipment_1' }), makeShipment({ id: 'ol_shipment_2' })],
        }}
      />,
    );
    expect(
      screen.getByText('2 failed shipments on this connection share one cause'),
    ).toBeInTheDocument();
  });

  it('scales copy to N for a larger group', () => {
    renderWithProviders(
      <ShipmentTriageStrip
        group={{
          connectionId: 'conn-dpd',
          cause: 'sender postcode invalid',
          shipments: [
            makeShipment({ id: 'ol_shipment_1' }),
            makeShipment({ id: 'ol_shipment_2' }),
            makeShipment({ id: 'ol_shipment_3' }),
          ],
        }}
      />,
    );
    expect(
      screen.getByText('3 failed shipments on this connection share one cause'),
    ).toBeInTheDocument();
  });

  it('links "Review connection settings" to the shared connection (#1826 — copy is cause-neutral, not "Fix sender address")', () => {
    renderWithProviders(
      <ShipmentTriageStrip
        group={{
          connectionId: 'conn-dpd',
          cause: 'sender postcode invalid',
          shipments: [
            makeShipment({ id: 'ol_shipment_1', connectionId: 'conn-dpd' }),
            makeShipment({ id: 'ol_shipment_2', connectionId: 'conn-dpd' }),
          ],
        }}
      />,
    );
    expect(screen.queryByText('Fix sender address')).toBeNull();
    expect(screen.getByRole('link', { name: 'Review connection settings' })).toHaveAttribute(
      'href',
      '/connections/conn-dpd',
    );
  });

  it('renders a representative raw cause so the operator knows what to look for', () => {
    renderWithProviders(
      <ShipmentTriageStrip
        group={{
          connectionId: 'conn-dpd',
          cause: 'recipient address unreachable',
          shipments: [
            makeShipment({ id: 'ol_shipment_1', errorMessage: 'Recipient address unreachable' }),
            makeShipment({ id: 'ol_shipment_2', errorMessage: 'Recipient address unreachable' }),
          ],
        }}
      />,
    );
    expect(screen.getByText('Recipient address unreachable')).toBeInTheDocument();
  });
});
