/**
 * OrderGiftAttention tests (#3940, mockup M31 `order/gift-out-of-stock`,
 * `gift-not-added*`, `gift-not-added-shop-rejected`)
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthenticatedSessionAdapter, createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { Permission } from '../../../shared/auth/session.types';
import { OrderGiftAttention } from './order-gift-attention';

function attentionWith(reasonCode: string | null): unknown {
  return {
    recordingAvailable: true,
    items: [
      {
        runId: 'run-1',
        ruleId: 'rule-9',
        ruleName: 'Coffee sample from 150',
        outcome: 'not-applied',
        reasonCode,
        dismissed: false,
        firedAt: '2026-11-02T10:00:00.000Z',
      },
    ],
  };
}

function mount(
  detail: string | null,
  props: { shopRejected?: boolean; onAddGift?: () => void; skip?: ReturnType<typeof vi.fn>; permissions?: Permission[]; failRead?: boolean } = {},
): void {
  const apiClient = createMockApiClient({
    gifts: {
      getGiftAttention: props.failRead
        ? vi.fn().mockRejectedValue(new Error('forbidden'))
        : vi.fn().mockResolvedValue(detail === null ? { items: [], recordingAvailable: true } : attentionWith(detail)),
      skipGiftAttention: props.skip ?? vi.fn().mockResolvedValue({}),
    },
  } as never);
  renderWithProviders(
    <OrderGiftAttention internalOrderId="o1" shopRejected={props.shopRejected ?? false} onAddGift={props.onAddGift} />,
    {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'u',
        username: 'admin',
        email: 'a@example.com',
        role: 'admin',
        permissions: props.permissions ?? ['gifts:write'],
        analyticsConsent: true,
      }),
    },
  );
}

afterEach(cleanup);

describe('OrderGiftAttention', () => {
  it('should offer another gift by hand and the promotion when the gift ran out', async () => {
    const onAddGift = vi.fn();
    mount('gift-out-of-stock', { onAddGift });

    expect(await screen.findByTestId('order-gift-attention-out-of-stock')).toHaveTextContent('Coffee sample from 150');
    fireEvent.click(screen.getByTestId('order-gift-choice-substitute'));
    expect(onAddGift).toHaveBeenCalled();
    expect(screen.getByTestId('order-gift-open-rule')).toHaveAttribute('href', '/promotions/rule-9');
  });

  it('should explain a rule that did what it was set to as a quiet notice, not a warning', async () => {
    mount('below-per-unit-threshold');

    const notice = await screen.findByTestId('order-gift-attention-below-threshold');
    expect(notice.className).toContain('alert--info');
  });

  it('should render nothing when every gift is where it should be', async () => {
    mount(null);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId('order-gift-banner')).not.toBeInTheDocument();
  });

  it('should say the shop refused an order that carries a gift line', async () => {
    mount(null, { shopRejected: true });

    expect(await screen.findByTestId('order-gift-attention-shop-rejected')).toBeInTheDocument();
  });

  it('should record "Send without the gift" against the run so the attention clears', async () => {
    const skip = vi.fn().mockResolvedValue({});
    mount('gift-out-of-stock', { skip });

    fireEvent.click(await screen.findByTestId('order-gift-choice-skip'));

    await waitFor(() => expect(skip).toHaveBeenCalledWith('o1', 'run-1'));
  });

  it('should hide "Send without the gift" from a role that cannot write gifts', async () => {
    mount('gift-out-of-stock', { permissions: [] });

    await screen.findByTestId('order-gift-attention-out-of-stock');
    expect(screen.queryByTestId('order-gift-choice-skip')).not.toBeInTheDocument();
  });

  it('should offer "See the promotion" for a gift that ran out', async () => {
    mount('gift-out-of-stock');

    expect(await screen.findByTestId('order-gift-open-rule')).toHaveTextContent('See the promotion');
  });

  it('should say the reason could not be read instead of rendering nothing when the runs read fails', async () => {
    mount(null, { failRead: true });

    expect(await screen.findByTestId('order-gift-attention-read-failed')).toBeInTheDocument();
  });
});
