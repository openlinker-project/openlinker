import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import type { ListView } from '../lib/saved-view.types';
import { ViewDialogs, type ViewDialogsProps } from './view-dialogs';

const definition = { v: 1 as const, query: '', sort: null, columns: [], parts: {} };
const existing: ListView = { id: 'late', name: 'Late to ship', scope: 'shared', definition };

function props(overrides: Partial<ViewDialogsProps> = {}): ViewDialogsProps {
  return {
    dialog: { mode: 'create' },
    views: [existing],
    isAdmin: false,
    pageTitle: 'Orders',
    summary: { filters: ['Stage: Sync failed'], sortLabel: 'Created, newest', columnCount: 5 },
    activeHasUnsavedChanges: false,
    activeId: 'all',
    onClose: vi.fn(),
    onCreate: vi.fn().mockResolvedValue('ok'),
    onRename: vi.fn().mockResolvedValue('ok'),
    onDelete: vi.fn(),
    ...overrides,
  };
}

describe('ViewDialogs', () => {
  it('should summarise what is saved', async () => {
    renderWithProviders(<ViewDialogs {...props()} />);
    expect(await screen.findByText('Stage: Sync failed')).toBeInTheDocument();
    expect(screen.getByText('Sort: Created, newest')).toBeInTheDocument();
    expect(screen.getByText('5 columns')).toBeInTheDocument();
  });

  it('should require a name', async () => {
    const p = props();
    renderWithProviders(<ViewDialogs {...p} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Save view' }));
    expect(screen.getByText('Enter a name for this view.')).toBeInTheDocument();
    expect(p.onCreate).not.toHaveBeenCalled();
  });

  it('should refuse a name another view already has, ignoring case', async () => {
    const p = props();
    renderWithProviders(<ViewDialogs {...p} />);
    await userEvent.type(await screen.findByLabelText('Name'), 'late TO ship');
    await userEvent.click(screen.getByRole('button', { name: 'Save view' }));
    expect(screen.getByText('A view with this name already exists.')).toBeInTheDocument();
    expect(p.onCreate).not.toHaveBeenCalled();
  });

  it('should create a personal view and open it by default when asked', async () => {
    const p = props();
    renderWithProviders(<ViewDialogs {...p} />);
    await userEvent.type(await screen.findByLabelText('Name'), 'Allegro, ready');
    await userEvent.click(screen.getByRole('checkbox', { name: /Open Orders in this view by default/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save view' }));
    expect(p.onCreate).toHaveBeenCalledWith({ name: 'Allegro, ready', scope: 'personal', asDefault: true });
  });

  it('should keep shared views for admins and say why', async () => {
    renderWithProviders(<ViewDialogs {...props({ isAdmin: false })} />);
    expect(await screen.findByRole('radio', { name: 'Everyone' })).toBeDisabled();
    expect(screen.getByText(/Shared views are created by admins/)).toBeInTheDocument();
  });

  it('should let an admin save a shared view, which cannot be the default', async () => {
    const p = props({ isAdmin: true });
    renderWithProviders(<ViewDialogs {...p} />);
    await userEvent.type(await screen.findByLabelText('Name'), 'Team view');
    await userEvent.click(screen.getByRole('radio', { name: 'Everyone' }));
    expect(screen.queryByRole('checkbox', { name: /by default/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Save view' }));
    expect(p.onCreate).toHaveBeenCalledWith({ name: 'Team view', scope: 'shared', asDefault: false });
  });

  it('should show the server answer when the name turns out to be taken', async () => {
    const p = props({ onCreate: vi.fn().mockResolvedValue('taken') });
    renderWithProviders(<ViewDialogs {...p} />);
    await userEvent.type(await screen.findByLabelText('Name'), 'Fresh name');
    await userEvent.click(screen.getByRole('button', { name: 'Save view' }));
    expect(await screen.findByText('A view with this name already exists.')).toBeInTheDocument();
  });

  it('should rename without offering scope or summary', async () => {
    const mine: ListView = { ...existing, id: 'mine', name: 'Mine', scope: 'personal' };
    const p = props({ dialog: { mode: 'rename', view: mine }, views: [existing, mine] });
    renderWithProviders(<ViewDialogs {...p} />);
    const input = await screen.findByLabelText('Name');
    expect(input).toHaveValue('Mine');
    expect(screen.queryByText('Who can see it')).toBeNull();
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed');
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(p.onRename).toHaveBeenCalledWith(mine, 'Renamed');
  });

  it('should warn that deleting a shared view removes it for everyone and drops unsaved changes', async () => {
    const p = props({ dialog: { mode: 'delete', view: existing }, activeId: 'late', activeHasUnsavedChanges: true });
    renderWithProviders(<ViewDialogs {...p} />);
    expect(await screen.findByText(/It disappears for everyone\. Your unsaved changes will be lost too\. Records are not affected/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete view' }));
    expect(p.onDelete).toHaveBeenCalledWith(existing);
  });
});
