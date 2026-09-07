/**
 * SalesDocumentRuleComposerDialog Tests (#2809 review)
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
 *     ID" is a disabled checkbox on the Receipt outcome, never a third option.
 *  4. That checkbox submits NOTHING — it exists so the composer's shape need
 *     not change when the adapter gap closes, and a future edit that starts
 *     sending it would be a field no destination reads.
 *  5. Save is refused until a destination connection is picked.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';
import { SalesDocumentRuleComposerDialog } from './sales-document-rule-composer-dialog';

function renderComposer(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const apiClient = createMockApiClient(overrides);
  renderWithProviders(
    <SalesDocumentRuleComposerDialog country="PL" open onOpenChange={vi.fn()} />,
    { apiClient },
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

  it('should show the tax-ID-on-receipt checkbox disabled, and only for the Receipt outcome', async () => {
    const user = userEvent.setup();
    renderComposer();
    const root = await dialog();
    const select = await within(root).findByLabelText('Document type');

    expect(within(root).queryByLabelText(/include the buyer's tax id/i)).not.toBeInTheDocument();

    await user.selectOptions(select, 'fiscal-receipt');

    const checkbox = await within(root).findByLabelText(/include the buyer's tax id/i);
    expect(checkbox).toBeDisabled();
  });

  it('should refuse to save until a destination connection is picked', async () => {
    renderComposer();
    const root = await dialog();
    const save = await within(root).findByRole('button', { name: /save|add rule/i });
    expect(save).toBeDisabled();
  });

  it('should never send the tax-ID-on-receipt flag in the create payload', async () => {
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
      expect(within(connectionSelect as HTMLSelectElement).getAllByRole('option').length).toBeGreaterThan(1),
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
});
