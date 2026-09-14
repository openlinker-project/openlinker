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
      rules={[target]}
      now={NOW}
      {...props}
      rule={target}
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

    expect(screen.getByText(/removes your only limit on splitting/)).toBeInTheDocument();
  });

  it('does not warn when another active rule keeps the same limit', () => {
    const governing = rule({ id: 'rule_a', afterAction: 'no-split' });
    const sibling = rule({ id: 'rule_b', name: 'nearest', afterAction: 'no-split' });
    renderDialog({ rule: governing, rules: [governing, sibling] });

    expect(screen.queryByText(/removes your only limit on splitting/)).toBeNull();
  });

  it('surfaces a delete refusal verbatim and stays open', async () => {
    const remove = vi.fn().mockRejectedValue(new ApiError('rule not found on this connection', 404, {}));
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange }, { remove });

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('This sourcing rule no longer exists.')).toBeInTheDocument();
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
