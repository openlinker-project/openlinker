import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '../../features/connections/api/connections.types';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../test/test-utils';
import { ConnectionDetailPage } from './connection-detail-page';

const PRESTASHOP_UUID_1 = '11111111-1111-4111-8111-111111111111';
const PRESTASHOP_UUID_2 = '22222222-2222-4222-8222-222222222222';
const ALLEGRO_UUID = '33333333-3333-4333-8333-333333333333';

const candidatePrestashop: Connection = {
  ...sampleConnection,
  id: PRESTASHOP_UUID_1,
  name: 'Main PrestaShop Store',
};

const secondPrestashop: Connection = {
  ...sampleConnection,
  id: PRESTASHOP_UUID_2,
  name: 'Second PrestaShop',
};

function makeAllegro(overrides: Partial<Connection> = {}): Connection {
  return {
    ...sampleConnection,
    id: ALLEGRO_UUID,
    name: 'Allegro sandbox',
    platformType: 'allegro',
    config: { environment: 'sandbox' },
    enabledCapabilities: ['OfferManager', 'OrderProcessorManager'],
    supportedCapabilities: ['OfferManager', 'OrderProcessorManager'],
    adapterKey: 'allegro.publicapi.v1',
    ...overrides,
  };
}

/**
 * Build an api client mock where `connections.getById` returns the connection under
 * test and `connections.list` returns the given candidate set.
 */
function apiClientForBanner(
  connection: Connection,
  candidates: Connection[],
  overrides: Parameters<typeof createMockApiClient>[0] = {},
): ReturnType<typeof createMockApiClient> {
  return createMockApiClient({
    ...overrides,
    connections: {
      ...overrides.connections,
      getById: vi.fn().mockResolvedValue(connection),
      list: vi.fn().mockResolvedValue(candidates),
    },
  });
}

async function renderDetailPage(
  connection: Connection,
  apiClient: ReturnType<typeof createMockApiClient>,
): Promise<void> {
  renderWithProviders(
    <Routes>
      <Route path="/connections/:connectionId" element={<ConnectionDetailPage />} />
    </Routes>,
    { apiClient, route: `/connections/${connection.id}` },
  );
  // Wait for the main connection query to settle so banner logic can render.
  await screen.findByRole('heading', { name: 'Overview' });
}

// Note: renderWithProviders uses MemoryRouter. The page reads connectionId via
// useParams which defaults to '' when no route pattern matches. To provide the
// param, we pass the route option so MemoryRouter starts at the right path.
// The query hook is enabled when connectionId.length > 0, so we rely on the
// fallback param value from useParams ({ connectionId = '' }).
//
// However, without a <Route path=":connectionId"> wrapper, useParams returns {}.
// We work around this by testing the page component through the route definition
// using a Route wrapper inside test-utils. Since page tests cannot import from
// app/, we test the rendered output at the feature component level and keep
// page-level tests limited to what renderWithProviders supports.

