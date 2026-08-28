/**
 * Needs-attention section — component tests.
 *
 * The #2356 acceptance criteria that live on this component: the zero-state, a
 * counted state, an unknown value, and the A2-`none` regression.
 *
 * Fixtures are built from the REAL `AuthorityAttention` envelope (`counted` /
 * `routine` / `affectedOrderCount`), never an invented shape — a fixture that
 * asserts its own invention is how #2355's ambiguity panel shipped naming
 * nobody.
 *
 * @module apps/web/src/features/fulfillment-authority/components
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AttentionSection } from './attention-section';
import { ATTENTION_SECTION_COPY, ATTENTION_UNKNOWN_COPY, attentionTitle } from '../lib/attention-reason.copy';
import type { AuthorityAttention, AuthorityAttentionItem } from '../api/who-decides.types';

function renderSection(attention: AuthorityAttention): void {
  render(
    <MemoryRouter>
      <AttentionSection attention={attention} nameFor={(id) => `Name for ${id}`} />
    </MemoryRouter>
  );
}

function item(overrides: Partial<AuthorityAttentionItem> = {}): AuthorityAttentionItem {
  return {
    reason: 'availability-unknown',
    badge: 'stopped',
    surfaces: ['product', 'connection'],
    origin: 'authority-resolution',
    question: 'availability',
    connectionIds: ['conn-aaa', 'conn-bbb'],
    ...overrides,
  };
}

describe('AttentionSection', () => {
  it('should show a zero count and the reassuring line on a zero-config install', () => {
    // The A2-`none` regression (#2356). A single-location install answers A2
    // with `nobody-to-route`, which `deriveAuthorityState` reports as `default`
    // and NOT `ambiguous` — so it never enters `counted` at all. The count is
    // therefore zero by construction, not by a suppression rule, and this test
    // pins that construction.
    renderSection({ counted: [], routine: [], affectedOrderCount: 0 });

    expect(screen.getByRole('heading', { name: `${ATTENTION_SECTION_COPY.heading} (0)` })).toBeInTheDocument();
    expect(screen.getByText(ATTENTION_SECTION_COPY.empty)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('should render a counted state with the byte-identical title and name its connections', () => {
    renderSection({ counted: [item()], routine: [], affectedOrderCount: 3 });

    // Byte-identical to what `OmsAttentionBadges` renders for the same reason —
    // both go through `attentionTitle`, which is the whole point of § 4.
    expect(screen.getByText(attentionTitle('availability-unknown'))).toBeInTheDocument();
    // 1 state + 3 orders. Both parts are named, never summed silently.
    expect(screen.getByRole('heading', { name: `${ATTENTION_SECTION_COPY.heading} (4)` })).toBeInTheDocument();
    expect(screen.getByText(/Decisions not being made: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Orders affected: 3/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Name for conn-aaa' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Name for conn-bbb' })).toBeInTheDocument();
  });

  it('should render an unknown reason neutrally and not count it', () => {
    renderSection({
      counted: [item({ reason: 'written-by-a-newer-release', connectionIds: [] })],
      routine: [],
      affectedOrderCount: 0,
    });

    expect(screen.getByText(ATTENTION_UNKNOWN_COPY.title)).toBeInTheDocument();
    // Rendered, so the operator learns OpenLinker stopped — and uncounted.
    expect(screen.getByRole('heading', { name: `${ATTENTION_SECTION_COPY.heading} (0)` })).toBeInTheDocument();
    // The raw value survives so it can be quoted in a support ticket.
    expect(screen.getByText('written-by-a-newer-release')).toBeInTheDocument();
  });

  it('should render counted states in the declared vocabulary order, not the response order', () => {
    renderSection({
      // `restock-blocked` is 7th and `sourcing-ambiguous` 2nd in the declared
      // array; sent in reverse to prove the component does not trust the wire.
      counted: [
        item({ reason: 'restock-blocked', question: 'returns-disposition', connectionIds: [] }),
        item({ reason: 'sourcing-ambiguous', question: 'sourcing', connectionIds: [] }),
      ],
      routine: [],
      affectedOrderCount: 0,
    });

    const titles = screen.getAllByText(
      new RegExp(`${attentionTitle('sourcing-ambiguous')}|${attentionTitle('restock-blocked')}`)
    );
    expect(titles[0]).toHaveTextContent(attentionTitle('sourcing-ambiguous'));
  });
});
