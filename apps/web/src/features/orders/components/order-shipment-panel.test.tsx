/**
 * OrderShipmentPanel — component tests (#769)
 *
 * Covers: capability gate, status badge, KeyValueList rendering, action-button
 * status matrix, empty-state CTA, tracking link, paczkomat caption keyed on
 * shipping connection's platformType.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { OrderShipmentPanel } from './order-shipment-panel';
import type { Connection } from '../../connections';
import type { Shipment } from '../../shipments';
import type { OrderRecord } from '../api/orders.types';

afterEach(cleanup);

function makeOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    internalOrderId: 'ol_order_1',
    customerId: 'ol_customer_1',
    sourceConnectionId: 'conn-allegro',
    sourceEventId: 'evt-1',
    orderSnapshot: {
      id: '1234',
      orderNumber: 'A-1234',
      customerEmail: 'buyer@example.com',
      shippingAddress: {
        firstName: 'Anna',
        lastName: 'Kowalska',
        address1: 'Krakowska 12',
        city: 'Poznań',
        postalCode: '60-001',
        country: 'PL',
        phone: '+48500600700',
      },
      shipping: { methodId: 'allegro-courier', methodName: 'Kurier Allegro' },
      pickupPoint: { id: 'POZ08A', name: 'Paczkomat POZ08A' },
    },
    syncStatus: [],
    syncAttempts: [],
    recordStatus: 'ready',
    createdAt: '2026-05-28T09:00:00.000Z',
    updatedAt: '2026-05-28T09:30:00.000Z',
    // Live OL carrier route by default (#1799) so "Generate label" is offered;
    // individual tests override deliveryResolution to exercise the suppressed
    // shop-fulfilled / disabled paths.
    deliveryResolution: {
      source: 'rule',
      processorKind: 'ol_managed_carrier',
      processorConnectionId: 'conn-inpost',
      processorAvailable: true,
    },
    ...overrides,
  };
}

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: 'ol_shipment_1',
    orderId: 'ol_order_1',
    customerId: 'ol_customer_1',
    connectionId: 'conn-shipping',
    shippingMethod: 'paczkomat',
    status: 'dispatched',
    providerShipmentId: 'prov-1',
    paczkomatId: 'POZ08A',
    trackingNumber: '6800000001',
    carrier: 'inpost',
    labelPdfRef: null,
    dispatchedAt: '2026-05-28T11:00:00.000Z',
    deliveredAt: null,
    cancelledAt: null,
    failedAt: null,
    errorMessage: null,
    createdAt: '2026-05-28T10:00:00.000Z',
    updatedAt: '2026-05-28T11:00:00.000Z',
    ...overrides,
  };
}

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-shipping',
    platformType: 'inpost',
    name: 'InPost',
    status: 'active',
    config: {},
    credentialsBacked: true,
    adapterKey: 'inpost.shipx.v1',
    supportedCapabilities: ['ShippingProviderManager'],
    enabledCapabilities: ['ShippingProviderManager'],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('OrderShipmentPanel — capability gating (AC-8)', () => {
  it('should render nothing when no connection declares ShippingProviderManager', async () => {
    const apiClient = createMockApiClient({
      connections: {
        list: vi.fn().mockResolvedValue([
          makeConnection({
            id: 'conn-allegro',
            platformType: 'allegro',
            supportedCapabilities: ['OrderSource', 'OfferManager'],
          }),
        ]),
      },
    });

    const { container } = renderWithProviders(<OrderShipmentPanel order={makeOrder()} />, {
      apiClient,
    });

    // The panel renders a loading-skeleton on first paint (a tech-review
    // SUGGESTION fix to avoid CLS); once the connections query settles with
    // no `ShippingProviderManager` capability, the panel unmounts entirely.
    await waitFor(() => {
      expect(container.querySelector('.order-shipment-panel')).toBeNull();
    });
  });

  it('should render the panel when at least one connection declares ShippingProviderManager', async () => {
    const apiClient = createMockApiClient({
      connections: {
        list: vi.fn().mockResolvedValue([makeConnection()]),
      },
    });

    const { container } = renderWithProviders(<OrderShipmentPanel order={makeOrder()} />, {
      apiClient,
    });

    // The empty state renders once the connections + shipments queries settle.
    await screen.findByText('No shipment yet');
    expect(container.querySelector('.order-shipment-panel')).not.toBeNull();
  });
});

describe('OrderShipmentPanel — empty state', () => {
  it('should render the EmptyState with a Generate label CTA when the order has no shipment yet', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([makeConnection()]) },
      shipments: {
        list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
      },
    });

    renderWithProviders(<OrderShipmentPanel order={makeOrder()} />, { apiClient });

    expect(await screen.findByText('No shipment yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate label/i })).toBeInTheDocument();
  });

  it('should suppress the Generate-label CTA and explain shop fulfilment for an omp_fulfilled order (#1799)', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([makeConnection()]) },
      shipments: {
        list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
      },
    });
    const order = makeOrder({
      deliveryResolution: {
        source: 'default',
        processorKind: 'omp_fulfilled',
        processorConnectionId: null,
        processorAvailable: true,
      },
    });

    renderWithProviders(<OrderShipmentPanel order={order} />, { apiClient });

    expect(await screen.findByText(/ships this order with its own carrier/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generate label/i })).not.toBeInTheDocument();
  });

  it('should suppress the Generate-label CTA and point to Delivery for a disabled-carrier route (#1799)', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([makeConnection()]) },
      shipments: {
        list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
      },
    });
    const order = makeOrder({
      deliveryResolution: {
        source: 'rule',
        processorKind: 'ol_managed_carrier',
        processorConnectionId: 'conn-inpost',
        processorAvailable: false,
      },
      deliveryRider: { rider: 'disabled', candidateCarrier: { platformType: 'inpost', displayName: 'InPost' } },
    });

    renderWithProviders(<OrderShipmentPanel order={order} />, { apiClient });

    expect(await screen.findByText(/that connection is disabled/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generate label/i })).not.toBeInTheDocument();
  });

  it('should render a passive "Dispatched outside OpenLinker" note when there is no shipment but the rollup is dispatched (#1799)', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([makeConnection()]) },
      shipments: {
        list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
      },
    });
    const order = makeOrder({ fulfillmentState: 'dispatched' });

    renderWithProviders(<OrderShipmentPanel order={order} />, { apiClient });

    expect(await screen.findByText('Dispatched outside OpenLinker')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generate label/i })).not.toBeInTheDocument();
  });

  it('should surface the no-live-route reason inline when an active shipment exists on a disabled-carrier route (#1799)', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([makeConnection()]) },
      shipments: {
        list: vi.fn().mockResolvedValue({ items: [makeShipment()], total: 1, limit: 20, offset: 0 }),
      },
    });
    const order = makeOrder({
      deliveryResolution: {
        source: 'rule',
        processorKind: 'ol_managed_carrier',
        processorConnectionId: 'conn-inpost',
        processorAvailable: false,
      },
      deliveryRider: {
        rider: 'disabled',
        candidateCarrier: { platformType: 'inpost', displayName: 'InPost' },
      },
    });

    renderWithProviders(<OrderShipmentPanel order={order} />, { apiClient });

    // Populated state (carrier row) plus the inline route note - the reason is
    // visible without hovering the disabled Generate-label button.
    expect(await screen.findByText('InPost')).toBeInTheDocument();
    expect(screen.getByText(/that connection is disabled/i)).toBeInTheDocument();
  });
});

describe('OrderShipmentPanel — populated state', () => {
  it('should render the status badge, carrier, tracking link, and paczkomat row', async () => {
    const shipment = makeShipment();
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([makeConnection()]) },
      shipments: {
        list: vi.fn().mockResolvedValue({ items: [shipment], total: 1, limit: 20, offset: 0 }),
      },
    });

    const { container } = renderWithProviders(<OrderShipmentPanel order={makeOrder()} />, {
      apiClient,
    });

    // Tracking link — most identifying signal of the populated state
    const link = await screen.findByRole('link', { name: /Track shipment on InPost/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('inpost.pl'));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    // Status badge — pulsing for dispatched (assert via class — the badge
    // word `dispatched` collides case-insensitively with the "Dispatched at"
    // KeyValueList label).
    expect(container.querySelector('.status-badge--pulse')).not.toBeNull();

    // Carrier display name (canonical)
    expect(screen.getByText('InPost')).toBeInTheDocument();

    // Paczkomat — operator-selected caption (shipping connection is InPost
    // own-contract, NOT Allegro Delivery)
    expect(screen.getByText(/operator-selected/i)).toBeInTheDocument();
  });

  it('should label the paczkomat as buyer-selected via Allegro when the shipping connection is Allegro', async () => {
    const shipment = makeShipment({ connectionId: 'conn-allegro-delivery' });
    const apiClient = createMockApiClient({
      connections: {
        list: vi.fn().mockResolvedValue([
          makeConnection({
            id: 'conn-allegro-delivery',
            platformType: 'allegro',
            name: 'Allegro Delivery',
          }),
        ]),
      },
      shipments: {
        list: vi.fn().mockResolvedValue({ items: [shipment], total: 1, limit: 20, offset: 0 }),
      },
    });

    renderWithProviders(<OrderShipmentPanel order={makeOrder()} />, { apiClient });

    // Driven by the Allegro plugin's `pickupPointResolvesAsync` trait (#893),
    // resolved via `usePlatform` against the real registry — not a literal
    // `platformType === 'allegro'` compare. The "via Allegro" suffix is the
    // platform's `displayName`.
    expect(await screen.findByText(/buyer-selected via Allegro/i)).toBeInTheDocument();
  });

  it('should label a DPD pickup shipment "Pickup point" with an operator-selected caption (#966)', async () => {
    const shipment = makeShipment({ connectionId: 'conn-dpd', shippingMethod: 'pickup', paczkomatId: 'PL11033', carrier: 'dpd' });
    const apiClient = createMockApiClient({
      connections: {
        list: vi.fn().mockResolvedValue([
          makeConnection({ id: 'conn-dpd', platformType: 'dpd', name: 'DPD Polska' }),
        ]),
      },
      shipments: {
        list: vi.fn().mockResolvedValue({ items: [shipment], total: 1, limit: 20, offset: 0 }),
      },
    });

    renderWithProviders(<OrderShipmentPanel order={makeOrder()} />, { apiClient });

    // Row label follows the method (#966) — pickup → "Pickup point"; DPD omits
    // pickupPointResolvesAsync so the caption is operator-selected.
    expect(await screen.findByText('Pickup point')).toBeInTheDocument();
    expect(screen.getByText('PL11033')).toBeInTheDocument();
    expect(screen.getByText(/operator-selected/i)).toBeInTheDocument();
  });

  it('should surface a Cash-on-delivery status row for a COD order (#966, decision A)', async () => {
    const order = makeOrder();
    (order.orderSnapshot as Record<string, unknown>).paymentStatus = 'cod';
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([makeConnection()]) },
      shipments: {
        list: vi.fn().mockResolvedValue({ items: [makeShipment()], total: 1, limit: 20, offset: 0 }),
      },
    });

    renderWithProviders(<OrderShipmentPanel order={order} />, { apiClient });

    // Status only — no amount is persisted on the shipment (decision A).
    expect(await screen.findByText('Cash on delivery')).toBeInTheDocument();
    expect(screen.getByText(/collect on delivery/i)).toBeInTheDocument();
  });

  it('should render copy-text for the tracking number when carrier is null (status-sync has not backfilled)', async () => {
    const shipment = makeShipment({ carrier: null, trackingNumber: '6800000099' });
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([makeConnection()]) },
      shipments: {
        list: vi.fn().mockResolvedValue({ items: [shipment], total: 1, limit: 20, offset: 0 }),
      },
    });

    renderWithProviders(<OrderShipmentPanel order={makeOrder()} />, { apiClient });

    expect(await screen.findByText('6800000099')).toBeInTheDocument();
    // No link should be rendered when there's no carrier
    expect(screen.queryByRole('link', { name: /Track shipment/i })).toBeNull();
  });
});

describe('OrderShipmentPanel — action button matrix (§3.4)', () => {
  it.each([
    // Plan §3.4 status-matrix coverage.
    // `draft` → generate-as-retry per the spec ("enabled (retry)").
    // `download` column assumes a non-null labelPdfRef (set below) so it
    // isolates the lifecycle-state gate; the ref-absent case is covered separately.
    ['draft', { generate: true, cancel: false, notify: false, download: false }],
    ['generated', { generate: false, cancel: true, notify: true, download: true }],
    ['dispatched', { generate: false, cancel: false, notify: false, download: true }],
    ['in-transit', { generate: false, cancel: false, notify: false, download: true }],
    ['delivered', { generate: true, cancel: false, notify: false, download: true }],
    ['failed', { generate: true, cancel: false, notify: false, download: false }],
    ['cancelled', { generate: true, cancel: false, notify: false, download: false }],
  ] as const)('should compute enablement for status %s', async (status, expected) => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([makeConnection()]) },
      shipments: {
        list: vi.fn().mockResolvedValue({
          items: [makeShipment({ status, labelPdfRef: 'shipx:label:1' })],
          total: 1,
          limit: 20,
          offset: 0,
        }),
      },
    });

    renderWithProviders(<OrderShipmentPanel order={makeOrder()} />, { apiClient });

    // Wait for the populated state — the Cancel button only appears once
    // both connections + shipments queries have settled (heading is shared
    // with the skeleton state, so it's not a reliable settle-signal).
    await screen.findByRole('button', { name: /^Cancel$/i });

    const generate = screen.getByRole('button', { name: /Generate label|Generate shipping label/i });
    const cancel = screen.getByRole('button', { name: /^Cancel$/i });
    const notify = screen.getByRole('button', { name: /Mark dispatched/i });
    const download = screen.getByRole('button', { name: /Download label|Download shipping label/i });

    expect((generate as HTMLButtonElement).disabled).toBe(!expected.generate);
    expect((cancel as HTMLButtonElement).disabled).toBe(!expected.cancel);
    expect((notify as HTMLButtonElement).disabled).toBe(!expected.notify);
    expect((download as HTMLButtonElement).disabled).toBe(!expected.download);
  });

  it('should disable Download label when the shipment has no labelPdfRef even if dispatched', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([makeConnection()]) },
      shipments: {
        list: vi.fn().mockResolvedValue({
          items: [makeShipment({ status: 'dispatched', labelPdfRef: null })],
          total: 1,
          limit: 20,
          offset: 0,
        }),
      },
    });

    renderWithProviders(<OrderShipmentPanel order={makeOrder()} />, { apiClient });

    const download = await screen.findByRole('button', {
      name: /Download label|Download shipping label/i,
    });
    expect((download as HTMLButtonElement).disabled).toBe(true);
  });

  // ── #839 — branch-1 (shippingMethod='omp') awareness ─────────────────

  it('should hide the action row and render "Fulfilled by destination" for branch-1 (omp) shipments', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([makeConnection()]) },
      shipments: {
        list: vi.fn().mockResolvedValue({
          items: [
            makeShipment({
              shippingMethod: 'omp',
              status: 'dispatched',
              providerShipmentId: null,
              paczkomatId: null,
              trackingNumber: null,
              carrier: null,
              labelPdfRef: null,
            }),
          ],
          total: 1,
          limit: 20,
          offset: 0,
        }),
      },
    });

    renderWithProviders(<OrderShipmentPanel order={makeOrder()} />, { apiClient });

    // The read-only affordance replaces the action buttons.
    await screen.findByText('Fulfilled by destination');
    expect(
      screen.queryByRole('button', { name: /Generate label|Generate shipping label/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Cancel$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark dispatched/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Download label|Download shipping label/i }),
    ).not.toBeInTheDocument();
  });

  it('should call the download API + name the file by the blob content type when clicked', async () => {
    const downloadLabel = vi
      .fn()
      .mockResolvedValue(new Blob([new Uint8Array([0x25, 0x50])], { type: 'application/pdf' }));
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([makeConnection()]) },
      shipments: {
        list: vi.fn().mockResolvedValue({
          items: [makeShipment({ status: 'dispatched', labelPdfRef: 'shipx:label:1' })],
          total: 1,
          limit: 20,
          offset: 0,
        }),
        downloadLabel,
      },
    });
    // jsdom lacks createObjectURL/revokeObjectURL — stub so the hook runs.
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    // Capture the click target's download attribute (filename + extension).
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    renderWithProviders(<OrderShipmentPanel order={makeOrder()} />, { apiClient });

    const button = await screen.findByRole('button', {
      name: /Download label|Download shipping label/i,
    });
    fireEvent.click(button);

    await waitFor(() => expect(downloadLabel).toHaveBeenCalledWith('ol_shipment_1'));
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('ol-shipment-ol_shipment_1.pdf');
    vi.restoreAllMocks();
  });
});

describe('OrderShipmentPanel — persisted rejection (#1800)', () => {
  it('should render the persisted errorMessage and failedAt for a failed shipment', async () => {
    const shipment = makeShipment({
      status: 'failed',
      errorMessage: 'DPD rejected the shipment: sender postal code is not serviceable.',
      failedAt: '2026-05-28T12:30:00.000Z',
      trackingNumber: null,
      carrier: 'dpd',
    });
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([makeConnection()]) },
      shipments: {
        list: vi.fn().mockResolvedValue({ items: [shipment], total: 1, limit: 20, offset: 0 }),
      },
    });

    renderWithProviders(<OrderShipmentPanel order={makeOrder()} />, { apiClient });

    expect(
      await screen.findByText(/sender postal code is not serviceable/i),
    ).toBeInTheDocument();
    // failedAt renders as a relative/absolute time — the "Failed" label anchors it.
    expect(screen.getByText(/^Failed/)).toBeInTheDocument();
  });

  it('should not render a persisted-error Alert for a non-failed shipment carrying a stale errorMessage', async () => {
    // A shipment that failed once then recovered keeps its old errorMessage;
    // gating on status === 'failed' prevents surfacing it as a current error.
    const shipment = makeShipment({
      status: 'dispatched',
      errorMessage: 'previous transient error',
      failedAt: '2026-05-28T12:30:00.000Z',
    });
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([makeConnection()]) },
      shipments: {
        list: vi.fn().mockResolvedValue({ items: [shipment], total: 1, limit: 20, offset: 0 }),
      },
    });

    const { container } = renderWithProviders(<OrderShipmentPanel order={makeOrder()} />, {
      apiClient,
    });

    await screen.findByText('Shipment');
    expect(screen.queryByText('previous transient error')).toBeNull();
    expect(container.querySelector('.order-shipment-panel__error')).toBeNull();
  });
});
