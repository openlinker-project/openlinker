/**
 * `OrderDestinationRoutingBadge` unit tests (#2703 / #2704).
 *
 * ONE component renders the row on desktop and the card on mobile, so what is
 * asserted here is what both surfaces show.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DestinationRoutingBlockReasonValues } from '../api/orders.types';
import {
  DESTINATION_ROUTING_ATTENTION_REASONS,
  DESTINATION_ROUTING_REASON_COPY,
} from '../lib/destination-routing-copy';
import { OrderDestinationRoutingBadge } from './order-destination-routing-badge';

afterEach(cleanup);

describe('OrderDestinationRoutingBadge (#2703)', () => {
  it('should render the label of every declared reason', () => {
    // The loop iterates the vocabulary the badge reads, so an empty list would
    // pass while asserting nothing - pinning the count makes it a real claim.
    expect(DestinationRoutingBlockReasonValues.length).toBeGreaterThan(0);

    for (const reason of DestinationRoutingBlockReasonValues) {
      const { unmount } = render(<OrderDestinationRoutingBadge reason={reason} />);
      expect(screen.getByText(DESTINATION_ROUTING_REASON_COPY[reason].label)).toBeInTheDocument();
      unmount();
    }
  });

  it('should carry the hint as a title AND for a screen reader', () => {
    const reason = 'routed-destinations-unavailable';
    const { container } = render(<OrderDestinationRoutingBadge reason={reason} />);

    expect(container.querySelector('.order-destination-routing-badge')).toHaveAttribute(
      'title',
      DESTINATION_ROUTING_REASON_COPY[reason].hint
    );
    expect(container.querySelector('.sr-only')?.textContent).toContain(
      DESTINATION_ROUTING_REASON_COPY[reason].hint
    );
  });

  it('should render the router choosing nobody neutrally, and every fault as a warning', () => {
    // The tone is driven by `DESTINATION_ROUTING_ATTENTION_REASONS`, so the
    // vocabulary is what decides "decision" versus "needs a look".
    expect(DESTINATION_ROUTING_ATTENTION_REASONS).not.toContain('routed-to-no-destination');
    expect(DESTINATION_ROUTING_ATTENTION_REASONS.length).toBeGreaterThan(0);

    const neutral = render(<OrderDestinationRoutingBadge reason="routed-to-no-destination" />);
    const neutralClass = neutral.container.querySelector('[class*="status-badge"]')?.className;
    neutral.unmount();

    for (const reason of DESTINATION_ROUTING_ATTENTION_REASONS) {
      const { container, unmount } = render(<OrderDestinationRoutingBadge reason={reason} />);
      const cls = container.querySelector('[class*="status-badge"]')?.className;
      expect(cls).not.toBe(neutralClass);
      unmount();
    }
  });

  it('should render nothing for an absent reason', () => {
    for (const reason of [null, undefined, '']) {
      const { container, unmount } = render(<OrderDestinationRoutingBadge reason={reason} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('should render nothing for a reason this build does not recognise', () => {
    // A value written by a newer release and then rolled back must not become a
    // confident wrong label.
    const { container } = render(<OrderDestinationRoutingBadge reason="from-the-future" />);
    expect(container).toBeEmptyDOMElement();
  });
});
