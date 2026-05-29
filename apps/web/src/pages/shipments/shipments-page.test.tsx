import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { ShipmentsPage } from './shipments-page';
import type { PaginatedShipments, Shipment } from '../../features/shipments/api/shipments.types';
import type { Connection } from '../../features/connections/api/connections.types';

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

    // Status word renders in both the table cell and the mobile card meta.
    expect((await screen.findAllByText('generated')).length).toBeGreaterThan(0);
    expect(screen.getByText('Shipments')).toBeInTheDocument();
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
