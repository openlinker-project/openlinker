/**
 * `PlaceOrderHoldDialog` unit tests (#2342).
 *
 * The reason is the only required field, and the acting user is deliberately
 * never in the body — the backend stamps it from the session. The 409 branch is
 * asserted on the CODE rather than the message, because the two hold conflicts
 * share a status and have different remedies.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlaceOrderHoldDialog } from './place-order-hold-dialog';
import { ApiError } from '../../../shared/api/api-error';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';

const ORDER_ID = 'ol_order_1';

function renderDialog(placeHold = vi.fn().mockResolvedValue({ hold: { id: 'hold_1' } })) {
  const onOpenChange = vi.fn();
  const api = createMockApiClient({
    orders: { placeHold },
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false }) },
  });

  renderWithProviders(
    <PlaceOrderHoldDialog open internalOrderId={ORDER_ID} onOpenChange={onOpenChange} />,
    { apiClient: api },
  );

  return { placeHold, onOpenChange };
}

afterEach(cleanup);

describe('PlaceOrderHoldDialog (#2342)', () => {
  it('should submit the chosen reason and omit an empty note', async () => {
    const { placeHold, onOpenChange } = renderDialog();
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText('Reason'), 'stock-shortfall');
    await user.click(screen.getByRole('button', { name: 'Put on hold' }));

    await waitFor(() => {
      // The acting user is NEVER sent — the backend stamps it from the session.
      expect(placeHold).toHaveBeenCalledWith(ORDER_ID, {
        reason: 'stock-shortfall',
        note: undefined,
      });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('should submit a trimmed note when one is given', async () => {
    const { placeHold } = renderDialog();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Note (optional)'), '  Supplier is late  ');
    await user.click(screen.getByRole('button', { name: 'Put on hold' }));

    await waitFor(() => {
      expect(placeHold).toHaveBeenCalledWith(ORDER_ID, {
        reason: 'operator',
        note: 'Supplier is late',
      });
    });
  });

  it('should offer every declared reason in the select', async () => {
    renderDialog();
    const select = await screen.findByLabelText('Reason');
    // A mirror that silently loses a reason loses it from this control; the
    // guard script is what keeps the list itself honest.
    expect(select.querySelectorAll('option')).toHaveLength(8);
  });

  it('should name the ORDER_ALREADY_ON_HOLD conflict rather than echoing a status', async () => {
    const conflict = new ApiError('Conflict', 409, {
      statusCode: 409,
      error: 'ORDER_ALREADY_ON_HOLD',
      message: 'Order already has an open hold',
    });
    const { onOpenChange } = renderDialog(vi.fn().mockRejectedValue(conflict));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Put on hold' }));

    expect(
      await screen.findByText('This order is already on hold. Reload to see the hold that is open.'),
    ).toBeInTheDocument();
    // The dialog stays open: the operator is still in the form.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('should surface the server message for a failure it does not recognise', async () => {
    // A 400 naming a missing field must not be hidden behind a generic sentence.
    const { onOpenChange } = renderDialog(
      vi.fn().mockRejectedValue(new ApiError('Unknown hold reason', 400, {})),
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Put on hold' }));

    expect(await screen.findByText('Unknown hold reason')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
