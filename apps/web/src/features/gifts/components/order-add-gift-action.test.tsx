/**
 * OrderAddGiftAction tests (#3940, mockup M31 `order-gift-readonly-notice`)
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import { OrderAddGiftAction } from './order-add-gift-action';

afterEach(cleanup);

function mount(permissions: string[]): void {
  renderWithProviders(
    <OrderAddGiftAction
      internalOrderId="o1"
      orderLabel="A1"
      terminal={false}
      parcelClosed={false}
      hasSalesDocument={false}
    />,
    {
      apiClient: createMockApiClient(),
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'u',
        username: 'v',
        email: 'v@example.com',
        role: 'viewer',
        permissions: permissions as never,
        analyticsConsent: true,
      }),
    },
  );
}

describe('OrderAddGiftAction', () => {
  it('should say the button is switched off for a role that cannot add a gift', async () => {
    mount(['orders:read' as never]);

    expect(await screen.findByTestId('order-gift-readonly-notice')).toHaveTextContent('switched off');
    expect(screen.getByTestId('order-gift-add')).toBeDisabled();
  });

  it('should show no notice to a role that can', async () => {
    mount(['gifts:write']);

    await waitFor(() => expect(screen.getByTestId('order-gift-add')).toBeEnabled());
    expect(screen.queryByTestId('order-gift-readonly-notice')).not.toBeInTheDocument();
  });
});
