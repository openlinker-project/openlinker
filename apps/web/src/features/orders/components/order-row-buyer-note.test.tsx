/**
 * `OrderRowBuyerNote` unit tests (#3539): the expansion reads the detail on open.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { OrderRowBuyerNote } from './order-row-buyer-note';

afterEach(cleanup);

describe('OrderRowBuyerNote (#3539)', () => {
  it('should show the whole note from the order detail once the row is expanded', async () => {
    const getById = vi
      .fn()
      .mockResolvedValue({ internalOrderId: 'o1', hasBuyerNote: true, buyerNote: 'Zadzwońcie przed dostawą' });
    renderWithProviders(
      <dl>
        <OrderRowBuyerNote internalOrderId="o1" />
      </dl>,
      { apiClient: createMockApiClient({ orders: { getById } }) },
    );

    expect(await screen.findByTestId('order-row-buyer-note-text')).toHaveTextContent(
      'Zadzwońcie przed dostawą',
    );
    expect(getById).toHaveBeenCalledWith('o1');
  });

  it('should say the note could not be loaded when the detail read fails', async () => {
    const getById = vi.fn().mockRejectedValue(new Error('boom'));
    renderWithProviders(
      <dl>
        <OrderRowBuyerNote internalOrderId="o1" />
      </dl>,
      { apiClient: createMockApiClient({ orders: { getById } }) },
    );

    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
  });
});
