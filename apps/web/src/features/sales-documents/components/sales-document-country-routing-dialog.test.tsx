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

function tierNumbers(): string[] {
  const badges = document.querySelectorAll('.sales-document-tier__number');
  return Array.from(badges).map((badge) => badge.textContent ?? '');
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

describe('SalesDocumentCountryRoutingDialog — close-time acknowledgment gate (#2189, review reversal)', () => {
  it('should require confirmation via a second modal when closing a country with zero rules and zero defaults', async () => {
    const onOpenChange = vi.fn();
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
        onOpenChange={onOpenChange}
        onNavigate={vi.fn()}
      />,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    await screen.findByText(/Rules for DE/i);
    // Inline body carries no acknowledge button anymore — the gate lives in
    // the close-time confirm modal only.
    expect(screen.queryByRole('button', { name: 'Confirm - nothing needed here' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    // The gate intercepted the close — the parent's onOpenChange(false) was
    // never called, and a SECOND modal appeared asking to confirm.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(await screen.findByText('Leave DE unconfigured?')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Confirm - nothing needed here' }),
    ).toBeInTheDocument();
  });

  it('"Go back" cancels the gate and leaves the routing dialog open, unchanged', async () => {
    const onOpenChange = vi.fn();
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
        onOpenChange={onOpenChange}
        onNavigate={vi.fn()}
      />,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    await screen.findByText(/Rules for DE/i);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByText('Leave DE unconfigured?');

    await userEvent.click(screen.getByRole('button', { name: 'Go back' }));

    expect(screen.queryByText('Leave DE unconfigured?')).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
    // The routing dialog itself is still open and untouched.
    expect(screen.getByText(/Rules for DE/i)).toBeInTheDocument();
  });

  it('should close without any gate when the country has a rule', async () => {
    const onOpenChange = vi.fn();
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
        onOpenChange={onOpenChange}
        onNavigate={vi.fn()}
      />,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    await screen.findByText(/Rules for DE/i);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText('Leave DE unconfigured?')).toBeNull();
  });

  it('should close without any gate when the country has a country default', async () => {
    const onOpenChange = vi.fn();
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
        onOpenChange={onOpenChange}
        onNavigate={vi.fn()}
      />,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    await screen.findByText(/Rules for DE/i);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText('Leave DE unconfigured?')).toBeNull();
  });

  it('confirming the gate acknowledges the country AND closes the dialog', async () => {
    const onOpenChange = vi.fn();
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
        onOpenChange={onOpenChange}
        onNavigate={vi.fn()}
      />,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    await screen.findByText(/Rules for DE/i);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByText('Leave DE unconfigured?');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm - nothing needed here' }));

    await waitFor(() => expect(acknowledgeNoDocument).toHaveBeenCalledWith('DE'));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('reopening an acknowledged country shows the settled inline banner with Undo, and Undo re-arms the gate', async () => {
    let acknowledgedAt: string | null = '2026-02-03T10:00:00.000Z';
    const clearAcknowledgment = vi.fn(() => {
      acknowledgedAt = null;
      return Promise.resolve(undefined);
    });
    const onOpenChange = vi.fn();
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
        onOpenChange={onOpenChange}
        onNavigate={vi.fn()}
      />,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() },
    );

    const undoButton = await screen.findByRole('button', { name: 'Undo' });
    await userEvent.click(undoButton);
    expect(clearAcknowledgment).toHaveBeenCalledWith('DE');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull());

    // Now unacknowledged again — closing must re-trigger the gate.
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Leave DE unconfigured?')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe('SalesDocumentCountryRoutingDialog — Reset country (#2189)', () => {
  it('should not render the reset affordance at all for a session with no write permission (non-demo)', async () => {
    const rules = [makeRule('r1', { country: 'DE' })];
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue(rules),
        listCountryDefaults: vi.fn().mockResolvedValue([]),
      },
    });
    // Default session adapter (no sessionAdapter passed) is anonymous/no
    // permissions, and demo mode is off by default — `useWriteAccess`'s
    // `visible` is false, so the reset danger-zone must not render at all
    // rather than render disabled (docs/frontend-architecture.md's
    // "otherwise hidden" rule for a write affordance).
    renderWithProviders(
      <SalesDocumentCountryRoutingDialog
        open
        country="DE"
        cameFrom={null}
        onOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
      { apiClient },
    );

    await screen.findByText(/An unmatched order is held/i);
    expect(screen.queryByRole('button', { name: 'Reset country' })).toBeNull();
    expect(screen.queryByText(/Resetting deletes every rule and default/i)).toBeNull();
  });

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
    // defaults, "Reset country" disabled again, and the close-time gate
    // re-armed (never inline anymore — see the close-time gate describe
    // block above).
    await screen.findByText(/No rules yet for this country/i);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reset country' })).toBeDisabled();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(
      await screen.findByRole('button', { name: 'Confirm - nothing needed here' }),
    ).toBeInTheDocument();
  });

  it('should offer an explicit "Done" close action so the operator does not rely on Escape or a backdrop click', async () => {
    const onOpenChange = vi.fn();
    // A configured country (a rule present) — Done closes directly with no
    // close-time acknowledgment gate (that gate is exercised separately,
    // above, for the zero-rules/zero-defaults/unacknowledged case).
    const rules = [makeRule('r1', { country: 'DE' })];
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue(rules),
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

  it('should state that an unmatched order falls through when the country has no rule and no default', async () => {
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
        onNavigate={vi.fn()}
      />,
      { apiClient },
    );

    expect(await screen.findByText(/Falls through to ★ Rest of world/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /DE has no rules and no default, so an order delivered here goes to/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/An unmatched order is held/i)).toBeNull();
  });

  it('should state that an unmatched order is held, and never falls through, once the country carries a rule', async () => {
    const rules = [makeRule('r1', { country: 'DE' })];
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue(rules),
        listCountryDefaults: vi.fn().mockResolvedValue([]),
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
      { apiClient },
    );

    expect(await screen.findByText(/An unmatched order is held/i)).toBeInTheDocument();
    expect(
      screen.getByText(/DE has its own routing, so an order that matches nothing here is/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Falls through to ★ Rest of world/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Open ★ Rest of world/i })).toBeNull();
  });

  it('should state that an unmatched order is held once the country carries a default, even with no rules', async () => {
    const defaults: SalesDocumentCountryDefault[] = [
      { id: 'd1', country: 'DE', documentKind: 'invoice', connectionId: 'conn_1' },
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
        country="DE"
        cameFrom={null}
        onOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
      { apiClient },
    );

    expect(await screen.findByText(/An unmatched order is held/i)).toBeInTheDocument();
  });

  it('should not claim a country has no rules and no default while the counts are still loading', async () => {
    // `rules`/`defaults` read `?? []` while the queries are in flight, so an
    // ungated tier would assert "DE has no rules and no default" about a
    // configured country and then flip once the real counts land.
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockReturnValue(new Promise(() => {})),
        listCountryDefaults: vi.fn().mockReturnValue(new Promise(() => {})),
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
      { apiClient },
    );

    expect(
      await screen.findByText(/What happens to an unmatched order/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/DE has no rules and no default/i)).toBeNull();
    expect(screen.queryByText(/Falls through to ★ Rest of world/i)).toBeNull();
    expect(screen.queryByText(/An unmatched order is held/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Open ★ Rest of world/i })).toBeNull();
  });
});
