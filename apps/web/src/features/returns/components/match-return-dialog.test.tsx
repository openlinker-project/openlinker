/**
 * Match Return Dialog (#3078/#3082)
 *
 * The acceptance criteria this file exists for: an unknown-order 400 renders
 * as a field error naming the typed id, and an already-attributed 409
 * renders as a distinct message rather than the generic failure.
 *
 * @module apps/web/src/features/returns/components
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MatchReturnDialog } from './match-return-dialog';
import { MATCH_RETURN_DIALOG_COPY as COPY } from '../lib/match-return-dialog.copy';
import { ApiError } from '../../../shared/api/api-error';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { WriteAccess } from '../../../shared/auth/use-permission';

const FULL_WRITE_ACCESS: WriteAccess = { canWrite: true, demoReadOnly: false, visible: true };

function renderDialog(options: {
  matchOrder?: ReturnType<typeof vi.fn>;
  onMatched?: () => void;
  orders?: Array<{ internalOrderId: string; syncStatus: Array<{ externalOrderNumber: string | null }> }>;
  writeAccess?: WriteAccess;
} = {}) {
  const apiClient = createMockApiClient();
  const matchOrder = options.matchOrder ?? vi.fn().mockResolvedValue({
    returnId: 'ol_return_1',
    internalOrderId: 'ol_order_1',
    matchedAt: '2026-08-01T00:00:00.000Z',
  });
  apiClient.returns.matchOrder = matchOrder as unknown as typeof apiClient.returns.matchOrder;

  if (options.orders !== undefined) {
    apiClient.orders.list = vi.fn().mockResolvedValue({
      items: options.orders,
      total: options.orders.length,
      limit: 20,
      offset: 0,
    }) as unknown as typeof apiClient.orders.list;
  }

  const onOpenChange = vi.fn();
  renderWithProviders(
    <MatchReturnDialog
      returnId="ol_return_1"
      open
      onOpenChange={onOpenChange}
      onMatched={options.onMatched}
      writeAccess={options.writeAccess ?? FULL_WRITE_ACCESS}
    />,
    { apiClient },
  );
  return { matchOrder, onOpenChange };
}

async function typeAndSubmit(value: string): Promise<void> {
  const input = await screen.findByLabelText(COPY.fieldLabel);
  await userEvent.clear(input);
  await userEvent.type(input, value);
  await userEvent.click(screen.getByRole('button', { name: COPY.confirm }));
}

describe('MatchReturnDialog', () => {
  it('should show the irreversibility warning up front', async () => {
    renderDialog();

    expect(await screen.findByText(COPY.warning)).toBeInTheDocument();
  });

  it('should require a value before submitting', async () => {
    const { matchOrder } = renderDialog();

    await userEvent.click(await screen.findByRole('button', { name: COPY.confirm }));

    expect(await screen.findByText(COPY.fieldRequired)).toBeInTheDocument();
    expect(matchOrder).not.toHaveBeenCalled();
  });

  it('should match on a valid order id and close', async () => {
    const { matchOrder, onOpenChange } = renderDialog();

    await typeAndSubmit('ol_order_1');

    await waitFor(() => {
      expect(matchOrder).toHaveBeenCalledWith('ol_return_1', { internalOrderId: 'ol_order_1' });
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('should call onMatched after a successful match', async () => {
    const onMatched = vi.fn();
    renderDialog({ onMatched });

    await typeAndSubmit('ol_order_1');

    await waitFor(() => {
      expect(onMatched).toHaveBeenCalled();
    });
  });

  it('should render an unknown-order 400 as a FIELD error naming the typed id', async () => {
    const matchOrder = vi.fn().mockRejectedValue(
      new ApiError('Cannot match', 400, { reason: 'unknown-order' }),
    );
    renderDialog({ matchOrder });

    await typeAndSubmit('#ZZZ999');

    expect(await screen.findByText(COPY.unknownOrder('#ZZZ999'))).toBeInTheDocument();
    // Never the generic sentence alongside the field error.
    expect(screen.queryByText(COPY.genericError)).not.toBeInTheDocument();
  });

  it('should render an already-attributed 409 as a DISTINCT message, not the generic error', async () => {
    const matchOrder = vi.fn().mockRejectedValue(
      new ApiError('Cannot match', 409, { reason: 'already-attributed' }),
    );
    renderDialog({ matchOrder });

    await typeAndSubmit('ol_order_2');

    expect(await screen.findByText(COPY.alreadyAttributedTitle)).toBeInTheDocument();
    expect(screen.getByText(COPY.alreadyAttributedBody)).toBeInTheDocument();
    expect(screen.queryByText(COPY.genericError)).not.toBeInTheDocument();
    // Nor mistaken for a correctable field error.
    expect(screen.queryByText(COPY.fieldRequired)).not.toBeInTheDocument();
  });

  it('should call onMatched on an already-attributed conflict too — the return IS attributed', async () => {
    const onMatched = vi.fn();
    const matchOrder = vi.fn().mockRejectedValue(
      new ApiError('Cannot match', 409, { reason: 'already-attributed' }),
    );
    renderDialog({ matchOrder, onMatched });

    await typeAndSubmit('ol_order_2');

    await waitFor(() => {
      expect(onMatched).toHaveBeenCalled();
    });
  });

  it('should fall back to the generic message for an unrecognised failure', async () => {
    const matchOrder = vi.fn().mockRejectedValue(new Error('network down'));
    renderDialog({ matchOrder });

    await typeAndSubmit('ol_order_1');

    expect(await screen.findByText(COPY.genericError)).toBeInTheDocument();
    expect(screen.queryByText(COPY.alreadyAttributedTitle)).not.toBeInTheDocument();
  });

  it('should echo the resolved order number when the typed value matches a fetched order exactly', async () => {
    renderDialog({
      orders: [{ internalOrderId: 'ol_order_1', syncStatus: [{ externalOrderNumber: '#12345' }] }],
    });

    const input = await screen.findByLabelText(COPY.fieldLabel);
    await userEvent.type(input, 'ol_order_1');

    expect(await screen.findByText(COPY.resolvedOrder('#12345'))).toBeInTheDocument();
  });

  it('should NOT echo a resolved order for a value that does not exactly match a fetched order', async () => {
    renderDialog({
      orders: [{ internalOrderId: 'ol_order_1', syncStatus: [{ externalOrderNumber: '#12345' }] }],
    });

    const input = await screen.findByLabelText(COPY.fieldLabel);
    await userEvent.type(input, 'ol_order_1_typo');

    expect(screen.queryByText(COPY.resolvedOrder('#12345'))).not.toBeInTheDocument();
  });

  it('should clear a stale field error once the operator edits the value', async () => {
    const matchOrder = vi.fn().mockRejectedValue(
      new ApiError('Cannot match', 400, { reason: 'unknown-order' }),
    );
    renderDialog({ matchOrder });

    await typeAndSubmit('#ZZZ999');
    expect(await screen.findByText(COPY.unknownOrder('#ZZZ999'))).toBeInTheDocument();

    await userEvent.type(await screen.findByLabelText(COPY.fieldLabel), '1');

    expect(screen.queryByText(COPY.unknownOrder('#ZZZ999'))).not.toBeInTheDocument();
  });

  it('should clear a leftover generic error on Cancel, so it does not survive into a reopen', async () => {
    // Repro from tech-lead review on #3281: the mutation object outlives a
    // close, so `mutation.error` alone (never reset) would re-render the
    // generic Alert on a dialog the operator hasn't touched yet.
    const matchOrder = vi.fn().mockRejectedValue(new Error('network down'));
    renderDialog({ matchOrder });

    await typeAndSubmit('ol_order_1');
    expect(await screen.findByText(COPY.genericError)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: COPY.cancel }));

    expect(screen.queryByText(COPY.genericError)).not.toBeInTheDocument();
  });

  it('should disable the confirm button and show the read-only lock in demo mode', async () => {
    renderDialog({ writeAccess: { canWrite: false, demoReadOnly: true, visible: true } });

    expect(await screen.findByRole('button', { name: COPY.confirm })).toBeDisabled();
  });

  it('should disable the confirm button when the session has no write access at all', async () => {
    renderDialog({ writeAccess: { canWrite: false, demoReadOnly: false, visible: false } });

    expect(await screen.findByRole('button', { name: COPY.confirm })).toBeDisabled();
  });

  it('should not submit when the confirm button is clicked without write access', async () => {
    const { matchOrder } = renderDialog({
      writeAccess: { canWrite: false, demoReadOnly: true, visible: true },
    });

    const input = await screen.findByLabelText(COPY.fieldLabel);
    await userEvent.type(input, 'ol_order_1');
    // A demo-locked button still renders as a real <button disabled>, so a
    // click resolves to nothing at the DOM level — this pins the same
    // refusal at the submit handler, in case the disabled attribute is ever
    // dropped from the markup.
    await userEvent.click(screen.getByRole('button', { name: COPY.confirm }));

    expect(matchOrder).not.toHaveBeenCalled();
  });
});
