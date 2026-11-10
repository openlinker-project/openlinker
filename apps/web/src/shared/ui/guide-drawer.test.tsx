import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuideButton, GuideDrawer, useGuideDrawer, type GuideSection } from './guide-drawer';
import { HelpHint } from './help-hint';

const sections: GuideSection[] = [
  {
    id: 's-one',
    number: '01',
    title: 'First',
    summary: 'closed by default',
    defaultOpen: true,
    items: [{ id: 'item-a', name: 'Item A', text: 'About A' }],
  },
  { id: 's-two', number: '02', title: 'Second', items: [{ id: 'item-b', name: 'Item B', text: 'About B' }] },
];

function Harness(): ReturnType<typeof GuideDrawer> {
  const guide = useGuideDrawer();
  return (
    <>
      <GuideButton label="Open guide" onClick={() => guide.show()} />
      <HelpHint label="About: B" onClick={() => guide.show('item-b')} />
      <GuideDrawer
        open={guide.open}
        onOpenChange={guide.onOpenChange}
        focusItemId={guide.itemId}
        title="The guide"
        lede="Short lede"
        sections={sections}
      />
    </>
  );
}

describe('GuideDrawer', () => {
  afterEach(cleanup);

  it('should open on the question mark key and close on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByTestId('guide-drawer')).toBeNull();
    await user.keyboard('?');
    expect(screen.getByRole('dialog', { name: 'The guide' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('guide-drawer')).toBeNull();
  });

  it('should not open from the shortcut while typing in a field', async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="field" />
        <Harness />
      </>,
    );
    await user.click(screen.getByLabelText('field'));
    await user.keyboard('?');
    expect(screen.queryByTestId('guide-drawer')).toBeNull();
  });

  it('should open only the section of the item a hint points at', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'About: B' }));
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole('button', { name: /Second/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /First/ })).toHaveAttribute('aria-expanded', 'false');
    vi.useRealTimers();
  });

  it('should let a section be toggled by its header', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open guide' }));
    const second = screen.getByRole('button', { name: /Second/ });
    expect(second).toHaveAttribute('aria-expanded', 'false');
    await user.click(second);
    expect(second).toHaveAttribute('aria-expanded', 'true');
  });
});