describe('ConnectionDetailPage', () => {
  afterEach(cleanup);

  it('renders the page layout', () => {
    renderWithProviders(<ConnectionDetailPage />);
    expect(screen.getByText(/Integration detail/)).toBeInTheDocument();
  });

  it('shows empty state when connectionId is not provided', async () => {
    const apiClient = createMockApiClient({
      connections: { getById: vi.fn().mockResolvedValue(null) },
    });
    renderWithProviders(<ConnectionDetailPage />, { apiClient });

    // With no route params, connectionId defaults to '' and query is disabled
    expect(await screen.findByRole('heading', { name: 'Connection not found' })).toBeInTheDocument();
  });

  it('organizes the detail surface into Overview / Health / Actions / Config tabs', async () => {
    const user = userEvent.setup();
    const apiClient = createMockApiClient();

    renderWithProviders(
      <Routes>
        <Route path="/connections/:connectionId" element={<ConnectionDetailPage />} />
      </Routes>,
      { apiClient, route: `/connections/${sampleConnection.id}` },
    );

    await screen.findByRole('heading', { name: 'Overview' });
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Health' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Actions' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Config' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Config' }));
    expect(screen.getByRole('tab', { name: 'Config' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('Connection config')).toBeInTheDocument();
  });

  it('honors ?tab=config in the URL on first render', async () => {
    const apiClient = createMockApiClient();

    renderWithProviders(
      <Routes>
        <Route path="/connections/:connectionId" element={<ConnectionDetailPage />} />
      </Routes>,
      { apiClient, route: `/connections/${sampleConnection.id}?tab=config` },
    );

    const configTab = await screen.findByRole('tab', { name: 'Config' });
    expect(configTab).toHaveAttribute('aria-selected', 'true');
  });

  describe('ProductCatalogLinkBanner', () => {
    it('does NOT render the banner for non-Marketplace connections (e.g. PrestaShop)', async () => {
      const apiClient = apiClientForBanner(sampleConnection, [candidatePrestashop]);
      await renderDetailPage(sampleConnection, apiClient);

      expect(screen.queryByText('Product catalog auto-linked')).toBeNull();
      expect(screen.queryByText('Product catalog not linked')).toBeNull();
      expect(screen.queryByText('Barcode linking disabled')).toBeNull();
    });

    it('does NOT render the banner when an explicit master catalog is linked', async () => {
      const connection = makeAllegro({
        config: { environment: 'sandbox', masterCatalogConnectionId: candidatePrestashop.id },
      });
      const apiClient = apiClientForBanner(connection, [candidatePrestashop]);
      await renderDetailPage(connection, apiClient);

      expect(screen.queryByText('Product catalog auto-linked')).toBeNull();
      expect(screen.queryByText('Product catalog not linked')).toBeNull();
      expect(screen.queryByText('Barcode linking disabled')).toBeNull();
    });

    it('renders the "explicitly disabled" warning when config has an empty master id', async () => {
      const connection = makeAllegro({
        config: { environment: 'sandbox', masterCatalogConnectionId: '' },
      });
      const apiClient = apiClientForBanner(connection, [candidatePrestashop]);
      await renderDetailPage(connection, apiClient);

      expect(await screen.findByText('Barcode linking disabled')).toBeInTheDocument();
      expect(screen.queryByText('Product catalog auto-linked')).toBeNull();
    });

    it('renders the auto-linked info banner when exactly one ProductMaster candidate exists', async () => {
      const connection = makeAllegro();
      const apiClient = apiClientForBanner(connection, [candidatePrestashop]);
      await renderDetailPage(connection, apiClient);

      const banner = await screen.findByText('Product catalog auto-linked');
      expect(banner).toBeInTheDocument();
      // Candidate name is surfaced in the banner body.
      expect(screen.getByText(candidatePrestashop.name)).toBeInTheDocument();
      // Linked-state banners should NOT appear simultaneously.
      expect(screen.queryByText('Product catalog not linked')).toBeNull();
    });

    it('renders the ambiguous warning when 2+ candidates exist', async () => {
      const connection = makeAllegro();
      const apiClient = apiClientForBanner(connection, [candidatePrestashop, secondPrestashop]);
      await renderDetailPage(connection, apiClient);

      expect(await screen.findByText('Product catalog not linked')).toBeInTheDocument();
      expect(
        screen.getByText(/Multiple ProductMaster connections exist/i),
      ).toBeInTheDocument();
      expect(screen.queryByText('Product catalog auto-linked')).toBeNull();
    });

    it('renders the no-candidates warning with a "create PrestaShop" CTA when 0 candidates exist', async () => {
      const connection = makeAllegro();
      const apiClient = apiClientForBanner(connection, []);
      await renderDetailPage(connection, apiClient);

      expect(await screen.findByText('Product catalog not linked')).toBeInTheDocument();
      const cta = screen.getByRole('link', { name: /add a prestashop connection/i });
      expect(cta).toHaveAttribute('href', '/connections/new?platform=prestashop');
    });

    it('renders nothing while the candidates query is still loading', async () => {
      const connection = makeAllegro();
      const apiClient = createMockApiClient({
        connections: {
          getById: vi.fn().mockResolvedValue(connection),
          list: vi.fn().mockImplementation(
            () => new Promise(() => {}), // never resolves — simulate persistent loading
          ),
        },
      });
      renderWithProviders(
        <Routes>
          <Route path="/connections/:connectionId" element={<ConnectionDetailPage />} />
        </Routes>,
        { apiClient, route: `/connections/${connection.id}` },
      );
      await screen.findByRole('heading', { name: 'Overview' });

      // Neither auto-resolved nor ambiguous banner should flash during loading.
      expect(screen.queryByText('Product catalog auto-linked')).toBeNull();
      expect(screen.queryByText('Product catalog not linked')).toBeNull();
    });

    it('stays silent when the candidates query errors out (advisory, not blocking)', async () => {
      const connection = makeAllegro();
      const apiClient = createMockApiClient({
        connections: {
          getById: vi.fn().mockResolvedValue(connection),
          list: vi.fn().mockRejectedValue(new Error('Network error')),
        },
      });
      renderWithProviders(
        <Routes>
          <Route path="/connections/:connectionId" element={<ConnectionDetailPage />} />
        </Routes>,
        { apiClient, route: `/connections/${connection.id}` },
      );
      await screen.findByRole('heading', { name: 'Overview' });

      // Give the query a tick to fail.
      await waitFor(() => {
        expect((apiClient.connections.list as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
      });
      expect(screen.queryByText('Product catalog auto-linked')).toBeNull();
      expect(screen.queryByText('Product catalog not linked')).toBeNull();
    });

    it('excludes the connection under test from its own candidate list', async () => {
      // Dual-cap hypothetical: the connection under test is itself marked as a
      // ProductMaster candidate by the hook (which doesn't exclude self). The
      // banner must filter self out to avoid auto-linking to itself.
      const dualCap = makeAllegro({
        enabledCapabilities: ['OfferManager', 'ProductMaster', 'OrderProcessorManager'],
      });
      const apiClient = apiClientForBanner(dualCap, [dualCap]);
      await renderDetailPage(dualCap, apiClient);

      // After filtering self, candidates = 0 → no-candidates warning, not auto-linked.
      expect(await screen.findByText('Product catalog not linked')).toBeInTheDocument();
      expect(screen.queryByText('Product catalog auto-linked')).toBeNull();
    });
  });

  describe('ReauthRequiredBanner (#819)', () => {
    it('shows the re-auth banner with an OAuth re-auth link when status is needs_reauth', async () => {
      const connection = makeAllegro({ status: 'needs_reauth' });
      const apiClient = apiClientForBanner(connection, []);
      await renderDetailPage(connection, apiClient);

      expect(await screen.findByText('Re-authentication required')).toBeInTheDocument();
      const link = screen.getByRole('link', { name: /re-authenticate/i });
      expect(link).toHaveAttribute('href', `/connections/new/allegro?reauth=${ALLEGRO_UUID}`);
    });

    it('does NOT show the re-auth banner when the connection is active', async () => {
      const connection = makeAllegro({ status: 'active' });
      const apiClient = apiClientForBanner(connection, []);
      await renderDetailPage(connection, apiClient);

      expect(screen.queryByText('Re-authentication required')).toBeNull();
    });
  });
});
