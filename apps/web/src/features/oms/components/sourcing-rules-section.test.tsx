/**
 * Sourcing-rules section (#3061)
 *
 * The property worth holding is that loading, a FAILED read and a confirmed
 * empty ruleset are three distinguishable claims. Rendering "nothing decides
 * where your orders ship from" while a read is in flight, or after one failed,
 * would state something about the operator's configuration on the strength of
 * a network problem.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import type { SourcingRule } from '../api/sourcing-rules.types';
import { SourcingRulesSection } from './sourcing-rules-section';

const NOW = new Date('2026-09-14T12:00:00.000Z');
const CONNECTION_ID = 'conn_1';

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

function renderSection(sourcingRules: Record<string, unknown>): void {
  renderWithProviders(
    <SourcingRulesSection connectionId={CONNECTION_ID} locations={[]} now={NOW} />,
    { apiClient: createMockApiClient({ sourcingRules: sourcingRules as never }) }
  );
}

describe('SourcingRulesSection (#3061)', () => {
  it('shows a loading state while the read is in flight, and no empty claim', () => {
    renderSection({ list: vi.fn().mockReturnValue(new Promise(() => undefined)) });

    expect(screen.getByText('Loading sourcing rules')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing decides where an order ships from/)).toBeNull();
  });

  it('shows an error state with a retry, and no empty claim', async () => {
    const list = vi.fn().mockRejectedValue(new ApiError('boom', 503, {}));
    renderSection({ list });

    expect(await screen.findByText('Could not load sourcing rules')).toBeInTheDocument();
    // A failed read is the one failure most easily mistaken for a lost config.
    expect(screen.getByText(/Nothing has changed/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing decides where an order ships from/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('claims emptiness only on a SUCCESSFUL empty read', async () => {
    renderSection({ list: vi.fn().mockResolvedValue([]) });

    expect(
      await screen.findByText('Nothing decides where an order ships from yet')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeInTheDocument();
  });

  it('renders the table once rules load', async () => {
    renderSection({ list: vi.fn().mockResolvedValue([rule()]) });

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByText('Nothing decides where an order ships from yet')).toBeNull();
  });

  it('explains an unrecognised rule instead of opening the form, and offers delete', async () => {
    renderSection({ list: vi.fn().mockResolvedValue([rule({ recognised: false, name: 'invented-later' })]) });

    await screen.findByRole('table');
    await userEvent.click(
      screen.getByRole('button', { name: 'Why this rule cannot be edited' })
    );

    const locked = await screen.findByRole('dialog');
    expect(within(locked).getByText(/does not recognise this rule/)).toBeInTheDocument();
    // The stored vocabulary is quoted verbatim so it can be reported. Scoped to
    // the dialog: the row behind it renders the same raw value, because the
    // copy map falls back to it rather than inventing a label.
    expect(within(locked).getByText('filter · invented-later')).toBeInTheDocument();

    await userEvent.click(within(locked).getByRole('button', { name: 'Delete rule' }));
    expect(await screen.findByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('sends the full live id list when a row is reordered', async () => {
    const reorder = vi.fn().mockResolvedValue([]);
    renderSection({
      list: vi.fn().mockResolvedValue([rule({ id: 'a' }), rule({ id: 'b', name: 'country-served' })]),
      reorder,
    });

    await screen.findByRole('table');
    const rows = document.querySelectorAll('[data-rule-id]');
    const second = rows[1] as HTMLElement;
    await userEvent.click(
      within(second).getByRole('button', { name: 'Move up' })
    );

    await waitFor(() => {
      expect(reorder).toHaveBeenCalledWith(CONNECTION_ID, { ruleIds: ['b', 'a'] });
    });
  });

  it('surfaces a reorder conflict rather than letting a row snap back unexplained', async () => {
    const reorder = vi
      .fn()
      .mockRejectedValue(new ApiError('the list did not name the active rules', 409, {}));
    renderSection({
      list: vi.fn().mockResolvedValue([rule({ id: 'a' }), rule({ id: 'b', name: 'country-served' })]),
      reorder,
    });

    await screen.findByRole('table');
    const rows = document.querySelectorAll('[data-rule-id]');
    await userEvent.click(
      within(rows[1] as HTMLElement).getByRole('button', { name: 'Move up' })
    );

    expect(await screen.findByText(/Could not save the new order/)).toBeInTheDocument();
    expect(screen.getByText(/The list has been refreshed/)).toBeInTheDocument();

    // Dismissed by hand, never on the next settled read: a 409 invalidates the
    // list, so an auto-clear would pull the explanation away about as fast as
    // the refreshed rows arrive.
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => {
      expect(screen.queryByText(/Could not save the new order/)).toBeNull();
    });
  });

  it('replaces the error card with the loading one while a retry is in flight', async () => {
    // A retry must not leave the operator looking at an unchanged card with a
    // button that appears dead. It does not, because `refetch()` puts the query
    // back to `pending` and the loading branch is read FIRST — which is a
    // property of the branch ORDER, so it is pinned here rather than assumed.
    let settleSecond: (() => void) | undefined;
    const list = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('boom', 503, {}))
      .mockImplementationOnce(
        (): Promise<SourcingRule[]> =>
          new Promise<SourcingRule[]>((resolve) => {
            settleSecond = (): void => resolve([]);
          })
      );
    renderSection({ list });

    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Loading sourcing rules')).toBeInTheDocument();
    expect(screen.queryByText('Could not load sourcing rules')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    // And still no claim about the operator's configuration mid-retry.
    expect(screen.queryByText(/Nothing decides where an order ships from/)).toBeNull();

    settleSecond?.();
    expect(
      await screen.findByText('Nothing decides where an order ships from yet')
    ).toBeInTheDocument();
  });
});
