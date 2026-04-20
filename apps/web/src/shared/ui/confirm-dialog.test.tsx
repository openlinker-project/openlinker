import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './confirm-dialog';

describe('ConfirmDialog', () => {
  afterEach(cleanup);

  it('calls onConfirm when the confirm action is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <ConfirmDialog
        open
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
        title="Delete item?"
        description="This action cannot be undone."
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenChange(false) when the cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <ConfirmDialog
        open
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
        title="Delete item?"
        description="This action cannot be undone."
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not render dialog content when open=false', () => {
    render(
      <ConfirmDialog
        open={false}
        onConfirm={vi.fn()}
        onOpenChange={vi.fn()}
        title="Delete item?"
        description="This action cannot be undone."
      />,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Delete item?')).toBeNull();
  });

  it('wires aria-labelledby/aria-describedby to the title and description', () => {
    render(
      <ConfirmDialog
        open
        onConfirm={vi.fn()}
        onOpenChange={vi.fn()}
        title="Delete item?"
        description="This action cannot be undone."
      />,
    );

    const dialog = screen.getByRole('dialog');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    const describedBy = dialog.getAttribute('aria-describedby');

    expect(labelledBy).toBeTruthy();
    expect(describedBy).toBeTruthy();
    expect(screen.getByText('Delete item?')).toHaveAttribute('id', labelledBy!);
    expect(screen.getByText('This action cannot be undone.')).toHaveAttribute('id', describedBy!);
  });

  it('disables the confirm button while isConfirming is true', () => {
    render(
      <ConfirmDialog
        open
        isConfirming
        onConfirm={vi.fn()}
        onOpenChange={vi.fn()}
        title="Delete item?"
        description="This action cannot be undone."
      />,
    );

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('applies the danger tone class on the confirm button when tone=danger', () => {
    render(
      <ConfirmDialog
        open
        tone="danger"
        onConfirm={vi.fn()}
        onOpenChange={vi.fn()}
        title="Delete item?"
        description="This action cannot be undone."
      />,
    );

    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveClass('button--danger');
  });

  it('fires onOpenChange(false) when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <ConfirmDialog
        open
        onConfirm={vi.fn()}
        onOpenChange={onOpenChange}
        title="Delete item?"
        description="This action cannot be undone."
      />,
    );

    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('focuses the Confirm button (not Cancel) when the dialog opens', () => {
    render(
      <ConfirmDialog
        open
        onConfirm={vi.fn()}
        onOpenChange={vi.fn()}
        title="Delete item?"
        description="This action cannot be undone."
      />,
    );

    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus();
  });
});
