import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';

function Harness({ onAction }: { onAction: () => void }): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={onAction}>Retry</DropdownMenuItem>
        <DropdownMenuItem>Disable</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe('DropdownMenu (Radix wrapper)', () => {
  afterEach(cleanup);

  it('opens and shows items', async () => {
    const user = userEvent.setup();
    render(<Harness onAction={() => {}} />);

    await user.click(screen.getByText('Open'));
    expect(screen.getByText('Retry')).toBeInTheDocument();
    expect(screen.getByText('Disable')).toBeInTheDocument();
  });

  it('fires onSelect when an item is activated', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(<Harness onAction={onAction} />);

    await user.click(screen.getByText('Open'));
    await user.click(screen.getByText('Retry'));

    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
