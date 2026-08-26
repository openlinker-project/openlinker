/**
 * `OrderHoldBadge` unit tests (#2342).
 *
 * The badge is ONE component used by the desktop row and the mobile card, so
 * the acceptance criterion "renders identically from one renderer" is a
 * property of this file: whatever is asserted here is what both surfaces show.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OrderHoldBadge } from './order-hold-badge';
import { HOLD_REASON_COPY, HoldReasonValues } from '../lib/order-hold.types';

afterEach(cleanup);

describe('OrderHoldBadge (#2342)', () => {
  it('should render the reason label for every declared reason', () => {
    for (const reason of HoldReasonValues) {
      const { unmount } = render(<OrderHoldBadge reason={reason} />);
      expect(screen.getByText(`On hold — ${HOLD_REASON_COPY[reason].label}`)).toBeInTheDocument();
      unmount();
    }
  });

  it('should carry the hint as a title AND for a screen reader', () => {
    const { container } = render(<OrderHoldBadge reason="stock-shortfall" />);
    const wrapper = container.querySelector('.order-hold-badge');
    // WHY an order is held is the load-bearing half of this badge, so it is not
    // a hover-only nicety.
    expect(wrapper).toHaveAttribute('title', HOLD_REASON_COPY['stock-shortfall'].hint);
    expect(container.querySelector('.sr-only')?.textContent).toContain(
      HOLD_REASON_COPY['stock-shortfall'].hint,
    );
  });

  it('should render nothing when the order is not held', () => {
    const { container } = render(<OrderHoldBadge reason={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('should render nothing for a payload that carries no reason at all', () => {
    // A row from an API predating #2340.
    const { container } = render(<OrderHoldBadge reason={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('should render nothing for a reason this build does not recognise', () => {
    // A reason it cannot label is one it cannot label honestly — the
    // `OrderPhaseBadge` contract.
    const { container } = render(<OrderHoldBadge reason="reason-from-a-newer-build" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('should apply the compact treatment for a table row / card badge row', () => {
    const { container } = render(<OrderHoldBadge reason="operator" compact />);
    expect(container.querySelector('.status-badge--compact')).not.toBeNull();
  });
});
