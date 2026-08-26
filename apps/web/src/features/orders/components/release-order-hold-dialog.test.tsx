/**
 * `ReleaseOrderHoldDialog` unit tests (#2342).
 *
 * Two acceptance criteria live here. Releasing a SERVICE-placed hold must block
 * submit until a note is entered (§6.4 — and the backend answers 400 for it, so
 * the form is what keeps the operator from finding out after the fact), and a
 * `failed` provisioning resume must never be reported as a plain success.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReleaseOrderHoldDialog } from './release-order-hold-dialog';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { OrderHold, ReleaseOrderHoldResult } from '../api/orders.types';

const ORDER_ID = 'ol_order_1';

function hold(overrides: Partial<OrderHold> = {}): OrderHold {
  return {
    id: 'hold_1',
    internalOrderId: ORDER_ID,
    reason: 'operator',
    note: null,
    placedByUserId: 'user_1',
    placedByService: null,
    placedAt: '2026-08-20T10:00:00.000Z',
    releasedAt: null,
    releasedByUserId: null,
    releaseNote: null,
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
    ...overrides,
  };
}

function renderDialog(
  target: OrderHold,
  result: ReleaseOrderHoldResult = { hold: target, provisioningResume: { status: 'enqueued', jobId: 'job_1', reason: null } },
) {
  const releaseHold = vi.fn().mockResolvedValue(result);
  const onReleased = vi.fn();
  const api = createMockApiClient({
    orders: { releaseHold },
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false }) },
  });

  renderWithProviders(
    <ReleaseOrderHoldDialog
      open
      hold={target}
      onOpenChange={vi.fn()}
      onReleased={onReleased}
    />,
    { apiClient: api },
  );

  return { releaseHold, onReleased };
}

afterEach(cleanup);

describe('ReleaseOrderHoldDialog (#2342)', () => {
  it('should release a USER-placed hold with no note', async () => {
    const { releaseHold } = renderDialog(hold());
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Release hold' }));

    await waitFor(() => {
      // The backend allows a note-less release here, so the form must too.
      expect(releaseHold).toHaveBeenCalledWith(ORDER_ID, 'hold_1', { note: undefined });
    });
  });

  it('should BLOCK releasing a SERVICE-placed hold until a note is entered', async () => {
    const { releaseHold } = renderDialog(
      hold({ placedByUserId: null, placedByService: 'stock-monitor' }),
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Release hold' }));

    expect(
      await screen.findByText(
        'A note is required to release a hold OpenLinker placed automatically',
      ),
    ).toBeInTheDocument();
    expect(releaseHold).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Note'), 'Stock arrived this morning');
    await user.click(screen.getByRole('button', { name: 'Release hold' }));

    await waitFor(() => {
      expect(releaseHold).toHaveBeenCalledWith(ORDER_ID, 'hold_1', {
        note: 'Stock arrived this morning',
      });
    });
  });

  it('should refuse a whitespace-only note on a service-placed hold', async () => {
    // The service normalises empty/whitespace to null before applying the rule,
    // so whitespace must not satisfy it here either.
    const { releaseHold } = renderDialog(
      hold({ placedByUserId: null, placedByService: 'stock-monitor' }),
    );
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Note'), '   ');
    await user.click(screen.getByRole('button', { name: 'Release hold' }));

    await screen.findByText(
      'A note is required to release a hold OpenLinker placed automatically',
    );
    expect(releaseHold).not.toHaveBeenCalled();
  });

  it('should report a FAILED provisioning resume to the caller rather than a flat success', async () => {
    const target = hold();
    const { onReleased } = renderDialog(target, {
      hold: target,
      provisioningResume: { status: 'failed', jobId: null, reason: 'enqueue-failed' },
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Release hold' }));

    await waitFor(() => {
      // The hold is gone AND the order is still un-provisioned; the panel keeps
      // the remedy on screen off the back of this.
      expect(onReleased).toHaveBeenCalledWith({
        status: 'failed',
        jobId: null,
        reason: 'enqueue-failed',
      });
    });
  });

  it('should show what is being released before it asks', async () => {
    renderDialog(hold({ reason: 'address-invalid', note: 'Postcode does not exist' }));

    expect(await screen.findByText('Address invalid')).toBeInTheDocument();
    expect(screen.getByText('Postcode does not exist')).toBeInTheDocument();
  });
});
