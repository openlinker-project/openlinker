import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrderLineMatchBanner } from './order-line-match-banner';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { ReturnLine } from '../api/returns.types';

const line = (resolvedOrderLineId: string | null): ReturnLine =>
  ({ id: 'line-1', resolvedOrderLineId } as unknown as ReturnLine);

const suggestion = {
  candidates: [
    { id: 'l1', price: 100, quantity: 1, sku: 'KUB' },
    { id: 'l2', price: 80, quantity: 1, sku: 'KUB' },
  ],
  suggestedOrderLineId: 'l2',
  basis: 'price-match',
  alreadyResolvedOrderLineId: null,
};

function renderBanner(resolved: string | null, data: unknown) {
  const getOrderLineSuggestion = vi.fn().mockResolvedValue(data);
  const confirmOrderLine = vi.fn().mockResolvedValue({ claimed: true });
  renderWithProviders(
    <OrderLineMatchBanner canWrite currency="PLN" line={line(resolved)} returnId="ret-1" />,
    { apiClient: createMockApiClient({ returns: { getOrderLineSuggestion, confirmOrderLine } }) }
  );
  return { getOrderLineSuggestion, confirmOrderLine };
}

describe('OrderLineMatchBanner', () => {
  it('should suggest a line but confirm nothing until the operator presses Confirm', async () => {
    const { confirmOrderLine } = renderBanner(null, suggestion);

    const select = await screen.findByTestId('return-component-match-select');
    expect(select).toHaveValue('l2');
    expect(confirmOrderLine).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('return-component-match-confirm'));
    await waitFor(() => expect(confirmOrderLine).toHaveBeenCalledWith('ret-1', 'line-1', 'l2'));
  });

  it('should confirm the line the operator picked, not the suggestion', async () => {
    const { confirmOrderLine } = renderBanner(null, suggestion);

    await userEvent.selectOptions(await screen.findByTestId('return-component-match-select'), 'l1');
    await userEvent.click(screen.getByTestId('return-component-match-confirm'));

    await waitFor(() => expect(confirmOrderLine).toHaveBeenCalledWith('ret-1', 'line-1', 'l1'));
  });

  it('should render nothing when the offer is on a single order line', async () => {
    const { getOrderLineSuggestion } = renderBanner(null, {
      ...suggestion,
      candidates: [suggestion.candidates[0]],
    });

    await waitFor(() => expect(getOrderLineSuggestion).toHaveBeenCalled());
    expect(screen.queryByTestId('return-component-match-banner')).toBeNull();
  });

  it('should not even ask for a line that is already resolved', async () => {
    const { getOrderLineSuggestion } = renderBanner('l1', suggestion);

    expect(screen.queryByTestId('return-component-match-banner')).toBeNull();
    expect(getOrderLineSuggestion).not.toHaveBeenCalled();
  });
});
