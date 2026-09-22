/**
 * SalesDocumentRuleComposerDialog Tests (#2809 review; #3182 removed the
 * disabled tax-ID-on-receipt checkbox)
 *
 * The composer is the largest component in this feature and shipped with e2e
 * coverage only. Per `testing-guide.md § Test Pyramid` an e2e spec is not a
 * substitute: it needs a live stack and a seeded market, so nothing checked
 * these rules on `pnpm test`.
 *
 * What is asserted here is the set of decisions the component's own doc
 * comment calls load-bearing, plus the one submit-shape rule a wrong edit
 * would break silently:
 *
 *  1. Three bordered sections, not a flat form (the review finding).
 *  2. The buyer-tax-ID caveat is a per-row GLYPH TRIGGER, never a full-width
 *     `Alert` repeated once per condition — the density finding. Three tax-ID
 *     conditions must produce three triggers and zero banners.
 *  3. Document type stays EXACTLY two-valued; "receipt with the buyer's tax
 *     ID" is never a third option — and per #3182, there is no toggle for it
 *     anywhere in the dialog, disabled or otherwise: if the order carries a
 *     tax ID it always reaches the adapter, so no property exists to gate.
 *  4. Save is refused until a destination connection is picked.
 *  5. Overlap (#3190): `rule-conflict` and `rule-no-conflict` are mutually
 *     exclusive, and the save is inert while a collision stands - AND while
 *     the check has not answered about the draft on screen, which is the state
 *     the shipped version could not tell from a clean verdict. Those cases
 *     resolve the mock by hand rather than `await`ing a banner, because every
 *     `findByTestId` first settles the query and so can only ever observe the
 *     at-rest state.
 *  6. The readback (#3189) states the assembled rule and never fills a gap in
 *     - the mockup's primary assertion target. The sentence itself is pinned
 *     by `describe-sales-document-rule-draft.test.ts`; what is asserted HERE
 *     is that the dialog is wired to it at all.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import { SalesDocumentRuleComposerDialog } from './sales-document-rule-composer-dialog';

function renderComposer(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const apiClient = createMockApiClient(overrides);
  renderWithProviders(
    <SalesDocumentRuleComposerDialog country="PL" open onOpenChange={vi.fn()} />,
    { apiClient }
  );
  return apiClient;
}

async function dialog() {
  return await screen.findByRole('dialog');
}

describe('SalesDocumentRuleComposerDialog', () => {
  it('should group the form into the three bordered sections, not one flat column', async () => {
    renderComposer();
    const root = await dialog();

    await waitFor(() => expect(within(root).getByText('Conditions')).toBeInTheDocument());
    expect(within(root).getByText('Document & destination')).toBeInTheDocument();
    expect(within(root).getByText('Effective window')).toBeInTheDocument();
    expect(root.querySelectorAll('.rule-composer-section')).toHaveLength(3);
  });

  describe('overlap detection (#3190)', () => {
    it('warns and makes the save inert when the draft could match the same order', async () => {
      renderComposer({
        salesDocumentRules: {
          checkRuleOverlap: vi.fn().mockResolvedValue({
            overlapping: [
              { ruleId: 'rule-1', connectionId: 'conn-1', documentKind: 'fiscal-receipt' },
            ],
            disjoint: [],
            undecided: [],
          }),
        },
      });
      const root = await dialog();

      const conflict = await within(root).findByTestId('rule-conflict');
      expect(conflict).toHaveTextContent('hold the order instead of one winning');
      // The acceptance criterion: the save is not merely styled as blocked.
      expect(within(root).getByTestId('rule-save-blocked')).toBeDisabled();
      expect(within(root).queryByTestId('rule-save')).not.toBeInTheDocument();
      expect(within(root).queryByTestId('rule-no-conflict')).not.toBeInTheDocument();
    });

    it('states the provable non-collision, and leaves the save available', async () => {
      renderComposer({
        salesDocumentRules: {
          checkRuleOverlap: vi.fn().mockResolvedValue({
            overlapping: [],
            disjoint: [{ ruleId: 'rule-1', reason: 'currency' }],
            undecided: [],
          }),
        },
      });
      const root = await dialog();

      const clear = await within(root).findByTestId('rule-no-conflict');
      expect(clear).toHaveTextContent('cannot match the same order');
      expect(within(root).queryByTestId('rule-conflict')).not.toBeInTheDocument();
      expect(within(root).getByTestId('rule-save')).toBeInTheDocument();
    });

    // The third outcome must not read as either of the other two - silence
    // here is the false reassurance the whole check exists to remove.
    it('surfaces a pair it could not decide about, without claiming safety', async () => {
      renderComposer({
        salesDocumentRules: {
          checkRuleOverlap: vi.fn().mockResolvedValue({
            overlapping: [],
            disjoint: [],
            undecided: [{ ruleId: 'rule-1', reason: 'unreadable-condition' }],
          }),
        },
      });
      const root = await dialog();

      const undecided = await within(root).findByTestId('rule-overlap-undecided');
      expect(undecided).toHaveTextContent('could not tell');
      expect(within(root).queryByTestId('rule-no-conflict')).not.toBeInTheDocument();
      expect(within(root).queryByTestId('rule-conflict')).not.toBeInTheDocument();
    });

    // IN FLIGHT. Every assertion above starts by awaiting a banner, which
    // settles the query first - so none of them can see the window in which
    // the check has been asked and not answered. That window is the one the
    // shipped version rendered as "no conflict" with an ENABLED save, on every
    // keystroke, with no network fault required.
    it('withholds the save while the check is still running, and says so', async () => {
      let resolveCheck: ((verdict: unknown) => void) | undefined;
      renderComposer({
        salesDocumentRules: {
          checkRuleOverlap: vi.fn().mockImplementation(
            () =>
              new Promise((resolve) => {
                resolveCheck = resolve;
              })
          ),
        },
      });
      const root = await dialog();

      const save = await within(root).findByTestId('rule-save');
      expect(save).toBeDisabled();
      expect(save).toHaveAttribute('data-overlap-state', 'pending');
      expect(save).toHaveTextContent('Checking…');
      expect(within(root).getByTestId('rule-save-hint')).toHaveTextContent('Checking this draft');
      // The point of the test: silence here is not reassurance.
      expect(within(root).queryByTestId('rule-no-conflict')).not.toBeInTheDocument();

      resolveCheck?.({ overlapping: [], disjoint: [], undecided: [] });
      await waitFor(() =>
        expect(within(root).getByTestId('rule-save')).toHaveAttribute(
          'data-overlap-state',
          'known'
        )
      );
    });

    // A draft the server would 400 is never sent, and the save it would fail
    // is never offered. Before this the gate tested non-emptiness, so typing
    // `PLN` one character at a time sent `"P"` then `"PL"` and the first 400
    // painted the "could not run the check" banner.
    it('never asks about - or offers to save - a draft the server would refuse', async () => {
      const user = userEvent.setup();
      const apiClient = renderComposer();
      const root = await dialog();
      // The default draft (`buyerHasTaxId`) is itself checkable, so mounting
      // already fires one request. Cleared here so what is asserted below is
      // "changing to an unfinished condition sends no FURTHER request", not
      // "no request is ever sent".
      await waitFor(() => expect(apiClient.salesDocumentRules.checkRuleOverlap).toHaveBeenCalled());
      vi.mocked(apiClient.salesDocumentRules.checkRuleOverlap).mockClear();

      await user.selectOptions(
        within(root).getByLabelText('Condition field'),
        'orderTotalGross'
      );
      await user.type(within(root).getByLabelText('Order total amount'), '450');
      await user.type(within(root).getByLabelText('Order total currency'), 'PL');

      const save = within(root).getByTestId('rule-save');
      expect(save).toBeDisabled();
      expect(save).toHaveAttribute('data-overlap-state', 'incomplete');
      expect(within(root).getByTestId('rule-save-hint')).toHaveTextContent('Finish every condition');
      expect(apiClient.salesDocumentRules.checkRuleOverlap).not.toHaveBeenCalled();
    });

    // The detector's own comment says refusing a duplicate field "belongs in
    // the composer", and nothing did it: such a rule saves happily and matches
    // no order at all.
    it('refuses a draft bounding the total in two currencies', async () => {
      const user = userEvent.setup();
      const apiClient = renderComposer();
      const root = await dialog();

      await user.selectOptions(
        within(root).getByLabelText('Condition field'),
        'orderTotalGross'
      );
      await user.type(within(root).getByLabelText('Order total amount'), '450');
      await user.type(within(root).getByLabelText('Order total currency'), 'PLN');
      // The single valid condition above IS checkable and fires once. The
      // assertion below is about the SECOND condition making the pair
      // uncheckable, not about whether anything was ever asked.
      await waitFor(() => expect(apiClient.salesDocumentRules.checkRuleOverlap).toHaveBeenCalled());
      vi.mocked(apiClient.salesDocumentRules.checkRuleOverlap).mockClear();

      await user.click(within(root).getByRole('button', { name: '+ Add condition' }));
      const fields = within(root).getAllByLabelText('Condition field');
      await user.selectOptions(fields[1], 'orderTotalGross');
      await user.type(within(root).getAllByLabelText('Order total amount')[1], '100');
      await user.type(within(root).getAllByLabelText('Order total currency')[1], 'EUR');

      expect(within(root).getByTestId('rule-save')).toBeDisabled();
      expect(within(root).getByTestId('rule-save-hint')).toHaveTextContent(
        'more than one currency'
      );
      expect(apiClient.salesDocumentRules.checkRuleOverlap).not.toHaveBeenCalled();
    });

    // The FOURTH state. `verdict` is `undefined` on a failed request and all
    // three arrays fall back to `[]`, which renders as no banner - i.e. as "no
    // conflict". Absence and failure must not be the same pixel.
    it('says the check could not run, rather than rendering as no conflict', async () => {
      renderComposer({
        salesDocumentRules: {
          checkRuleOverlap: vi.fn().mockRejectedValue(new Error('network down')),
        },
      });
      const root = await dialog();

      const unavailable = await within(root).findByTestId('rule-overlap-unavailable');
      expect(unavailable).toHaveTextContent('has not been compared');
      expect(within(root).queryByTestId('rule-no-conflict')).not.toBeInTheDocument();
      expect(within(root).queryByTestId('rule-conflict')).not.toBeInTheDocument();
      expect(within(root).queryByTestId('rule-overlap-undecided')).not.toBeInTheDocument();
      // A failed check is not evidence of a collision, so it must not block.
      expect(within(root).getByTestId('rule-save')).toBeInTheDocument();
    });
  });

  it('should read the draft back, naming the unchosen destination rather than omitting it', async () => {
    renderComposer();
    const root = await dialog();
    await waitFor(() => expect(within(root).getByText('Conditions')).toBeInTheDocument());

    const readback = within(root).getByTestId('rule-readback');
    // A fresh draft starts on `buyerHasTaxId` with nothing else chosen, so the
    // sentence must SAY the destination is unchosen. Reading as though a
    // destination were already picked is the failure this guards: the operator
    // would believe they had chosen one.
    // A fresh draft starts on `buyerHasTaxId` = true — the only state a real
    // order can reach (#3189) — with nothing else chosen.
    expect(readback).toHaveTextContent('customer has a tax ID');
    expect(readback).toHaveTextContent('(no integration selected)');
  });

  it('should render ONE small caveat trigger per tax-ID condition and no full-width banner', async () => {
    const user = userEvent.setup();
    renderComposer();
    const root = await dialog();
    await waitFor(() => expect(within(root).getByText('Conditions')).toBeInTheDocument());

    // A fresh draft starts on `buyerHasTaxId`, so adding two more rows gives three.
    const addCondition = within(root).getByRole('button', { name: /add condition/i });
    await user.click(addCondition);
    await user.click(addCondition);

    const triggers = within(root).getAllByRole('button', {
      name: 'Coverage caveat for this condition',
    });
    expect(triggers).toHaveLength(3);

    // The density finding: the caveat prose must NOT be rendered inline three
    // times. It lives behind the trigger's tooltip.
    expect(within(root).queryByText(/falls through to the next tier/i)).not.toBeInTheDocument();
  });

  it('should offer exactly two document types, never a third "receipt with tax ID" option', async () => {
    renderComposer();
    const root = await dialog();
    const select = await within(root).findByLabelText('Document type');

    const options = within(select as HTMLSelectElement).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Invoice', 'Receipt']);
  });

  it('should never render a tax-ID-on-receipt toggle, for either document type', async () => {
    const user = userEvent.setup();
    renderComposer();
    const root = await dialog();
    const select = await within(root).findByLabelText('Document type');

    expect(within(root).queryByLabelText(/include the buyer's tax id/i)).not.toBeInTheDocument();

    await user.selectOptions(select, 'fiscal-receipt');

    expect(within(root).queryByLabelText(/include the buyer's tax id/i)).not.toBeInTheDocument();
  });

  it('should refuse to save until a destination connection is picked', async () => {
    renderComposer();
    const root = await dialog();
    const save = await within(root).findByRole('button', { name: /save|add rule/i });
    expect(save).toBeDisabled();
  });

  it('should never send a tax-ID-on-receipt flag in the create payload — there is no such field', async () => {
    const user = userEvent.setup();
    const createRule = vi.fn().mockResolvedValue(null);
    const apiClient = renderComposer({
      salesDocumentRules: { createRule },
      // The default fixture connection carries no `Fiscalization` capability,
      // so `selectFiscalizationCandidates` would return nothing and the
      // Integration picker would stay empty — the save could never be enabled.
      connections: {
        list: vi.fn().mockResolvedValue([
          {
            ...sampleConnection,
            id: 'conn_eparagony',
            name: 'e-paragony Sandbox',
            status: 'active',
            enabledCapabilities: ['Fiscalization'],
          },
        ]),
      },
    });
    const root = await dialog();

    await user.selectOptions(await within(root).findByLabelText('Document type'), 'fiscal-receipt');

    const connectionSelect = within(root).getByLabelText('Integration');
    await waitFor(() =>
      expect(
        within(connectionSelect as HTMLSelectElement).getAllByRole('option').length
      ).toBeGreaterThan(1)
    );
    const firstReal = within(connectionSelect as HTMLSelectElement)
      .getAllByRole('option')
      .find((o) => (o as HTMLOptionElement).value !== '');
    if (!firstReal) throw new Error('fixture has no fiscalization-capable connection to pick');
    await user.selectOptions(connectionSelect, (firstReal as HTMLOptionElement).value);

    const save = within(root).getByRole('button', { name: /save|add rule/i });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() => expect(createRule).toHaveBeenCalledTimes(1));
    const payload = createRule.mock.calls[0][0] as Record<string, unknown>;
    const serialized = JSON.stringify(payload).toLowerCase();
    expect(serialized).not.toContain('taxidonreceipt');
    expect(serialized).not.toContain('buyertaxidonreceipt');
    expect(apiClient.salesDocumentRules.createRule).toBe(createRule);
  });

  // #3232: the composer offers a capability-only candidate list, wider than
  // the destination-warnings list's capability+role predicate — deliberately,
  // since a rule routes on its own `documentKind` regardless of the
  // connection's role. That divergence must not be silent.
  describe('connection role gap (#3232)', () => {
    it('warns at pick time when the chosen connection has no role configured', async () => {
      const user = userEvent.setup();
      renderComposer({
        connections: {
          list: vi.fn().mockResolvedValue([
            {
              ...sampleConnection,
              id: 'conn_eparagony',
              name: 'e-paragony Sandbox',
              status: 'active',
              enabledCapabilities: ['Fiscalization'],
              config: {},
            },
          ]),
        },
      });
      const root = await dialog();

      await user.selectOptions(await within(root).findByLabelText('Document type'), 'fiscal-receipt');
      const connectionSelect = within(root).getByLabelText('Integration');
      await waitFor(() =>
        expect(
          within(connectionSelect as HTMLSelectElement).getAllByRole('option').length
        ).toBeGreaterThan(1)
      );
      await user.selectOptions(connectionSelect, 'conn_eparagony');

      const warning = await within(root).findByTestId('rule-connection-role-gap');
      expect(warning).toHaveTextContent('e-paragony Sandbox');
      expect(warning).toHaveTextContent('no role set');
      // Non-blocking: the operator may still save.
      expect(within(root).getByTestId('rule-save')).not.toBeDisabled();
    });

    it('renders no warning when the chosen connection already carries a role', async () => {
      const user = userEvent.setup();
      renderComposer({
        connections: {
          list: vi.fn().mockResolvedValue([
            {
              ...sampleConnection,
              id: 'conn_eparagony',
              name: 'e-paragony Sandbox',
              status: 'active',
              enabledCapabilities: ['Fiscalization'],
              config: { salesDocument: { documentKind: 'fiscal-receipt' } },
            },
          ]),
        },
      });
      const root = await dialog();

      await user.selectOptions(await within(root).findByLabelText('Document type'), 'fiscal-receipt');
      const connectionSelect = within(root).getByLabelText('Integration');
      await waitFor(() =>
        expect(
          within(connectionSelect as HTMLSelectElement).getAllByRole('option').length
        ).toBeGreaterThan(1)
      );
      await user.selectOptions(connectionSelect, 'conn_eparagony');

      expect(within(root).queryByTestId('rule-connection-role-gap')).not.toBeInTheDocument();
    });

    it('renders no warning before any connection is picked', async () => {
      renderComposer();
      const root = await dialog();
      await waitFor(() => expect(within(root).getByText('Conditions')).toBeInTheDocument());

      expect(within(root).queryByTestId('rule-connection-role-gap')).not.toBeInTheDocument();
    });
  });
});
