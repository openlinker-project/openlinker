/**
 * ConnectionMappingsPage tests
 *
 * The page resolves a config-stamped source -> destination pair (#1784), so
 * tests set up a connections list where a marketplace connection is paired to
 * a PrestaShop master via `config.masterCatalogConnectionId`. Opening the page
 * from the master (with one paired marketplace) resolves the same ready pair.
 *
 * Because the paired PrestaShop master advertises OrderSource, the default tab
 * is "Fulfillment"; status/carrier/payment content mounts only once its tab is
 * selected (Radix Tabs render the active panel).
 *
 * @module apps/web/src/pages/connections
 */

import { cleanup, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../test/test-utils';
import { ConnectionMappingsPage } from './connection-mappings-page';
import type { Connection } from '../../features/connections';
import type {
  StatusMapping,
  MappingOption,
  MappingSide,
  MappingOptionListKind,
} from '../../features/mappings/api/mappings.types';

// PrestaShop master (destination). sampleConnection is prestashop with both
// OrderSource + OrderProcessorManager and no pairing key of its own.
const PRESTA: Connection = { ...sampleConnection, id: 'ps_1', name: 'Main PrestaShop Store' };

function marketplace(
  overrides: Partial<Connection> & Pick<Connection, 'id' | 'platformType'>,
): Connection {
  return {
    ...sampleConnection,
    name: `Marketplace ${overrides.id}`,
    status: 'active',
    enabledCapabilities: ['OrderSource'],
    supportedCapabilities: ['OrderSource'],
    config: { masterCatalogConnectionId: 'ps_1' },
    ...overrides,
  };
}

const ALLEGRO = marketplace({ id: 'alg_1', name: 'Main Allegro', platformType: 'allegro' });
const ERLI = marketplace({ id: 'erli_1', name: 'Erli Store', platformType: 'erli' });
const WOO = marketplace({ id: 'woo_1', name: 'US Woo', platformType: 'woocommerce' });

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
  { id: 'mapping-1', connectionId: 'ps_1', allegroStatus: 'READY_FOR_PROCESSING', prestashopStatusId: '2' },
];

const BASE_MAPPINGS_MOCKS = {
  getStatusMappings: vi.fn().mockResolvedValue([]),
  upsertStatusMappings: vi.fn().mockResolvedValue([]),
  getCarrierMappings: vi.fn().mockResolvedValue([]),
  upsertCarrierMappings: vi.fn().mockResolvedValue([]),
  getPaymentMappings: vi.fn().mockResolvedValue([]),
  upsertPaymentMappings: vi.fn().mockResolvedValue([]),
  getOrderStateMappings: vi.fn().mockResolvedValue([]),
  upsertOrderStateMappings: vi.fn().mockResolvedValue([]),
  getMappingOptions: buildOptionsResolver({
    'source/order-statuses': STATUS_OPTIONS,
    'destination/order-statuses': PS_STATUS_OPTIONS,
  }),
};

function buildApiClient(options?: {
  mappings?: Partial<typeof BASE_MAPPINGS_MOCKS>;
  connectionList?: Connection[];
  byId?: Record<string, Connection>;
}): ReturnType<typeof createMockApiClient> {
  const connectionList = options?.connectionList ?? [ALLEGRO, PRESTA];
  const byId = options?.byId ?? { ps_1: PRESTA, alg_1: ALLEGRO, erli_1: ERLI, woo_1: WOO };
  return createMockApiClient({
    mappings: { ...BASE_MAPPINGS_MOCKS, ...options?.mappings },
    connections: {
      list: vi.fn().mockResolvedValue(connectionList),
      getById: vi.fn((id: string) => Promise.resolve(byId[id] ?? PRESTA)),
    },
  });
}

function renderAt(
  apiClient: ReturnType<typeof createMockApiClient>,
  route = '/connections/ps_1/mappings',
): void {
  renderWithProviders(
    <Routes>
      <Route path="/connections/:connectionId/mappings" element={<ConnectionMappingsPage />} />
    </Routes>,
    { apiClient, route },
  );
}

/** Wait for the ready page (tabs present) and open the named tab. */
async function openTab(name: string): Promise<void> {
  const tab = await screen.findByRole('tab', { name });
  await userEvent.setup().click(tab);
}

