/**
 * Sourcing-rule dialog (#3058)
 *
 * The assertions that carry weight are the ones about what the form will NOT
 * let an operator do: change a rule's kind while editing, claim a name a live
 * sibling holds, or widen the ruleset's splitting limit without saying so.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import type { SourcingRule } from '../api/sourcing-rules.types';
import { SourcingRuleDialog, type SourcingRuleLocationOption } from './sourcing-rule-dialog';

const NOW = new Date('2026-09-14T12:00:00.000Z');
const CONNECTION_ID = 'conn_1';

const LOCATIONS: SourcingRuleLocationOption[] = [
  { id: 'loc_a', code: 'MAIN', name: 'Main warehouse', isActive: true },
  { id: 'loc_b', code: 'SOUTH', name: 'Southern depot', isActive: false },
];

function rule(overrides: Partial<SourcingRule> = {}): SourcingRule {
  return {
    id: 'rule_1',
    connectionId: CONNECTION_ID,
    position: 1,
    kind: 'filter',
    name: 'in-stock',
    afterAction: 'quantity-split',
    priorityLocationIds: [],
    effectiveFrom: null,
    effectiveTo: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    recognised: true,
    ...overrides,
  };
}

function renderDialog(
  props: Partial<Parameters<typeof SourcingRuleDialog>[0]> = {},
  sourcingRules: Record<string, unknown> = {}
): void {
  renderWithProviders(
    <SourcingRuleDialog
      open
      onOpenChange={vi.fn()}
      connectionId={CONNECTION_ID}
      rules={[]}
      locations={LOCATIONS}
      now={NOW}
      {...props}
    />,
    { apiClient: createMockApiClient({ sourcingRules: sourcingRules as never }) }
  );
}

describe('SourcingRuleDialog (#3058)', () => {
  it('offers only the selected kind’s names', async () => {
    renderDialog();

    const names = screen.getByLabelText<HTMLSelectElement>('Rule');
    const filterNames = [...names.options].map((option) => option.value);
    expect(filterNames).toContain('in-stock');
    expect(filterNames).not.toContain('nearest');

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'sort');

    const sortNames = [...screen.getByLabelText<HTMLSelectElement>('Rule').options].map(
      (option) => option.value
    );
    expect(sortNames).toContain('nearest');
    expect(sortNames).not.toContain('in-stock');
  });

  it('resets the name when the kind changes, so no unevaluable pair is submitted', async () => {
    renderDialog();

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'sort');

    // A stale filter name under `kind: sort` is a pair the server refuses.
    expect(screen.getByLabelText<HTMLSelectElement>('Rule').value).toBe('priority');
  });

  it('LOCKS the kind while editing, and says why', () => {
    // UpdateSourcingRuleDto carries no `kind`, so an editable control would
    // offer a change the PATCH cannot make.
    renderDialog({ rule: rule(), rules: [rule()] });

    expect(screen.getByLabelText('Type')).toBeDisabled();
    expect(screen.getByText(/Cannot be changed/)).toBeInTheDocument();
  });

  it('offers a name a live sibling already claims as DISABLED, naming the rule', async () => {
    // Only one rule per (kind, name) may be live; the API answers 409. Removing
    // the option would leave the operator hunting for a capability that exists.
    renderDialog({ rules: [rule({ id: 'rule_live', kind: 'filter', name: 'country-served' })] });

    const claimed = within(screen.getByLabelText('Rule')).getByRole('option', {
      name: /already active as rule 1/,
    });
    expect(claimed).toBeDisabled();
  });

  it('treats a SCHEDULED sibling as holding the slot', () => {
    // "Live" is the backend's not-retired predicate, which includes scheduled.
    renderDialog({
      rules: [
        rule({
          id: 'rule_scheduled',
          name: 'country-served',
          effectiveFrom: '2026-12-01T00:00:00.000Z',
        }),
      ],
    });

    expect(
      within(screen.getByLabelText('Rule')).getByRole('option', { name: /already active/ })
    ).toBeDisabled();
  });

  it('does NOT treat a retired sibling as holding the slot', () => {
    renderDialog({
      rules: [
        rule({ id: 'rule_retired', name: 'country-served', effectiveTo: '2026-01-01T00:00:00.000Z' }),
      ],
    });

    expect(
      within(screen.getByLabelText('Rule')).queryByRole('option', { name: /already active/ })
    ).toBeNull();
  });

  it('shows the priority list only for the priority sort', async () => {
    renderDialog();

    expect(screen.queryByLabelText(/Location order/)).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'sort');
    await userEvent.selectOptions(screen.getByLabelText('Rule'), 'priority');

    expect(screen.getByText(/Location order/)).toBeInTheDocument();
  });

  it('saves without confirmation when the change does not loosen splitting', async () => {
    const create = vi.fn().mockResolvedValue(rule());
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange, rules: [] }, { create });

    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(1);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(create).toHaveBeenCalledWith(
      CONNECTION_ID,
      expect.objectContaining({ kind: 'filter', name: 'in-stock', position: 1 })
    );
  });

  it('CONFIRMS before a change that would allow more splitting than today', async () => {
    // Only an EDIT of the governing rule can loosen the ceiling: adding a
    // permissive rule beside a strict one changes nothing, because the
    // strictest rung still governs. Creating against a strict sibling would
    // therefore be a test that can never see the state it names.
    const update = vi.fn().mockResolvedValue(rule());
    const governing = rule({ id: 'rule_strict', afterAction: 'no-split' });
    renderDialog({ rule: governing, rules: [governing] }, { update });

    await userEvent.selectOptions(screen.getByLabelText('Splitting'), 'quantity-split');
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));

    const confirm = await screen.findByRole('dialog', {
      name: 'Allow more splitting than today?',
    });
    expect(update).not.toHaveBeenCalled();

    await userEvent.click(within(confirm).getByRole('button', { name: 'Save anyway' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(1);
    });
  });

  it('does not save when the loosening confirmation is cancelled', async () => {
    const update = vi.fn().mockResolvedValue(rule());
    const governing = rule({ id: 'rule_strict', afterAction: 'no-split' });
    renderDialog({ rule: governing, rules: [governing] }, { update });

    await userEvent.selectOptions(screen.getByLabelText('Splitting'), 'quantity-split');
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));

    // Scoped to the confirm: the form behind it has its own Cancel.
    const confirm = await screen.findByRole('dialog', {
      name: 'Allow more splitting than today?',
    });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));

    expect(update).not.toHaveBeenCalled();
  });

  it('does NOT confirm when the change makes splitting stricter', async () => {
    const create = vi.fn().mockResolvedValue(rule());
    renderDialog({ rules: [] }, { create });

    await userEvent.selectOptions(screen.getByLabelText('Splitting'), 'no-split');
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));

    // An extra click on a safe direction trains people to click through the
    // unsafe one.
    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('Allow more splitting than today?')).toBeNull();
  });

  it('refuses an end date that is not after the start, before any request', async () => {
    const create = vi.fn().mockResolvedValue(rule());
    renderDialog({}, { create });

    await userEvent.type(screen.getByLabelText(/Starts on/), '2026-09-10');
    await userEvent.type(screen.getByLabelText(/Ends on/), '2026-09-01');
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));

    expect(await screen.findByText(/end date must be after the start date/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('surfaces a server refusal verbatim', async () => {
    // The API's 400s name the actual problem; a generic sentence throws it away.
    const create = vi
      .fn()
      .mockRejectedValue(new ApiError('an unknown location id was supplied', 400, {}));
    renderDialog({}, { create });

    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));

    expect(await screen.findByText('an unknown location id was supplied')).toBeInTheDocument();
  });

  it('patches without a kind when editing', async () => {
    const update = vi.fn().mockResolvedValue(rule());
    const existing = rule({ afterAction: 'line-split' });
    renderDialog({ rule: existing, rules: [existing] }, { update });

    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(1);
    });
    const [, , body] = update.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(body).not.toHaveProperty('kind');
    expect(body).not.toHaveProperty('position');
  });
});
