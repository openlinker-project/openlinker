/**
 * Return Money Panel - refund ceiling handling (#3289, B-4)
 *
 * @module apps/web/src/features/returns/components
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReturnMoneyPanel } from './return-money-panel';
import { RETURN_MONEY_COPY, RETURN_REFUND_CEILING_COPY } from '../lib/return-money.copy';
import type { ReturnDetail } from '../api/returns.types';
import { ApiError } from '../../../shared/api/api-error';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';

const detail = {
  id: 'ol_return_1',
  bucket: 'attributed',
  orderCurrency: 'PLN',
  refunds: [],
} as unknown as ReturnDetail;

const ceilingError = new ApiError('Conflict', 409, {
  code: 'refund_ceiling_exceeded',
  ceiling: '100.00',
  alreadyRefunded: '95.00',
  requested: '19.99',
  currency: 'PLN',
});

function renderPanel(confirmRefund: ReturnType<typeof vi.fn>): void {
  const apiClient = createMockApiClient();
  apiClient.returns.confirmRefund =
    confirmRefund as unknown as typeof apiClient.returns.confirmRefund;
  renderWithProviders(
    <ReturnMoneyPanel
      detail={detail}
      writeAccess={{ canWrite: true, demoReadOnly: false, visible: true }}
    />,
    { apiClient }
  );
}

async function submit(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: RETURN_MONEY_COPY.action }));
  fireEvent.change(await screen.findByLabelText(/Amount refunded/), {
    target: { value: '19.99' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }));
}

describe('ReturnMoneyPanel refund ceiling (B-4)', () => {
  it('should show the figures from a 409 refund_ceiling_exceeded and resend with acknowledgeAboveCeiling once ticked', async () => {
    const confirmRefund = vi
      .fn()
      .mockRejectedValueOnce(ceilingError)
      .mockResolvedValue({
        moneyState: 'triggered',
        claimedLineIds: ['a'],
        moneyMoved: true,
        refundRecordWritten: true,
        refundRecordId: 'r1',
      });
    renderPanel(confirmRefund);

    await submit();

    expect(await screen.findByText(RETURN_REFUND_CEILING_COPY.title)).toBeInTheDocument();
    expect(screen.getByText(/Order total 100.00 PLN, already refunded 95.00 PLN/)).toBeInTheDocument();
    expect(confirmRefund.mock.calls[0][1]).not.toHaveProperty('acknowledgeAboveCeiling');

    fireEvent.click(screen.getByLabelText(RETURN_REFUND_CEILING_COPY.acknowledge));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }));

    await waitFor(() => expect(confirmRefund).toHaveBeenCalledTimes(2));
    expect(confirmRefund.mock.calls[1][1]).toMatchObject({ acknowledgeAboveCeiling: true });
  });
});
