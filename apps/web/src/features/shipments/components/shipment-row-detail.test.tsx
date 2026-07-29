/**
 * Unit tests for the /shipments accordion body (#1826).
 *
 * Covers: per-status action branches, `canWrite` (viewer) gating of write
 * actions + raw error text, and the omp/branch-1 read-only tracking display.
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { Shipment } from '../api/shipments.types';
import { ShipmentRowDetail } from './shipment-row-detail';

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
    errorMessage: 'NOT_PROCESSED — sender postcode "22-213" invalid',
    createdAt: '2026-07-24T09:11:00.000Z',
    updatedAt: '2026-07-24T09:12:00.000Z',
    ...overrides,
  };
}

const apiClient = createMockApiClient();

describe('ShipmentRowDetail — failed', () => {
  it('admin/operator: shows the raw errorMessage + failedAt + Review connection settings + Regenerate', () => {
    renderWithProviders(<ShipmentRowDetail shipment={makeShipment()} canWrite />, { apiClient });
    expect(screen.getByText('NOT_PROCESSED — sender postcode "22-213" invalid')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review connection settings' })).toHaveAttribute(
      'href',
      '/connections/conn-dpd',
    );
    expect(screen.getByRole('link', { name: 'Regenerate label' })).toHaveAttribute(
      'href',
      '/orders/ol_order_1?retryShipmentId=ol_shipment_1',
    );
  });

  it('viewer: redacts the raw message and renders no action', () => {
    renderWithProviders(<ShipmentRowDetail shipment={makeShipment()} canWrite={false} />, {
      apiClient,
    });
    expect(screen.queryByText('NOT_PROCESSED — sender postcode "22-213" invalid')).not.toBeInTheDocument();
    expect(screen.getByText('Details hidden for this role.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review connection settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Regenerate label' })).not.toBeInTheDocument();
  });
});

describe('ShipmentRowDetail — draft / cancelled', () => {
  it('draft: renders Generate label (not Regenerate) deep-linking to the same order', () => {
    renderWithProviders(
      <ShipmentRowDetail shipment={makeShipment({ status: 'draft', errorMessage: null, failedAt: null })} canWrite />,
      { apiClient },
    );
    expect(screen.getByRole('link', { name: 'Generate label' })).toHaveAttribute(
      'href',
      '/orders/ol_order_1?retryShipmentId=ol_shipment_1',
    );
  });

  it('cancelled: also generate-eligible per CAN_GENERATE', () => {
    renderWithProviders(
      <ShipmentRowDetail
        shipment={makeShipment({ status: 'cancelled', errorMessage: null, failedAt: null })}
        canWrite
      />,
      { apiClient },
    );
    expect(screen.getByRole('link', { name: 'Generate label' })).toBeInTheDocument();
  });
});

describe('ShipmentRowDetail — generated', () => {
  function generatedShipment(overrides: Partial<Shipment> = {}): Shipment {
    return makeShipment({
      status: 'generated',
      errorMessage: null,
      failedAt: null,
      labelPdfRef: 'shipx:label:1',
      ...overrides,
    });
  }

  it('admin/operator: shows Mark dispatched, Download label, and Cancel', () => {
    renderWithProviders(<ShipmentRowDetail shipment={generatedShipment()} canWrite />, { apiClient });
    expect(screen.getByRole('button', { name: 'Mark dispatched' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download label' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('viewer: Download label stays visible (read-only), Mark dispatched / Cancel are hidden', () => {
    renderWithProviders(<ShipmentRowDetail shipment={generatedShipment()} canWrite={false} />, {
      apiClient,
    });
    expect(screen.getByRole('button', { name: 'Download label' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark dispatched' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('does not render Generate label for a generated shipment (not in CAN_GENERATE)', () => {
    renderWithProviders(<ShipmentRowDetail shipment={generatedShipment()} canWrite />, { apiClient });
    expect(screen.queryByRole('link', { name: /Generate label/ })).not.toBeInTheDocument();
  });

  // AC-115 names Cancel explicitly as needing its own coverage (separate from
  // Generate label) — it has its own confirm dialog and its own mutation. The
  // tests above only assert the buttons *render*; these drive the full
  // click → confirm-dialog → mutation flow.

  it('Cancel opens a destructive confirm dialog and fires the cancel mutation only on confirm', async () => {
    const cancel = vi.fn().mockResolvedValue(generatedShipment({ status: 'cancelled' }));
    renderWithProviders(<ShipmentRowDetail shipment={generatedShipment()} canWrite />, {
      apiClient: createMockApiClient({ shipments: { cancel } }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // The dialog explains the irreversibility before anything is sent.
    expect(await screen.findByText('Cancel this shipment?')).toBeInTheDocument();
    expect(cancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel shipment' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('ol_shipment_1'));
  });

  it('Cancel dismissed via Keep does not fire the mutation', async () => {
    const cancel = vi.fn();
    renderWithProviders(<ShipmentRowDetail shipment={generatedShipment()} canWrite />, {
      apiClient: createMockApiClient({ shipments: { cancel } }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByText('Cancel this shipment?');
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));

    await waitFor(() => {
      expect(screen.queryByText('Cancel this shipment?')).not.toBeInTheDocument();
    });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('Mark dispatched opens its own confirm dialog and fires the notify mutation on confirm', async () => {
    const notifyDispatched = vi.fn().mockResolvedValue({
      shipmentId: 'ol_shipment_1',
      outcome: 'notified',
      source: 'ok',
      destinations: [],
    });
    renderWithProviders(<ShipmentRowDetail shipment={generatedShipment()} canWrite />, {
      apiClient: createMockApiClient({ shipments: { notifyDispatched } }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Mark dispatched' }));

    expect(await screen.findByText('Manually mark as dispatched?')).toBeInTheDocument();
    expect(notifyDispatched).not.toHaveBeenCalled();

    // Scope to the dialog — the row's own trigger button shares this label.
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark dispatched' }));
    await waitFor(() => expect(notifyDispatched).toHaveBeenCalledWith('ol_shipment_1'));
  });
});

describe('ShipmentRowDetail — delivered/dispatched with tracking', () => {
  it('renders a Track parcel external link when a known carrier + tracking number resolve', () => {
    renderWithProviders(
      <ShipmentRowDetail
        shipment={makeShipment({
          status: 'delivered',
          errorMessage: null,
          failedAt: null,
          labelPdfRef: 'shipx:label:1',
          carrier: 'inpost',
          trackingNumber: '6800000001',
        })}
        canWrite
      />,
      { apiClient },
    );
    const trackLink = screen.getByRole('link', { name: 'Track parcel' });
    expect(trackLink).toHaveAttribute('target', '_blank');
    expect(trackLink.getAttribute('href')).toContain('inpost.pl');
  });

  it('omits Track parcel when carrier/tracking are unresolved', () => {
    renderWithProviders(
      <ShipmentRowDetail
        shipment={makeShipment({ status: 'delivered', errorMessage: null, failedAt: null })}
        canWrite
      />,
      { apiClient },
    );
    expect(screen.queryByRole('link', { name: 'Track parcel' })).not.toBeInTheDocument();
  });
});

describe('ShipmentRowDetail — omp/branch-1', () => {
  it('renders a read-only copyable tracking number when present, no write actions', () => {
    renderWithProviders(
      <ShipmentRowDetail
        shipment={makeShipment({
          shippingMethod: 'omp',
          status: 'dispatched',
          errorMessage: null,
          failedAt: null,
          trackingNumber: 'DE-OMP-88213',
        })}
        canWrite
      />,
      { apiClient },
    );
    expect(screen.getByText('DE-OMP-88213')).toBeInTheDocument();
    // The only button present is CopyableId's own read-only "Copy" — no
    // write-shaped action (Cancel/Mark dispatched/Generate) ever renders here.
    expect(screen.getByRole('button', { name: 'Copy DE-OMP-88213' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel|mark dispatched|generate/i })).not.toBeInTheDocument();
  });

  it('renders a plain message when no tracking number exists yet', () => {
    renderWithProviders(
      <ShipmentRowDetail
        shipment={makeShipment({
          shippingMethod: 'omp',
          status: 'dispatched',
          errorMessage: null,
          failedAt: null,
          trackingNumber: null,
        })}
        canWrite
      />,
      { apiClient },
    );
    expect(screen.getByText('Fulfilled by the destination — no tracking yet.')).toBeInTheDocument();
  });
});

describe('ShipmentRowDetail — empty-content fallback (#1826)', () => {
  it('renders a fallback message for a dispatched, non-omp shipment with no label ref and no resolvable carrier yet', () => {
    // A common transitional state: `dispatched` before the carrier
    // status-sync poll has backfilled `carrier` (no tracking link) and with
    // no persisted `labelPdfRef` (no Download action either). Not `failed`
    // (no failure block) and not `generated`/`in-transit`/`delivered`-eligible
    // for any of the write actions — an empty accordion otherwise.
    renderWithProviders(
      <ShipmentRowDetail
        shipment={makeShipment({
          status: 'dispatched',
          errorMessage: null,
          failedAt: null,
          labelPdfRef: null,
          carrier: null,
          trackingNumber: null,
        })}
        canWrite
      />,
      { apiClient },
    );
    expect(
      screen.getByText(
        'No actions available for this shipment yet — check back once the carrier status sync catches up.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not render the fallback once a tracking link becomes resolvable', () => {
    renderWithProviders(
      <ShipmentRowDetail
        shipment={makeShipment({
          status: 'dispatched',
          errorMessage: null,
          failedAt: null,
          labelPdfRef: null,
          carrier: 'inpost',
          trackingNumber: '6800000001',
        })}
        canWrite
      />,
      { apiClient },
    );
    expect(screen.queryByText(/No actions available/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Track parcel' })).toBeInTheDocument();
  });
});
