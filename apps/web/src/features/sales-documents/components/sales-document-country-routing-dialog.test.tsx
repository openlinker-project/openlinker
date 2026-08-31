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
  SalesDocumentCountrySummary,
  SalesDocumentRule,
} from '../api/sales-document-rules.types';
import { SalesDocumentCountryRoutingDialog } from './sales-document-country-routing-dialog';

function makeRule(id: string, overrides: Partial<SalesDocumentRule> = {}): SalesDocumentRule {
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
    ...overrides,
  };
}

function makeCountrySummary(
  overrides: Partial<SalesDocumentCountrySummary> = {},
): SalesDocumentCountrySummary {
  return {
    country: 'DE',
    ruleCount: 0,
    invoiceDefaultConnectionId: null,
    receiptDefaultConnectionId: null,
    acknowledgedNoDocumentAt: null,
    ...overrides,
  };
}

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
      await screen.findByText(/Both an Invoice and a Receipt default are set/i),
    ).toBeInTheDocument();
    // The consequence is stated, never reassurance that something resolves it.
    expect(screen.getByText(/that step is disabled entirely/i)).toBeInTheDocument();
    expect(screen.getByText(/an order that matches no rule is\s*held/i)).toBeInTheDocument();
  });

  it('should not show the dual-default warning when only one default is set, and should show the single-default hint instead', async () => {
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
    expect(screen.queryByText(/Both an Invoice and a Receipt default are set/i)).toBeNull();
    expect(
      await screen.findByText(/applies only when no rule above matches/i),
    ).toBeInTheDocument();
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
    expect(screen.queryByText(/Both an Invoice and a Receipt default are set/i)).toBeNull();
    expect(screen.queryByText(/applies only when no rule above matches/i)).toBeNull();
  });

  it('should render the "+ Add rule" composer with the elevated dialog tier when opened from within this dialog', async () => {
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
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    const addRuleButton = await screen.findByRole('button', { name: /\+ Add rule/i });
    await userEvent.click(addRuleButton);

    const composerHeading = await screen.findByRole('heading', { name: 'Add rule' });
    const composerContent = composerHeading.closest('[role="dialog"]');
    expect(composerContent).not.toBeNull();
    expect(composerContent).toHaveClass('dialog__content--elevated');

    // The overlay is a Radix Portal sibling of the content, not an
    // ancestor/descendant of it — assert directly against the document
    // rather than via DOM traversal from the heading, so this stays
    // robust to Radix's own portal-container structure.
    expect(document.querySelector('.dialog__overlay--elevated')).not.toBeNull();
  });
});

