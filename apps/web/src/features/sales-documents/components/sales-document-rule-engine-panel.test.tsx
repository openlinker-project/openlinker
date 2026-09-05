/**
 * SalesDocumentRuleEnginePanel Tests (#2189, updated #2806 review)
 *
 * Covers the acceptance criterion that "Reset country" leaves the whole
 * feature — the unified market list AND the dialog — looking exactly like a
 * country that was never touched: seed DE with 3 rules + 1 country default,
 * reset it via the dialog's footer action, and assert the market row's own
 * outcome flips from "Invoice" to "Nothing issued" and the dialog (reopened
 * via the row's own action) renders the fully empty ladder again, with the
 * acknowledgment banner back in its offering shape.
 *
 * #2806 review: the per-country index this test drove via `<tr>` lookups and
 * `listConfiguredCountries` was retired — `SalesDocumentMarketSection` now
 * renders every country (detected or configured) from the single
 * `listMarkets` read, so this test mocks THAT endpoint instead, deriving its
 * response from the same mutable `rules`/`defaults` state the old mock did.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  renderWithProviders,
  createMockApiClient,
  createAuthenticatedSessionAdapter,
} from '../../../test/test-utils';
import type {
  SalesDocumentCountryDefault,
  SalesDocumentRule,
} from '../api/sales-document-rules.types';
import type { SalesDocumentMarketsResponse } from '../api/sales-document-markets.types';
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

describe('SalesDocumentRuleEnginePanel — Reset country reflects everywhere (#2189, #2806 review)', () => {
  it('should leave the market list and dialog looking like a never-touched country after a full reset', async () => {
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

    // DE is CONFIGURED-only here (no recent orders) — `orderCount: null`,
    // exactly the shape a country reached only through the old country
    // index (never a detected market) has under the merged read.
    const listMarkets = vi.fn(
      (): Promise<SalesDocumentMarketsResponse> =>
        Promise.resolve({
          windowDays: 30,
          since: '2026-01-01T00:00:00.000Z',
          markets: [
            {
              country: 'DE',
              orderCount: null,
              hasTemplate: false,
              ruleCount: rules.length,
              invoiceDefaultConnectionId:
                defaults.find((d) => d.documentKind === 'invoice')?.connectionId ?? null,
              receiptDefaultConnectionId:
                defaults.find((d) => d.documentKind === 'fiscal-receipt')?.connectionId ?? null,
              acknowledgedNoDocumentAt: null,
              outcome:
                rules.length > 0
                  ? { kind: 'route', documentKind: 'invoice' }
                  : { kind: 'unresolved', reason: 'no-configuration-for-country' },
            },
          ],
        }),
    );

    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn(() => Promise.resolve(rules)),
        listCountryDefaults: vi.fn(() => Promise.resolve(defaults)),
        listMarkets,
        deleteRule,
        deleteCountryDefault,
      },
    });

    renderWithProviders(<SalesDocumentRuleEnginePanel />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    // Sanity: DE starts out issuing an invoice — the merged list's own row,
    // no disclosure to open first.
    await screen.findByText('DE');
    const deRow = screen.getByText('DE').closest('li');
    expect(deRow).not.toBeNull();
    expect(deRow).toHaveTextContent('Invoice');

    await userEvent.click(screen.getByRole('button', { name: 'Configure' }));

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

    // Dialog itself now reflects the empty ladder.
    await screen.findByText(/No rules yet for this country/i);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reset country' })).toBeDisabled();
    });

    // Closing now-empty DE requires an answer (review reversal) — "Done"
    // opens the close-time gate instead of closing outright.
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(
      await screen.findByRole('button', { name: 'Confirm - nothing needed here' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Go back' }));

    // Market row flips to "Nothing issued" — the same outcome a country
    // that was never touched at all resolves to.
    await waitFor(() => {
      const refreshedRow = screen.getByText('DE').closest('li') as HTMLElement;
      expect(refreshedRow).toHaveTextContent('Nothing issued');
    });
  });
});

describe('SalesDocumentRuleEnginePanel — "Add a market" picker (review finding: real ISO dictionary, not free text)', () => {
  function emptyMarketsResponse(): Promise<SalesDocumentMarketsResponse> {
    return Promise.resolve({
      windowDays: 30,
      since: '2026-01-01T00:00:00.000Z',
      markets: [],
    });
  }

  it('should open the picked country\'s own dialog when "Add a market" is clicked', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn(() => Promise.resolve([])),
        listCountryDefaults: vi.fn(() => Promise.resolve([])),
        listMarkets: vi.fn(emptyMarketsResponse),
        getTemplate: vi.fn(() => Promise.resolve(null)),
      },
    });

    renderWithProviders(<SalesDocumentRuleEnginePanel />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    // #2806 review — no disclosure to open first: the picker is always
    // visible directly below the market list. "Add a market" starts
    // disabled until a country is actually picked (review finding: a real
    // dictionary selection, never a free-text guess).
    const addButton = await screen.findByRole('button', { name: 'Add a market' });
    expect(addButton).toBeDisabled();

    await userEvent.click(screen.getByRole('combobox', { name: 'New market country' }));
    await userEvent.type(screen.getByPlaceholderText(/Type to search/i), 'France');
    await userEvent.click(await screen.findByText('France'));

    expect(addButton).toBeEnabled();
    await userEvent.click(addButton);

    expect(await screen.findByText(/Sales-document routing.*FR/i)).toBeInTheDocument();
  });

  it('should disable a country already present in the market list, so it cannot be re-added', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn(() => Promise.resolve([])),
        listCountryDefaults: vi.fn(() => Promise.resolve([])),
        listMarkets: vi.fn(
          (): Promise<SalesDocumentMarketsResponse> =>
            Promise.resolve({
              windowDays: 30,
              since: '2026-01-01T00:00:00.000Z',
              markets: [
                {
                  country: 'DE',
                  orderCount: 4,
                  hasTemplate: false,
                  ruleCount: 0,
                  invoiceDefaultConnectionId: 'conn_1',
                  receiptDefaultConnectionId: null,
                  acknowledgedNoDocumentAt: null,
                  outcome: { kind: 'route', documentKind: 'invoice', connectionId: 'conn_1' },
                },
              ],
            }),
        ),
      },
    });

    renderWithProviders(<SalesDocumentRuleEnginePanel />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await screen.findByText('DE');
    await userEvent.click(screen.getByRole('combobox', { name: 'New market country' }));
    await userEvent.type(screen.getByPlaceholderText(/Type to search/i), 'Germany');

    const germanyOption = await screen.findByText('Germany');
    expect(germanyOption.closest('[role="option"]')).toHaveAttribute('aria-disabled', 'true');
  });
});
