import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  renderWithProviders,
  createMockApiClient,
  createAuthenticatedSessionAdapter,
} from '../../test/test-utils';
import { mockMobileViewport } from '../../test/viewport';
import { ShipmentsPage } from './shipments-page';
import type { PaginatedShipments, Shipment } from '../../features/shipments/api/shipments.types';
import type { Connection } from '../../features/connections/api/connections.types';
import type { SessionUser } from '../../shared/auth/session.types';

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: 'ol_shipment_1',
    orderId: 'ol_order_1',
    customerId: 'ol_customer_1',
    connectionId: 'conn_1',
    shippingMethod: 'paczkomat',
    status: 'generated',
    providerShipmentId: 'shipx-1',
    paczkomatId: 'POZ08A',
    sourceDeliveryMethodId: null,
    deliveryIntent: null,
    trackingNumber: '6800000001',
    carrier: 'inpost',
    labelPdfRef: 'shipx:label:1',
    dispatchedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    failedAt: null,
    errorMessage: null,
    createdAt: '2026-05-20T10:00:00.000Z',
    updatedAt: '2026-05-20T10:00:00.000Z',
    ...overrides,
  };
}

function page(items: Shipment[]): PaginatedShipments {
  return { items, total: items.length, limit: 20, offset: 0 };
}

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn_inpost',
    name: 'InPost',
    platformType: 'inpost',
    status: 'active',
    config: {},
    credentialsBacked: true,
    enabledCapabilities: [],
    supportedCapabilities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ShipmentsPage', () => {
  afterEach(cleanup);

  it('should show loading state initially', () => {
    const mockApi = createMockApiClient({
      shipments: { list: vi.fn().mockReturnValue(new Promise(() => {})) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, { apiClient: mockApi });

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('should render shipments when data loads', async () => {
    const mockApi = createMockApiClient({
      shipments: { list: vi.fn().mockResolvedValue(page([makeShipment()])) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, { apiClient: mockApi });

    // Scoped to the table body (not `findAllByText`, which also matches the
    // status-filter dropdown's static `<option>generated</option>` before any
    // data has loaded — a false-positive that would let this assertion pass
    // vacuously without the query ever resolving).
    const table = await screen.findByRole('table');
    expect(within(table).getByText('generated')).toBeInTheDocument();
    // `getByRole('heading', ...)` (not `getByText`), since the DataTable's
    // sr-only `<caption>Shipments</caption>` shares the same text as the page
    // title once the real table (rather than the loading skeleton) is mounted.
    expect(screen.getByRole('heading', { name: 'Shipments' })).toBeInTheDocument();
  });

  it('should pass URL filters through to the query (incl. hasTracking=false coercion)', async () => {
    const listMock = vi.fn().mockResolvedValue(page([]));
    const mockApi = createMockApiClient({
      shipments: { list: listMock },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, {
      apiClient: mockApi,
      route: '/shipments?status=delivered&hasTracking=false&connectionId=conn_x',
    });

    await screen.findByText('No shipments found');
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'delivered', hasTracking: false, connectionId: 'conn_x' }),
      expect.objectContaining({ limit: 20, offset: 0 }),
    );
  });

  it('should show error state when fetch fails', async () => {
    const mockApi = createMockApiClient({
      shipments: { list: vi.fn().mockRejectedValue(new Error('Service unavailable')) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, { apiClient: mockApi });

    expect(await screen.findByText('Unable to load shipments')).toBeInTheDocument();
    expect(screen.getByText('Service unavailable')).toBeInTheDocument();
  });

  it('should show empty state without a CTA when no shipments exist and no filter is active', async () => {
    const mockApi = createMockApiClient({
      shipments: { list: vi.fn().mockResolvedValue(page([])) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, { apiClient: mockApi });

    expect(await screen.findByText('No shipments found')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument();
  });

  it('should show a Clear filters CTA when a filter is active and no shipments match', async () => {
    const mockApi = createMockApiClient({
      shipments: { list: vi.fn().mockResolvedValue(page([])) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, {
      apiClient: mockApi,
      route: '/shipments?status=failed',
    });

    expect(await screen.findByText('No shipments found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear filters/i })).toBeInTheDocument();
  });

  it('should hide method-specific columns when no connection declares the shipping capability', async () => {
    const mockApi = createMockApiClient({
      shipments: { list: vi.fn().mockResolvedValue(page([makeShipment()])) },
      connections: { list: vi.fn().mockResolvedValue([makeConnection({ supportedCapabilities: [] })]) },
    });

    renderWithProviders(<ShipmentsPage />, { apiClient: mockApi });

    expect((await screen.findAllByText('generated')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Method')).not.toBeInTheDocument();
  });

  it('should show method-specific columns when a connection declares the shipping capability', async () => {
    const mockApi = createMockApiClient({
      shipments: { list: vi.fn().mockResolvedValue(page([makeShipment()])) },
      connections: {
        list: vi
          .fn()
          .mockResolvedValue([makeConnection({ supportedCapabilities: ['ShippingProviderManager'] })]),
      },
    });

    renderWithProviders(<ShipmentsPage />, { apiClient: mockApi });

    // `findByText` (not `getByText`) — the Method column appears only after the
    // parallel connections query resolves and the capability gate re-renders.
    expect(await screen.findByText('Method')).toBeInTheDocument();
  });

  // ── #839 — processor column + filter, branch-1 ('omp') label ───────────

  it('should render a Processor column with branch-1 row labelled "OMP-fulfilled"', async () => {
    const mockApi = createMockApiClient({
      shipments: {
        list: vi.fn().mockResolvedValue(
          page([
            makeShipment({
              id: 'ol_shipment_omp',
              shippingMethod: 'omp',
              providerShipmentId: null,
              paczkomatId: null,
              trackingNumber: null,
              carrier: null,
              labelPdfRef: null,
            }),
          ]),
        ),
      },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, { apiClient: mockApi });

    await screen.findByText('Processor');
    // ProcessorBadge renders the friendly label, not the raw enum.
    expect((await screen.findAllByText('OMP-fulfilled')).length).toBeGreaterThan(0);
  });

  it('should render the carrier-row Processor cell as "Carrier"', async () => {
    const mockApi = createMockApiClient({
      shipments: {
        list: vi.fn().mockResolvedValue(
          page([
            makeShipment({
              shippingMethod: 'paczkomat',
              providerShipmentId: 'shipx-9',
            }),
          ]),
        ),
      },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, { apiClient: mockApi });

    expect(await screen.findByText('Carrier')).toBeInTheDocument();
  });

  it("should map ?processor=omp URL param to { shippingMethod: 'omp' } in the BE query", async () => {
    const listMock = vi.fn().mockResolvedValue(page([]));
    const mockApi = createMockApiClient({
      shipments: { list: listMock },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, {
      apiClient: mockApi,
      route: '/shipments?processor=omp',
    });

    await screen.findByText('No shipments found');
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ shippingMethod: 'omp' }),
      expect.anything(),
    );
  });

  it('should map ?processor=carrier URL param to { hasProviderShipmentId: true } in the BE query', async () => {
    const listMock = vi.fn().mockResolvedValue(page([]));
    const mockApi = createMockApiClient({
      shipments: { list: listMock },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, {
      apiClient: mockApi,
      route: '/shipments?processor=carrier',
    });

    await screen.findByText('No shipments found');
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ hasProviderShipmentId: true }),
      expect.anything(),
    );
  });

  it('should ignore unknown processor URL values (defensive narrowing)', async () => {
    const listMock = vi.fn().mockResolvedValue(page([]));
    const mockApi = createMockApiClient({
      shipments: { list: listMock },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, {
      apiClient: mockApi,
      route: '/shipments?processor=garbage',
    });

    await screen.findByText('No shipments found');
    const [filters] = listMock.mock.calls[0];
    expect(filters.shippingMethod).toBeUndefined();
    expect(filters.hasProviderShipmentId).toBeUndefined();
  });

  // Direct round-trip test (#839 tech-review SUGGESTION fix) — verifies the
  // FE-mirror `hasProviderShipmentId` wire shape independently of the
  // processor URL mapping. Future toolbar / hook refactors that lose the
  // serializer wiring fail here, not in some subtle UX regression.
  it('should serialize hasProviderShipmentId verbatim onto the BE list call', async () => {
    const listMock = vi.fn().mockResolvedValue(page([]));
    const mockApi = createMockApiClient({
      shipments: { list: listMock },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, {
      apiClient: mockApi,
      route: '/shipments?processor=carrier',
    });

    await screen.findByText('No shipments found');
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ hasProviderShipmentId: true }),
      expect.anything(),
    );
    // And the underlying api module serialises it onto the query string as
    // `hasProviderShipmentId=true` (see shipments.api.ts buildQuery). We
    // can't assert on the URL through the mock list signature, but we can
    // pin the contract by exact-key+value match.
    const [filters] = listMock.mock.calls[0];
    expect(filters).toMatchObject({ hasProviderShipmentId: true });
  });
});

describe('ShipmentsPage — failed-shipment hint (#1800)', () => {
  afterEach(cleanup);

  it('should render the persisted errorMessage for a failed shipment', async () => {
    const failed = makeShipment({
      id: 'ol_shipment_failed',
      status: 'failed',
      errorMessage: 'DPD rejected: sender postal code not serviceable',
      failedAt: '2026-05-20T12:00:00.000Z',
      trackingNumber: null,
    });
    const mockApi = createMockApiClient({
      shipments: { list: vi.fn().mockResolvedValue(page([failed])) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, {
      apiClient: mockApi,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    // The message renders in the status cell (table + mobile card => >=1).
    expect(
      (await screen.findAllByText(/sender postal code not serviceable/i)).length,
    ).toBeGreaterThan(0);
  });

  it('should render the persisted rejection reason in the mobile card view too', async () => {
    // `ShipmentStatusCell` is shared between the table cell and the mobile card
    // `meta` slot, and the DataTable renders one OR the other by viewport — so
    // this locks the card-view path (which the desktop-only assertion above
    // never exercises), keeping triage-from-phone parity (frontend-ui-style-guide
    // § Responsive) from silently regressing.
    const viewport = mockMobileViewport();
    try {
      const failed = makeShipment({
        id: 'ol_shipment_failed_mobile',
        status: 'failed',
        errorMessage: 'DPD rejected: sender postal code not serviceable',
        failedAt: '2026-05-20T12:00:00.000Z',
        trackingNumber: null,
      });
      const mockApi = createMockApiClient({
        shipments: { list: vi.fn().mockResolvedValue(page([failed])) },
        connections: { list: vi.fn().mockResolvedValue([]) },
      });

      const { container } = renderWithProviders(<ShipmentsPage />, {
        apiClient: mockApi,
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });

      await screen.findByText(/sender postal code not serviceable/i);
      // Assert the reason rendered *inside* a card (not merely somewhere on the
      // page) — in mobile mode the table isn't rendered, so scoping to the card
      // pins the card-view path specifically.
      const card = container.querySelector('.data-table__card');
      expect(card).not.toBeNull();
      expect(
        within(card as HTMLElement).getByText(/sender postal code not serviceable/i),
      ).toBeInTheDocument();
    } finally {
      viewport.restore();
    }
  });

  it('should not render an error hint for a non-failed shipment', async () => {
    const mockApi = createMockApiClient({
      shipments: {
        list: vi.fn().mockResolvedValue(page([makeShipment({ status: 'delivered', errorMessage: null })])),
      },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    const { container } = renderWithProviders(<ShipmentsPage />, { apiClient: mockApi });

    expect((await screen.findAllByText('delivered')).length).toBeGreaterThan(0);
    expect(container.querySelector('.shipment-status-cell__error')).toBeNull();
  });
});

describe('ShipmentsPage — row accordion + Order/Provider columns (#1826)', () => {
  afterEach(cleanup);

  it('should expand and collapse the row accordion, showing the Regenerate action', async () => {
    const failed = makeShipment({
      id: 'ol_shipment_failed',
      status: 'failed',
      errorMessage: 'DPD rejected: sender postal code not serviceable',
      failedAt: '2026-05-20T12:00:00.000Z',
      trackingNumber: null,
    });
    const mockApi = createMockApiClient({
      shipments: { list: vi.fn().mockResolvedValue(page([failed])) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, {
      apiClient: mockApi,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    const toggle = await screen.findByRole('button', {
      name: `Expand details for shipment ${failed.id}`,
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: /regenerate label/i })).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(
      await screen.findByRole('link', { name: /regenerate label/i }),
    ).toBeInTheDocument();
    const expandedToggle = screen.getByRole('button', {
      name: `Collapse details for shipment ${failed.id}`,
    });
    // The attribute, not just the label — nothing else in the repo pins it,
    // and AT users depend on it rather than on the accessible name.
    expect(expandedToggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(expandedToggle);
    expect(screen.queryByRole('link', { name: /regenerate label/i })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `Expand details for shipment ${failed.id}` }),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('should render the Order column id as a link to the order (not "Unknown")', async () => {
    const mockApi = createMockApiClient({
      shipments: { list: vi.fn().mockResolvedValue(page([makeShipment()])) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, { apiClient: mockApi });

    const table = await screen.findByRole('table');
    // The link's own accessible name is the full order id — a plain, unlinked
    // "Unknown" (the pre-fix EntityLabel fallback for a missing `name`) would
    // fail this `getByRole` lookup outright, so a successful match already
    // proves the id itself isn't rendering as "Unknown".
    const orderLink = within(table).getByRole('link', { name: 'ol_order_1' });
    expect(orderLink).toHaveAttribute('href', '/orders/ol_order_1');
  });

  it('should render the Provider column (renamed from Connection) with the connection name', async () => {
    const mockApi = createMockApiClient({
      shipments: { list: vi.fn().mockResolvedValue(page([makeShipment({ connectionId: 'conn_inpost' })])) },
      connections: { list: vi.fn().mockResolvedValue([makeConnection()]) },
    });

    renderWithProviders(<ShipmentsPage />, { apiClient: mockApi });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Provider')).toBeInTheDocument();
    expect(within(table).queryByText('Connection')).not.toBeInTheDocument();
    // Scoped to the visible provider cell — `ConnectionDot` also carries a
    // duplicate `sr-only` "InPost" for its accessible name, and "InPost" is
    // separately an `<option>` in the toolbar's connection filter.
    const providerCell = table.querySelector('.shipments-page__provider');
    expect(providerCell).not.toBeNull();
    expect(within(providerCell as HTMLElement).getByText('InPost', { selector: 'span:not(.sr-only)' })).toBeInTheDocument();
  });

  it('should render the Action column with a plain, non-interactive severity label per status', async () => {
    const mockApi = createMockApiClient({
      shipments: {
        list: vi.fn().mockResolvedValue(
          page([
            makeShipment({ id: 'ol_shipment_failed', status: 'failed' }),
            makeShipment({ id: 'ol_shipment_draft', status: 'draft' }),
            makeShipment({ id: 'ol_shipment_generated', status: 'generated' }),
            makeShipment({ id: 'ol_shipment_delivered', status: 'delivered' }),
          ]),
        ),
      },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, { apiClient: mockApi });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Action')).toBeInTheDocument();
    expect(within(table).getByText('Fix')).toBeInTheDocument();
    expect(within(table).getByText('Finish')).toBeInTheDocument();
    expect(within(table).getByText('Send')).toBeInTheDocument();
    expect(within(table).getByText('View')).toBeInTheDocument();
    // Plain text, not a second interactive control — no button/link role.
    const severityCell = within(table).getByText('Fix');
    expect(severityCell.tagName).toBe('SPAN');
    expect(severityCell.closest('button, a')).toBeNull();
  });

  it('should label an omp/branch-1 row "View" regardless of status (never implies a Generate action)', async () => {
    const mockApi = createMockApiClient({
      shipments: {
        list: vi.fn().mockResolvedValue(
          page([
            makeShipment({ id: 'ol_shipment_omp', status: 'cancelled', shippingMethod: 'omp' }),
          ]),
        ),
      },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, { apiClient: mockApi });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('View')).toBeInTheDocument();
    expect(within(table).queryByText('Finish')).not.toBeInTheDocument();
  });

  it('should freeze the Status column via stickyLeftColumns', async () => {
    const mockApi = createMockApiClient({
      shipments: { list: vi.fn().mockResolvedValue(page([makeShipment()])) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, { apiClient: mockApi });

    const table = await screen.findByRole('table');
    // `DataTable` marks a frozen column's header/cell with `data-table__sticky-col`.
    expect(table.querySelector('.data-table__sticky-col')).not.toBeNull();
  });
});

describe('ShipmentsPage — cause-first triage strip (#1826)', () => {
  afterEach(cleanup);

  it('should show the triage strip when >=2 failed shipments share a normalised cause', async () => {
    const shared = 'DPD rejected: sender postcode 00-000 not serviceable';
    const mockApi = createMockApiClient({
      shipments: {
        list: vi.fn().mockResolvedValue(
          page([
            makeShipment({ id: 'ol_shipment_a', status: 'failed', errorMessage: shared }),
            makeShipment({
              id: 'ol_shipment_b',
              status: 'failed',
              errorMessage: 'DPD rejected: sender postcode 11-111 not serviceable',
            }),
          ]),
        ),
      },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, {
      apiClient: mockApi,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByText(/failed shipments on this connection share one cause/i)).toBeInTheDocument();
  });

  it('should not show the triage strip when only 1 shipment has a given cause', async () => {
    const mockApi = createMockApiClient({
      shipments: {
        list: vi.fn().mockResolvedValue(
          page([makeShipment({ id: 'ol_shipment_a', status: 'failed', errorMessage: 'a lone rejection' })]),
        ),
      },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, {
      apiClient: mockApi,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await screen.findByRole('table');
    expect(screen.queryByText(/failed shipments on this connection share one cause/i)).not.toBeInTheDocument();
  });

  it('should hide the triage strip entirely for a viewer session even with a shared cause', async () => {
    const viewer: SessionUser = {
      id: 'user_viewer',
      username: 'viewer',
      email: 'viewer@example.com',
      role: 'viewer',
      permissions: ['shipments:read'],
    };
    const shared = 'DPD rejected: sender postcode 00-000 not serviceable';
    const mockApi = createMockApiClient({
      shipments: {
        list: vi.fn().mockResolvedValue(
          page([
            makeShipment({ id: 'ol_shipment_a', status: 'failed', errorMessage: shared }),
            makeShipment({
              id: 'ol_shipment_b',
              status: 'failed',
              errorMessage: 'DPD rejected: sender postcode 11-111 not serviceable',
            }),
          ]),
        ),
      },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, {
      apiClient: mockApi,
      sessionAdapter: createAuthenticatedSessionAdapter(viewer),
    });

    await screen.findByRole('table');
    expect(screen.queryByText(/failed shipments on this connection share one cause/i)).not.toBeInTheDocument();
  });
});

describe('ShipmentsPage — viewer-role redaction (#1826)', () => {
  afterEach(cleanup);

  const viewer: SessionUser = {
    id: 'user_viewer',
    username: 'viewer',
    email: 'viewer@example.com',
    role: 'viewer',
    permissions: ['shipments:read'],
  };

  it('should redact the raw errorMessage in the status cell for a viewer session', async () => {
    const failed = makeShipment({
      id: 'ol_shipment_failed',
      status: 'failed',
      errorMessage: 'DPD rejected: sender postal code not serviceable',
      failedAt: '2026-05-20T12:00:00.000Z',
      trackingNumber: null,
    });
    const mockApi = createMockApiClient({
      shipments: { list: vi.fn().mockResolvedValue(page([failed])) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, {
      apiClient: mockApi,
      sessionAdapter: createAuthenticatedSessionAdapter(viewer),
    });

    expect(await screen.findByText('Details hidden for this role.')).toBeInTheDocument();
    expect(screen.queryByText(/sender postal code not serviceable/i)).not.toBeInTheDocument();
  });

  it('should not leak the raw errorMessage via the status cell\'s title tooltip for a viewer session', async () => {
    // The third redaction surface named in AC-105 alongside the status-cell
    // text and the accordion. The visible text can be redacted while a stale
    // `title={shipment.errorMessage}` still exposes the raw string on hover —
    // exactly the leak an earlier pass on this issue missed, so it gets its
    // own assertion rather than riding on the text-redaction test above.
    const failed = makeShipment({
      id: 'ol_shipment_failed',
      status: 'failed',
      errorMessage: 'DPD rejected: sender postal code not serviceable',
      failedAt: '2026-05-20T12:00:00.000Z',
      trackingNumber: null,
    });
    const mockApi = createMockApiClient({
      shipments: { list: vi.fn().mockResolvedValue(page([failed])) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    const { container } = renderWithProviders(<ShipmentsPage />, {
      apiClient: mockApi,
      sessionAdapter: createAuthenticatedSessionAdapter(viewer),
    });

    await screen.findByText('Details hidden for this role.');
    const messageEl = container.querySelector('.shipment-status-cell__error-message');
    expect(messageEl).not.toBeNull();
    expect(messageEl).not.toHaveAttribute('title');
    // Belt-and-braces: no element anywhere carries the raw text as a title.
    expect(
      container.querySelector('[title*="sender postal code not serviceable"]'),
    ).toBeNull();
  });

  it('should still expose the raw errorMessage on the title tooltip for an admin/operator session', async () => {
    const failed = makeShipment({
      id: 'ol_shipment_failed',
      status: 'failed',
      errorMessage: 'DPD rejected: sender postal code not serviceable',
      failedAt: '2026-05-20T12:00:00.000Z',
      trackingNumber: null,
    });
    const mockApi = createMockApiClient({
      shipments: { list: vi.fn().mockResolvedValue(page([failed])) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    const { container } = renderWithProviders(<ShipmentsPage />, {
      apiClient: mockApi,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await screen.findAllByText(/sender postal code not serviceable/i);
    expect(container.querySelector('.shipment-status-cell__error-message')).toHaveAttribute(
      'title',
      'DPD rejected: sender postal code not serviceable',
    );
  });

  it('should NOT redact for an operator session (holds shipments:write, unlike viewer)', async () => {
    // The permission boundary has three roles; admin (the default fixture) and
    // viewer were covered, operator was not. `ROLE_PERMISSIONS.operator`
    // includes `shipments:write`, so an operator must see the raw message.
    const operator: SessionUser = {
      id: 'user_operator',
      username: 'operator',
      email: 'operator@example.com',
      role: 'operator',
      permissions: ['shipments:read', 'shipments:write'],
    };
    const failed = makeShipment({
      id: 'ol_shipment_failed',
      status: 'failed',
      errorMessage: 'DPD rejected: sender postal code not serviceable',
      failedAt: '2026-05-20T12:00:00.000Z',
      trackingNumber: null,
    });
    const mockApi = createMockApiClient({
      shipments: { list: vi.fn().mockResolvedValue(page([failed])) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, {
      apiClient: mockApi,
      sessionAdapter: createAuthenticatedSessionAdapter(operator),
    });

    expect(
      (await screen.findAllByText(/sender postal code not serviceable/i)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('Details hidden for this role.')).not.toBeInTheDocument();
  });

  it('should redact for an anonymous (no-session) render — usePermission fails closed', async () => {
    const failed = makeShipment({
      id: 'ol_shipment_failed',
      status: 'failed',
      errorMessage: 'DPD rejected: sender postal code not serviceable',
      failedAt: '2026-05-20T12:00:00.000Z',
      trackingNumber: null,
    });
    const mockApi = createMockApiClient({
      shipments: { list: vi.fn().mockResolvedValue(page([failed])) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    // No `sessionAdapter` → the noop (unauthenticated) adapter.
    renderWithProviders(<ShipmentsPage />, { apiClient: mockApi });

    expect(await screen.findByText('Details hidden for this role.')).toBeInTheDocument();
    expect(screen.queryByText(/sender postal code not serviceable/i)).not.toBeInTheDocument();
  });

  it('should keep the status chip and accordion visible but hide write actions for a viewer session', async () => {
    const failed = makeShipment({
      id: 'ol_shipment_failed',
      status: 'failed',
      errorMessage: 'DPD rejected: sender postal code not serviceable',
      failedAt: '2026-05-20T12:00:00.000Z',
      trackingNumber: null,
    });
    const mockApi = createMockApiClient({
      shipments: { list: vi.fn().mockResolvedValue(page([failed])) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ShipmentsPage />, {
      apiClient: mockApi,
      sessionAdapter: createAuthenticatedSessionAdapter(viewer),
    });

    // Chip stays visible (redacted, not hidden).
    expect(await screen.findByText('failed')).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: `Expand details for shipment ${failed.id}` });
    fireEvent.click(toggle);

    // Scoped to the accordion — the status cell shows the same redacted
    // placeholder, so an unscoped query would find two matches.
    await screen.findByText('Shipment failed'); // the accordion's own field label
    const detail = document.querySelector('.data-table__detail') as HTMLElement;
    expect(detail).not.toBeNull();
    expect(within(detail).getByText('Details hidden for this role.')).toBeInTheDocument();
    expect(within(detail).queryByRole('link', { name: /regenerate label/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /review connection settings/i })).not.toBeInTheDocument();
  });
});

describe('ShipmentsPage — mobile card parity (#1826)', () => {
  afterEach(cleanup);

  it('links the card to the order (restores navigation dropped when rowHref was removed)', async () => {
    const viewport = mockMobileViewport();
    try {
      const mockApi = createMockApiClient({
        shipments: {
          list: vi.fn().mockResolvedValue(
            page([makeShipment({ id: 'ol_shipment_1', orderId: 'ol_order_1', customerId: 'ol_customer_1' })]),
          ),
        },
        connections: { list: vi.fn().mockResolvedValue([]) },
      });

      const { container } = renderWithProviders(<ShipmentsPage />, { apiClient: mockApi });

      const card = await waitFor(() => {
        const el = container.querySelector('.data-table__card');
        expect(el).not.toBeNull();
        return el as HTMLElement;
      });
      // Even though this shipment carries a `customerId` (previously the
      // condition that suppressed the order fallback in `subtitle`), the
      // card's `title` is now unconditionally the order link.
      const orderLink = within(card).getByRole('link', { name: 'ol_order_1' });
      expect(orderLink).toHaveAttribute('href', '/orders/ol_order_1');
    } finally {
      viewport.restore();
    }
  });

  it('shows the severity label in the card summary', async () => {
    const viewport = mockMobileViewport();
    try {
      const mockApi = createMockApiClient({
        shipments: {
          list: vi.fn().mockResolvedValue(page([makeShipment({ status: 'failed' })])),
        },
        connections: { list: vi.fn().mockResolvedValue([]) },
      });

      const { container } = renderWithProviders(<ShipmentsPage />, { apiClient: mockApi });

      const card = await waitFor(() => {
        const el = container.querySelector('.data-table__card');
        expect(el).not.toBeNull();
        return el as HTMLElement;
      });
      expect(within(card).getByText('Fix')).toBeInTheDocument();
    } finally {
      viewport.restore();
    }
  });

  it('redacts the raw errorMessage for a viewer session in card mode too', async () => {
    const viewer: SessionUser = {
      id: 'user_viewer',
      username: 'viewer',
      email: 'viewer@example.com',
      role: 'viewer',
      permissions: ['shipments:read'],
    };
    const viewport = mockMobileViewport();
    try {
      const failed = makeShipment({
        id: 'ol_shipment_failed',
        status: 'failed',
        errorMessage: 'DPD rejected: sender postal code not serviceable',
        failedAt: '2026-05-20T12:00:00.000Z',
        trackingNumber: null,
      });
      const mockApi = createMockApiClient({
        shipments: { list: vi.fn().mockResolvedValue(page([failed])) },
        connections: { list: vi.fn().mockResolvedValue([]) },
      });

      const { container } = renderWithProviders(<ShipmentsPage />, {
        apiClient: mockApi,
        sessionAdapter: createAuthenticatedSessionAdapter(viewer),
      });

      await waitFor(() => {
        expect(container.querySelector('.data-table__card')).not.toBeNull();
      });
      expect(await screen.findByText('Details hidden for this role.')).toBeInTheDocument();
      expect(
        screen.queryByText(/sender postal code not serviceable/i),
      ).not.toBeInTheDocument();
    } finally {
      viewport.restore();
    }
  });

  it('shows the triage strip above the card list for an admin/operator session', async () => {
    const viewport = mockMobileViewport();
    try {
      const shared = 'DPD rejected: sender postcode 00-000 not serviceable';
      const mockApi = createMockApiClient({
        shipments: {
          list: vi.fn().mockResolvedValue(
            page([
              makeShipment({ id: 'ol_shipment_a', status: 'failed', errorMessage: shared }),
              makeShipment({
                id: 'ol_shipment_b',
                status: 'failed',
                errorMessage: 'DPD rejected: sender postcode 11-111 not serviceable',
              }),
            ]),
          ),
        },
        connections: { list: vi.fn().mockResolvedValue([]) },
      });

      renderWithProviders(<ShipmentsPage />, {
        apiClient: mockApi,
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });

      expect(
        await screen.findByText(/failed shipments on this connection share one cause/i),
      ).toBeInTheDocument();
    } finally {
      viewport.restore();
    }
  });
});
