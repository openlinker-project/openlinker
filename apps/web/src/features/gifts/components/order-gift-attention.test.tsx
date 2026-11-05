/**
 * OrderGiftAttention tests (#3940, mockup M31 `order/gift-out-of-stock`,
 * `gift-not-added*`, `gift-not-added-shop-rejected`)
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { OrderGiftAttention } from './order-gift-attention';

function runsWith(detail: string, outcome = 'nothing-to-do'): unknown {
  return {
    recordingAvailable: true,
    limit: 20,
    hasMore: false,
    note: null,
    runs: [
      {
        id: 'run-1',
        ruleId: 'rule-9',
        ruleName: 'Coffee sample from 150',
        trigger: 'order.ingested',
        subjectKind: 'order',
        subjectId: 'o1',
        outcome,
        steps: [{ stepIndex: 0, action: 'add-gift', status: outcome, detail, report: null, syncJobId: null, unavailableReason: null }],
        blockedByRuleIds: null,
        firedAt: '2026-11-02T10:00:00.000Z',
        needsAttention: false,
        retryable: false,
        retryRefusalReason: null,
        dismissedAt: null,
        dismissedByUserId: null,
        retryOfRunId: null,
        supersededByRetry: false,
      },
    ],
  };
}

function mount(detail: string | null, props: { shopRejected?: boolean; onAddGift?: () => void } = {}): void {
  const apiClient = createMockApiClient({
    automations: {
      listRunsBySubject: vi.fn().mockResolvedValue(detail === null ? { runs: [], limit: 20, hasMore: false, recordingAvailable: true, note: null } : runsWith(detail)),
    },
  } as never);
  renderWithProviders(
    <OrderGiftAttention internalOrderId="o1" shopRejected={props.shopRejected ?? false} onAddGift={props.onAddGift} />,
    { apiClient },
  );
}

afterEach(cleanup);

describe('OrderGiftAttention', () => {
  it('should offer another gift by hand and the promotion when the gift ran out', async () => {
    const onAddGift = vi.fn();
    mount('No gift added: gift-out-of-stock.', { onAddGift });

    expect(await screen.findByTestId('order-gift-attention-out-of-stock')).toHaveTextContent('Coffee sample from 150');
    fireEvent.click(screen.getByTestId('order-gift-attention-add'));
    expect(onAddGift).toHaveBeenCalled();
    expect(screen.getByTestId('order-gift-open-rule')).toHaveAttribute('href', '/automations/gifts/rule-9');
  });

  it('should explain a rule that did what it was set to as a quiet notice, not a warning', async () => {
    mount('No gift added: below-per-unit-threshold.');

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
});
