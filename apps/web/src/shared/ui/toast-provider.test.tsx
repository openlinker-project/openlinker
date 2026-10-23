import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { ToastProvider, useToast } from './toast-provider';

/**
 * `ShowToastOptions.action` (#3148) — the inline "Undo"-style button
 * rendered alongside a toast's dismiss control. Covers the contract new
 * consumers rely on: the action fires, and clicking it also dismisses the
 * toast (mirroring the dismiss button's own behaviour), without regressing
 * the plain (no-action) toast shape every pre-#3148 caller still uses.
 */
function Harness({ withAction = false }: { withAction?: boolean }): ReactElement {
  const { showToast } = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        showToast({
          tone: 'success',
          title: 'Set to Automatic',
          description: 'Future price changes will publish without review.',
          ...(withAction ? { action: { label: 'Undo', onClick: vi.fn() } } : {}),
        })
      }
    >
      trigger
    </button>
  );
}

describe('ToastProvider', () => {
  it('renders a plain toast with no action button when none is supplied', async () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByText('trigger'));

    expect(await screen.findByText('Set to Automatic', { selector: '.toast__title' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('renders the action button and invokes onClick when clicked', async () => {
    const onClick = vi.fn();

    function HarnessWithSpy(): ReactElement {
      const { showToast } = useToast();
      return (
        <button
          type="button"
          onClick={() =>
            showToast({
              tone: 'success',
              description: 'Future price changes will publish without review.',
              action: { label: 'Undo', onClick },
            })
          }
        >
          trigger
        </button>
      );
    }

    render(
      <ToastProvider>
        <HarnessWithSpy />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByText('trigger'));
    const undoButton = await screen.findByRole('button', { name: 'Undo' });
    await userEvent.click(undoButton);

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('dismisses the toast when the action is clicked', async () => {
    render(
      <ToastProvider>
        <Harness withAction />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByText('trigger'));
    const undoButton = await screen.findByRole('button', { name: 'Undo' });
    await userEvent.click(undoButton);

    await waitFor(() => {
      expect(screen.queryByText('Set to Automatic', { selector: '.toast__title' })).not.toBeInTheDocument();
    });
  });
});
