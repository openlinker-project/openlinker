import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuideDrawer, useGuideShortcut } from './guide-drawer';
import { HelpHint } from './help-hint';

afterEach(cleanup);

const sections = [
  { id: 'a', title: 'First', body: <p>First body</p> },
  { id: 'b', title: 'Second', tag: '2 steps', body: <p>Second body</p> },
];

function Shortcut({ onOpen }: { onOpen: () => void }): null {
  useGuideShortcut(onOpen);
  return null;
}

describe('GuideDrawer', () => {
  it('should open the first section and expand another on click', () => {
    render(<GuideDrawer open onOpenChange={() => undefined} title="Guide" intro="Intro" sections={sections} />);

    expect(screen.getByText('First body')).toBeInTheDocument();
    expect(screen.queryByText('Second body')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Second/ }));
    expect(screen.getByText('Second body')).toBeInTheDocument();
  });

  it('should open the section named by initialSectionId', () => {
    render(
      <GuideDrawer open onOpenChange={() => undefined} title="Guide" intro="Intro" sections={sections} initialSectionId="b" />,
    );

    expect(screen.getByText('Second body')).toBeInTheDocument();
    expect(screen.queryByText('First body')).toBeNull();
  });
});

describe('useGuideShortcut', () => {
  it('should call onOpen on ? but not while typing', () => {
    const onOpen = vi.fn();
    render(
      <>
        <Shortcut onOpen={onOpen} />
        <input aria-label="field" />
      </>,
    );

    fireEvent.keyDown(document.body, { key: '?' });
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText('field'), { key: '?' });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('HelpHint', () => {
  it('should report its section when clicked', () => {
    const onOpen = vi.fn();
    render(<HelpHint label="Help" sectionId="b" onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(onOpen).toHaveBeenCalledWith('b');
  });
});
