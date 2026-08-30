import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

/** A trigger inside a horizontally scrolling table container, as a cell would be. */
function ClippedTable({ dismiss = false }: { dismiss?: boolean }): ReactElement {
  return (
    <div className="data-table__container" style={{ overflowX: 'auto' }}>
      <table>
        <tbody>
          <tr>
            <td>
              <Popover dismissOnViewportChange={dismiss}>
                <PopoverTrigger>Document</PopoverTrigger>
                <PopoverContent>Invoice FA/2026/08/0144</PopoverContent>
              </Popover>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

describe('Popover (Radix wrapper)', () => {
  afterEach(cleanup);

  it('should toggle content on trigger click', async () => {
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

  it('should render outside a clipping scroll container', async () => {
    // `.data-table__container` sets `overflow-x: auto`, so content positioned
    // inside a cell is cut off at the table's edge. The portal is what stops it.
    const user = userEvent.setup();
    const { container } = render(<ClippedTable />);

    await user.click(screen.getByText('Document'));
    const content = screen.getByText('Invoice FA/2026/08/0144');
    const clipper = container.querySelector('.data-table__container');

    expect(clipper).not.toBeNull();
    expect(clipper?.contains(content)).toBe(false);
    expect(document.body.contains(content)).toBe(true);
  });

  it('should close on a scroll of the clipping ancestor when asked to', async () => {
    const user = userEvent.setup();
    const { container } = render(<ClippedTable dismiss />);

    await user.click(screen.getByText('Document'));
    expect(screen.getByText('Invoice FA/2026/08/0144')).toBeInTheDocument();

    const clipper = container.querySelector('.data-table__container');
    // A scroll event does not bubble, so only a capture-phase listener sees it.
    act(() => {
      clipper?.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(screen.queryByText('Invoice FA/2026/08/0144')).toBeNull();
  });

  it('should close on resize when asked to', async () => {
    const user = userEvent.setup();
    render(<ClippedTable dismiss />);

    await user.click(screen.getByText('Document'));
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(screen.queryByText('Invoice FA/2026/08/0144')).toBeNull();
  });

  it('should survive a scroll inside its own body', async () => {
    // Closing here would make a scrollable panel impossible to read.
    const user = userEvent.setup();
    render(<ClippedTable dismiss />);

    await user.click(screen.getByText('Document'));
    const content = screen.getByText('Invoice FA/2026/08/0144');
    act(() => {
      content.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(screen.getByText('Invoice FA/2026/08/0144')).toBeInTheDocument();
  });

  it('should stay open on a scroll when the caller did not opt in', async () => {
    const user = userEvent.setup();
    const { container } = render(<ClippedTable />);

    await user.click(screen.getByText('Document'));
    act(() => {
      container.querySelector('.data-table__container')?.dispatchEvent(new Event('scroll'));
    });

    expect(screen.getByText('Invoice FA/2026/08/0144')).toBeInTheDocument();
  });

  it('should close on Escape and return focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<ClippedTable dismiss />);

    const trigger = screen.getByText('Document');
    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(screen.queryByText('Invoice FA/2026/08/0144')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('should report every open and close to a controlling caller', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Popover onOpenChange={onOpenChange} dismissOnViewportChange>
        <PopoverTrigger>Document</PopoverTrigger>
        <PopoverContent>Body</PopoverContent>
      </Popover>,
    );

    await user.click(screen.getByText('Document'));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('should honour a controlled open prop', () => {
    const { rerender } = render(
      <Popover open={false} onOpenChange={vi.fn()}>
        <PopoverTrigger>Document</PopoverTrigger>
        <PopoverContent>Body</PopoverContent>
      </Popover>,
    );
    expect(screen.queryByText('Body')).toBeNull();

    rerender(
      <Popover open onOpenChange={vi.fn()}>
        <PopoverTrigger>Document</PopoverTrigger>
        <PopoverContent>Body</PopoverContent>
      </Popover>,
    );
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('should open from defaultOpen without a controlling caller', () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger>Document</PopoverTrigger>
        <PopoverContent>Body</PopoverContent>
      </Popover>,
    );
    expect(screen.getByText('Body')).toBeInTheDocument();
  });
});
