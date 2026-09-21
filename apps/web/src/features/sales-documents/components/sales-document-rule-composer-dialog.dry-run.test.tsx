/**
 * SalesDocumentRuleComposerDialog — "Test with a sample order" tests (#3191)
 *
 * The dry-run panel is a toggled, self-contained tool inside the Conditions
 * section: it must never persist anything (there is no invalidation to
 * assert — `useDryRunSalesDocumentRuleMutation` simply has none), and it must
 * send exactly the in-progress draft plus the sample-order fields, never a
 * value pulled from elsewhere.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';
import { SalesDocumentRuleComposerDialog } from './sales-document-rule-composer-dialog';

function renderComposer(overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  const apiClient = createMockApiClient({
    connections: {
      list: vi.fn().mockResolvedValue([
        {
          ...sampleConnection,
          id: 'conn_eparagony',
          name: 'e-paragony Sandbox',
          status: 'active',
          enabledCapabilities: ['Invoicing'],
        },
      ]),
    },
    ...overrides,
  });
  renderWithProviders(
    <SalesDocumentRuleComposerDialog country="PL" open onOpenChange={vi.fn()} />,
    { apiClient },
  );
  return apiClient;
}

async function dialog() {
  return await screen.findByRole('dialog');
}

async function pickAConnection(root: HTMLElement, user: ReturnType<typeof userEvent.setup>) {
  const connectionSelect = within(root).getByLabelText('Integration');
  await waitFor(() =>
    expect(within(connectionSelect as HTMLSelectElement).getAllByRole('option').length).toBeGreaterThan(1),
  );
  const firstReal = within(connectionSelect as HTMLSelectElement)
    .getAllByRole('option')
    .find((o) => (o as HTMLOptionElement).value !== '');
  if (!firstReal) throw new Error('fixture has no invoicing-capable connection to pick');
  await user.selectOptions(connectionSelect, (firstReal as HTMLOptionElement).value);
}

describe('SalesDocumentRuleComposerDialog — dry run (#3191)', () => {
  it('should toggle the sample-order panel open and closed without calling the API', async () => {
    const user = userEvent.setup();
    const dryRunRule = vi.fn();
    const apiClient = renderComposer({ salesDocumentRules: { dryRunRule } });
    const root = await dialog();

    expect(within(root).queryByTestId('rule-test-sample-order-panel')).not.toBeInTheDocument();

    await user.click(within(root).getByTestId('rule-test-sample-order'));
    expect(within(root).getByTestId('rule-test-sample-order-panel')).toBeInTheDocument();

    await user.click(within(root).getByTestId('rule-test-sample-order'));
    expect(within(root).queryByTestId('rule-test-sample-order-panel')).not.toBeInTheDocument();

    expect(apiClient.salesDocumentRules.dryRunRule).not.toHaveBeenCalled();
  });

  it('should keep "Run test" disabled until a destination connection and a sample amount/currency are set', async () => {
    const user = userEvent.setup();
    const root = await (async () => {
      renderComposer();
      return dialog();
    })();

    await user.click(within(root).getByTestId('rule-test-sample-order'));
    const runTest = within(root).getByTestId('rule-run-sample-order-test');
    expect(runTest).toBeDisabled();
  });

  it('should send the in-progress draft plus the sample order, and render the result', async () => {
    const user = userEvent.setup();
    const dryRunRule = vi.fn().mockResolvedValue({
      kind: 'route',
      documentKind: 'invoice',
      connectionId: 'conn_eparagony',
      matchedByCandidateRule: true,
    });
    renderComposer({ salesDocumentRules: { dryRunRule } });
    const root = await dialog();
    await waitFor(() => expect(within(root).getByText('Conditions')).toBeInTheDocument());

    await pickAConnection(root, user);
    await user.click(within(root).getByTestId('rule-test-sample-order'));

    const panel = within(root).getByTestId('rule-test-sample-order-panel');
    await user.type(within(panel).getByLabelText('Sample order total amount'), '450.00');
    await user.type(within(panel).getByLabelText('Sample order currency'), 'PLN');

    await user.click(within(panel).getByTestId('rule-run-sample-order-test'));

    await waitFor(() => expect(dryRunRule).toHaveBeenCalledTimes(1));
    const payload = dryRunRule.mock.calls[0][0] as {
      country: string;
      documentKind: string;
      connectionId: string;
      sampleOrder: {
        country: string;
        totalGross: number;
        currency: string;
        taxTreatment?: 'inclusive' | 'exclusive';
        buyerHasTaxId?: boolean;
      };
    };
    expect(payload.country).toBe('PL');
    expect(payload.connectionId).toBe('conn_eparagony');
    // Defaults to gross-priced ('inclusive') — see #3191 review: the panel
    // used to send no taxTreatment at all, which held every amount-threshold
    // rule as "cannot compare" regardless of the typed amount.
    expect(payload.sampleOrder).toEqual({
      country: 'PL',
      totalGross: 450,
      currency: 'PLN',
      taxTreatment: 'inclusive',
      buyerHasTaxId: undefined,
    });

    const result = await within(root).findByTestId('rule-test-sample-order-result');
    expect(result).toHaveTextContent('via the rule you are drafting');
  });

  it('should send taxTreatment: exclusive when the operator picks net-priced (#3191 review)', async () => {
    const user = userEvent.setup();
    const dryRunRule = vi.fn().mockResolvedValue({
      kind: 'unresolved',
      reason: 'net-priced-order',
      matchedByCandidateRule: false,
    });
    renderComposer({ salesDocumentRules: { dryRunRule } });
    const root = await dialog();

    await pickAConnection(root, user);
    await user.click(within(root).getByTestId('rule-test-sample-order'));
    const panel = within(root).getByTestId('rule-test-sample-order-panel');
    await user.type(within(panel).getByLabelText('Sample order total amount'), '10');
    await user.type(within(panel).getByLabelText('Sample order currency'), 'EUR');
    await user.selectOptions(within(panel).getByLabelText('Sample order pricing'), 'exclusive');
    await user.click(within(panel).getByTestId('rule-run-sample-order-test'));

    await waitFor(() => expect(dryRunRule).toHaveBeenCalledTimes(1));
    const payload = dryRunRule.mock.calls[0][0] as {
      sampleOrder: { taxTreatment?: 'inclusive' | 'exclusive' };
    };
    expect(payload.sampleOrder.taxTreatment).toBe('exclusive');
  });

  it('should never persist anything — no create/upsert/delete call happens from a dry run', async () => {
    const user = userEvent.setup();
    const createRule = vi.fn();
    const dryRunRule = vi.fn().mockResolvedValue({ kind: 'unresolved', reason: 'no-matching-rule', matchedByCandidateRule: false });
    renderComposer({ salesDocumentRules: { createRule, dryRunRule } });
    const root = await dialog();

    await pickAConnection(root, user);
    await user.click(within(root).getByTestId('rule-test-sample-order'));
    const panel = within(root).getByTestId('rule-test-sample-order-panel');
    await user.type(within(panel).getByLabelText('Sample order total amount'), '10');
    await user.type(within(panel).getByLabelText('Sample order currency'), 'EUR');
    await user.click(within(panel).getByTestId('rule-run-sample-order-test'));

    await waitFor(() => expect(dryRunRule).toHaveBeenCalledTimes(1));
    expect(createRule).not.toHaveBeenCalled();
  });

  it('should render the mutation error rather than swallowing it', async () => {
    const user = userEvent.setup();
    const dryRunRule = vi.fn().mockRejectedValue(new Error('boom'));
    renderComposer({ salesDocumentRules: { dryRunRule } });
    const root = await dialog();

    await pickAConnection(root, user);
    await user.click(within(root).getByTestId('rule-test-sample-order'));
    const panel = within(root).getByTestId('rule-test-sample-order-panel');
    await user.type(within(panel).getByLabelText('Sample order total amount'), '10');
    await user.type(within(panel).getByLabelText('Sample order currency'), 'EUR');
    await user.click(within(panel).getByTestId('rule-run-sample-order-test'));

    expect(await within(root).findByTestId('rule-test-sample-order-error')).toHaveTextContent('boom');
  });
});
