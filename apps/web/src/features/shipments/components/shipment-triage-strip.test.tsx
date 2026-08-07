/**
 * Unit tests for the cause-first triage strip (#1826).
 *
 * The copy assertions are deliberately two-sided: the strip must state the
 * same-message OBSERVATION and must NOT make the causal claims it used to
 * (#1905) — a shared cause, or that regenerating will re-fail. For an
 * exhausted-retry 429/5xx the latter advice is exactly inverted.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../../test/test-utils';
import type { Shipment } from '../api/shipments.types';
import type { FailedShipmentCauseGroup } from '../lib/group-failed-shipments-by-cause';
import { ShipmentTriageStrip } from './shipment-triage-strip';

afterEach(cleanup);

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
    providerCode: null,
    createdAt: '2026-07-24T09:11:00.000Z',
    updatedAt: '2026-07-24T09:12:00.000Z',
    orderSummary: null,
    ...overrides,
  };
}

function makeGroup(overrides: Partial<FailedShipmentCauseGroup> = {}): FailedShipmentCauseGroup {
  return {
    connectionId: 'conn-dpd',
    cause: 'sender postcode invalid',
    providerCode: null,
    shipments: [makeShipment({ id: 'ol_shipment_1' }), makeShipment({ id: 'ol_shipment_2' })],
    ...overrides,
  };
}

describe('ShipmentTriageStrip', () => {
  it('should state the same-message observation for a 2-row group', () => {
    renderWithProviders(
      <ShipmentTriageStrip group={makeGroup()} connectionName="DPD Warehouse A" canReviewConnection />,
    );
    expect(
      screen.getByText('2 failed shipments on DPD Warehouse A report the same carrier message'),
    ).toBeInTheDocument();
  });

  it('should scale the count to N for a larger group', () => {
    renderWithProviders(
      <ShipmentTriageStrip
        group={makeGroup({
          shipments: [
            makeShipment({ id: 'ol_shipment_1' }),
            makeShipment({ id: 'ol_shipment_2' }),
            makeShipment({ id: 'ol_shipment_3' }),
          ],
        })}
        connectionName="DPD Warehouse A"
        canReviewConnection
      />,
    );
    expect(
      screen.getByText('3 failed shipments on DPD Warehouse A report the same carrier message'),
    ).toBeInTheDocument();
  });

  it('should claim neither a shared cause nor that regenerating will re-fail (#1905)', () => {
    renderWithProviders(
      <ShipmentTriageStrip group={makeGroup()} connectionName="DPD Warehouse A" canReviewConnection />,
    );
    expect(screen.queryByText(/share one cause/)).toBeNull();
    expect(screen.queryByText(/re-fail/)).toBeNull();
    expect(screen.queryByText(/Fix sender address/)).toBeNull();
  });

  it('should disclose that the count is page-local, not global', () => {
    renderWithProviders(
      <ShipmentTriageStrip group={makeGroup()} connectionName="DPD Warehouse A" canReviewConnection />,
    );
    expect(
      screen.getByText(/Counted across the shipments loaded on this page only\./),
    ).toBeInTheDocument();
  });

  it('should fall back to a generic connection phrase when the name is unresolvable', () => {
    renderWithProviders(
      <ShipmentTriageStrip group={makeGroup()} connectionName={null} canReviewConnection />,
    );
    expect(
      screen.getByText('2 failed shipments on this connection report the same carrier message'),
    ).toBeInTheDocument();
  });

  it('should render a representative raw cause so the operator knows what to look for', () => {
    renderWithProviders(
      <ShipmentTriageStrip
        group={makeGroup({
          cause: 'recipient address unreachable',
          shipments: [
            makeShipment({ id: 'ol_shipment_1', errorMessage: 'Recipient address unreachable' }),
            makeShipment({ id: 'ol_shipment_2', errorMessage: 'Recipient address unreachable' }),
          ],
        })}
        connectionName="DPD Warehouse A"
        canReviewConnection
      />,
    );
    expect(screen.getByText('Recipient address unreachable')).toBeInTheDocument();
  });

  it('should render the shared providerCode + retryability label when the group is code-keyed (#1918)', () => {
    renderWithProviders(
      <ShipmentTriageStrip
        group={makeGroup({
          cause: 'api.http-503',
          providerCode: 'api.http-503',
          shipments: [
            makeShipment({ id: 'ol_shipment_1', providerCode: 'api.http-503' }),
            makeShipment({ id: 'ol_shipment_2', providerCode: 'api.http-503' }),
          ],
        })}
        connectionName="DPD Warehouse A"
        canReviewConnection
      />,
    );
    expect(
      screen.getByText('2 failed shipments on DPD Warehouse A report the same rejection code'),
    ).toBeInTheDocument();
    expect(screen.getByText('api.http-503')).toBeInTheDocument();
    expect(screen.getByText(/Transient - safe to just retry/)).toBeInTheDocument();
  });

  it('should link the connection-settings CTA to the group connection when the operator holds connections:write', () => {
    renderWithProviders(
      <ShipmentTriageStrip group={makeGroup()} connectionName="DPD Warehouse A" canReviewConnection />,
    );
    expect(screen.getByRole('link', { name: 'Review connection settings' })).toHaveAttribute(
      'href',
      '/connections/conn-dpd',
    );
  });

  it('should hide the connection-settings CTA when the operator lacks connections:write, even though the strip itself renders', () => {
    // The two permissions are distinct: `shipments:write` gates the strip,
    // `connections:write` gates only this CTA.
    renderWithProviders(
      <ShipmentTriageStrip
        group={makeGroup()}
        connectionName="DPD Warehouse A"
        canReviewConnection={false}
      />,
    );
    expect(
      screen.getByText('2 failed shipments on DPD Warehouse A report the same carrier message'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review connection settings' })).toBeNull();
  });

  it('should always offer the connection-scoped failed filter, which is how the rest of the page-local group is seen', () => {
    renderWithProviders(
      <ShipmentTriageStrip
        group={makeGroup()}
        connectionName="DPD Warehouse A"
        canReviewConnection={false}
      />,
    );
    expect(
      screen.getByRole('link', { name: 'Show all failed on this connection' }),
    ).toHaveAttribute('href', '/shipments?status=failed&connectionId=conn-dpd');
  });
});
