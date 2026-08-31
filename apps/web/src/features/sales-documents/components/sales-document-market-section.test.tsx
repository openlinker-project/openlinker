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
