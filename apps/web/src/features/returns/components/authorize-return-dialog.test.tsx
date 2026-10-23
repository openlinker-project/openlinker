/**
 * Authorize Return Dialog (#3078/#3083)
 *
 * @module apps/web/src/features/returns/components
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AuthorizeReturnDialog } from './authorize-return-dialog';
import { AUTHORIZE_RETURN_DIALOG_COPY as COPY } from '../lib/authorize-return-dialog.copy';
import { ApiError } from '../../../shared/api/api-error';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';

function renderDialog(options: {
  authorize?: ReturnType<typeof vi.fn>;
  onAuthorized?: () => void;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const apiClient = createMockApiClient();
  const authorize = options.authorize ?? vi.fn().mockResolvedValue({
    outcome: 'authorized',
    changeId: 'ol_change_1',
    authorizedAt: '2026-08-01T00:00:00.000Z',
  });
  apiClient.returns.authorize = authorize as unknown as typeof apiClient.returns.authorize;

  const onOpenChange = options.onOpenChange ?? vi.fn();
  renderWithProviders(
    <AuthorizeReturnDialog
      returnId="ol_return_1"
      open
      onOpenChange={onOpenChange}
      onAuthorized={options.onAuthorized}
    />,
    { apiClient },
  );
  return { authorize, onOpenChange };
}

describe('AuthorizeReturnDialog', () => {
  it('should call authorize with no fields to fill in', async () => {
    const { authorize } = renderDialog();

    await userEvent.click(await screen.findByRole('button', { name: COPY.confirm }));

    await waitFor(() => {
      expect(authorize).toHaveBeenCalledWith('ol_return_1');
    });
  });

  it('should close and call onAuthorized once confirmed', async () => {
    const onAuthorized = vi.fn();
    const { onOpenChange } = renderDialog({ onAuthorized });

    await userEvent.click(await screen.findByRole('button', { name: COPY.confirm }));

    await waitFor(() => {
      expect(onAuthorized).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('should treat an idempotent repeat (already-authorized) as success too', async () => {
    const authorize = vi.fn().mockResolvedValue({
      outcome: 'already-authorized',
      changeId: 'ol_change_1',
      authorizedAt: '2026-08-01T00:00:00.000Z',
    });
    const onAuthorized = vi.fn();
    renderDialog({ authorize, onAuthorized });

    await userEvent.click(await screen.findByRole('button', { name: COPY.confirm }));

    await waitFor(() => {
      expect(onAuthorized).toHaveBeenCalled();
    });
  });

  it('should render the source-ingested 409 as a DISTINCT message, not the generic error', async () => {
    const authorize = vi.fn().mockRejectedValue(
      new ApiError('Cannot authorize', 409, { reason: 'source-ingested' }),
    );
    renderDialog({ authorize });

    await userEvent.click(await screen.findByRole('button', { name: COPY.confirm }));

    expect(await screen.findByText(COPY.refusedTitle)).toBeInTheDocument();
    expect(screen.getByText(COPY.refusedBody)).toBeInTheDocument();
    expect(screen.queryByText(COPY.genericError)).not.toBeInTheDocument();
    // The confirm form is gone — only the acknowledgement remains.
    expect(screen.queryByRole('button', { name: COPY.confirm })).not.toBeInTheDocument();
  });

  it('should fall back to the generic message for an unrecognised failure', async () => {
    const authorize = vi.fn().mockRejectedValue(new Error('network down'));
    renderDialog({ authorize });

    await userEvent.click(await screen.findByRole('button', { name: COPY.confirm }));

    expect(await screen.findByText(COPY.genericError)).toBeInTheDocument();
    expect(screen.queryByText(COPY.refusedTitle)).not.toBeInTheDocument();
  });

  it('should not close on a refused attempt', async () => {
    const authorize = vi.fn().mockRejectedValue(
      new ApiError('Cannot authorize', 409, { reason: 'source-ingested' }),
    );
    const onOpenChange = vi.fn();
    renderDialog({ authorize, onOpenChange });

    await userEvent.click(await screen.findByRole('button', { name: COPY.confirm }));

    await screen.findByText(COPY.refusedTitle);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('should close via cancel without calling authorize', async () => {
    const { authorize, onOpenChange } = renderDialog();

    await userEvent.click(await screen.findByRole('button', { name: COPY.cancel }));

    expect(authorize).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