describe('SalesDocumentCountryRoutingDialog — acknowledgment banner (#2189)', () => {
  it('should render the "Mark as no sales document" banner when the country has zero rules and zero defaults', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([]),
        listCountryDefaults: vi.fn().mockResolvedValue([]),
        listConfiguredCountries: vi.fn().mockResolvedValue([]),
      },
    });
    renderWithProviders(
      <SalesDocumentCountryRoutingDialog
        open
        country="DE"
        cameFrom={null}
        onOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    expect(
      await screen.findByRole('button', { name: 'Mark as no sales document' }),
    ).toBeInTheDocument();
  });

  it('should not render the banner when the country has a rule', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([makeRule('r1')]),
        listCountryDefaults: vi.fn().mockResolvedValue([]),
        listConfiguredCountries: vi
          .fn()
          .mockResolvedValue([makeCountrySummary({ ruleCount: 1 })]),
      },
    });
    renderWithProviders(
      <SalesDocumentCountryRoutingDialog
        open
        country="DE"
        cameFrom={null}
        onOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    await screen.findByText(/Rules for DE/i);
    expect(screen.queryByRole('button', { name: 'Mark as no sales document' })).toBeNull();
  });

  it('should not render the banner when the country has a country default', async () => {
    const defaults: SalesDocumentCountryDefault[] = [
      { id: 'd1', country: 'DE', documentKind: 'invoice', connectionId: 'conn_1' },
    ];
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([]),
        listCountryDefaults: vi.fn().mockResolvedValue(defaults),
        listConfiguredCountries: vi
          .fn()
          .mockResolvedValue([makeCountrySummary({ invoiceDefaultConnectionId: 'conn_1' })]),
      },
    });
    renderWithProviders(
      <SalesDocumentCountryRoutingDialog
        open
        country="DE"
        cameFrom={null}
        onOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    await screen.findByText(/Rules for DE/i);
    expect(screen.queryByRole('button', { name: 'Mark as no sales document' })).toBeNull();
  });

  it('should acknowledge the country and flip the banner to "Acknowledged" with an Undo action', async () => {
    let acknowledgedAt: string | null = null;
    const acknowledgeNoDocument = vi.fn((country: string) => {
      acknowledgedAt = '2026-02-03T10:00:00.000Z';
      return Promise.resolve({ country, acknowledgedAt });
    });
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([]),
        listCountryDefaults: vi.fn().mockResolvedValue([]),
        listConfiguredCountries: vi.fn(() =>
          Promise.resolve(
            acknowledgedAt
              ? [makeCountrySummary({ acknowledgedNoDocumentAt: acknowledgedAt })]
              : [],
          ),
        ),
        acknowledgeNoDocument,
      },
    });
    renderWithProviders(
      <SalesDocumentCountryRoutingDialog
        open
        country="DE"
        cameFrom={null}
        onOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    const markButton = await screen.findByRole('button', { name: 'Mark as no sales document' });
    await userEvent.click(markButton);

    expect(acknowledgeNoDocument).toHaveBeenCalledWith('DE');
    expect(await screen.findByText(/Acknowledged/i)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as no sales document' })).toBeNull();
  });

  it('should undo the acknowledgment and flip the banner back to the offering state', async () => {
    let acknowledgedAt: string | null = '2026-02-03T10:00:00.000Z';
    const clearAcknowledgment = vi.fn(() => {
      acknowledgedAt = null;
      return Promise.resolve(undefined);
    });
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([]),
        listCountryDefaults: vi.fn().mockResolvedValue([]),
        listConfiguredCountries: vi.fn(() =>
          Promise.resolve(
            acknowledgedAt
              ? [makeCountrySummary({ acknowledgedNoDocumentAt: acknowledgedAt })]
              : [],
          ),
        ),
        clearAcknowledgment,
      },
    });
    renderWithProviders(
      <SalesDocumentCountryRoutingDialog
        open
        country="DE"
        cameFrom={null}
        onOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    const undoButton = await screen.findByRole('button', { name: 'Undo' });
    await userEvent.click(undoButton);

    expect(clearAcknowledgment).toHaveBeenCalledWith('DE');
    expect(
      await screen.findByRole('button', { name: 'Mark as no sales document' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});

describe('SalesDocumentCountryRoutingDialog — Reset country (#2189)', () => {
  it('should disable "Reset country" when the country has zero rules, zero defaults, and no acknowledgment', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([]),
        listCountryDefaults: vi.fn().mockResolvedValue([]),
        listConfiguredCountries: vi.fn().mockResolvedValue([]),
      },
    });
    renderWithProviders(
      <SalesDocumentCountryRoutingDialog
        open
        country="DE"
        cameFrom={null}
        onOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    await screen.findByText(/No rules yet for this country/i);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reset country' })).toBeDisabled();
    });
  });

  it('should enable "Reset country" when the country has at least one rule', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([makeRule('r1')]),
        listCountryDefaults: vi.fn().mockResolvedValue([]),
        listConfiguredCountries: vi
          .fn()
          .mockResolvedValue([makeCountrySummary({ ruleCount: 1 })]),
      },
    });
    renderWithProviders(
      <SalesDocumentCountryRoutingDialog
        open
        country="DE"
        cameFrom={null}
        onOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reset country' })).toBeEnabled();
    });
  });

  it('should name the exact rule count and default in the confirm dialog description', async () => {
    const defaults: SalesDocumentCountryDefault[] = [
      { id: 'd1', country: 'DE', documentKind: 'invoice', connectionId: 'conn_1' },
    ];
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([makeRule('r1'), makeRule('r2'), makeRule('r3')]),
        listCountryDefaults: vi.fn().mockResolvedValue(defaults),
        listConfiguredCountries: vi.fn().mockResolvedValue([
          makeCountrySummary({ ruleCount: 3, invoiceDefaultConnectionId: 'conn_1' }),
        ]),
      },
    });
    renderWithProviders(
      <SalesDocumentCountryRoutingDialog
        open
        country="DE"
        cameFrom={null}
        onOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    const resetButton = await waitFor(() => {
      const button = screen.getByRole('button', { name: 'Reset country' });
      expect(button).toBeEnabled();
      return button;
    });
    await userEvent.click(resetButton);

    expect(
      await screen.findByText(
        "This deletes 3 rules and the Invoice default for DE. This can't be undone.",
      ),
    ).toBeInTheDocument();
  });

  it('should sequentially delete every rule and default, then reflect an empty, never-touched-looking state', async () => {
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
    const clearAcknowledgment = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn(() => Promise.resolve(rules)),
        listCountryDefaults: vi.fn(() => Promise.resolve(defaults)),
        listConfiguredCountries: vi.fn(() =>
          Promise.resolve(
            rules.length > 0 || defaults.length > 0
              ? [makeCountrySummary({ ruleCount: rules.length, invoiceDefaultConnectionId: 'conn_1' })]
              : [],
          ),
        ),
        deleteRule,
        deleteCountryDefault,
        clearAcknowledgment,
      },
    });
    renderWithProviders(
      <SalesDocumentCountryRoutingDialog
        open
        country="DE"
        cameFrom={null}
        onOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

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
    expect(deleteRule).toHaveBeenNthCalledWith(1, 'r1');
    expect(deleteRule).toHaveBeenNthCalledWith(2, 'r2');
    expect(deleteRule).toHaveBeenNthCalledWith(3, 'r3');
    expect(deleteCountryDefault).toHaveBeenCalledWith('d1');
    expect(clearAcknowledgment).not.toHaveBeenCalled();

    // Post-reset state matches a never-touched country: no rules, no
    // defaults, the acknowledgment banner back in its offering shape, and
    // "Reset country" disabled again.
    await screen.findByText(/No rules yet for this country/i);
    expect(
      await screen.findByRole('button', { name: 'Mark as no sales document' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reset country' })).toBeDisabled();
    });
  });

  it('should offer an explicit "Done" close action so the operator does not rely on Escape or a backdrop click', async () => {
    const onOpenChange = vi.fn();
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
        onOpenChange={onOpenChange}
        onNavigate={vi.fn()}
      />,
      { apiClient },
    );

    await screen.findByText(/Rules for DE/i);
    const doneButton = screen.getByRole('button', { name: 'Done' });
    await userEvent.click(doneButton);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('should surface a per-rule delete failure without hiding the rest of the dialog', async () => {
    const rules = [makeRule('r1')];
    const deleteRule = vi.fn().mockRejectedValue(new Error('Rule is referenced elsewhere'));
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue(rules),
        listCountryDefaults: vi.fn().mockResolvedValue([]),
        deleteRule,
      },
    });
    renderWithProviders(
      <SalesDocumentCountryRoutingDialog
        open
        country="DE"
        cameFrom={null}
        onOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    const deleteButton = await screen.findByRole('button', { name: 'Delete' });
    await userEvent.click(deleteButton);

    await screen.findByText('Rule is referenced elsewhere');
    // The failure is scoped to the rule row — the rest of the dialog (e.g.
    // its title) is still there, not replaced by a full-dialog error state.
    expect(screen.getByText(/Sales-document routing · DE/i)).toBeInTheDocument();
  });
});
