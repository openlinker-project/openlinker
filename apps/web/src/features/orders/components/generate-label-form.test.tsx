/**
 * GenerateLabelForm — component tests (#769)
 *
 * Covers the pre-flight gate: when the order snapshot is missing required
 * recipient fields, submit is disabled and a warning Alert names the gaps.
 * Plus the happy-path render: with a complete snapshot, the form mounts
 * focused on the first input and the submit is enabled.
 */
import { cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

import {
  renderWithProviders,
  createMockApiClient,
  findToastTitle,
} from '../../../test/test-utils';
import { GenerateLabelForm } from './generate-label-form';
import type { OrderRecord } from '../api/orders.types';

afterEach(cleanup);

function makeOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    internalOrderId: 'ol_order_1',
    customerId: 'ol_customer_1',
    sourceConnectionId: 'b3f1c2d4-0000-4000-8000-000000000099',
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
    ...overrides,
  };
}

describe('GenerateLabelForm — pre-flight gate (tech-review BLOCKING fix)', () => {
  it('should disable submit and surface a warning when the snapshot has no customer email', async () => {
    const order = makeOrder({
      orderSnapshot: {
        ...makeOrder().orderSnapshot,
        customerEmail: undefined,
      },
    });

    renderWithProviders(
      <GenerateLabelForm order={order} onSuccess={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(
      await screen.findByText(/Missing recipient data — cannot generate label:/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Buyer email is missing/i)).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: /^Generate label$/ });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it('should disable submit when the courier branch lacks a postal address', async () => {
    // Drop the pickupPoint → courier (kurier) branch; address requirements kick in.
    const baseSnapshot = makeOrder().orderSnapshot as Record<string, unknown>;
    const order = makeOrder({
      orderSnapshot: {
        ...baseSnapshot,
        pickupPoint: undefined,
        shippingAddress: { phone: '+48500600700' }, // missing street/city/postcode/country
      },
    });

    renderWithProviders(
      <GenerateLabelForm order={order} onSuccess={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(await screen.findByText(/Shipping street is missing/i)).toBeInTheDocument();
    expect(screen.getByText(/Shipping city is missing/i)).toBeInTheDocument();
    expect(screen.getByText(/Shipping postal code is missing/i)).toBeInTheDocument();
    expect(screen.getByText(/Shipping country must be a 2-letter ISO code/i)).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: /^Generate label$/ });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it('should reject a non-ISO-alpha-2 country code as missing (no silent truncation)', async () => {
    const baseSnapshot = makeOrder().orderSnapshot as Record<string, unknown>;
    const order = makeOrder({
      orderSnapshot: {
        ...baseSnapshot,
        pickupPoint: undefined,
        shippingAddress: {
          ...((baseSnapshot.shippingAddress ?? {}) as Record<string, unknown>),
          country: 'Poland', // 6 chars — used to be silently truncated to "PO"
        },
      },
    });

    renderWithProviders(
      <GenerateLabelForm order={order} onSuccess={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(
      await screen.findByText(/Shipping country must be a 2-letter ISO code/i),
    ).toBeInTheDocument();
  });
});

describe('GenerateLabelForm — happy path', () => {
  it('should enable submit when the snapshot is complete (paczkomat branch)', async () => {
    renderWithProviders(
      <GenerateLabelForm order={makeOrder()} onSuccess={vi.fn()} onCancel={vi.fn()} />,
    );

    const submit = await screen.findByRole('button', { name: /^Generate label$/ });
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    // No "missing recipient" Alert on the happy path.
    expect(screen.queryByText(/Missing recipient data/i)).toBeNull();
  });

  it('should disable submit and switch the label while generation is pending', async () => {
    const resolveRef: { current: ((value: unknown) => void) | null } = { current: null };
    const apiClient = createMockApiClient({
      shipments: {
        generateLabel: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveRef.current = resolve;
            }),
        ),
      },
    });
    const onSuccess = vi.fn();

    renderWithProviders(
      <GenerateLabelForm order={makeOrder()} onSuccess={onSuccess} onCancel={vi.fn()} />,
      { apiClient },
    );

    // Fill the parcel inputs so Zod-side validation passes.
    fireEvent.change(screen.getByLabelText(/Length in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Width in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Height in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/^Weight \(g\)$/i), { target: { value: '500' } });

    fireEvent.click(screen.getByRole('button', { name: /^Generate label$/ }));

    // While the mutation hangs, the button advertises the wait.
    expect(await screen.findByRole('button', { name: /Generating label…/i })).toBeInTheDocument();

    // Resolve the mutation so the test doesn't leak the unresolved promise.
    resolveRef.current?.({ kind: 'dispatched', shipment: null });
  });

  it('should send the read-only sourced Allegro amount for a COD order with codToCollect (#1435)', async () => {
    const generateLabel = vi.fn().mockResolvedValue({ kind: 'dispatched', shipment: null });
    const apiClient = createMockApiClient({ shipments: { generateLabel } });
    const order = makeOrder({
      orderSnapshot: {
        ...makeOrder().orderSnapshot,
        paymentStatus: 'cod',
        codToCollect: { amount: '510.94', currency: 'PLN' },
      },
    });

    renderWithProviders(<GenerateLabelForm order={order} onSuccess={vi.fn()} onCancel={vi.fn()} />, {
      apiClient,
    });

    // Read-only "from Allegro" panel: amount shown, no manual input rendered.
    expect(screen.getByText(/from Allegro/i)).toBeInTheDocument();
    expect(screen.getByText(/510\.94/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/COD amount to collect/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/Length in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Width in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Height in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/^Weight \(g\)$/i), { target: { value: '500' } });

    fireEvent.click(screen.getByRole('button', { name: /^Generate label$/ }));

    await waitFor(() =>
      expect(generateLabel).toHaveBeenCalledWith(
        expect.objectContaining({ cod: { amount: '510.94', currency: 'PLN' } }),
      ),
    );
  });

  it('should render no COD UI and send no cod for a prepaid order (#1435)', async () => {
    const generateLabel = vi.fn().mockResolvedValue({ kind: 'dispatched', shipment: null });
    const apiClient = createMockApiClient({ shipments: { generateLabel } });
    const order = makeOrder({
      orderSnapshot: { ...makeOrder().orderSnapshot, paymentStatus: 'paid' },
    });

    renderWithProviders(<GenerateLabelForm order={order} onSuccess={vi.fn()} onCancel={vi.fn()} />, {
      apiClient,
    });

    expect(screen.queryByText(/Cash on delivery/i)).toBeNull();
    expect(screen.queryByLabelText(/COD amount to collect/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/Length in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Width in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Height in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/^Weight \(g\)$/i), { target: { value: '500' } });

    fireEvent.click(screen.getByRole('button', { name: /^Generate label$/ }));

    await waitFor(() => expect(generateLabel).toHaveBeenCalled());
    expect((generateLabel.mock.calls[0][0] as { cod?: unknown }).cod).toBeUndefined();
  });

  it('should show the fallback manual COD input for a COD order with no sourced amount and send it, normalising the decimal (#1435)', async () => {
    const generateLabel = vi.fn().mockResolvedValue({ kind: 'dispatched', shipment: null });
    const apiClient = createMockApiClient({ shipments: { generateLabel } });
    const order = makeOrder({
      orderSnapshot: { ...makeOrder().orderSnapshot, paymentStatus: 'cod' },
    });

    renderWithProviders(<GenerateLabelForm order={order} onSuccess={vi.fn()} onCancel={vi.fn()} />, {
      apiClient,
    });

    // Fallback: a manual amount input is the only typed case.
    const codInput = screen.getByLabelText(/COD amount to collect/i);
    expect(codInput).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Length in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Width in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Height in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/^Weight \(g\)$/i), { target: { value: '500' } });
    // Comma decimal separator → normalised to a dot for the wire shape.
    fireEvent.change(codInput, { target: { value: '129,90' } });

    fireEvent.click(screen.getByRole('button', { name: /^Generate label$/ }));

    await waitFor(() =>
      expect(generateLabel).toHaveBeenCalledWith(
        expect.objectContaining({ cod: { amount: '129.90', currency: 'PLN' } }),
      ),
    );
  });

  it('should allow manual COD for an order with no reported payment status (DPD/PrestaShop) and send it (#1435 regression)', async () => {
    const generateLabel = vi.fn().mockResolvedValue({ kind: 'dispatched', shipment: null });
    const apiClient = createMockApiClient({ shipments: { generateLabel } });
    // Default makeOrder() has no paymentStatus — the non-marketplace path.
    renderWithProviders(<GenerateLabelForm order={makeOrder()} onSuccess={vi.fn()} onCancel={vi.fn()} />, {
      apiClient,
    });

    const codInput = screen.getByLabelText(/COD amount to collect/i);
    expect(codInput).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Length in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Width in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Height in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/^Weight \(g\)$/i), { target: { value: '500' } });
    fireEvent.change(codInput, { target: { value: '129.90' } });

    fireEvent.click(screen.getByRole('button', { name: /^Generate label$/ }));

    await waitFor(() =>
      expect(generateLabel).toHaveBeenCalledWith(
        expect.objectContaining({ cod: { amount: '129.90', currency: 'PLN' } }),
      ),
    );
  });

  it('should omit COD when an unknown-payment order leaves the amount blank (#1435)', async () => {
    const generateLabel = vi.fn().mockResolvedValue({ kind: 'dispatched', shipment: null });
    const apiClient = createMockApiClient({ shipments: { generateLabel } });
    renderWithProviders(<GenerateLabelForm order={makeOrder()} onSuccess={vi.fn()} onCancel={vi.fn()} />, {
      apiClient,
    });

    fireEvent.change(screen.getByLabelText(/Length in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Width in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Height in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/^Weight \(g\)$/i), { target: { value: '500' } });

    fireEvent.click(screen.getByRole('button', { name: /^Generate label$/ }));

    await waitFor(() => expect(generateLabel).toHaveBeenCalled());
    expect((generateLabel.mock.calls[0][0] as { cod?: unknown }).cod).toBeUndefined();
  });

  it('should send parcel.template (locker size, default medium) for a paczkomat order (#1423)', async () => {
    const generateLabel = vi.fn().mockResolvedValue({ kind: 'dispatched', shipment: null });
    const apiClient = createMockApiClient({ shipments: { generateLabel } });

    renderWithProviders(
      <GenerateLabelForm order={makeOrder()} onSuccess={vi.fn()} onCancel={vi.fn()} />,
      { apiClient },
    );

    fireEvent.change(screen.getByLabelText(/Length in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Width in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Height in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/^Weight \(g\)$/i), { target: { value: '500' } });

    fireEvent.click(screen.getByRole('button', { name: /^Generate label$/ }));

    await waitFor(() =>
      expect(generateLabel).toHaveBeenCalledWith(
        expect.objectContaining({
          parcel: expect.objectContaining({ template: 'medium' }),
        }),
      ),
    );
  });

  it('should send deliveryIntent pickup_point for an order with a pickup point (#979)', async () => {
    const generateLabel = vi.fn().mockResolvedValue({ kind: 'dispatched', shipment: null });
    const apiClient = createMockApiClient({ shipments: { generateLabel } });

    renderWithProviders(
      <GenerateLabelForm order={makeOrder()} onSuccess={vi.fn()} onCancel={vi.fn()} />,
      { apiClient },
    );

    fireEvent.change(screen.getByLabelText(/Length in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Width in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Height in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/^Weight \(g\)$/i), { target: { value: '500' } });

    fireEvent.click(screen.getByRole('button', { name: /^Generate label$/ }));

    await waitFor(() =>
      expect(generateLabel).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryIntent: 'pickup_point' }),
      ),
    );
  });

  it('should send deliveryIntent address for a courier order (#979)', async () => {
    const generateLabel = vi.fn().mockResolvedValue({ kind: 'dispatched', shipment: null });
    const apiClient = createMockApiClient({ shipments: { generateLabel } });
    const baseSnapshot = makeOrder().orderSnapshot as Record<string, unknown>;
    const order = makeOrder({ orderSnapshot: { ...baseSnapshot, pickupPoint: undefined } });

    renderWithProviders(
      <GenerateLabelForm order={order} onSuccess={vi.fn()} onCancel={vi.fn()} />,
      { apiClient },
    );

    fireEvent.change(screen.getByLabelText(/Length in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Width in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Height in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/^Weight \(g\)$/i), { target: { value: '500' } });

    fireEvent.click(screen.getByRole('button', { name: /^Generate label$/ }));

    await waitFor(() =>
      expect(generateLabel).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryIntent: 'address' }),
      ),
    );
  });

  it('should auto-download the label after a successful dispatched generation (#884)', async () => {
    const downloadLabel = vi.fn().mockResolvedValue(new Blob([new Uint8Array([0x25, 0x50])]));
    const apiClient = createMockApiClient({
      shipments: {
        generateLabel: vi.fn().mockResolvedValue({
          kind: 'dispatched',
          shipment: { id: 'ol_shipment_99', labelPdfRef: 'shipx:label:99' },
        }),
        downloadLabel,
      },
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    renderWithProviders(
      <GenerateLabelForm order={makeOrder()} onSuccess={vi.fn()} onCancel={vi.fn()} />,
      { apiClient },
    );

    fireEvent.change(screen.getByLabelText(/Length in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Width in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Height in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/^Weight \(g\)$/i), { target: { value: '500' } });

    fireEvent.click(screen.getByRole('button', { name: /^Generate label$/ }));

    await waitFor(() => expect(downloadLabel).toHaveBeenCalledWith('ol_shipment_99'));
    expect(downloadLabel).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('should NOT auto-download when generation resolves omp_fulfilled (no label)', async () => {
    const downloadLabel = vi.fn();
    const apiClient = createMockApiClient({
      shipments: {
        generateLabel: vi.fn().mockResolvedValue({ kind: 'omp_fulfilled' }),
        downloadLabel,
      },
    });

    renderWithProviders(
      <GenerateLabelForm order={makeOrder()} onSuccess={vi.fn()} onCancel={vi.fn()} />,
      { apiClient },
    );

    fireEvent.change(screen.getByLabelText(/Length in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Width in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Height in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/^Weight \(g\)$/i), { target: { value: '500' } });

    fireEvent.click(screen.getByRole('button', { name: /^Generate label$/ }));

    // Wait for the success toast path to settle, then assert no download fired.
    await waitFor(() => expect(apiClient.shipments.generateLabel).toHaveBeenCalled());
    expect(downloadLabel).not.toHaveBeenCalled();
  });
});

// ── #839 AC-3 — pickup-point retry hint ─────────────────────────────────

describe('GenerateLabelForm — AC-3 pickup-point retry hint (#839)', () => {
  // A genuine unresolved-locker order: a locker delivery method, but the
  // pickup point hasn't arrived yet (#954 — the hint's legitimate case). The
  // locker method is what makes it "expecting a pickup point" rather than a
  // courier order; before #954 this helper kept the base courier method, which
  // is exactly the false-positive #954 fixes.
  function makeOrderWithoutPickupPoint(
    overrides: Partial<OrderRecord> = {},
  ): OrderRecord {
    const base = makeOrder();
    const baseSnapshot = base.orderSnapshot as Record<string, unknown>;
    return {
      ...base,
      ...overrides,
      orderSnapshot: {
        ...baseSnapshot,
        shipping: { methodId: 'allegro-one-box', methodName: 'Allegro One Box' },
        pickupPoint: undefined,
      },
    };
  }

  it('should render the retry hint for a locker-method Allegro order with no pickup-point yet + recent', async () => {
    const order = makeOrderWithoutPickupPoint({
      sourceConnectionId: 'conn-allegro-1',
      createdAt: new Date().toISOString(),
    });

    const apiClient = createMockApiClient({
      connections: {
        list: vi.fn().mockResolvedValue([
          {
            id: 'conn-allegro-1',
            platformType: 'allegro',
            name: 'Allegro Main',
            status: 'active',
            config: {},
            credentialsBacked: true,
            enabledCapabilities: [],
            supportedCapabilities: ['OrderSource'],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
      },
    });

    renderWithProviders(
      <GenerateLabelForm order={order} onSuccess={vi.fn()} onCancel={vi.fn()} />,
      { apiClient },
    );

    expect(await screen.findByText(/Pickup point not yet available/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Retry pickup-point lookup/i }),
    ).toBeInTheDocument();
  });

  // PrestaShop omits the `pickupPointResolvesAsync` trait, so `usePlatform`
  // resolves it falsy and the hint stays hidden — pins the trait path (#893),
  // not the old literal `platformType === 'allegro'` compare.
  it('should NOT render the retry hint when the order source is not Allegro', async () => {
    const order = makeOrderWithoutPickupPoint({
      sourceConnectionId: 'conn-ps-1',
      createdAt: new Date().toISOString(),
    });

    const apiClient = createMockApiClient({
      connections: {
        list: vi.fn().mockResolvedValue([
          {
            id: 'conn-ps-1',
            platformType: 'prestashop',
            name: 'PrestaShop',
            status: 'active',
            config: {},
            credentialsBacked: true,
            enabledCapabilities: [],
            supportedCapabilities: ['OrderSource'],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
      },
    });

    renderWithProviders(
      <GenerateLabelForm order={order} onSuccess={vi.fn()} onCancel={vi.fn()} />,
      { apiClient },
    );

    // Wait on a stable form element (the parcel-length input) — the
    // "Generate label" string collides between the form heading and the
    // submit button, so findByText is ambiguous here.
    await screen.findByLabelText(/Length in millimetres/i);
    expect(screen.queryByText(/Pickup point not yet available/i)).not.toBeInTheDocument();
  });

  it('should NOT render the retry hint for an old Allegro order (outside the 24h window)', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const order = makeOrderWithoutPickupPoint({
      sourceConnectionId: 'conn-allegro-1',
      createdAt: twoDaysAgo,
    });

    const apiClient = createMockApiClient({
      connections: {
        list: vi.fn().mockResolvedValue([
          {
            id: 'conn-allegro-1',
            platformType: 'allegro',
            name: 'Allegro Main',
            status: 'active',
            config: {},
            credentialsBacked: true,
            enabledCapabilities: [],
            supportedCapabilities: ['OrderSource'],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
      },
    });

    renderWithProviders(
      <GenerateLabelForm order={order} onSuccess={vi.fn()} onCancel={vi.fn()} />,
      { apiClient },
    );

    // Wait on a stable form element (the parcel-length input) — the
    // "Generate label" string collides between the form heading and the
    // submit button, so findByText is ambiguous here.
    await screen.findByLabelText(/Length in millimetres/i);
    expect(screen.queryByText(/Pickup point not yet available/i)).not.toBeInTheDocument();
  });
});

// ── #954 — hint must key on delivery method, not pickupPoint presence ─────

describe('GenerateLabelForm — #954 courier-vs-locker hint gating', () => {
  function allegroConnApi() {
    return createMockApiClient({
      connections: {
        list: vi.fn().mockResolvedValue([
          {
            id: 'conn-allegro-1',
            platformType: 'allegro',
            name: 'Allegro Main',
            status: 'active',
            config: {},
            credentialsBacked: true,
            enabledCapabilities: [],
            supportedCapabilities: ['OrderSource'],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
      },
    });
  }

  function recentAllegroOrder(snapshotOverrides: Record<string, unknown>): OrderRecord {
    const base = makeOrder();
    return {
      ...base,
      sourceConnectionId: 'conn-allegro-1',
      createdAt: new Date().toISOString(),
      orderSnapshot: {
        ...(base.orderSnapshot as Record<string, unknown>),
        ...snapshotOverrides,
      },
    };
  }

  it('should NOT render the retry hint for a courier-method Allegro order (the #954 false positive)', async () => {
    const order = recentAllegroOrder({
      shipping: { methodId: 'allegro-courier', methodName: 'Kurier Allegro' },
      pickupPoint: undefined,
    });

    renderWithProviders(
      <GenerateLabelForm order={order} onSuccess={vi.fn()} onCancel={vi.fn()} />,
      { apiClient: allegroConnApi() },
    );

    await screen.findByLabelText(/Length in millimetres/i);
    expect(screen.queryByText(/Pickup point not yet available/i)).not.toBeInTheDocument();
  });

  it('should NOT render the retry hint when the method is unknown but a full street address is present', async () => {
    // Pre-#952 reality: the snapshot carries no delivery method, but the order
    // has a full street address → courier heuristic suppresses the hint.
    const order = recentAllegroOrder({ shipping: undefined, pickupPoint: undefined });

    renderWithProviders(
      <GenerateLabelForm order={order} onSuccess={vi.fn()} onCancel={vi.fn()} />,
      { apiClient: allegroConnApi() },
    );

    await screen.findByLabelText(/Length in millimetres/i);
    expect(screen.queryByText(/Pickup point not yet available/i)).not.toBeInTheDocument();
  });

  it('should NOT render the retry hint once the locker pickup point is resolved', async () => {
    const order = recentAllegroOrder({
      shipping: { methodId: 'allegro-one-box', methodName: 'Allegro One Box' },
      // base snapshot's pickupPoint is present (resolved)
    });

    renderWithProviders(
      <GenerateLabelForm order={order} onSuccess={vi.fn()} onCancel={vi.fn()} />,
      { apiClient: allegroConnApi() },
    );

    await screen.findByLabelText(/Length in millimetres/i);
    expect(screen.queryByText(/Pickup point not yet available/i)).not.toBeInTheDocument();
  });
});

// ── #953 — post-submit toast must reflect the dispatch outcome ────────────

describe('GenerateLabelForm — #953 dispatch-outcome toast', () => {
  function fillParcelAndSubmit(): void {
    fireEvent.change(screen.getByLabelText(/Length in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Width in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Height in millimetres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/^Weight \(g\)$/i), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /^Generate label$/ }));
  }

  it('should show the "Label generated" success toast on a dispatched result', async () => {
    const apiClient = createMockApiClient({
      shipments: {
        generateLabel: vi.fn().mockResolvedValue({
          kind: 'dispatched',
          shipment: { id: 'ol_shipment_1', labelPdfRef: null },
        }),
        downloadLabel: vi.fn().mockResolvedValue(new Blob()),
      },
    });

    renderWithProviders(
      <GenerateLabelForm order={makeOrder()} onSuccess={vi.fn()} onCancel={vi.fn()} />,
      { apiClient },
    );
    fillParcelAndSubmit();

    expect(await findToastTitle(/Label generated/i)).toBeInTheDocument();
  });

  it('should show a neutral toast (not "Label generated") on an omp_fulfilled result', async () => {
    const apiClient = createMockApiClient({
      shipments: {
        generateLabel: vi.fn().mockResolvedValue({ kind: 'omp_fulfilled' }),
        downloadLabel: vi.fn(),
      },
    });

    renderWithProviders(
      <GenerateLabelForm order={makeOrder()} onSuccess={vi.fn()} onCancel={vi.fn()} />,
      { apiClient },
    );
    fillParcelAndSubmit();

    expect(await findToastTitle(/Fulfilled by destination store/i)).toBeInTheDocument();
    expect(screen.queryByText(/Label generated/i)).not.toBeInTheDocument();
  });
});
