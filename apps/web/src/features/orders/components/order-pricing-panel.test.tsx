import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrderPricingPanel } from './order-pricing-panel';

describe('OrderPricingPanel', () => {
  it('labels tax-exclusive totals as net and explains source-authoritative pricing', () => {
    render(
      <OrderPricingPanel
        items={[]}
        totals={{ subtotal: 10, tax: 2, shipping: 0, total: 12, currency: 'PLN', taxTreatment: 'exclusive' }}
      />,
    );
    expect(screen.getByText(/net · source-authoritative/i)).toBeInTheDocument();
    expect(screen.getByText(/buyer-paid \(net\) price/i)).toBeInTheDocument();
  });

  it('omits the treatment badge and note when taxTreatment is absent', () => {
    render(
      <OrderPricingPanel
        items={[]}
        totals={{ subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' }}
      />,
    );
    expect(screen.queryByText(/source-authoritative/i)).toBeNull();
  });
});
