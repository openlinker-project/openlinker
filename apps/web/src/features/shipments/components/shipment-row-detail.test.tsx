/**
 * Unit tests for the /shipments accordion body (#1826).
 *
 * Covers: per-status action branches, `canWrite` (viewer) gating of write
 * actions + raw error text, and the omp/branch-1 read-only tracking display.
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import { REDACTED_ERROR_MESSAGE, type Shipment } from '../api/shipments.types';
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
    providerCode: null,
    createdAt: '2026-07-24T09:11:00.000Z',
    updatedAt: '2026-07-24T09:12:00.000Z',
    orderSummary: null,
    ...overrides,
  };
}

const apiClient = createMockApiClient();

describe('ShipmentRowDetail — failed', () => {
  it('admin/operator: shows the raw errorMessage + failedAt + Review connection settings + Regenerate', () => {
    renderWithProviders(
      <ShipmentRowDetail shipment={makeShipment()} canWrite canReviewConnection />,
      { apiClient },
    );
    expect(screen.getByText('NOT_PROCESSED — sender postcode "22-213" invalid')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review connection settings' })).toHaveAttribute(
      'href',
      '/connections/conn-dpd',
    );
    expect(screen.getByRole('link', { name: 'Regenerate label' })).toHaveAttribute(
      'href',
      '/orders/ol_order_1?retryShipmentId=ol_shipment_1&from=shipments#shipment',
    );
  });

  it('viewer: redacts the raw message and renders no action', () => {
    renderWithProviders(
      <ShipmentRowDetail shipment={makeShipment()} canWrite={false} canReviewConnection={false} />,
      { apiClient },
    );
    expect(screen.queryByText('NOT_PROCESSED — sender postcode "22-213" invalid')).not.toBeInTheDocument();
    expect(screen.getByText(REDACTED_ERROR_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review connection settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Regenerate label' })).not.toBeInTheDocument();
  });

  it('shows providerCode + retryability for BOTH admin and viewer sessions (#1918 — not redacted)', () => {
    const shipment = makeShipment({ providerCode: 'preflight.missing-parcel-template' });

    const { unmount } = renderWithProviders(
      <ShipmentRowDetail shipment={shipment} canWrite canReviewConnection />,
      { apiClient },
    );
    expect(screen.getByText(/preflight\.missing-parcel-template/)).toBeInTheDocument();
    expect(screen.getByText(/Needs a fix before retrying/)).toBeInTheDocument();
    unmount();

    renderWithProviders(
      <ShipmentRowDetail shipment={shipment} canWrite={false} canReviewConnection={false} />,
      { apiClient },
    );
    expect(screen.getByText(/preflight\.missing-parcel-template/)).toBeInTheDocument();
  });

  it('omits the Rejection code field when providerCode is null', () => {
    renderWithProviders(
      <ShipmentRowDetail shipment={makeShipment({ providerCode: null })} canWrite canReviewConnection />,
      { apiClient },
    );
    expect(screen.queryByText('Rejection code')).not.toBeInTheDocument();
  });
});

describe('ShipmentRowDetail — failed, post-waybill (#1905)', () => {
  it('should replace Regenerate with a void-first explanation when a failed shipment still holds a waybill', () => {
    renderWithProviders(
      <ShipmentRowDetail
        shipment={makeShipment({
          status: 'failed',
          providerShipmentId: '680000000012345',
          carrier: 'inpost',
          errorMessage: null,
        })}
        canWrite
        canReviewConnection
      />,
      { apiClient },
    );
    expect(screen.queryByRole('link', { name: /Regenerate label/ })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'This parcel already has a live waybill (680000000012345), so it cannot be re-dispatched from here - regenerating would purchase a second label. Void the existing waybill with InPost first, then generate a new one.',
      ),
    ).toBeInTheDocument();
  });

  it('should name the tracking number as the live waybill when one is present, and fall back to "the carrier" for an unresolved carrier', () => {
    renderWithProviders(
      <ShipmentRowDetail
        shipment={makeShipment({
          status: 'failed',
          providerShipmentId: '680000000012345',
          trackingNumber: '6800000001',
          carrier: null,
          errorMessage: null,
        })}
        canWrite
        canReviewConnection
      />,
      { apiClient },
    );
    expect(
      screen.getByText(
        'This parcel already has a live waybill (6800000001), so it cannot be re-dispatched from here - regenerating would purchase a second label. Void the existing waybill with the carrier first, then generate a new one.',
      ),
    ).toBeInTheDocument();
  });

  it('should explain the live waybill to a viewer without the write-only remediation instruction', () => {
    renderWithProviders(
      <ShipmentRowDetail
        shipment={makeShipment({
          status: 'failed',
          providerShipmentId: '680000000012345',
          carrier: 'inpost',
          errorMessage: null,
        })}
        canWrite={false}
        canReviewConnection={false}
      />,
      { apiClient },
    );
    // A viewer gets the reason (this row is inert) but not the operator
    // instruction to void the waybill, which they hold no permission to do.
    expect(
      screen.getByText(
        'This parcel already has a live waybill (680000000012345), so it cannot be re-dispatched from here.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Void the existing waybill/)).not.toBeInTheDocument();
  });

  it('should still offer Regenerate for a pre-waybill failure, deep-linking to the order shipment anchor', () => {
    renderWithProviders(
      <ShipmentRowDetail
        shipment={makeShipment({ providerShipmentId: null })}
        canWrite
        canReviewConnection
      />,
      { apiClient },
    );
    expect(screen.getByRole('link', { name: 'Regenerate label' })).toHaveAttribute(
      'href',
      '/orders/ol_order_1?retryShipmentId=ol_shipment_1&from=shipments#shipment',
    );
    expect(screen.queryByText(/already has a live waybill/)).not.toBeInTheDocument();
  });

  it('should render the undelivered/returned fallback copy when a failed shipment persisted no errorMessage', () => {
    renderWithProviders(
      <ShipmentRowDetail
        shipment={makeShipment({ errorMessage: null })}
        canWrite
        canReviewConnection
      />,
      { apiClient },
    );
    // The heading drops "Carrier rejection" too - there is no rejection text
    // to head, so claiming one above an empty paragraph was the bug.
    expect(screen.getByText('Shipment failed')).toBeInTheDocument();
    expect(screen.queryByText('Carrier rejection')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'The carrier reported this parcel as undelivered or returned - check the tracker.',
      ),
    ).toBeInTheDocument();
  });
});

describe('ShipmentRowDetail — draft / cancelled', () => {
  it('draft: renders Generate label (not Regenerate) deep-linking to the same order', () => {
    renderWithProviders(
      <ShipmentRowDetail
        shipment={makeShipment({ status: 'draft', errorMessage: null, failedAt: null })}
        canWrite
        canReviewConnection
      />,
      { apiClient },
    );
    expect(screen.getByRole('link', { name: 'Generate label' })).toHaveAttribute(
      'href',
      '/orders/ol_order_1?retryShipmentId=ol_shipment_1&from=shipments#shipment',
    );
  });

  it('cancelled: also generate-eligible per CAN_GENERATE', () => {
    renderWithProviders(
      <ShipmentRowDetail
        shipment={makeShipment({ status: 'cancelled', errorMessage: null, failedAt: null })}
        canWrite
        canReviewConnection
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
    renderWithProviders(
      <ShipmentRowDetail shipment={generatedShipment()} canWrite canReviewConnection />,
      { apiClient },
    );
    expect(screen.getByRole('button', { name: 'Mark dispatched' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download label' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('viewer: Download label stays visible (read-only), Mark dispatched / Cancel are hidden', () => {
    renderWithProviders(
      <ShipmentRowDetail
        shipment={generatedShipment()}
        canWrite={false}
        canReviewConnection={false}
      />,
      { apiClient },
    );
    expect(screen.getByRole('button', { name: 'Download label' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark dispatched' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('does not render Generate label for a generated shipment (not in CAN_GENERATE)', () => {
    renderWithProviders(
      <ShipmentRowDetail shipment={generatedShipment()} canWrite canReviewConnection />,
      { apiClient },
    );
    expect(screen.queryByRole('link', { name: /Generate label/ })).not.toBeInTheDocument();
  });

  // AC-115 names Cancel explicitly as needing its own coverage (separate from
  // Generate label) — it has its own confirm dialog and its own mutation. The
  // tests above only assert the buttons *render*; these drive the full
  // click → confirm-dialog → mutation flow.

  it('Cancel opens a destructive confirm dialog and fires the cancel mutation only on confirm', async () => {
    const cancel = vi.fn().mockResolvedValue(generatedShipment({ status: 'cancelled' }));
    renderWithProviders(
      <ShipmentRowDetail shipment={generatedShipment()} canWrite canReviewConnection />,
      { apiClient: createMockApiClient({ shipments: { cancel } }) },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // The dialog explains the irreversibility before anything is sent.
    expect(await screen.findByText('Cancel this shipment?')).toBeInTheDocument();
    expect(cancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel shipment' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('ol_shipment_1'));
  });

  it('Cancel dismissed via Keep does not fire the mutation', async () => {
    const cancel = vi.fn();
    renderWithProviders(
      <ShipmentRowDetail shipment={generatedShipment()} canWrite canReviewConnection />,
      { apiClient: createMockApiClient({ shipments: { cancel } }) },
    );

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
    renderWithProviders(
      <ShipmentRowDetail shipment={generatedShipment()} canWrite canReviewConnection />,
      { apiClient: createMockApiClient({ shipments: { notifyDispatched } }) },
    );

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
        canReviewConnection
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
        canReviewConnection
      />,
      { apiClient },
    );
    expect(screen.queryByRole('link', { name: 'Track parcel' })).not.toBeInTheDocument();
  });
});

describe('ShipmentRowDetail — non-failed facts grid (#1905)', () => {
  it('should surface the tracking number, provider and method the responsive table rules hide', () => {
    // Provider + Paczkomat drop out of the table below 1024px and Tracking
    // below 768px, so on a narrow window the accordion is the only place they
    // can be read.
    renderWithProviders(
      <ShipmentRowDetail
        shipment={makeShipment({
          status: 'generated',
          shippingMethod: 'paczkomat',
          errorMessage: null,
          failedAt: null,
          labelPdfRef: 'shipx:label:1',
          carrier: 'inpost',
          trackingNumber: '6800000001',
          paczkomatId: 'KRA010',
        })}
        canWrite
        canReviewConnection
      />,
      { apiClient },
    );
    expect(screen.getByText('Provider')).toBeInTheDocument();
    expect(screen.getByText('InPost')).toBeInTheDocument();
    expect(screen.getByText('Method')).toBeInTheDocument();
    expect(
      screen.getByText('Paczkomat', { selector: '.shipment-detail-grid__value' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Tracking')).toBeInTheDocument();
    expect(screen.getByText('6800000001')).toBeInTheDocument();
    expect(screen.getByText('KRA010')).toBeInTheDocument();
  });

  it('should omit the fields that are null rather than render them empty', () => {
    renderWithProviders(
      <ShipmentRowDetail
        shipment={makeShipment({
          status: 'generated',
          errorMessage: null,
          failedAt: null,
          labelPdfRef: 'shipx:label:1',
          carrier: null,
          trackingNumber: null,
          paczkomatId: null,
        })}
        canWrite
        canReviewConnection
      />,
      { apiClient },
    );
    // Method is the only always-present fact.
    expect(screen.getByText('Method')).toBeInTheDocument();
    expect(screen.getByText('Kurier')).toBeInTheDocument();
    expect(screen.queryByText('Provider')).not.toBeInTheDocument();
    expect(screen.queryByText('Tracking')).not.toBeInTheDocument();
    expect(screen.queryByText('Paczkomat')).not.toBeInTheDocument();
  });

  it('should not render the facts grid on a failed row - the failure block owns that slot', () => {
    renderWithProviders(
      <ShipmentRowDetail
        shipment={makeShipment({ carrier: 'dpd', trackingNumber: '1234567890' })}
        canWrite
        canReviewConnection
      />,
      { apiClient },
    );
    expect(screen.getByText('Carrier rejection')).toBeInTheDocument();
    expect(screen.queryByText('Provider')).not.toBeInTheDocument();
    expect(screen.queryByText('Method')).not.toBeInTheDocument();
  });

  it('should still render the copyable order id on a failed row (#2089)', () => {
    // A failed row is exactly where an operator quotes the order id to carrier
    // support, and the failure block replaces the facts grid — so the field has
    // to live in both grids, not only the healthy one.
    renderWithProviders(
      <ShipmentRowDetail
        shipment={makeShipment({ orderId: 'ol_order_a4f3b9c1d8e2f0a9b6c3d4e5f6a7b8c9' })}
        canWrite
        canReviewConnection
      />,
      { apiClient },
    );

    expect(screen.getByText('Carrier rejection')).toBeInTheDocument();
    expect(screen.getByText('Order')).toBeInTheDocument();
    expect(screen.getByText('ol_order_a4f3…c9')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy internal order ID ol_order_a4f3…c9' }),
    ).toBeInTheDocument();
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
        canReviewConnection
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
        canReviewConnection
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
        canReviewConnection
      />,
      { apiClient },
    );
    expect(
      screen.getByText(
        'No actions available for this shipment yet — check back once the carrier status sync catches up.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    // The Order fact's copy control (#2089) is the one button an actionless row
    // still carries — it is identity, not an action, which is the distinction
    // this test is about.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: /^Copy internal order ID/ }),
    ).toBeInTheDocument();
  });

  it('should tell a viewer it is a permission problem, not a pending status sync (#1905)', () => {
    // Same actionless row for two entirely different reasons; conflating them
    // told a viewer to wait for a sync that was never the blocker.
    for (const status of ['draft', 'cancelled'] as const) {
      cleanup();
      renderWithProviders(
        <ShipmentRowDetail
          shipment={makeShipment({ status, errorMessage: null, failedAt: null })}
          canWrite={false}
          canReviewConnection={false}
        />,
        { apiClient },
      );
      expect(
        screen.getByText('You do not have permission to act on this shipment.'),
      ).toBeInTheDocument();
      expect(screen.queryByText(/carrier status sync catches up/)).not.toBeInTheDocument();
    }
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
        canReviewConnection
      />,
      { apiClient },
    );
    expect(screen.queryByText(/No actions available/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Track parcel' })).toBeInTheDocument();
  });
});

// Each failure class must surface its own toast copy, never the collapsed
// generic string (#2671). Mirrors the equivalent table in
// shipment-action-buttons.test.tsx - the two manual call sites must never
// disagree about what a given backend response means.
const DOWNLOAD_FAILURES: Array<[string, ApiError, RegExp]> = [
  [
    '404 - shipment gone',
    new ApiError('Shipment not found: ol_shipment_1', 404, {
      statusCode: 404,
      message: 'Shipment not found: ol_shipment_1',
      error: 'Not Found',
    }),
    /no shipment matches this id/i,
  ],
  [
    '422 - not generated yet',
    new ApiError(
      'No label has been generated for shipment ol_shipment_1 yet - generate the label first',
      422,
      { statusCode: 422, message: 'No label has been generated for shipment ol_shipment_1 yet - generate the label first' },
    ),
    /no label to download yet/i,
  ],
  [
    '422 - carrier has none',
    new ApiError(
      'Cannot fetch label for shipment ol_shipment_1: connection conn-dpd does not support returning label documents',
      422,
      {
        statusCode: 422,
        message:
          'Cannot fetch label for shipment ol_shipment_1: connection conn-dpd does not support returning label documents',
      },
    ),
    /doesn.t provide a downloadable label/i,
  ],
  [
    '502 - provider rejected',
    new ApiError('Waybill expired', 502, {
      message: 'Waybill expired for this shipment',
      providerCode: 'DPD.WAYBILL_EXPIRED',
    }),
    /the carrier rejected the request/i,
  ],
  [
    '502 - our credentials rejected',
    new ApiError('Carrier credentials rejected', 502, {
      statusCode: 502,
      message: 'Carrier credentials rejected',
      error: 'Bad Gateway',
    }),
    /our stored carrier credentials were rejected/i,
  ],
  [
    'unclassified 500',
    new ApiError('boom', 500, { statusCode: 500, message: 'boom', error: 'Internal Server Error' }),
    /something went wrong/i,
  ],
  ['network', ApiError.fromNetworkFailure(new Error('Failed to fetch')), /couldn.t reach openlinker/i],
];

describe('ShipmentRowDetail download-label failure mapping (#2671)', () => {
  it.each(DOWNLOAD_FAILURES)('renders distinct copy for %s', async (_label, error, expectedTitle) => {
    const apiClient = createMockApiClient({
      shipments: { downloadLabel: vi.fn().mockRejectedValue(error) },
    });
    renderWithProviders(
      <ShipmentRowDetail
        shipment={makeShipment({ status: 'generated', errorMessage: null, failedAt: null, labelPdfRef: 'shipx:label:1' })}
        canWrite
        canReviewConnection
      />,
      { apiClient },
    );

    fireEvent.click(screen.getByRole('button', { name: /^Download label$/ }));

    expect(await screen.findByText(expectedTitle)).toBeInTheDocument();
    expect(screen.queryByText(/Could not download the label\. Try again\./i)).not.toBeInTheDocument();
  });
});
