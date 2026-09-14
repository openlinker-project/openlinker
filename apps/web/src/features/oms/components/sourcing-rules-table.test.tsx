/**
 * Sourcing-rules table (#3057)
 *
 * The load-bearing assertions are about the REORDER BODY, not about pixels.
 * `PUT /order` is exhaustive and refuses a subset, so a table that emits the
 * wrong set produces a 409 about rules the operator never touched.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SourcingRule } from '../api/sourcing-rules.types';
import { SourcingRulesTable } from './sourcing-rules-table';

const NOW = new Date('2026-09-14T12:00:00.000Z');

function rule(id: string, overrides: Partial<SourcingRule> = {}): SourcingRule {
  return {
    id,
    connectionId: 'conn_1',
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

function rowFor(ruleId: string): HTMLElement {
  const row = document.querySelector(`[data-rule-id="${ruleId}"]`);
  if (row === null) throw new Error(`no row for ${ruleId}`);
  return row as HTMLElement;
}

describe('SourcingRulesTable (#3057)', () => {
  it('renders rows in the order given, without re-sorting', async () => {
    // The API returns position-then-id order, which IS the router's evaluation
    // order. A client-side sort would be a second opinion about it.
    render(
      <SourcingRulesTable
        rules={[rule('c', { position: 3 }), rule('a', { position: 1 })]}
        onReorder={vi.fn()}
        now={NOW}
      />
    );

    const ids = [...document.querySelectorAll('[data-rule-id]')].map((row) =>
      row.getAttribute('data-rule-id')
    );
    expect(ids).toEqual(['c', 'a']);
  });

  it('emits the FULL live id list when a row moves up', async () => {
    const onReorder = vi.fn();
    render(
      <SourcingRulesTable
        rules={[rule('a'), rule('b'), rule('c')]}
        onReorder={onReorder}
        now={NOW}
      />
    );

    await userEvent.click(within(rowFor('b')).getByRole('button', { name: 'Move up' }));

    // Exhaustive, not a delta: a subset is refused and writes nothing.
    expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c']);
  });

  it('emits the full list when a row moves down', async () => {
    const onReorder = vi.fn();
    render(
      <SourcingRulesTable
        rules={[rule('a'), rule('b'), rule('c')]}
        onReorder={onReorder}
        now={NOW}
      />
    );

    await userEvent.click(within(rowFor('a')).getByRole('button', { name: 'Move down' }));

    expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c']);
  });

  it('EXCLUDES a retired row from the reorder body', async () => {
    // A retired rule is on screen only because the caller asked for history;
    // naming it answers 409 unknownRuleIds.
    const onReorder = vi.fn();
    render(
      <SourcingRulesTable
        rules={[
          rule('a'),
          rule('retired', { effectiveTo: '2026-01-01T00:00:00.000Z' }),
          rule('b'),
        ]}
        onReorder={onReorder}
        now={NOW}
      />
    );

    await userEvent.click(within(rowFor('b')).getByRole('button', { name: 'Move up' }));

    expect(onReorder).toHaveBeenCalledWith(['b', 'a']);
  });

  it('disables both arrows on a retired row rather than offering a move it cannot express', () => {
    render(
      <SourcingRulesTable
        rules={[rule('a'), rule('retired', { effectiveTo: '2026-01-01T00:00:00.000Z' })]}
        onReorder={vi.fn()}
        now={NOW}
      />
    );

    const retired = within(rowFor('retired'));
    expect(retired.getByRole('button', { name: 'Move up' })).toBeDisabled();
    expect(retired.getByRole('button', { name: 'Move down' })).toBeDisabled();
  });

  it('keeps the boundary arrows in the DOM, disabled rather than hidden', () => {
    render(<SourcingRulesTable rules={[rule('a'), rule('b')]} onReorder={vi.fn()} now={NOW} />);

    // Present so the control group does not change width and the tab order is
    // stable as rules move.
    expect(within(rowFor('a')).getByRole('button', { name: 'Move up' })).toBeDisabled();
    expect(within(rowFor('b')).getByRole('button', { name: 'Move down' })).toBeDisabled();
  });

  it('renders NO drag handle a user could grab', () => {
    render(<SourcingRulesTable rules={[rule('a')]} onReorder={vi.fn()} now={NOW} />);

    // #3055 § Decisions: arrows only. The glyph is a static indicator, so it
    // must stay out of the accessibility tree and carry no draggable attribute.
    expect(document.querySelector('[draggable="true"]')).toBeNull();
    expect(document.querySelector('.rule-position__handle')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
  });

  it('captions the rule that sets the splitting limit, and only that one', () => {
    render(
      <SourcingRulesTable
        rules={[rule('a', { afterAction: 'quantity-split' }), rule('b', { afterAction: 'no-split' })]}
        onReorder={vi.fn()}
        now={NOW}
      />
    );

    expect(within(rowFor('b')).getByText("Sets today's splitting limit")).toBeInTheDocument();
    expect(within(rowFor('a')).queryByText("Sets today's splitting limit")).toBeNull();
  });

  it('routes edit on an unrecognised rule to the refusal, never to the form', async () => {
    // The API rejects the patch outright. The control stays ENABLED so the
    // explanation and its remedy are reachable — a disabled button cannot be
    // focused in every browser and its title is not reliably announced (#3061).
    const onEdit = vi.fn();
    const onEditRefused = vi.fn();
    render(
      <SourcingRulesTable
        rules={[rule('a', { recognised: false })]}
        onReorder={vi.fn()}
        onEdit={onEdit}
        onEditRefused={onEditRefused}
        now={NOW}
      />
    );

    // The name describes what clicking DOES. A live control announced as
    // "Cannot edit" sends both a sighted and a screen-reader operator past the
    // explanation and its remedy.
    expect(
      screen.queryByRole('button', { name: 'Cannot edit — this rule is no longer recognised' })
    ).toBeNull();
    const edit = screen.getByRole('button', { name: 'Why this rule cannot be edited' });
    expect(edit).toBeEnabled();

    await userEvent.click(edit);
    expect(onEdit).not.toHaveBeenCalled();
    expect(onEditRefused).toHaveBeenCalledTimes(1);
  });

  it('falls back to a disabled edit when no refusal handler is wired', async () => {
    // A caller that has not wired the explanation still must not open the form
    // on a rule the server will refuse.
    const onEdit = vi.fn();
    render(
      <SourcingRulesTable
        rules={[rule('a', { recognised: false })]}
        onReorder={vi.fn()}
        onEdit={onEdit}
        now={NOW}
      />
    );

    // Only the genuinely inert control keeps the refusal as its name.
    const edit = screen.getByRole('button', {
      name: 'Cannot edit — this rule is no longer recognised',
    });
    expect(edit).toBeDisabled();
    await userEvent.click(edit);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('renders the refusal for a caller that wires only the explanation', async () => {
    // An absent control reads as a rendering bug, so a caller with no edit
    // handler at all must still reach the explanation on an unrecognised row.
    const onEditRefused = vi.fn();
    render(
      <SourcingRulesTable
        rules={[rule('a', { recognised: false })]}
        onReorder={vi.fn()}
        onEditRefused={onEditRefused}
        now={NOW}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Why this rule cannot be edited' }));
    expect(onEditRefused).toHaveBeenCalledTimes(1);
  });

  it('offers no edit control on a recognised rule when only the refusal is wired', () => {
    render(
      <SourcingRulesTable
        rules={[rule('a')]}
        onReorder={vi.fn()}
        onEditRefused={vi.fn()}
        now={NOW}
      />
    );

    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Why this rule cannot be edited' })).toBeNull();
  });

  it('still offers delete on an unrecognised rule, which is its only remedy', () => {
    render(
      <SourcingRulesTable
        rules={[rule('a', { recognised: false })]}
        onReorder={vi.fn()}
        onDelete={vi.fn()}
        now={NOW}
      />
    );

    expect(screen.getByRole('button', { name: /^Delete / })).toBeEnabled();
  });

  it('shows a value this build does not recognise, unlabelled, rather than dropping it', () => {
    render(
      <SourcingRulesTable
        rules={[rule('a', { name: 'invented-later', afterAction: 'split-sideways' })]}
        onReorder={vi.fn()}
        now={NOW}
      />
    );

    expect(screen.getByText('invented-later')).toBeInTheDocument();
    expect(screen.getByText('split-sideways')).toBeInTheDocument();
  });

  it('says "Always" for a rule with no window, rather than leaving the cell blank', () => {
    render(<SourcingRulesTable rules={[rule('a')]} onReorder={vi.fn()} now={NOW} />);

    expect(screen.getByText('Always')).toBeInTheDocument();
  });

  it('disables every control while a write is in flight', () => {
    render(
      <SourcingRulesTable
        rules={[rule('a'), rule('b')]}
        onReorder={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        busy
        now={NOW}
      />
    );

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });
});
