/**
 * SalesDocumentTemplateScreen tests
 *
 * @module apps/web/src/features/sales-documents/components
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { SalesDocumentTemplateScreen } from './sales-document-template-screen';
import type { SalesDocumentStarterTemplate } from '../api/sales-document-rules.types';

const REAL_TEMPLATE: SalesDocumentStarterTemplate = {
  country: 'PL',
  sourceLabel: 'Ministry of Finance',
  sourceUrl: 'https://example.com/pl-vat',
  disclaimer: 'Not legal advice.',
  rules: [
    {
      slot: 'invoice',
      label: 'Invoice for a business buyer',
      requiredCapability: 'Invoicing',
      documentKind: 'invoice',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      usesBuyerHasTaxId: true,
    },
  ],
};

describe('SalesDocumentTemplateScreen', () => {
  it('renders the starter template card when the API resolves one', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: { getTemplate: vi.fn().mockResolvedValue(REAL_TEMPLATE) },
    });
    renderWithProviders(<SalesDocumentTemplateScreen country="PL" />, { apiClient });

    expect(await screen.findByText('Suggested starter template')).toBeInTheDocument();
  });

  it('renders nothing when no curated template exists for the country', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: { getTemplate: vi.fn().mockResolvedValue(null) },
    });
    // Wrapped in a probe element rather than asserting on the render
    // `container` directly — `renderWithProviders`' own wrapper chrome
    // (the toast region, etc.) means the outer container is never truly
    // empty, crash or not. The probe isolates "did OUR component render
    // anything" from that chrome.
    renderWithProviders(
      <div data-testid="probe">
        <SalesDocumentTemplateScreen country="DE" />
      </div>,
      { apiClient },
    );

    // Wait for the loading state to clear AND the probe to be empty in the
    // SAME check — the query being called is not the same as it having
    // settled and re-rendered, and checking the two outside one retrying
    // `waitFor` risks observing the still-loading DOM as if it were final.
    await waitFor(() => {
      expect(screen.queryByText(/Checking for a starter template/i)).not.toBeInTheDocument();
      expect(screen.getByTestId('probe')).toBeEmptyDOMElement();
    });
  });

  it('degrades to rendering nothing, not a crash, when the response is truthy but has no `rules` array', async () => {
    // A degraded response (a 500 handled into an empty object, a partial
    // payload, a field dropped by version skew) can arrive as a successful
    // query whose `data` is truthy but not shaped like a real template —
    // `rules` in particular must be an array, since it is `.map`-ped.
    // `null` already means "no curated template for this country" here, so
    // an unreadable response degrades into that same, already-handled state.
    // An uncaught render exception with no error boundary unmounts the
    // WHOLE tree, so the probe disappearing entirely (rather than merely
    // being empty) is what would tell a crash apart from a clean render.
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        getTemplate: vi
          .fn()
          .mockResolvedValue({ country: 'PL' } as unknown as SalesDocumentStarterTemplate),
      },
    });
    renderWithProviders(
      <div data-testid="probe">
        <SalesDocumentTemplateScreen country="PL" />
      </div>,
      { apiClient },
    );

    await waitFor(() => {
      expect(screen.queryByText(/Checking for a starter template/i)).not.toBeInTheDocument();
      expect(screen.getByTestId('probe')).toBeEmptyDOMElement();
    });
    expect(screen.queryByText('Suggested starter template')).not.toBeInTheDocument();
  });
});
