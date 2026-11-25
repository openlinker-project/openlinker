import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import type { ListView } from '../lib/saved-view.types';
import { ViewsBar, type ViewsBarProps } from './views-bar';

const definition = { v: 1 as const, query: '', sort: null, columns: [], parts: {} };
const view = (id: string, name: string, scope: ListView['scope'], extra: Partial<ListView> = {}): ListView => ({
  id,
  name,
  scope,
  definition,
  ...extra,
});

function props(overrides: Partial<ViewsBarProps> = {}): ViewsBarProps {
  const views = [
    view('all', 'All orders', 'system', { count: 285 }),
    view('attention', 'Needs attention', 'system', { count: 46, tone: 'error' }),
    view('late', 'Late to ship', 'shared'),
    view('mine', 'My gifts', 'personal'),
  ];
  return {
    tabs: views.slice(0, 2),
    activeId: 'all',
    views,
    pinnedIds: ['all', 'attention'],
    lockedIds: ['all'],
    defaultId: 'all',
    isAdmin: false,
    customViews: true,
    onSelect: vi.fn(),
    onPin: vi.fn(),
    onSetDefault: vi.fn(),
    onDuplicate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onNew: vi.fn(),
    ...overrides,
  };
}

describe('ViewsBar', () => {
  it('should mark the active tab and show counters on tabs that have one', () => {
    renderWithProviders(<ViewsBar {...props()} />);
    expect(screen.getByRole('button', { name: 'All orders, 285' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Needs attention, 46' })).not.toHaveAttribute('aria-current');
  });

  it('should colour a non-zero error counter and leave a zero one quiet', () => {
    const views = [view('attention', 'Needs attention', 'system', { count: 0, tone: 'error' })];
    renderWithProviders(<ViewsBar {...props({ tabs: views, views })} />);
    expect(screen.getByText('0')).not.toHaveClass('sv-tab__count--err');
  });

  it('should select a view when its tab is clicked but not the active one', async () => {
    const onSelect = vi.fn();
    renderWithProviders(<ViewsBar {...props({ onSelect })} />);
    await userEvent.click(screen.getByRole('button', { name: 'All orders, 285' }));
    expect(onSelect).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Needs attention, 46' }));
    expect(onSelect).toHaveBeenCalledWith('attention');
  });

  it('should render the Views button on a list with a single built-in view', () => {
    const only = [view('all', 'All customers', 'system')];
    renderWithProviders(<ViewsBar {...props({ tabs: only, views: only, pinnedIds: ['all'], customViews: false })} />);
    expect(screen.getByRole('button', { name: /^Views/ })).toBeInTheDocument();
  });

  it('should show how many views are not in the strip', () => {
    renderWithProviders(<ViewsBar {...props()} />);
    expect(screen.getByRole('button', { name: /^Views/ })).toHaveTextContent('2');
  });

  it('should group the menu into built-in, shared and mine', async () => {
    renderWithProviders(<ViewsBar {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /^Views/ }));
    const menu = await screen.findByRole('dialog', { name: 'Views' });
    expect(within(menu).getByText('Built-in')).toBeInTheDocument();
    expect(within(menu).getByText('Shared')).toBeInTheDocument();
    expect(within(menu).getByText('Mine')).toBeInTheDocument();
    expect(within(menu).getByText('Late to ship')).toBeInTheDocument();
  });

  it('should offer only the built-in group, with no per-view menu, on a list without custom views', async () => {
    const only = [view('all', 'All customers', 'system')];
    renderWithProviders(<ViewsBar {...props({ tabs: only, views: only, customViews: false })} />);
    await userEvent.click(screen.getByRole('button', { name: /^Views/ }));
    const menu = await screen.findByRole('dialog', { name: 'Views' });
    expect(within(menu).queryByText('Shared')).toBeNull();
    expect(within(menu).queryByRole('button', { name: /Actions for/ })).toBeNull();
    expect(within(menu).queryByText(/Save current filters/)).toBeNull();
  });

  describe('read-only state for people who cannot edit a shared view', () => {
    async function openRowMenu(name: string, admin: boolean): Promise<HTMLElement> {
      renderWithProviders(<ViewsBar {...props({ isAdmin: admin })} />);
      await userEvent.click(screen.getByRole('button', { name: /^Views/ }));
      await userEvent.click(await screen.findByRole('button', { name: `Actions for ${name}` }));
      return screen.getByRole('menu', { name });
    }

    it('should let a non-admin duplicate a shared view but not rename or delete it', async () => {
      const menu = await openRowMenu('Late to ship', false);
      expect(within(menu).getByRole('menuitem', { name: 'Duplicate to mine' })).toBeInTheDocument();
      expect(within(menu).queryByRole('menuitem', { name: 'Rename' })).toBeNull();
      expect(within(menu).queryByRole('menuitem', { name: 'Delete' })).toBeNull();
    });

    it('should let an admin rename and delete a shared view', async () => {
      const menu = await openRowMenu('Late to ship', true);
      expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
      expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    });

    it('should let anyone rename and delete their own view', async () => {
      const menu = await openRowMenu('My gifts', false);
      expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
      expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    });

    it('should never offer to rename, delete or default a built-in view', async () => {
      const menu = await openRowMenu('Needs attention', true);
      expect(within(menu).queryByRole('menuitem', { name: 'Rename' })).toBeNull();
      expect(within(menu).queryByRole('menuitem', { name: 'Delete' })).toBeNull();
      expect(within(menu).queryByRole('menuitem', { name: 'Open by default' })).toBeNull();
      expect(within(menu).getByRole('menuitem', { name: 'Duplicate to mine' })).toBeInTheDocument();
    });
  });

  it('should not offer to unpin a view that always stays in the strip', async () => {
    renderWithProviders(<ViewsBar {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /^Views/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for All orders' }));
    const menu = screen.getByRole('menu', { name: 'All orders' });
    expect(within(menu).queryByRole('menuitem', { name: 'Unpin from strip' })).toBeNull();
  });

  it('should close only the row menu on the first Escape and the whole menu on the second', async () => {
    renderWithProviders(<ViewsBar {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /^Views/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for My gifts' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'My gifts' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Views' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Views' })).toBeNull();
  });

  it('should start a new view from the menu', async () => {
    const onNew = vi.fn();
    renderWithProviders(<ViewsBar {...props({ onNew })} />);
    await userEvent.click(screen.getByRole('button', { name: /^Views/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Save current filters as new view/ }));
    expect(onNew).toHaveBeenCalled();
  });
});
