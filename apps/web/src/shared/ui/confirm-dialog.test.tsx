import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './confirm-dialog';

describe('ConfirmDialog', () => {
  it('calls onConfirm when the confirm action is clicked', () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();

    const view = render(
      <ConfirmDialog
        open
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
        title="Delete item?"
        description="This action cannot be undone."
      />,
    );

    fireEvent.click(within(view.container).getByRole('button', { name: 'Confirm' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('closes on cancel', () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();

    const view = render(
      <ConfirmDialog
        open
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
        title="Delete item?"
        description="This action cannot be undone."
      />,
    );

    fireEvent.click(within(within(view.container).getAllByRole('dialog', { name: 'Delete item?' })[0]).getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('traps focus within the dialog actions', () => {
    const view = render(
      <ConfirmDialog
        open
        onConfirm={vi.fn()}
        onOpenChange={vi.fn()}
        title="Delete item?"
        description="This action cannot be undone."
      />,
    );

    const dialog = within(view.container).getAllByRole('dialog', { name: 'Delete item?' })[0];
    const cancelButton = within(dialog).getByRole('button', { name: 'Cancel' });
    const confirmButton = within(dialog).getByRole('button', { name: 'Confirm' });

    expect(confirmButton).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Tab' });
    expect(cancelButton).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(confirmButton).toHaveFocus();
  });

  it('restores focus to the previously focused element after close', () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    const view = render(
      <>
        <button type="button">Open dialog</button>
        <ConfirmDialog
          open={false}
          onConfirm={onConfirm}
          onOpenChange={onOpenChange}
          title="Delete item?"
          description="This action cannot be undone."
        />
      </>,
    );

    const triggerButton = within(view.container).getByRole('button', { name: 'Open dialog' });
    triggerButton.focus();
    expect(triggerButton).toHaveFocus();

    view.rerender(
      <>
        <button type="button">Open dialog</button>
        <ConfirmDialog
          open
          onConfirm={onConfirm}
          onOpenChange={onOpenChange}
          title="Delete item?"
          description="This action cannot be undone."
        />
      </>,
    );

    expect(within(view.container).getByRole('button', { name: 'Confirm' })).toHaveFocus();

    view.rerender(
      <>
        <button type="button">Open dialog</button>
        <ConfirmDialog
          open={false}
          onConfirm={onConfirm}
          onOpenChange={onOpenChange}
          title="Delete item?"
          description="This action cannot be undone."
        />
      </>,
    );

    expect(within(view.container).getByRole('button', { name: 'Open dialog' })).toHaveFocus();
  });
});
