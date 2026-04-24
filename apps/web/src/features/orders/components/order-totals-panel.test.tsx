import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OrderTotalsPanel } from './order-totals-panel';
import type { ParsedOrderTotals } from '../api/order-snapshot.schema';

const fullTotals: ParsedOrderTotals = {
  subtotal: 39.98,
  tax: 9.2,
  shipping: 5,
  total: 54.18,
  currency: 'PLN',
};

describe('OrderTotalsPanel', () => {
  afterEach(cleanup);

  it('renders subtotal, shipping, tax, and a grand-total row marked as total', () => {
    render(<OrderTotalsPanel totals={fullTotals} />);

    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    expect(screen.getByText('Shipping')).toBeInTheDocument();
    expect(screen.getByText('Tax')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();

    const totalRow = screen.getByText('Total').closest('.order-totals__row');
    expect(totalRow).toHaveClass('order-totals__row--total');
  });

  it('omits shipping and tax rows when their value is zero', () => {
    render(
      <OrderTotalsPanel
        totals={{ subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' }}
      />,
    );

    expect(screen.queryByText('Shipping')).toBeNull();
    expect(screen.queryByText('Tax')).toBeNull();
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('falls back to bare numeric formatting when currency is an empty string', () => {
    // Schema requires currency as string, so we use '' to simulate missing
    // formatting info without widening the type.
    render(
      <OrderTotalsPanel
        totals={{ subtotal: 10, tax: 0, shipping: 0, total: 10, currency: '' }}
      />,
    );

    // No currency symbols rendered
    expect(screen.queryByText(/PLN/)).toBeNull();
    expect(screen.queryByText(/\$/)).toBeNull();
    expect(screen.queryByText(/€/)).toBeNull();
    // Still renders the numeric value with fixed fraction digits
    expect(screen.getAllByText('10.00').length).toBeGreaterThanOrEqual(1);
  });
});
