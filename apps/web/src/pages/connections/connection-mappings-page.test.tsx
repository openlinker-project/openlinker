/**
 * ConnectionMappingsPage tests
 *
 * @module apps/web/src/pages/connections
 */

import { cleanup, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../test/test-utils';
import { ConnectionMappingsPage } from './connection-mappings-page';
import { sampleConnection } from '../../test/test-utils';
import type {
  StatusMapping,
  MappingOption,
  MappingSide,
  MappingOptionListKind,
} from '../../features/mappings/api/mappings.types';

/**
 * Builds a getMappingOptions mock that switches by (side, kind).
 * Mirrors the new capability-scoped routes (#472).
 */
function buildOptionsResolver(
  byKey: Partial<Record<`${MappingSide}/${MappingOptionListKind}`, MappingOption[]>>,
) {
  return vi.fn((_connectionId: string, side: MappingSide, kind: MappingOptionListKind) =>
    Promise.resolve(byKey[`${side}/${kind}`] ?? []),
  );
}

const STATUS_OPTIONS: MappingOption[] = [
  { value: 'READY_FOR_PROCESSING', label: 'Ready for processing' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const PS_STATUS_OPTIONS: MappingOption[] = [
  { value: '2', label: 'Payment accepted' },
  { value: '6', label: 'Cancelled' },
];

const SAVED_STATUS_MAPPINGS: StatusMapping[] = [
  {
    id: 'mapping-1',
    connectionId: 'conn-1',
    allegroStatus: 'READY_FOR_PROCESSING',
    prestashopStatusId: '2',
  },
];

const BASE_MAPPINGS_MOCKS = {
  getStatusMappings: vi.fn().mockResolvedValue([]),
  upsertStatusMappings: vi.fn().mockResolvedValue([]),
  getCarrierMappings: vi.fn().mockResolvedValue([]),
  upsertCarrierMappings: vi.fn().mockResolvedValue([]),
  getPaymentMappings: vi.fn().mockResolvedValue([]),
  upsertPaymentMappings: vi.fn().mockResolvedValue([]),
  getMappingOptions: buildOptionsResolver({
    'source/order-statuses': STATUS_OPTIONS,
    'destination/order-statuses': PS_STATUS_OPTIONS,
  }),
};

function buildApiClient(mappingsOverrides: Partial<typeof BASE_MAPPINGS_MOCKS> = {}): ReturnType<typeof createMockApiClient> {
  return createMockApiClient({
    mappings: { ...BASE_MAPPINGS_MOCKS, ...mappingsOverrides },
  });
}

describe('ConnectionMappingsPage', () => {
  afterEach(cleanup);

  it('renders the page layout with tab navigation', async () => {
    renderWithProviders(<ConnectionMappingsPage />, { apiClient: buildApiClient() });

    await waitFor(() => {
      expect(screen.getByText('Mapping Configuration')).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: 'Order Statuses' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Carriers' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Payments' })).toBeInTheDocument();
  });

  it('renders empty state when no status mappings exist', async () => {
    renderWithProviders(<ConnectionMappingsPage />, { apiClient: buildApiClient() });

    await waitFor(() => {
      expect(screen.getByText(/No mappings configured yet/i)).toBeInTheDocument();
    });
  });

  it('renders table rows when status mappings exist', async () => {
    const apiClient = buildApiClient({
      getStatusMappings: vi.fn().mockResolvedValue(SAVED_STATUS_MAPPINGS),
    });
    renderWithProviders(<ConnectionMappingsPage />, { apiClient });

    await waitFor(() => {
      // Labels appear in both the table cell and the dropdown options — verify the table cell
      const cells = screen.getAllByText('Ready for processing');
      expect(cells.length).toBeGreaterThan(0);
      expect(cells.some((el) => el.tagName === 'TD')).toBe(true);
    });
  });

  it('shows unsaved changes indicator after adding a row', async () => {
    const apiClient = buildApiClient();
    renderWithProviders(<ConnectionMappingsPage />, { apiClient });

    // Wait for page to finish loading
    await waitFor(() => {
      expect(screen.getByText('Mapping Configuration')).toBeInTheDocument();
    });

    // Select source option
    const sourceSelect = screen.getByRole('combobox', { name: /Select Allegro status/i });
    fireEvent.change(sourceSelect, { target: { value: 'READY_FOR_PROCESSING' } });

    // Select target option
    const targetSelect = screen.getByRole('combobox', { name: /Select PrestaShop status/i });
    fireEvent.change(targetSelect, { target: { value: '2' } });

    // Add the row
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });
  });

  it('calls upsertStatusMappings on save', async () => {
    const upsertFn = vi.fn().mockResolvedValue(SAVED_STATUS_MAPPINGS);
    const apiClient = buildApiClient({
      getStatusMappings: vi.fn().mockResolvedValue(SAVED_STATUS_MAPPINGS),
      upsertStatusMappings: upsertFn,
    });
    renderWithProviders(<ConnectionMappingsPage />, { apiClient });

    await waitFor(() => {
      expect(screen.getByText('Ready for processing')).toBeInTheDocument();
    });

    // Delete the existing row to make the state dirty
    fireEvent.click(screen.getByRole('button', { name: /Remove mapping for Ready for processing/i }));

    await waitFor(() => {
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save mappings' }));

    await waitFor(() => {
      expect(upsertFn).toHaveBeenCalledWith('', { items: [] });
    });
  });

  it('displays error message on save failure', async () => {
    const apiClient = buildApiClient({
      getStatusMappings: vi.fn().mockResolvedValue(SAVED_STATUS_MAPPINGS),
      upsertStatusMappings: vi.fn().mockRejectedValue(new Error('Server error')),
    });
    renderWithProviders(<ConnectionMappingsPage />, { apiClient });

    await waitFor(() => {
      expect(screen.getByText('Ready for processing')).toBeInTheDocument();
    });

    // Make dirty by deleting a row
    fireEvent.click(screen.getByRole('button', { name: /Remove mapping for Ready for processing/i }));

    fireEvent.click(screen.getByRole('button', { name: 'Save mappings' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Server error');
    });
  });

  describe('carrier-fallback banner (#517)', () => {
    const ALLEGRO_DELIVERY_OPTIONS: MappingOption[] = [
      { value: 'method-1', label: 'InPost Paczkomat' },
      { value: 'method-2', label: 'Kurier24' },
    ];
    const PS_CARRIERS_WITH_DYNAMIC: MappingOption[] = [
      { value: '1', label: 'Click and collect' },
      { value: '99', label: 'OpenLinker Dynamic', kind: 'dynamic' },
    ];
    const PS_CARRIERS_NO_DYNAMIC: MappingOption[] = [
      { value: '1', label: 'Click and collect' },
      { value: '7', label: 'DPD courier' },
    ];

    /**
     * Banner tests need `useParams()` to return a non-empty connectionId
     * because `useConnectionQuery` is `enabled: connectionId.length > 0`.
     * The other tests on this page don't depend on the connection query,
     * which is why they get away with no <Routes> wrapper.
     */
    function renderWithRoute(apiClient: ReturnType<typeof createMockApiClient>): void {
      renderWithProviders(
        <Routes>
          <Route path="/connections/:connectionId/mappings" element={<ConnectionMappingsPage />} />
        </Routes>,
        { apiClient, route: '/connections/conn_1/mappings' },
      );
    }

    function selectCarriersTab(): Promise<void> {
      const user = userEvent.setup();
      return user.click(screen.getByRole('tab', { name: 'Carriers' }));
    }

    /**
     * The banner wraps `{N}` in a `<span.alert__count>` so the count
     * renders in IBM Plex Mono. That splits the visible string across
     * elements, which `getByText` won't traverse — use the carriers
     * tab's `tabpanel` as the scope and match against `textContent`.
     *
     * The banner depends on 3 async queries (connection, mappings,
     * mapping-options) all having settled, so we poll instead of
     * single-shotting the lookup.
     */
    async function findFallbackBanner(): Promise<HTMLElement> {
      const tabpanel = await screen.findByRole('tabpanel', { name: /carriers/i });
      let alert: Element | null = null;
      await waitFor(() => {
        alert = tabpanel.querySelector('.mapping-panel__fallback-alert');
        if (!alert) throw new Error('not yet');
      });
      return alert as unknown as HTMLElement;
    }

    it('renders an info banner with the static fallback name when defaultCarrierId is set', async () => {
      const apiClient = buildApiClient({
        getMappingOptions: buildOptionsResolver({
          'source/order-statuses': STATUS_OPTIONS,
          'destination/order-statuses': PS_STATUS_OPTIONS,
          'source/delivery-methods': ALLEGRO_DELIVERY_OPTIONS,
          'destination/carriers': PS_CARRIERS_WITH_DYNAMIC,
        }),
      });
      apiClient.connections.getById = vi.fn().mockResolvedValue({
        ...sampleConnection,
        config: { ...sampleConnection.config, defaultCarrierId: 1 },
      });
      renderWithRoute(apiClient);
      await waitFor(() => {
        expect(screen.getByText('Mapping Configuration')).toBeInTheDocument();
      });
      await selectCarriersTab();

      const banner = await findFallbackBanner();
      expect(banner.textContent).toMatch(/using fallback: Click and collect/i);
      expect(banner.querySelector('.alert__count')).toHaveTextContent('2');
      expect(banner).toHaveClass('alert--info');
    });

    it("renders an info banner pointing to OpenLinker Dynamic when defaultCarrierId is unset and OL Dynamic is installed", async () => {
      const apiClient = buildApiClient({
        getMappingOptions: buildOptionsResolver({
          'source/order-statuses': STATUS_OPTIONS,
          'destination/order-statuses': PS_STATUS_OPTIONS,
          'source/delivery-methods': ALLEGRO_DELIVERY_OPTIONS,
          'destination/carriers': PS_CARRIERS_WITH_DYNAMIC,
        }),
      });
      // sampleConnection.config has no defaultCarrierId — leave default.
      renderWithRoute(apiClient);
      await waitFor(() => {
        expect(screen.getByText('Mapping Configuration')).toBeInTheDocument();
      });
      await selectCarriersTab();

      const banner = await findFallbackBanner();
      expect(banner.textContent).toMatch(
        /using OpenLinker Dynamic \(exact Allegro cost\) at sync time/i,
      );
      expect(banner).toHaveClass('alert--info');
    });

    it('renders a warning banner when neither defaultCarrierId nor an OL Dynamic option is available', async () => {
      const apiClient = buildApiClient({
        getMappingOptions: buildOptionsResolver({
          'source/order-statuses': STATUS_OPTIONS,
          'destination/order-statuses': PS_STATUS_OPTIONS,
          'source/delivery-methods': ALLEGRO_DELIVERY_OPTIONS,
          'destination/carriers': PS_CARRIERS_NO_DYNAMIC,
        }),
      });
      // No defaultCarrierId; OL Dynamic NOT in carriers list (operator
      // hasn't installed the OL PS module).
      renderWithRoute(apiClient);
      await waitFor(() => {
        expect(screen.getByText('Mapping Configuration')).toBeInTheDocument();
      });
      await selectCarriersTab();

      const banner = await findFallbackBanner();
      expect(banner.textContent).toMatch(
        /sync will fail until a mapping or fallback is configured/i,
      );
      expect(banner).toHaveClass('alert--warning');
    });

    it('does NOT render the banner when every Allegro method is mapped', async () => {
      const apiClient = buildApiClient({
        getMappingOptions: buildOptionsResolver({
          'source/order-statuses': STATUS_OPTIONS,
          'destination/order-statuses': PS_STATUS_OPTIONS,
          'source/delivery-methods': ALLEGRO_DELIVERY_OPTIONS,
          'destination/carriers': PS_CARRIERS_WITH_DYNAMIC,
        }),
        getCarrierMappings: vi.fn().mockResolvedValue([
          {
            id: 'cm-1',
            connectionId: 'conn_1',
            allegroDeliveryMethodId: 'method-1',
            prestashopCarrierId: '1',
          },
          {
            id: 'cm-2',
            connectionId: 'conn_1',
            allegroDeliveryMethodId: 'method-2',
            prestashopCarrierId: '7',
          },
        ]),
      });
      renderWithRoute(apiClient);
      await waitFor(() => {
        expect(screen.getByText('Mapping Configuration')).toBeInTheDocument();
      });
      await selectCarriersTab();

      // Wait for the carriers tab content to be visible, then assert
      // the banner element is absent. Selector-based check (rather than
      // text matching) avoids false positives from dropdown options
      // that happen to contain the carrier name.
      const tabpanel = await screen.findByRole('tabpanel', { name: /carriers/i });
      expect(tabpanel.querySelector('.mapping-panel__fallback-alert')).toBeNull();
    });
  });

  it('switches between tabs', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ConnectionMappingsPage />, { apiClient: buildApiClient() });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Carriers' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: 'Carriers' }));

    expect(screen.getByRole('tab', { name: 'Carriers' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Carrier Mappings')).toBeInTheDocument();
  });
});
