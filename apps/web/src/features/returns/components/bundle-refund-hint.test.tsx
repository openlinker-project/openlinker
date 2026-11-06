import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BundleRefundHint } from './bundle-refund-hint';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';

function renderHint(data: unknown) {
  const onUse = vi.fn();
  const getBundleRefundHint = vi.fn().mockResolvedValue(data);
  renderWithProviders(<BundleRefundHint currency="PLN" onUse={onUse} returnId="ret-1" />, {
    apiClient: createMockApiClient({ returns: { getBundleRefundHint } }),
  });
  return { onUse, getBundleRefundHint };
}

describe('BundleRefundHint', () => {
  it('should show the formula figure but apply nothing until Use is pressed', async () => {
    const { onUse } = renderHint({
      applicable: true,
      hintGross: 25,
      paidForSetGross: 64.99,
      keptStandaloneGross: 39.99,
    });

    expect(await screen.findByTestId('return-component-allegro-amount')).toHaveTextContent('25');
    expect(onUse).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('return-component-allegro-use'));
    expect(onUse).toHaveBeenCalledWith('25.00');
  });

  it('should render nothing when no bundle came back in parts', async () => {
    const { getBundleRefundHint } = renderHint({
      applicable: false,
      hintGross: null,
      paidForSetGross: null,
      keptStandaloneGross: null,
    });

    await waitFor(() => expect(getBundleRefundHint).toHaveBeenCalled());
    expect(screen.queryByTestId('return-component-allegro-hint')).toBeNull();
  });

  it('should say the formula cannot be calculated instead of showing a guessed figure', async () => {
    renderHint({ applicable: true, hintGross: null, paidForSetGross: null, keptStandaloneGross: null });

    expect(await screen.findByTestId('return-component-allegro-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('return-component-allegro-use')).toBeNull();
  });

  it('should offer a zero hint like any other figure', async () => {
    const { onUse } = renderHint({
      applicable: true,
      hintGross: 0,
      paidForSetGross: 10,
      keptStandaloneGross: 30,
    });

    await userEvent.click(await screen.findByTestId('return-component-allegro-use'));
    expect(onUse).toHaveBeenCalledWith('0.00');
  });
});
