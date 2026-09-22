/**
 * SalesDocumentTemplateScreen Tests (#3232)
 *
 * Covers the pick-time role-gap warning this screen shares with the rule
 * composer (`find-sales-document-connection-role-gap.ts`) — the screen had no
 * unit coverage at all before this change, only e2e.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';
import { SalesDocumentTemplateScreen } from './sales-document-template-screen';
import type { SalesDocumentStarterTemplate } from '../api/sales-document-rules.types';

const TEMPLATE: SalesDocumentStarterTemplate = {
  country: 'PL',
  sourceLabel: 'Example source',
  sourceUrl: 'https://example.com',
  disclaimer: 'This is a starting point, not legal advice.',
  rules: [
    {
      slot: 'over-threshold',
      label: 'Orders ≥ 450 PLN → Invoice',
      documentKind: 'invoice',
      requiredCapability: 'Invoicing',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: null,
      usesBuyerHasTaxId: false,
    },
  ],
};

function renderScreen(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const apiClient = createMockApiClient({
    salesDocumentRules: { getTemplate: vi.fn().mockResolvedValue(TEMPLATE) },
    ...overrides,
  });
  renderWithProviders(<SalesDocumentTemplateScreen country="PL" />, { apiClient });
  return apiClient;
}

async function openAccordion(): Promise<void> {
  const summary = await screen.findByText(/click to review/i);
  await userEvent.setup().click(summary);
}

describe('SalesDocumentTemplateScreen', () => {
  it('renders nothing when the country carries no curated template', async () => {
    renderWithProviders(<SalesDocumentTemplateScreen country="DE" />, {
      apiClient: createMockApiClient({
        salesDocumentRules: { getTemplate: vi.fn().mockResolvedValue(null) },
      }),
    });

    await waitFor(() => expect(screen.queryByText(/starter template/i)).not.toBeInTheDocument());
  });

  it('renders the accordion, collapsed, when a template exists', async () => {
    renderScreen();

    expect(await screen.findByText('Suggested starter template')).toBeInTheDocument();
    const details = document.querySelector('details.template-accordion');
    expect(details).not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBe(false);
  });

  describe('connection role gap (#3232)', () => {
    it('warns at pick time when the chosen connection has no role configured', async () => {
      const user = userEvent.setup();
      renderScreen({
        connections: {
          list: vi.fn().mockResolvedValue([
            {
              ...sampleConnection,
              id: 'conn_invoicing',
              name: 'inFakt',
              status: 'active',
              enabledCapabilities: ['Invoicing'],
              config: {},
            },
          ]),
        },
      });
      await openAccordion();

      const select = await screen.findByLabelText(`Connection for ${TEMPLATE.rules[0].label}`);
      await user.selectOptions(select, 'conn_invoicing');

      const warning = await screen.findByTestId('template-role-gap-over-threshold');
      expect(warning).toHaveTextContent('inFakt');
      expect(warning).toHaveTextContent('no role set');
    });

    it('renders no warning when the chosen connection already carries a role', async () => {
      const user = userEvent.setup();
      renderScreen({
        connections: {
          list: vi.fn().mockResolvedValue([
            {
              ...sampleConnection,
              id: 'conn_invoicing',
              name: 'inFakt',
              status: 'active',
              enabledCapabilities: ['Invoicing'],
              config: { salesDocument: { documentKind: 'invoice' } },
            },
          ]),
        },
      });
      await openAccordion();

      const select = await screen.findByLabelText(`Connection for ${TEMPLATE.rules[0].label}`);
      await user.selectOptions(select, 'conn_invoicing');

      expect(screen.queryByTestId('template-role-gap-over-threshold')).not.toBeInTheDocument();
    });

    it('renders no warning before any connection is picked', async () => {
      renderScreen({
        connections: {
          list: vi.fn().mockResolvedValue([
            {
              ...sampleConnection,
              id: 'conn_invoicing',
              name: 'inFakt',
              status: 'active',
              enabledCapabilities: ['Invoicing'],
              config: {},
            },
          ]),
        },
      });
      await openAccordion();

      expect(
        await screen.findByLabelText(`Connection for ${TEMPLATE.rules[0].label}`),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('template-role-gap-over-threshold')).not.toBeInTheDocument();
    });
  });

  it('dismisses the accordion via "Start from scratch instead"', async () => {
    const user = userEvent.setup();
    renderScreen();
    await openAccordion();

    const dismiss = await within(document.body).findByRole('button', {
      name: /start from scratch instead/i,
    });
    await user.click(dismiss);

    await waitFor(() => expect(screen.queryByText('Suggested starter template')).not.toBeInTheDocument());
  });
});
