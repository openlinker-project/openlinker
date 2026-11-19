/**
 * `OrderRefundStateBadge` unit tests (#4130).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OrderRefundStateBadge } from './order-refund-state-badge';

afterEach(cleanup);

describe('OrderRefundStateBadge (#4130)', () => {
  it('should render the partially refunded label for a partial refund', () => {
    render(
      <OrderRefundStateBadge
        refundState={{ state: 'partial', refundedAmount: '317.22', currency: 'PLN' }}
      />
    );
    expect(screen.getByText('Partially refunded')).toBeInTheDocument();
  });

  it('should render the refunded label for a full refund', () => {
    render(
      <OrderRefundStateBadge
        refundState={{ state: 'full', refundedAmount: '623.49', currency: 'PLN' }}
      />
    );
    expect(screen.getByText('Refunded')).toBeInTheDocument();
  });

  it('should render nothing when the state is unknown or absent', () => {
    const { container, rerender } = render(<OrderRefundStateBadge refundState={undefined} />);
    expect(container).toBeEmptyDOMElement();
    rerender(
      <OrderRefundStateBadge
        refundState={{ state: 'unknown', refundedAmount: null, currency: null }}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
