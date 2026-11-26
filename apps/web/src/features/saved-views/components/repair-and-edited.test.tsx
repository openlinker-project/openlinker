import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { EditedBar } from './edited-bar';
import { RepairBanner } from './repair-banner';

describe('RepairBanner', () => {
  const base = { issues: ['Column “carrierRef” no longer exists.'], canEdit: true, onFix: vi.fn(), onSaveAsMine: vi.fn(), onDismiss: vi.fn() };

  it('should say what is missing and that it is skipped', () => {
    renderWithProviders(<RepairBanner {...base} />);
    expect(screen.getByRole('alert')).toHaveTextContent('This view needs repair.');
    expect(screen.getByRole('alert')).toHaveTextContent('Missing items are skipped until you fix it.');
    expect(screen.getByText('Column “carrierRef” no longer exists.')).toBeInTheDocument();
  });

  it('should offer to remove the missing items when the view is editable', async () => {
    const onFix = vi.fn();
    renderWithProviders(<RepairBanner {...base} onFix={onFix} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove missing items and save' }));
    expect(onFix).toHaveBeenCalled();
  });

  it('should offer a copy instead when the view is read-only', async () => {
    const onSaveAsMine = vi.fn();
    renderWithProviders(<RepairBanner {...base} canEdit={false} onSaveAsMine={onSaveAsMine} />);
    expect(screen.queryByRole('button', { name: 'Remove missing items and save' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Save as my view…' }));
    expect(onSaveAsMine).toHaveBeenCalled();
  });

  it('should be dismissible', async () => {
    const onDismiss = vi.fn();
    renderWithProviders(<RepairBanner {...base} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('EditedBar', () => {
  const base = {
    changes: ['filters', 'columns'] as Array<'filters' | 'columns'>,
    isSavedView: true,
    canEdit: true,
    onReset: vi.fn(),
    onSaveChanges: vi.fn(),
    onSaveAsNew: vi.fn(),
  };

  it('should summarise what changed', () => {
    renderWithProviders(<EditedBar {...base} />);
    expect(screen.getByRole('group', { name: 'Unsaved view changes' })).toHaveTextContent('Edited · Filters, Columns');
  });

  it('should save, save as new and reset', async () => {
    const onSaveChanges = vi.fn();
    const onSaveAsNew = vi.fn();
    const onReset = vi.fn();
    renderWithProviders(<EditedBar {...base} onSaveChanges={onSaveChanges} onSaveAsNew={onSaveAsNew} onReset={onReset} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save as new…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onSaveChanges).toHaveBeenCalled();
    expect(onSaveAsNew).toHaveBeenCalled();
    expect(onReset).toHaveBeenCalled();
  });

  it('should only offer a copy when the viewer cannot edit the view', () => {
    renderWithProviders(<EditedBar {...base} canEdit={false} />);
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save as my view…' })).toBeInTheDocument();
  });

  it('should offer only "Save as view" on a built-in view', () => {
    renderWithProviders(<EditedBar {...base} isSavedView={false} />);
    expect(screen.getByRole('button', { name: 'Save as view…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(screen.queryByText(/Edited/)).toBeNull();
  });
});
