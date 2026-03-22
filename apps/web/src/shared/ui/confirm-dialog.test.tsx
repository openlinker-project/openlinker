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

  it('calls onOpenChange(false) when the cancel button is clicked', () => {
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

    fireEvent.click(within(view.container).getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // Focus trapping (Tab cycle) and Escape handling are provided natively by showModal() —
  // they are browser behaviours not exercisable via fireEvent in jsdom.

  it('focuses the confirm button when opened and restores focus to the trigger when closed', () => {
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