describe('ConnectionMappingsPage', () => {
  afterEach(cleanup);

  it('renders the resolved pair and tab navigation when opened from the master', async () => {
    renderAt(buildApiClient());

    // Pairing route strip shows both sides once resolved.
    expect(await screen.findByText('Main Allegro')).toBeInTheDocument();
    expect(screen.getByText('Main PrestaShop Store')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Order Statuses' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Carriers' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Payments' })).toBeInTheDocument();
  });

  it('substitutes resolved platform labels into copy (Allegro -> PrestaShop)', async () => {
    renderAt(buildApiClient());

    expect(await screen.findByText(/Configure Allegro/)).toBeInTheDocument();
    await openTab('Order Statuses');
    expect(screen.getByRole('combobox', { name: /Select Allegro status/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Select PrestaShop status/i })).toBeInTheDocument();
  });

  it('substitutes Erli labels when the paired source is Erli', async () => {
    renderAt(buildApiClient({ connectionList: [ERLI, PRESTA] }));

    expect(await screen.findByText(/Configure Erli/)).toBeInTheDocument();
    await openTab('Order Statuses');
    expect(screen.getByRole('combobox', { name: /Select Erli status/i })).toBeInTheDocument();
  });

  it('renders empty state when no status mappings exist', async () => {
    renderAt(buildApiClient());
    await openTab('Order Statuses');
    expect(await screen.findByText(/No mappings configured yet/i)).toBeInTheDocument();
  });

  it('renders table rows when status mappings exist', async () => {
    renderAt(buildApiClient({ mappings: { getStatusMappings: vi.fn().mockResolvedValue(SAVED_STATUS_MAPPINGS) } }));
    await openTab('Order Statuses');
    await waitFor(() => {
      const cells = screen.getAllByText('Ready for processing');
      expect(cells.some((el) => el.tagName === 'TD')).toBe(true);
    });
  });

  it('shows unsaved changes indicator after adding a row', async () => {
    renderAt(buildApiClient());
    await openTab('Order Statuses');

    fireEvent.change(screen.getByRole('combobox', { name: /Select Allegro status/i }), {
      target: { value: 'READY_FOR_PROCESSING' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /Select PrestaShop status/i }), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });
  });

  it('calls upsertStatusMappings on save (keyed to the URL connection)', async () => {
    const upsertFn = vi.fn().mockResolvedValue(SAVED_STATUS_MAPPINGS);
    renderAt(
      buildApiClient({
        mappings: {
          getStatusMappings: vi.fn().mockResolvedValue(SAVED_STATUS_MAPPINGS),
          upsertStatusMappings: upsertFn,
        },
      }),
    );
    await openTab('Order Statuses');

    await screen.findByText('Ready for processing');
    fireEvent.click(screen.getByRole('button', { name: /Remove mapping for Ready for processing/i }));
    await waitFor(() => {
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save mappings' }));

    await waitFor(() => {
      expect(upsertFn).toHaveBeenCalledWith('ps_1', { items: [] });
    });
  });

  it('displays error message on save failure', async () => {
    renderAt(
      buildApiClient({
        mappings: {
          getStatusMappings: vi.fn().mockResolvedValue(SAVED_STATUS_MAPPINGS),
          upsertStatusMappings: vi.fn().mockRejectedValue(new Error('Server error')),
        },
      }),
    );
    await openTab('Order Statuses');

    await screen.findByText('Ready for processing');
    fireEvent.click(screen.getByRole('button', { name: /Remove mapping for Ready for processing/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save mappings' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Server error');
    });
  });

  describe('pairing states', () => {
    it('shows the unsupported state for a source platform outside the allowlist', async () => {
      renderAt(buildApiClient({ connectionList: [WOO, PRESTA] }), '/connections/woo_1/mappings');

      expect(
        await screen.findByText(/Mapping isn't available for WooCommerce connections yet/i),
      ).toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'Order Statuses' })).toBeNull();
    });

    it('shows the no-source guidance when a shop has no paired marketplace', async () => {
      renderAt(buildApiClient({ connectionList: [PRESTA] }));

      expect(await screen.findByText(/No marketplace is paired with this shop/i)).toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'Order Statuses' })).toBeNull();
    });

    it('prompts for a source and navigates to it when several marketplaces are paired', async () => {
      const user = userEvent.setup();
      renderAt(buildApiClient({ connectionList: [ALLEGRO, ERLI, PRESTA] }));

      expect(await screen.findByText(/Choose which marketplace to configure/i)).toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'Order Statuses' })).toBeNull();

      await user.selectOptions(
        screen.getByRole('combobox', { name: /Choose marketplace to configure/i }),
        'alg_1',
      );

      // Navigation lands on the chosen marketplace's own mappings page (ready).
      expect(await screen.findByText(/Configure Allegro/)).toBeInTheDocument();
    });
  });

  describe('carrier-fallback banner (#517)', () => {
    const DELIVERY_OPTIONS: MappingOption[] = [
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
      const prestaWithFallback: Connection = { ...PRESTA, config: { ...PRESTA.config, defaultCarrierId: 1 } };
      renderAt(
        buildApiClient({
          mappings: {
            getMappingOptions: buildOptionsResolver({
              'source/delivery-methods': DELIVERY_OPTIONS,
              'destination/carriers': PS_CARRIERS_WITH_DYNAMIC,
            }),
          },
          byId: { ps_1: prestaWithFallback, alg_1: ALLEGRO },
        }),
      );
      await openTab('Carriers');

      const banner = await findFallbackBanner();
      expect(banner.textContent).toMatch(/using fallback: Click and collect/i);
      expect(banner.querySelector('.alert__count')).toHaveTextContent('2');
      expect(banner).toHaveClass('alert--info');
    });

    it('renders an info banner pointing to OpenLinker Dynamic with the resolved source label', async () => {
      renderAt(
        buildApiClient({
          mappings: {
            getMappingOptions: buildOptionsResolver({
              'source/delivery-methods': DELIVERY_OPTIONS,
              'destination/carriers': PS_CARRIERS_WITH_DYNAMIC,
            }),
          },
        }),
      );
      await openTab('Carriers');

      const banner = await findFallbackBanner();
      expect(banner.textContent).toMatch(/using OpenLinker Dynamic \(exact Allegro cost\) at sync time/i);
      expect(banner).toHaveClass('alert--info');
    });

    it('renders a warning banner when neither fallback nor OL Dynamic is available', async () => {
      renderAt(
        buildApiClient({
          mappings: {
            getMappingOptions: buildOptionsResolver({
              'source/delivery-methods': DELIVERY_OPTIONS,
              'destination/carriers': PS_CARRIERS_NO_DYNAMIC,
            }),
          },
        }),
      );
      await openTab('Carriers');

      const banner = await findFallbackBanner();
      expect(banner.textContent).toMatch(/sync will fail until a mapping or fallback is configured/i);
      expect(banner).toHaveClass('alert--warning');
    });

    it('does NOT render the banner when every delivery method is mapped', async () => {
      renderAt(
        buildApiClient({
          mappings: {
            getMappingOptions: buildOptionsResolver({
              'source/delivery-methods': DELIVERY_OPTIONS,
              'destination/carriers': PS_CARRIERS_WITH_DYNAMIC,
            }),
            getCarrierMappings: vi.fn().mockResolvedValue([
              { id: 'cm-1', connectionId: 'ps_1', allegroDeliveryMethodId: 'method-1', prestashopCarrierId: '1' },
              { id: 'cm-2', connectionId: 'ps_1', allegroDeliveryMethodId: 'method-2', prestashopCarrierId: '7' },
            ]),
          },
        }),
      );
      await openTab('Carriers');

      const tabpanel = await screen.findByRole('tabpanel', { name: /carriers/i });
      // Give queries a beat to settle, then assert absence.
      await waitFor(() => {
        expect(screen.getByText('Carrier Mappings')).toBeInTheDocument();
      });
      expect(tabpanel.querySelector('.mapping-panel__fallback-alert')).toBeNull();
    });
  });

  describe('order-state mappings tab (#862)', () => {
    it('shows the Order States tab and renders the OL->destination panel', async () => {
      renderAt(buildApiClient());
      await openTab('Order States');

      expect(await screen.findByText('Order-State Mappings')).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: /Select OpenLinker status/i })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: /Select PrestaShop order state/i })).toBeInTheDocument();
    });

    it('hides the Order States tab when opened from a source without OrderProcessorManager', async () => {
      // Opened from the Allegro source (OrderSource only) - no Order States tab.
      renderAt(buildApiClient(), '/connections/alg_1/mappings');

      await screen.findByRole('tab', { name: 'Carriers' });
      expect(screen.queryByRole('tab', { name: 'Order States' })).toBeNull();
    });

    it('saves OL->destination order-state overrides with olStatus + externalStateId', async () => {
      const upsertFn = vi.fn().mockResolvedValue([]);
      renderAt(buildApiClient({ mappings: { upsertOrderStateMappings: upsertFn } }));
      await openTab('Order States');
      await screen.findByText('Order-State Mappings');

      fireEvent.change(screen.getByRole('combobox', { name: /Select OpenLinker status/i }), {
        target: { value: 'shipped' },
      });
      fireEvent.change(screen.getByRole('combobox', { name: /Select PrestaShop order state/i }), {
        target: { value: '2' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save mappings' }));

      await waitFor(() => {
        expect(upsertFn).toHaveBeenCalledWith('ps_1', {
          items: [{ olStatus: 'shipped', externalStateId: '2' }],
        });
      });
    });
  });

  it('switches between tabs', async () => {
    renderAt(buildApiClient());
    await openTab('Carriers');

    expect(screen.getByRole('tab', { name: 'Carriers' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Carrier Mappings')).toBeInTheDocument();
  });
});
