/**
 * SalesDocumentRuleEnginePanel Tests (#2189)
 *
 * Covers the acceptance criterion that "Reset country" leaves the whole
 * feature - index AND dialog - looking exactly like a country that was never
 * touched: seed DE with 3 rules + 1 country default, reset it via the
 * dialog's footer action, and assert the index's Status column flips to
 * "Not configured" and the dialog (reopened via "Configure") renders the
 * fully empty ladder again, with the acknowledgment banner back in its
 * offering shape.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  renderWithProviders,
  createMockApiClient,
  createAuthenticatedSessionAdapter,
} from '../../../test/test-utils';
import type {
  SalesDocumentCountryDefault,
  SalesDocumentCountrySummary,
  SalesDocumentRule,
} from '../api/sales-document-rules.types';
import { SalesDocumentRuleEnginePanel } from './sales-document-rule-engine-panel';

function makeRule(id: string): SalesDocumentRule {
  return {
    id,
    country: 'DE',
    conditions: [],
    documentKind: 'invoice',
    connectionId: 'conn_1',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    provenance: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('SalesDocumentRuleEnginePanel — Reset country reflects everywhere (#2189)', () => {
  it('should leave the index and dialog looking like a never-touched country after a full reset', async () => {
    let rules: SalesDocumentRule[] = [makeRule('r1'), makeRule('r2'), makeRule('r3')];
    let defaults: SalesDocumentCountryDefault[] = [
      { id: 'd1', country: 'DE', documentKind: 'invoice', connectionId: 'conn_1' },
    ];

    const deleteRule = vi.fn((id: string) => {
      rules = rules.filter((r) => r.id !== id);
      return Promise.resolve(undefined);
    });
    const deleteCountryDefault = vi.fn((id: string) => {
      defaults = defaults.filter((d) => d.id !== id);
      return Promise.resolve(undefined);
    });

    const listConfiguredCountries = vi.fn(
      (): Promise<SalesDocumentCountrySummary[]> =>
        Promise.resolve([
          {
            country: 'DE',
            ruleCount: rules.length,
            invoiceDefaultConnectionId:
              defaults.find((d) => d.documentKind === 'invoice')?.connectionId ?? null,
            receiptDefaultConnectionId:
              defaults.find((d) => d.documentKind === 'fiscal-receipt')?.connectionId ?? null,
            acknowledgedNoDocumentAt: null,
          },
        ]),
    );

    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn(() => Promise.resolve(rules)),
        listCountryDefaults: vi.fn(() => Promise.resolve(defaults)),
        listConfiguredCountries,
        deleteRule,
        deleteCountryDefault,
      },
    });

    renderWithProviders(<SalesDocumentRuleEnginePanel />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    // The per-country index now lives behind the closed-by-default "Advanced"
    // disclosure (#2806) — open it before reaching into its rows.
    await userEvent.click(await screen.findByText('Advanced: per-country rules'));

    // Sanity: DE starts out "Configured".
    await screen.findByText('DE');
    const deRow = screen.getByText('DE').closest('tr');
    expect(deRow).not.toBeNull();
    expect(await within(deRow as HTMLElement).findByText('Configured')).toBeInTheDocument();

    await userEvent.click(within(deRow as HTMLElement).getByRole('button', { name: 'Configure' }));

    const resetButton = await waitFor(() => {
      const button = screen.getByRole('button', { name: 'Reset country' });
      expect(button).toBeEnabled();
      return button;
    });
    await userEvent.click(resetButton);

    const confirmButton = await screen.findByRole('button', { name: 'Yes, reset' });
    await userEvent.click(confirmButton);

    await waitFor(() => {
      expect(deleteRule).toHaveBeenCalledTimes(3);
    });
    expect(deleteCountryDefault).toHaveBeenCalledWith('d1');

    // Dialog itself now reflects the empty ladder + offering banner.
    await screen.findByText(/No rules yet for this country/i);
    expect(
      await screen.findByRole('button', { name: 'Mark as no sales document' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reset country' })).toBeDisabled();
    });

    // Index row flips to "Not configured" — the same badge a country that
    // was never touched at all renders (see SalesDocumentCountryIndex tests).
    await waitFor(() => {
      const refreshedRow = screen.getByText('DE').closest('tr') as HTMLElement;
      expect(within(refreshedRow).getByText('Not configured')).toBeInTheDocument();
    });
  });
});

describe('SalesDocumentRuleEnginePanel — Enter key in "Add country" opens the typed country', () => {
  it('should open the typed country\'s own dialog, not ★ Rest of world\'s, when submitted via Enter', async () => {
    const listConfiguredCountries = vi.fn((): Promise<SalesDocumentCountrySummary[]> => Promise.resolve([]));

    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn(() => Promise.resolve([])),
        listCountryDefaults: vi.fn(() => Promise.resolve([])),
        listConfiguredCountries,
        getTemplate: vi.fn(() => Promise.resolve(null)),
      },
    });

    renderWithProviders(<SalesDocumentRuleEnginePanel />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await userEvent.click(await screen.findByText('Advanced: per-country rules'));

    const addCountryInput = await screen.findByLabelText('New country ISO code');
    await userEvent.type(addCountryInput, 'FR{Enter}');

    // Regression (#2184): pressing Enter used to leave the native keydown
    // in flight past the state update, landing on the freshly-opened
    // dialog's "Open ★ Rest of world's routing" cross-link and triggering
    // it too — so the operator ended up on Rest of world instead of FR.
    expect(await screen.findByText(/Sales-document routing.*FR/i)).toBeInTheDocument();
    expect(screen.queryByText(/Sales-document routing.*Rest of world/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Back to/i)).not.toBeInTheDocument();
  });
});
