import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

describe('Popover (Radix wrapper)', () => {
  afterEach(cleanup);

  it('toggles content on trigger click', async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Filters</PopoverTrigger>
        <PopoverContent>Filter body</PopoverContent>
      </Popover>,
    );

    expect(screen.queryByText('Filter body')).toBeNull();
    await user.click(screen.getByText('Filters'));
    expect(screen.getByText('Filter body')).toBeInTheDocument();
  });
});
