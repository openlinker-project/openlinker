/**
 * PopoverOnHover / IconWithOnHoverPopoverTooltip / WarningPopoverTooltip tests
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { IconWithOnHoverPopoverTooltip } from './icon-with-popover-tooltip';
import { InfoIcon } from './icons';
import { PopoverOnHover } from './popover-on-hover';
import { WarningPopoverTooltip } from './warning-popover-tooltip';

afterEach(cleanup);

describe('PopoverOnHover', () => {
  it('opens when the pointer rests on the trigger and closes after it leaves', async () => {
    render(
      <PopoverOnHover
        trigger={(props) => (
          <button type="button" {...props}>
            trigger
          </button>
        )}
      >
        panel text
      </PopoverOnHover>
    );
    const trigger = screen.getByRole('button', { name: 'trigger' });
    expect(screen.queryByText('panel text')).not.toBeInTheDocument();

    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    expect(await screen.findByText('panel text')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.pointerLeave(trigger, { pointerType: 'mouse' });
    await waitFor(() => expect(screen.queryByText('panel text')).not.toBeInTheDocument());
  });

  it('opens on keyboard focus and closes on Escape', async () => {
    render(
      <PopoverOnHover
        trigger={(props) => (
          <button type="button" {...props}>
            trigger
          </button>
        )}
      >
        panel text
      </PopoverOnHover>
    );
    fireEvent.focus(screen.getByRole('button', { name: 'trigger' }));
    expect(await screen.findByText('panel text')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('panel text')).not.toBeInTheDocument());
  });

  it('opens on a tap, where there is no hover, and closes on the next tap', async () => {
    render(
      <PopoverOnHover
        trigger={(props) => (
          <button type="button" {...props}>
            trigger
          </button>
        )}
      >
        panel text
      </PopoverOnHover>
    );
    const trigger = screen.getByRole('button', { name: 'trigger' });
    fireEvent.pointerEnter(trigger, { pointerType: 'touch' });
    fireEvent.pointerDown(trigger, { pointerType: 'touch' });
    fireEvent.click(trigger);
    expect(await screen.findByText('panel text')).toBeInTheDocument();
    fireEvent.pointerDown(trigger, { pointerType: 'touch' });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.queryByText('panel text')).not.toBeInTheDocument());
  });

  it('keeps a hover-opened panel open when the mouse then clicks the trigger', async () => {
    render(
      <PopoverOnHover
        trigger={(props) => (
          <button type="button" {...props}>
            trigger
          </button>
        )}
      >
        panel text
      </PopoverOnHover>
    );
    const trigger = screen.getByRole('button', { name: 'trigger' });
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    await screen.findByText('panel text');
    fireEvent.pointerDown(trigger, { pointerType: 'mouse' });
    fireEvent.click(trigger);
    expect(screen.getByText('panel text')).toBeInTheDocument();
  });
});

describe('IconWithOnHoverPopoverTooltip', () => {
  it('names the icon button and shows the content behind any icon it is given', async () => {
    render(
      <IconWithOnHoverPopoverTooltip icon={<InfoIcon />} label="About this" tone="info">
        the explanation
      </IconWithOnHoverPopoverTooltip>
    );
    const button = screen.getByRole('button', { name: 'About this' });
    expect(button).toHaveClass('icon-tip--info');
    fireEvent.focus(button);
    expect(await screen.findByText('the explanation')).toBeInTheDocument();
  });
});

describe('WarningPopoverTooltip', () => {
  it('is an icon tooltip in the warning tone', async () => {
    render(<WarningPopoverTooltip label="Read this">careful</WarningPopoverTooltip>);
    const button = screen.getByRole('button', { name: 'Read this' });
    expect(button).toHaveClass('icon-tip--warning');
    fireEvent.focus(button);
    expect(await screen.findByText('careful')).toBeInTheDocument();
  });
});
