/**
 * BulkResultRows (#3619)
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { BulkResultRows } from './bulk-result-rows';

describe('BulkResultRows', () => {
  it('should show the whole order id as a wrapping link when a row is refused (B-1)', () => {
    render(
      <MemoryRouter>
        <BulkResultRows
          testId="rows"
          rows={[
            { orderId: 'ol_order_g05b_ui_ship', tone: 'error', label: 'Refused', detail: 'ORDER_ALREADY_SHIPPED' },
          ]}
        />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'ol_order_g05b_ui_ship' });
    expect(link).toHaveClass('bulk-result__ordid');
    expect(screen.getByTestId('orders-bulk-result-row')).toHaveClass('bulk-result__row');
  });
});
