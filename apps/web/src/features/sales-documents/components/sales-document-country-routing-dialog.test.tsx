/**
 * SalesDocumentCountryRoutingDialog Tests (#2188)
 *
 * Covers the acceptance criteria the issue calls out specifically: ★ Rest of
 * world's own dialog renders exactly 3 sequentially-numbered tiers (never a
 * 4th, never a duplicate number), every other country renders exactly 4, the
 * tier-3 cross-link opens ★ Rest of world's dialog, the "← Back to {country}"
 * affordance appears only when arrived via that link, and the dual-default
 * warning renders only when both an Invoice and a Receipt default are set.
 *
 * A prior design-review round of the source mockup shipped a real bug here —
 * two tiers both labeled "Tier 2" — which is why the numbering assertions
 * check both the exact count AND the absence of duplicate numbers.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import type { SalesDocumentCountryDefault } from '../api/sales-document-rules.types';
import { SalesDocumentCountryRoutingDialog } from './sales-document-country-routing-dialog';

function tierNumbers(): (string | undefined)[] {
  const headings = screen.getAllByRole('heading', { name: /^Tier \d/ });
  return headings.map((heading) => heading.textContent?.match(/Tier (\d)/)?.[1]);
}

describe('SalesDocumentCountryRoutingDialog', () => {
  it('should render exactly 4 sequentially numbered tiers for a real country, with no duplicates', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([]),
        listCountryDefaults: vi.fn().mockResolvedValue([]),
      },
    });
    renderWithProviders(
      <SalesDocumentCountryRoutingDialog
        open
        country="PL"
        cameFrom={null}
        onOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
      { apiClient },
    );

    await screen.findByText(/Rules for PL/i);
    const numbers = tierNumbers();
    expect(numbers).toEqual(['1', '2', '3', '4']);
    expect(new Set(numbers).size).toBe(4);
  });

  it('should render exactly 3 sequentially numbered tiers for ★ Rest of world, never a 4th', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([]),
        listCountryDefaults: vi.fn().mockResolvedValue([]),
      },
    });
    renderWithProviders(
      <SalesDocumentCountryRoutingDialog
        open
        country="*"
        cameFrom={null}
        onOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
      { apiClient },
    );

    await screen.findByText(/Rules for ★ Rest of world/i);
    const numbers = tierNumbers();
    expect(numbers).toEqual(['1', '2', '3']);
    expect(new Set(numbers).size).toBe(3);
  });

  it('should never render the ★ Rest of world cross-link tier inside ★ Rest of world\'s own dialog', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([]),
        listCountryDefaults: vi.fn().mockResolvedValue([]),
      },
    });
    renderWithProviders(
      <SalesDocumentCountryRoutingDialog
        open
        country="*"
        cameFrom={null}
        onOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
      { apiClient },
    );

    await screen.findByText(/Rules for ★ Rest of world/i);
    expect(screen.queryByRole('button', { name: /Open ★ Rest of world/i })).toBeNull();
  });

  it('should call onNavigate to open ★ Rest of world when the tier-3 cross-link is clicked', async () => {
    const onNavigate = vi.fn();
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([]),
        listCountryDefaults: vi.fn().mockResolvedValue([]),
      },
    });
    renderWithProviders(
      <SalesDocumentCountryRoutingDialog
        open
        country="DE"
        cameFrom={null}
        onOpenChange={vi.fn()}
        onNavigate={onNavigate}
      />,
      { apiClient },
    );

    const crossLink = await screen.findByRole('button', { name: /Open ★ Rest of world/i });
    await userEvent.click(crossLink);

    expect(onNavigate).toHaveBeenCalledWith('*', 'DE');
  });

  it('should render the "← Back to {country}" affordance only when cameFrom is set, and navigate back on click', async () => {
    const onNavigate = vi.fn();
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([]),
        listCountryDefaults: vi.fn().mockResolvedValue([]),
      },
    });
    renderWithProviders(
      <SalesDocumentCountryRoutingDialog
        open
        country="*"
        cameFrom="DE"
        onOpenChange={vi.fn()}
        onNavigate={onNavigate}
      />,
      { apiClient },
    );

    const backButton = await screen.findByRole('button', { name: /Back to DE/i });
    await userEvent.click(backButton);

    expect(onNavigate).toHaveBeenCalledWith('DE', null);
  });

  it('should not render a back affordance when the dialog was opened directly (cameFrom is null)', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([]),
        listCountryDefaults: vi.fn().mockResolvedValue([]),
      },
    });
    renderWithProviders(
      <SalesDocumentCountryRoutingDialog
        open
        country="PL"
        cameFrom={null}
        onOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
      { apiClient },
    );

    await screen.findByText(/Rules for PL/i);
    expect(screen.queryByRole('button', { name: /Back to/i })).toBeNull();
  });

  it('should show the dual-default warning when both an Invoice and a Receipt default are set', async () => {
    const defaults: SalesDocumentCountryDefault[] = [
      { id: 'd1', country: 'PL', documentKind: 'invoice', connectionId: 'conn_1' },
      { id: 'd2', country: 'PL', documentKind: 'fiscal-receipt', connectionId: 'conn_2' },
    ];
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([]),
        listCountryDefaults: vi.fn().mockResolvedValue(defaults),
      },
    });
    renderWithProviders(
      <SalesDocumentCountryRoutingDialog
        open
        country="PL"
        cameFrom={null}
        onOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
      { apiClient },
    );

    expect(
      await screen.findByText(/both an Invoice default and a Receipt default/i),
    ).toBeInTheDocument();
  });

  it('should not show the dual-default warning when only one default is set', async () => {
    const defaults: SalesDocumentCountryDefault[] = [
      { id: 'd1', country: 'PL', documentKind: 'invoice', connectionId: 'conn_1' },
    ];
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([]),
        listCountryDefaults: vi.fn().mockResolvedValue(defaults),
      },
    });
    renderWithProviders(
      <SalesDocumentCountryRoutingDialog
        open
        country="PL"
        cameFrom={null}
        onOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
      { apiClient },
    );

    await screen.findByText(/Rules for PL/i);
    expect(screen.queryByText(/both an Invoice default and a Receipt default/i)).toBeNull();
  });

  it('should not show the dual-default warning when neither default is set', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([]),
        listCountryDefaults: vi.fn().mockResolvedValue([]),
      },
    });
    renderWithProviders(
      <SalesDocumentCountryRoutingDialog
        open
        country="PL"
        cameFrom={null}
        onOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
      { apiClient },
    );

    await screen.findByText(/Rules for PL/i);
    expect(screen.queryByText(/both an Invoice default and a Receipt default/i)).toBeNull();
  });
});
