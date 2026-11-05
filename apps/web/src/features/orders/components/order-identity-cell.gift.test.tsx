/**
 * OrderIdentityCell gift mark tests (#3940, mockup M31 `orders/with-gift`)
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { OrderIdentityCell } from './order-identity-cell';

afterEach(cleanup);

describe('OrderIdentityCell gift mark', () => {
  it('should show a gift icon beside the product name when the order carries a gift', () => {
    renderWithProviders(<OrderIdentityCell orderId="ol_order_1" orderNumber="A-1" firstItemName="Coffee" hasGift />);

    expect(screen.getByTestId('orders-gift-row-icon-ol_order_1')).toHaveAccessibleName('Includes a gift');
  });

  it('should show no icon on an ordinary order', () => {
    renderWithProviders(<OrderIdentityCell orderId="ol_order_1" orderNumber="A-1" firstItemName="Coffee" />);

    expect(screen.queryByTestId('orders-gift-row-icon-ol_order_1')).not.toBeInTheDocument();
  });
});
