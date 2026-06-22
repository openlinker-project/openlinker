import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CommandPalette, CommandPaletteTrigger } from './command-palette';
import type { PaletteGroup } from './command-palette';

const noOp = vi.fn();

const mockGroups: PaletteGroup[] = [
  {
    key: 'nav',
    heading: 'Navigation',
    items: [
      { id: 'nav:orders', label: 'Orders', onSelect: noOp },
      { id: 'nav:products', label: 'Products', onSelect: noOp },
    ],
  },
  {
    key: 'connections',
    heading: 'Connections',
    items: [{ id: 'conn:1', label: 'My Shop', description: 'prestashop', onSelect: noOp }],
  },
];

describe('CommandPalette', () => {
  it('should not render when closed', () => {
    render(
      <CommandPalette
        open={false}
        onOpenChange={noOp}
        query=""
        onQueryChange={noOp}
        groups={[]}
      />,
    );
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('should render the input when open', () => {
    render(
      <CommandPalette
        open
        onOpenChange={noOp}
        query=""
        onQueryChange={noOp}
        groups={[]}
      />,
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('should show empty state when query is empty and no items', () => {
    render(
      <CommandPalette
        open
        onOpenChange={noOp}
        query=""
        onQueryChange={noOp}
        groups={[]}
      />,
    );
    expect(screen.getByText('Start typing to search.')).toBeInTheDocument();
  });

  it('should show no-results state when query is set but no items', () => {
    render(
      <CommandPalette
        open
        onOpenChange={noOp}
        query="zzz"
        onQueryChange={noOp}
        groups={[]}
      />,
    );
    expect(screen.getByText('No results found.')).toBeInTheDocument();
  });

  it('should render group headings and item labels', () => {
    render(
      <CommandPalette
        open
        onOpenChange={noOp}
        query=""
        onQueryChange={noOp}
        groups={mockGroups}
      />,
    );
    expect(screen.getByText('Navigation')).toBeInTheDocument();
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('Connections')).toBeInTheDocument();
    expect(screen.getByText('My Shop')).toBeInTheDocument();
  });

  it('should render item description when provided', () => {
    render(
      <CommandPalette
        open
        onOpenChange={noOp}
        query=""
        onQueryChange={noOp}
        groups={mockGroups}
      />,
    );
    expect(screen.getByText('prestashop')).toBeInTheDocument();
  });

  it('should call onQueryChange when user types', async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    render(
      <CommandPalette
        open
        onOpenChange={noOp}
        query=""
        onQueryChange={onQueryChange}
        groups={[]}
      />,
    );
    await user.type(screen.getByRole('combobox'), 'ord');
    expect(onQueryChange).toHaveBeenCalled();
  });

  it('should call onSelect when an item is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const groups: PaletteGroup[] = [
      { key: 'nav', heading: 'Nav', items: [{ id: 'nav:orders', label: 'Orders', onSelect }] },
    ];
    render(
      <CommandPalette open onOpenChange={noOp} query="" onQueryChange={noOp} groups={groups} />,
    );
    await user.click(screen.getByText('Orders'));
    expect(onSelect).toHaveBeenCalled();
  });

  it('should show loading state', () => {
    render(
      <CommandPalette
        open
        onOpenChange={noOp}
        query="ord"
        onQueryChange={noOp}
        groups={[]}
        loading
      />,
    );
    expect(screen.getByText('Searching…')).toBeInTheDocument();
  });

  it('should use custom placeholder', () => {
    render(
      <CommandPalette
        open
        onOpenChange={noOp}
        query=""
        onQueryChange={noOp}
        groups={[]}
        placeholder="Jump to…"
      />,
    );
    expect(screen.getByPlaceholderText('Jump to…')).toBeInTheDocument();
  });
});

describe('CommandPaletteTrigger', () => {
  it('should render a button with aria-label', () => {
    render(<CommandPaletteTrigger onClick={noOp} />);
    expect(
      screen.getByRole('button', { name: /open command palette/i }),
    ).toBeInTheDocument();
  });

  it('should call onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<CommandPaletteTrigger onClick={onClick} />);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();
  });

  it('should merge custom className', () => {
    render(<CommandPaletteTrigger onClick={noOp} className="custom" />);
    expect(screen.getByRole('button')).toHaveClass('shell-topbar__search', 'custom');
  });

  it('should forward ref to native button', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<CommandPaletteTrigger ref={ref} onClick={noOp} />);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
