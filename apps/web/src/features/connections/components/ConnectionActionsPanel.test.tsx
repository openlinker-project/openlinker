import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, sampleConnection, createAuthenticatedSessionAdapter } from '../../../test/test-utils';
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

const adminSession = { sessionAdapter: createAuthenticatedSessionAdapter() };

describe('ConnectionActionsPanel', () => {
  afterEach(cleanup);

  it('renders edit, trigger sync, and disable actions for an active connection', async () => {
    renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />, adminSession);

    // findByRole waits for the session to hydrate (canWrite starts false)
    expect(await screen.findByRole('link', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /trigger sync/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument();
  });

  it('hides trigger sync and disable when connection is already disabled', async () => {
    const disabledConnection = { ...sampleConnection, status: 'disabled' as const };
    renderWithProviders(<ConnectionActionsPanel connection={disabledConnection} />, adminSession);

    expect(await screen.findByRole('link', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /trigger sync/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disable' })).not.toBeInTheDocument();
  });

  it('links edit action to the correct URL', async () => {
    renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />, adminSession);

    const editLink = await screen.findByRole('link', { name: 'Edit' });
    expect(editLink).toHaveAttribute('href', `/connections/${sampleConnection.id}/edit`);
  });

  it('shows trigger sync button for non-prestashop connections too', async () => {
    const allegroConnection = { ...sampleConnection, platformType: 'allegro' };
    renderWithProviders(<ConnectionActionsPanel connection={allegroConnection} />, adminSession);

    expect(await screen.findByRole('button', { name: /trigger sync/i })).toBeInTheDocument();
  });

  it('renders the PrestaShop plugin\'s "Configure webhooks" action for prestashop connections', async () => {
    renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />, adminSession);
    expect(await screen.findByRole('button', { name: /configure webhooks/i })).toBeInTheDocument();
  });

  it('does not render the "Configure webhooks" action for non-prestashop connections', async () => {
    const allegroConnection = { ...sampleConnection, platformType: 'allegro' };
    renderWithProviders(<ConnectionActionsPanel connection={allegroConnection} />, adminSession);
    // Wait for session to hydrate, then confirm no webhook button
    await screen.findByRole('button', { name: /trigger sync/i });
    expect(screen.queryByRole('button', { name: /configure webhooks/i })).not.toBeInTheDocument();
  });

  it('renders no plugin-specific actions for an unregistered platformType', async () => {
    const unknownConnection = { ...sampleConnection, platformType: 'shopify' };
    renderWithProviders(<ConnectionActionsPanel connection={unknownConnection} />, adminSession);
    expect(await screen.findByRole('link', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /configure webhooks/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /trigger sync/i })).toBeInTheDocument();
  });

  it('opens the TriggerSyncDialog when "Trigger sync…" is clicked', async () => {
    renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />, adminSession);

    fireEvent.click(await screen.findByRole('button', { name: /trigger sync/i }));

    // Dialog is now open — job type select should be visible
    expect(screen.getByRole('combobox', { name: /job type/i })).toBeInTheDocument();
  });
});
