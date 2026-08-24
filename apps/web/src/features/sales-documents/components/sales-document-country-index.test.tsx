/**
 * SalesDocumentCountryIndex Tests (#2187)
 *
 * Covers the acceptance criteria the issue calls out specifically: the
 * three status states render with the correct badge shape/tone, ★ Rest of
 * world always sorts last with its own distinct badge, and both the
 * "Configure" row action and "Add country" reach `onSelectCountry` in one
 * click past typing a code.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, sampleConnection, createMockApiClient } from '../../../test/test-utils';
import type { Connection } from '../../connections';
import type { SalesDocumentCountrySummary } from '../api/sales-document-rules.types';
import { SalesDocumentCountryIndex } from './sales-document-country-index';

const INFAKT: Connection = {
  ...sampleConnection,
  id: 'conn_infakt',
  name: 'inFakt',
};

const SUMMARIES: SalesDocumentCountrySummary[] = [
  {
    country: 'PL',
    ruleCount: 3,
    invoiceDefaultConnectionId: 'conn_infakt',
    receiptDefaultConnectionId: null,
    acknowledgedNoDocumentAt: null,
  },
  {
    country: 'DE',
    ruleCount: 0,
    invoiceDefaultConnectionId: null,
    receiptDefaultConnectionId: null,
    acknowledgedNoDocumentAt: '2026-08-01T00:00:00.000Z',
  },
  {
    country: 'AT',
    ruleCount: 0,
    invoiceDefaultConnectionId: null,
    receiptDefaultConnectionId: null,
    acknowledgedNoDocumentAt: null,
  },
  {
    country: '*',
    ruleCount: 1,
    invoiceDefaultConnectionId: null,
    receiptDefaultConnectionId: null,
    acknowledgedNoDocumentAt: null,
  },
];

function renderIndex(onSelectCountry = vi.fn()): { onSelectCountry: typeof onSelectCountry } {
  const apiClient = createMockApiClient({
    connections: { list: vi.fn().mockResolvedValue([INFAKT]) },
    salesDocumentRules: { listConfiguredCountries: vi.fn().mockResolvedValue(SUMMARIES) },
  });
  renderWithProviders(<SalesDocumentCountryIndex onSelectCountry={onSelectCountry} />, { apiClient });
  return { onSelectCountry };
}

describe('SalesDocumentCountryIndex', () => {
  it('should render one row per country plus the always-last ★ Rest of world row', async () => {
    renderIndex();

    await screen.findByText('PL');
    const rows = screen.getAllByRole('row').slice(1); // drop the header row
    const countryCells = rows.map((row) => within(row).getAllByRole('cell')[0].textContent);
    expect(countryCells).toEqual(['AT', 'DE', 'PL', '★ Rest of world']);
  });

  it('should render "Configured" (success, no dot) when ruleCount > 0 or a default is set', async () => {
    renderIndex();
    await screen.findByText('PL');

    const plRow = screen.getByText('PL').closest('tr');
    expect(plRow).not.toBeNull();
    const badge = within(plRow as HTMLElement).getByText('Configured');
    expect(badge.closest('.status-badge')).toHaveClass('status-badge--success');
    expect(badge.closest('.status-badge')?.querySelector('.status-badge__dot')).toBeNull();
  });

  it('should render "No document · by design" (neutral, no dot) when acknowledged and unconfigured', async () => {
    renderIndex();
    await screen.findByText('DE');

    const deRow = screen.getByText('DE').closest('tr');
    const badge = within(deRow as HTMLElement).getByText('No document · by design');
    expect(badge.closest('.status-badge')).toHaveClass('status-badge--neutral');
    expect(badge.closest('.status-badge')?.querySelector('.status-badge__dot')).toBeNull();
  });

  it('should render "Not configured" (neutral, idle dot) with nothing set and no acknowledgment', async () => {
    renderIndex();
    await screen.findByText('AT');

    const atRow = screen.getByText('AT').closest('tr');
    const badge = within(atRow as HTMLElement).getByText('Not configured');
    expect(badge.closest('.status-badge')).toHaveClass('status-badge--neutral');
    expect(badge.closest('.status-badge')?.querySelector('.status-badge__dot')).not.toBeNull();
  });

  it('should render the distinct "Always on · catch-all" badge only on the ★ Rest of world row', async () => {
    renderIndex();
    await screen.findByText('Always on · catch-all');

    const restOfWorldRow = screen.getByText('Always on · catch-all').closest('tr');
    expect(within(restOfWorldRow as HTMLElement).getByText('★ Rest of world')).toBeInTheDocument();

    const plRow = screen.getByText('PL').closest('tr');
    expect(within(plRow as HTMLElement).queryByText('Always on · catch-all')).toBeNull();
  });

  it('should resolve the invoice default connection id to its connection name', async () => {
    renderIndex();
    await screen.findByText('PL');

    const plRow = screen.getByText('PL').closest('tr');
    expect(within(plRow as HTMLElement).getByText('inFakt')).toBeInTheDocument();
  });

  it('should call onSelectCountry with the row country when "Configure" is clicked', async () => {
    const { onSelectCountry } = renderIndex();
    await screen.findByText('DE');

    const deRow = screen.getByText('DE').closest('tr') as HTMLElement;
    await userEvent.click(within(deRow).getByRole('button', { name: 'Configure' }));

    expect(onSelectCountry).toHaveBeenCalledWith('DE');
  });

  it('should call onSelectCountry with the normalized code when adding a fresh country', async () => {
    const { onSelectCountry } = renderIndex();
    await screen.findByText('PL');

    await userEvent.type(screen.getByLabelText('New country ISO code'), 'fr');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(onSelectCountry).toHaveBeenCalledWith('FR');
  });

  it('should render an empty state when no country carries any configuration', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([]) },
      salesDocumentRules: { listConfiguredCountries: vi.fn().mockResolvedValue([]) },
    });
    renderWithProviders(<SalesDocumentCountryIndex onSelectCountry={vi.fn()} />, { apiClient });

    expect(await screen.findByText(/No countries configured yet/i)).toBeInTheDocument();
  });
});
