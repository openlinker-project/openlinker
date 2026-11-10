import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReturnGiftsPanel } from './return-gifts-panel';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';

const WRITE = { canWrite: true, demoReadOnly: false, visible: true };

const GIFT = {
  giftLineId: 'g1',
  sku: 'KAW-50-PROB',
  name: 'Coffee sample',
  quantity: 1,
  giftSource: 'ol-rule',
  standalonePriceGross: 9.99,
  decision: null,
  deductionGross: null,
  note: null,
  decidedAt: null,
};

function renderPanel(data: unknown, writeAccess = WRITE) {
  const getReturnGifts = vi.fn().mockResolvedValue(data);
  const decideReturnGift = vi.fn().mockResolvedValue({ ...GIFT, decision: 'keep' });
  renderWithProviders(<ReturnGiftsPanel returnId="ret-1" writeAccess={writeAccess} />, {
    apiClient: createMockApiClient({ returnGifts: { getReturnGifts, decideReturnGift } }),
  });
  return { getReturnGifts, decideReturnGift };
}

describe('ReturnGiftsPanel', () => {
  it('should show an undecided gift and deduct nothing by itself', async () => {
    renderPanel({ gifts: [GIFT], currency: 'PLN', refundDeductionGross: 0 });

    expect(await screen.findByTestId('return-gift-state-g1')).toBeInTheDocument();
    expect(screen.queryByTestId('return-gift-refund-amount')).toBeNull();
  });

  it('should record the operator decision when a choice is picked', async () => {
    const { decideReturnGift } = renderPanel({ gifts: [GIFT], currency: 'PLN', refundDeductionGross: 0 });

    await userEvent.click(await screen.findByTestId('return-gift-choice-keep'));

    await waitFor(() =>
      expect(decideReturnGift).toHaveBeenCalledWith('ret-1', 'g1', { decision: 'keep' })
    );
  });

  it('should only hint at the deduction recorded, never apply it', async () => {
    renderPanel({
      gifts: [{ ...GIFT, decision: 'deduct', deductionGross: 9.99 }],
      currency: 'PLN',
      refundDeductionGross: 9.99,
    });

    expect(await screen.findByTestId('return-gift-refund-amount')).toHaveTextContent('9');
    expect(screen.getByTestId('return-gift-note-deduct')).toBeInTheDocument();
  });

  it('should not offer deduct for a gift with no price', async () => {
    renderPanel({
      gifts: [{ ...GIFT, standalonePriceGross: null }],
      currency: 'PLN',
      refundDeductionGross: 0,
    });

    expect(await screen.findByTestId('return-gift-choice-deduct')).toBeDisabled();
  });

  it('should leave the choices disabled for a read-only session', async () => {
    const { decideReturnGift } = renderPanel(
      { gifts: [GIFT], currency: 'PLN', refundDeductionGross: 0 },
      { canWrite: false, demoReadOnly: false, visible: false }
    );

    const keep = await screen.findByTestId('return-gift-choice-keep');
    expect(keep).toBeDisabled();
    await userEvent.click(keep);
    expect(decideReturnGift).not.toHaveBeenCalled();
  });

  it('should render nothing when the order carries no gift', async () => {
    const { getReturnGifts } = renderPanel({ gifts: [], currency: null, refundDeductionGross: 0 });

    await waitFor(() => expect(getReturnGifts).toHaveBeenCalled());
    expect(screen.queryByTestId('return-gift-lines')).toBeNull();
  });
});
