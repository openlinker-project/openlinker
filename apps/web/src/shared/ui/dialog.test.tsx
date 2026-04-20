import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from './dialog';

function Harness(): React.ReactElement {
  return (
    <Dialog>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent aria-describedby="desc">
        <DialogTitle>Confirm action</DialogTitle>
        <DialogDescription id="desc">Are you sure?</DialogDescription>
        <DialogFooter>
          <DialogClose>Cancel</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog (Radix wrapper)', () => {
  afterEach(cleanup);

  it('opens the content when the trigger is clicked', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByText('Confirm action')).toBeNull();

    await user.click(screen.getByText('Open'));
    expect(screen.getByText('Confirm action')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('closes when the close element is activated', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText('Open'));
    expect(screen.getByText('Confirm action')).toBeInTheDocument();

    await user.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Confirm action')).toBeNull();
  });
});
