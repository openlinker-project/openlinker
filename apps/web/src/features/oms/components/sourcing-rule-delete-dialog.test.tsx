/**
 * Delete / retire confirm (#3059)
 *
 * The assertions that carry weight are about the SECOND action: that the
 * reversible alternative is offered at all, that it patches rather than
 * deletes, and that it disappears with a reason where the API would refuse it.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import type { SourcingRule } from '../api/sourcing-rules.types';
import { SourcingRuleDeleteDialog } from './sourcing-rule-delete-dialog';

const NOW = new Date('2026-09-14T12:00:00.000Z');
const CONNECTION_ID = 'conn_1';

function rule(overrides: Partial<SourcingRule> = {}): SourcingRule {
  return {
    id: 'rule_1',
    connectionId: CONNECTION_ID,
    position: 1,
    kind: 'sort',
    name: 'priority',
    afterAction: 'quantity-split',
    priorityLocationIds: ['loc_a'],
    effectiveFrom: null,
    effectiveTo: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    recognised: true,
    ...overrides,
  };
}

function renderDialog(
  props: Partial<Parameters<typeof SourcingRuleDeleteDialog>[0]> = {},
  sourcingRules: Record<string, unknown> = {}
): void {
  const target = props.rule ?? rule();
  renderWithProviders(
    <SourcingRuleDeleteDialog
      open
      onOpenChange={vi.fn()}
      connectionId={CONNECTION_ID}
      rule={target}
      rules={[target]}
      now={NOW}
      {...props}
    />,
    { apiClient: createMockApiClient({ sourcingRules: sourcingRules as never }) }
  );
}

describe('SourcingRuleDeleteDialog (#3059)', () => {
  it('deletes after confirmation and closes', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange }, { remove });

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith(CONNECTION_ID, 'rule_1');
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('RETIRES by patching effectiveTo, and never deletes', async () => {
    // The row must survive with its history — that is what the partial
    // duplicate-detection index exists to allow.
    const update = vi.fn().mockResolvedValue(rule());
    const remove = vi.fn();
    renderDialog({}, { update, remove });

    await userEvent.click(screen.getByRole('button', { name: 'Retire instead' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(1);
    });
    expect(remove).not.toHaveBeenCalled();

    const [, ruleId, body] = update.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(ruleId).toBe('rule_1');
    expect(Object.keys(body)).toEqual(['effectiveTo']);
    expect(typeof body['effectiveTo']).toBe('string');
  });

  it('does not offer retire for a rule this build no longer recognises', () => {
    // The API refuses the PATCH outright, so offering it would be a button
    // that answers 400.
    renderDialog({ rule: rule({ recognised: false }) });

    expect(screen.queryByRole('button', { name: 'Retire instead' })).toBeNull();
    expect(screen.getByText(/no longer recognises it/)).toBeInTheDocument();
  });

  it('does not offer retire for a rule that is already retired', () => {
    renderDialog({ rule: rule({ effectiveTo: '2026-01-01T00:00:00.000Z' }) });

    expect(screen.queryByRole('button', { name: 'Retire instead' })).toBeNull();
    expect(screen.getByText(/already retired/)).toBeInTheDocument();
  });

  it('warns when removing the rule that currently limits splitting', () => {
    // The one deletion whose consequence is invisible from the row.
    const governing = rule({ id: 'rule_strict', afterAction: 'no-split' });
    renderDialog({ rule: governing, rules: [governing] });

    expect(screen.getByText(/lifts your only limit on splitting/)).toBeInTheDocument();
    // Retiring drops the rule out of the same active set deleting it does, so
    // copy naming only Delete would point at the wrong button.
    expect(screen.getByText(/Retiring has the same effect as deleting/)).toBeInTheDocument();
  });

  it('does not warn when another active rule keeps the same limit', () => {
    const governing = rule({ id: 'rule_a', afterAction: 'no-split' });
    const sibling = rule({ id: 'rule_b', name: 'nearest', afterAction: 'no-split' });
    renderDialog({ rule: governing, rules: [governing, sibling] });

    expect(screen.queryByText(/lifts your only limit on splitting/)).toBeNull();
  });

  it('does not offer retire for a rule that has not started yet', () => {
    // `SourcingRuleAdminService.update` validates the MERGED window, so
    // `PATCH { effectiveTo: <now> }` against a future start date is always
    // `to < from` and always answers 400. Offering the button would tell the
    // operator about a start date they never touched in this dialog.
    renderDialog({ rule: rule({ effectiveFrom: '2026-12-01T00:00:00.000Z' }) });

    expect(screen.queryByRole('button', { name: 'Retire instead' })).toBeNull();
    expect(screen.getByText(/has not started yet/)).toBeInTheDocument();
  });

  it('still runs the retire path while the splitting warning is shown', () => {
    // The warning describes a consequence BOTH buttons produce, so it must not
    // suppress the reversible one.
    const governing = rule({ id: 'rule_strict', afterAction: 'no-split' });
    renderDialog({ rule: governing, rules: [governing] });

    expect(screen.getByText(/lifts your only limit on splitting/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retire instead' })).toBeInTheDocument();
  });

  it('splits the footer while Retire is on offer', () => {
    renderDialog();

    const footer = screen.getByRole('button', { name: 'Delete' }).closest('.dialog__footer');
    expect(footer).toHaveClass('dialog__footer--split');
    expect(footer?.children).toHaveLength(2);
  });

  it('drops the split modifier - not a spacer element - when Retire is absent', () => {
    // `space-between` needs two children to mean anything. With Retire gone the
    // footer holds one group and `.dialog__footer`'s own flex-end right-aligns
    // it, so the modifier comes off rather than an empty element being rendered
    // to hold the left slot open.
    renderDialog({ rule: rule({ effectiveTo: '2026-01-01T00:00:00.000Z' }) });

    const footer = screen.getByRole('button', { name: 'Delete' }).closest('.dialog__footer');
    expect(footer).not.toHaveClass('dialog__footer--split');
    expect(footer?.children).toHaveLength(1);
  });

  it('renders the canned sentence for a 404 delete and stays open', async () => {
    const remove = vi.fn().mockRejectedValue(new ApiError('rule not found on this connection', 404, {}));
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange }, { remove });

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    // `describeSourcingRuleError`'s canned 404 sentence, NOT the server's
    // message - the verbatim path is the 400/409 one, asserted below.
    expect(await screen.findByText('This sourcing rule no longer exists.')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('surfaces a 400 retire refusal VERBATIM and stays open', async () => {
    // The client-side guard is not a trust boundary: a rule whose start date
    // moved into the future in another tab still reaches the API, and its 400
    // names the actual problem. A generic sentence would throw that away.
    const update = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          'effectiveTo must be after effectiveFrom - a rule whose window closes before it opens is never evaluated.',
          400,
          {}
        )
      );
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange }, { update });

    await userEvent.click(screen.getByRole('button', { name: 'Retire instead' }));

    expect(
      await screen.findByText(/a rule whose window closes before it opens/)
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('renders nothing without a target rule', () => {
    renderWithProviders(
      <SourcingRuleDeleteDialog
        open
        onOpenChange={vi.fn()}
        connectionId={CONNECTION_ID}
        rules={[]}
        now={NOW}
      />,
      { apiClient: createMockApiClient() }
    );

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
