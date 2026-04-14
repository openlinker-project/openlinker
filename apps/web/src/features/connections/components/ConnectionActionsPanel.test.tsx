import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, sampleConnection } from '../../../test/test-utils';
import { ConnectionActionsPanel } from './ConnectionActionsPanel';

// jsdom does not implement showModal/close — stub them on HTMLDialogElement
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

describe('ConnectionActionsPanel', () => {
  afterEach(cleanup);

  it('renders edit, trigger sync, and disable actions for an active connection', () => {
    renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />);

    expect(screen.getByRole('link', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /trigger sync/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument();
  });

  it('hides trigger sync and disable when connection is already disabled', () => {
    const disabledConnection = { ...sampleConnection, status: 'disabled' as const };
    renderWithProviders(<ConnectionActionsPanel connection={disabledConnection} />);

    expect(screen.getByRole('link', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /trigger sync/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disable' })).not.toBeInTheDocument();
  });

  it('links edit action to the correct URL', () => {
    renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />);

    const editLink = screen.getByRole('link', { name: 'Edit' });
    expect(editLink).toHaveAttribute('href', `/connections/${sampleConnection.id}/edit`);
  });

  it('shows trigger sync button for non-prestashop connections too', () => {
    const allegroConnection = { ...sampleConnection, platformType: 'allegro' as const };
    renderWithProviders(<ConnectionActionsPanel connection={allegroConnection} />);

    expect(screen.getByRole('button', { name: /trigger sync/i })).toBeInTheDocument();
  });

  it('opens the TriggerSyncDialog when "Trigger sync…" is clicked', () => {
    renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />);

    fireEvent.click(screen.getByRole('button', { name: /trigger sync/i }));

    // Dialog is now open — job type select should be visible
    expect(screen.getByRole('combobox', { name: /job type/i })).toBeInTheDocument();
  });
});
