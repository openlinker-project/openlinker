/**
 * OMS attention badges — component tests.
 *
 * @module apps/web/src/features/fulfillment-authority/components
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OmsAttentionBadges } from './oms-attention-badges';
import {
  ATTENTION_BADGE_COPY,
  ATTENTION_UNKNOWN_COPY,
  attentionTitle,
} from '../lib/attention-reason.copy';

describe('OmsAttentionBadges', () => {
  it('should render nothing for a row with no inert state', () => {
    const { container } = render(<OmsAttentionBadges entries={[]} />);
    // Not a dash, not an "OK" pill — a healthy row shows nothing at all, which
    // is the only branch that runs on every install today (#2352 shipped the
    // columns undriven).
    expect(container).toBeEmptyDOMElement();
  });

  it('should render the short badge label and carry the full sentence', () => {
    render(<OmsAttentionBadges entries={[{ reason: 'reservation-shortfall', since: '2026-08-01T00:00:00Z' }]} />);

    expect(screen.getByText(ATTENTION_BADGE_COPY['at-risk'])).toBeInTheDocument();
    // Byte-identical to the section's title for the same reason.
    const expected = attentionTitle('reservation-shortfall');
    expect(screen.getByText(`— ${expected}`)).toBeInTheDocument();
  });

  it('should render an unrecognised reason under its own neutral label', () => {
    render(<OmsAttentionBadges entries={[{ reason: 'from-the-future' }]} />);

    expect(screen.getByText(ATTENTION_UNKNOWN_COPY.badgeLabel)).toBeInTheDocument();
    // Never borrows one of the four codes — each is a positive claim about what
    // went wrong, and this build does not know.
    expect(screen.queryByText(ATTENTION_BADGE_COPY.stopped)).not.toBeInTheDocument();
  });

  it('should render one badge per producer entry', () => {
    render(
      <OmsAttentionBadges
        entries={[{ reason: 'line-unfulfillable' }, { reason: 'restock-blocked' }]}
      />
    );
    expect(screen.getByText(ATTENTION_BADGE_COPY['at-risk'])).toBeInTheDocument();
    expect(screen.getByText(ATTENTION_BADGE_COPY.blocked)).toBeInTheDocument();
  });
});
