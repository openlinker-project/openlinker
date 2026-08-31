/**
 * SalesDocumentMarketSection Tests — summary + empty state (#2541)
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { SalesDocumentMarketSection } from './sales-document-market-section';

describe('SalesDocumentMarketSection — summary + empty state (#2541)', () => {
  it('should render the empty state, and never the summary, on a clean instance', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listMarkets: vi.fn().mockResolvedValue({
          windowDays: 30,
          since: '2026-01-01T00:00:00.000Z',
          markets: [],
        }),
      },
    });
    renderWithProviders(<SalesDocumentMarketSection onSelectCountry={vi.fn()} />, { apiClient });

    await waitFor(() => expect(screen.getByText('No markets yet')).toBeInTheDocument());
    expect(screen.queryByText(/issuing/)).not.toBeInTheDocument();
  });

  it('should render the computed summary sentence above the row list when markets exist', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listMarkets: vi.fn().mockResolvedValue({
          windowDays: 30,
          since: '2026-01-01T00:00:00.000Z',
          markets: [
            {
              country: 'DE',
              orderCount: null,
              hasTemplate: false,
              ruleCount: 1,
              invoiceDefaultConnectionId: 'conn_1',
              receiptDefaultConnectionId: null,
              acknowledgedNoDocumentAt: null,
              outcome: { kind: 'route', documentKind: 'invoice', connectionId: 'conn_1' },
            },
          ],
        }),
      },
    });
    renderWithProviders(<SalesDocumentMarketSection onSelectCountry={vi.fn()} />, { apiClient });

    await waitFor(() => expect(screen.getByText('DE')).toBeInTheDocument());
    expect(screen.getByText('This market is issuing its documents.')).toBeInTheDocument();
    expect(screen.queryByText('No markets yet')).not.toBeInTheDocument();
  });

  it('should read a market blocked without any configuration as fresh-install, not broken', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listMarkets: vi.fn().mockResolvedValue({
          windowDays: 30,
          since: '2026-01-01T00:00:00.000Z',
          markets: [
            {
              country: 'PL',
              orderCount: 4,
              hasTemplate: true,
              ruleCount: 0,
              invoiceDefaultConnectionId: null,
              receiptDefaultConnectionId: null,
              acknowledgedNoDocumentAt: null,
              outcome: { kind: 'unresolved', reason: 'no-configuration-for-country' },
            },
          ],
        }),
      },
    });
    renderWithProviders(<SalesDocumentMarketSection onSelectCountry={vi.fn()} />, { apiClient });

    await waitFor(() => expect(screen.getByText('PL')).toBeInTheDocument());
    expect(screen.getByText(/not been set up yet/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is lost/)).toBeInTheDocument();
  });
});

describe('SalesDocumentMarketSection — detected markets and suggested setup (#2542)', () => {
  it('should render a detected market\'s order count alongside the discovery window', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listMarkets: vi.fn().mockResolvedValue({
          windowDays: 30,
          since: '2026-01-01T00:00:00.000Z',
          markets: [
            {
              country: 'PL',
              orderCount: 12,
              hasTemplate: true,
              ruleCount: 0,
              invoiceDefaultConnectionId: null,
              receiptDefaultConnectionId: null,
              acknowledgedNoDocumentAt: null,
              outcome: { kind: 'unresolved', reason: 'no-configuration-for-country' },
            },
          ],
        }),
      },
    });
    renderWithProviders(<SalesDocumentMarketSection onSelectCountry={vi.fn()} />, { apiClient });

    await waitFor(() => expect(screen.getByText('PL')).toBeInTheDocument());
    expect(screen.getByText(/12 orders in the last 30 days/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use starter setup' })).toBeInTheDocument();
    expect(screen.getByText(/the only market with guidance so far/)).toBeInTheDocument();
  });

  it('should give a detected market without a template a plain "Set up", never a recommendation', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listMarkets: vi.fn().mockResolvedValue({
          windowDays: 30,
          since: '2026-01-01T00:00:00.000Z',
          markets: [
            {
              country: 'CZ',
              orderCount: 3,
              hasTemplate: false,
              ruleCount: 0,
              invoiceDefaultConnectionId: null,
              receiptDefaultConnectionId: null,
              acknowledgedNoDocumentAt: null,
              outcome: { kind: 'unresolved', reason: 'no-configuration-for-country' },
            },
          ],
        }),
      },
    });
    renderWithProviders(<SalesDocumentMarketSection onSelectCountry={vi.fn()} />, { apiClient });

    await waitFor(() => expect(screen.getByText('CZ')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Set up' })).toBeInTheDocument();
    expect(screen.queryByText(/Starter setup available/)).not.toBeInTheDocument();
  });

  it('should not claim exclusivity when two markets in the same list both carry a template', async () => {
    const templatedMarket = (country: string): Record<string, unknown> => ({
      country,
      orderCount: 5,
      hasTemplate: true,
      ruleCount: 0,
      invoiceDefaultConnectionId: null,
      receiptDefaultConnectionId: null,
      acknowledgedNoDocumentAt: null,
      outcome: { kind: 'unresolved' as const, reason: 'no-configuration-for-country' },
    });
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listMarkets: vi.fn().mockResolvedValue({
          windowDays: 30,
          since: '2026-01-01T00:00:00.000Z',
          markets: [templatedMarket('PL'), templatedMarket('DE')],
        }),
      },
    });
    renderWithProviders(<SalesDocumentMarketSection onSelectCountry={vi.fn()} />, { apiClient });

    await waitFor(() => expect(screen.getByText('PL')).toBeInTheDocument());
    expect(screen.queryByText(/the only market with guidance/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Starter setup available/)).toHaveLength(2);
  });
});

describe('SalesDocumentMarketSection — loading states (#2543)', () => {
  it('should render the skeleton, not the generic loading state, on initial fetch', () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listMarkets: vi.fn(() => new Promise<never>(() => {})),
      },
    });
    renderWithProviders(<SalesDocumentMarketSection onSelectCountry={vi.fn()} />, { apiClient });

    expect(screen.getByText('Loading markets…')).toBeInTheDocument();
    expect(screen.queryByText('No markets yet')).not.toBeInTheDocument();
  });

  it('should never render the skeleton and the empty state together on a clean instance', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listMarkets: vi.fn().mockResolvedValue({
          windowDays: 30,
          since: '2026-01-01T00:00:00.000Z',
          markets: [],
        }),
      },
    });
    renderWithProviders(<SalesDocumentMarketSection onSelectCountry={vi.fn()} />, { apiClient });

    await waitFor(() => expect(screen.getByText('No markets yet')).toBeInTheDocument());
    expect(screen.queryByText('Loading markets…')).not.toBeInTheDocument();
  });

});

describe('SalesDocumentMarketSection — busy state during a background refetch (#2543)', () => {
  // The query hook is mocked directly here (rather than driven through a real
  // TanStack Query refetch cycle) because this section has no user-facing
  // trigger for a background refetch while data is already loaded — that
  // happens via React Query's own focus/interval refetch, which is not worth
  // simulating end-to-end just to prove one derived boolean is wired through.
  const loadedRow = {
    country: 'DE',
    orderCount: null,
    hasTemplate: false,
    ruleCount: 1,
    invoiceDefaultConnectionId: 'conn_1',
    receiptDefaultConnectionId: null,
    acknowledgedNoDocumentAt: null,
    outcome: { kind: 'route' as const, documentKind: 'invoice', connectionId: 'conn_1' },
  };

  it('should disable every row action and announce a refresh while isFetching is true', async () => {
    vi.resetModules();
    vi.doMock('../hooks/use-sales-document-markets-query', (): Record<string, unknown> => ({
      useSalesDocumentMarketsQuery: () => ({
        isLoading: false,
        isFetching: true,
        error: null,
        data: { windowDays: 30, since: '2026-01-01T00:00:00.000Z', markets: [loadedRow] },
        refetch: vi.fn(),
      }),
    }));
    const { SalesDocumentMarketSection: MockedSection } = await import(
      './sales-document-market-section'
    );

    renderWithProviders(<MockedSection onSelectCountry={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Configure' })).toBeDisabled();
    expect(screen.getByText('Refreshing markets…')).toBeInTheDocument();

    vi.doUnmock('../hooks/use-sales-document-markets-query');
    vi.resetModules();
  });
});
