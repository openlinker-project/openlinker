/**
 * Shipment Action Buttons — payment-gate tests (#928)
 *
 * Focused on the dispatch gate the payment-status feature adds: Generate-label
 * is blocked iff payment status is awaiting/refunded (block-list polarity);
 * paid / cod / undefined / unknown all permit dispatch. The component's shipment
 * mutation/query hooks resolve against `renderWithProviders`' QueryClient +
 * mock API client (same pattern as order-shipment-panel.test.tsx) — no manual
 * hook mocking needed.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import { ShipmentActionButtons } from './shipment-action-buttons';
import type { Shipment } from '../../shipments';
import type { PaymentStatus } from '../api/order-snapshot.schema';

function renderGate(paymentStatus?: PaymentStatus): void {
  // No shipment row → synthetic 'none' status, which CAN_GENERATE allows, so the
  // only thing that can disable Generate here is the payment gate. `canWrite`
  // is held true throughout (#1905) — the permission gate is a separate axis
  // covered in order-shipment-panel.test.tsx.
  renderWithProviders(
    <ShipmentActionButtons
      shipment={null}
      canWrite
      paymentStatus={paymentStatus}
      onGenerateLabelClick={vi.fn()}
    />,
  );
}

// When payment blocks, the Generate button's accessible name switches to the
// block reason; otherwise it's the normal generate label.
const blockedButton = (): HTMLElement => screen.getByRole('button', { name: /awaiting payment/i });
const generateButton = (): HTMLElement =>
  screen.getByRole('button', { name: /generate shipping label/i });

describe('ShipmentActionButtons payment gate (#928)', () => {
  it('disables Generate when payment is awaiting', () => {
    renderGate('awaiting');
    expect(blockedButton()).toBeDisabled();
  });

  it('disables Generate when the order is refunded', () => {
    renderGate('refunded');
    expect(blockedButton()).toBeDisabled();
  });

  it('enables Generate when the order is paid', () => {
    renderGate('paid');
    expect(generateButton()).toBeEnabled();
  });

  it('enables Generate for cash on delivery', () => {
    renderGate('cod');
    expect(generateButton()).toBeEnabled();
  });

  it('enables Generate when payment status is unknown (undefined)', () => {
    // PrestaShop / legacy orders carry no payment status — must not block.
    renderGate(undefined);
    expect(generateButton()).toBeEnabled();
  });

  it('should disable Generate and name the permission when canWrite is false (#1905)', () => {
    renderWithProviders(
      <ShipmentActionButtons
        shipment={null}
        canWrite={false}
        paymentStatus="paid"
        onGenerateLabelClick={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: /permission to manage shipments/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringMatching(/permission to manage shipments/i));
  });
});

function makeDownloadableShipment(): Shipment {
  return {
    id: 'ol_shipment_1',
    orderId: 'ol_order_1',
    customerId: null,
    connectionId: 'conn-dpd',
    shippingMethod: 'kurier',
    status: 'generated',
    providerShipmentId: null,
    paczkomatId: null,
    sourceDeliveryMethodId: null,
    deliveryIntent: null,
    trackingNumber: null,
    carrier: null,
    labelPdfRef: 'shipx:label:1',
    dispatchedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    failedAt: null,
    errorMessage: null,
    providerCode: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    orderSummary: null,
    // #2073 waybill-relay failure history — none by default.
    waybillRelay: null,
  };
}

// Each failure class must surface its own toast copy, never the collapsed
// generic string (#2671). One shared apiClient rejection per class, keyed
// to the exact wire shapes `toHttpException` produces.
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
      'Cannot fetch label for shipment ol_shipment_1: connection conn-1 does not support returning label documents',
      422,
      {
        statusCode: 422,
        message:
          'Cannot fetch label for shipment ol_shipment_1: connection conn-1 does not support returning label documents',
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

describe('ShipmentActionButtons download-label failure mapping (#2671)', () => {
  it.each(DOWNLOAD_FAILURES)('renders distinct copy for %s', async (_label, error, expectedTitle) => {
    const apiClient = createMockApiClient({
      shipments: { downloadLabel: vi.fn().mockRejectedValue(error) },
    });
    renderWithProviders(
      <ShipmentActionButtons shipment={makeDownloadableShipment()} canWrite onGenerateLabelClick={vi.fn()} />,
      { apiClient },
    );

    fireEvent.click(screen.getByRole('button', { name: /download shipping label/i }));

    expect(await screen.findByText(expectedTitle)).toBeInTheDocument();
    expect(screen.queryByText(/Could not download the label\. Try again\./i)).not.toBeInTheDocument();
  });
});

// A carrier that refuses the cancellation used to leave the dialog open with
// no message at all. Each failure class names itself; the server `message`
// (which can echo carrier text) is never shown.
const SECRET_SERVER_TEXT = 'ShipX invalid_action for ul. Prosta 1';
const CANCEL_FAILURES: Array<[string, number, RegExp, boolean]> = [
  ['502 - carrier refused', 502, /the carrier did not cancel this shipment/i, true],
  ['409 - no longer active', 409, /can no longer be cancelled/i, false],
  ['422 - not supported', 422, /does not support cancelling/i, false],
  ['500 - unknown outcome', 500, /could not cancel the shipment/i, true],
];

describe('ShipmentActionButtons cancel failure', () => {
  function renderCancel(status: number): void {
    const apiClient = createMockApiClient({
      shipments: {
        cancel: vi
          .fn()
          .mockRejectedValue(
            new ApiError(SECRET_SERVER_TEXT, status, {
              message: SECRET_SERVER_TEXT,
              providerCode: 'shipx.invalid_action',
            }),
          ),
      },
    });
    renderWithProviders(
      <ShipmentActionButtons shipment={makeDownloadableShipment()} canWrite onGenerateLabelClick={vi.fn()} />,
      { apiClient },
    );
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^cancel shipment$/i }));
  }

  it.each(CANCEL_FAILURES)(
    'should keep the dialog open and explain a %s',
    async (_label, status, expectedTitle, retryable) => {
      renderCancel(status);

      expect(await screen.findByText(expectedTitle)).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.queryByText(new RegExp(SECRET_SERVER_TEXT))).not.toBeInTheDocument();
      const confirm = screen.getByRole('button', { name: /^cancel shipment$/i });
      if (retryable) expect(confirm).toBeEnabled();
      else expect(confirm).toBeDisabled();
    },
  );

  it('should clear the error when the dialog is closed and reopened', async () => {
    renderCancel(502);
    expect(await screen.findByText(/the carrier did not cancel this shipment/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^keep$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText(/the carrier did not cancel this shipment/i)).not.toBeInTheDocument();
  });
});
