/**
 * GuideDrawer tests (#3935)
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GuideProvider, type GuideContent } from './guide-drawer';
import { HelpHint } from './help-hint';

const content: GuideContent = {
  eyebrow: 'Guide',
  title: 'How it works',
  lede: 'Short.',
  closeLabel: 'Close',
  footer: 'Press ? to open',
  sections: [
    { id: 's-a', number: '01', title: 'First', items: [{ id: 'g-a', name: 'A', body: 'About A' }] },
    { id: 's-b', number: '02', title: 'Second', items: [{ id: 'g-b', name: 'B', body: 'About B' }] },
  ],
};

function mount(): void {
  render(
    <div id="root">
      <GuideProvider content={content}>
        <HelpHint guide="g-b" label="About B" />
        <input aria-label="field" />
      </GuideProvider>
    </div>,
  );
}

const drawer = (): HTMLElement => document.querySelector('.pm-guide') as HTMLElement;

afterEach(cleanup);

describe('GuideDrawer', () => {
  it('should be closed until asked and open at the entry a hint names', () => {
    mount();
    expect(drawer()).toHaveAttribute('data-open', 'false');

    fireEvent.click(screen.getByLabelText('About B'));

    expect(drawer()).toHaveAttribute('data-open', 'true');
    expect(document.getElementById('s-b')).toHaveAttribute('data-open', 'true');
    expect(document.getElementById('s-a')).toHaveAttribute('data-open', 'false');
  });

  it('should open on the question mark key and close on Escape', () => {
    mount();

    fireEvent.keyDown(document.body, { key: '?' });
    expect(drawer()).toHaveAttribute('data-open', 'true');

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(drawer()).toHaveAttribute('data-open', 'false');
  });

  it('should not take the question mark while the operator is typing', () => {
    mount();

    fireEvent.keyDown(screen.getByLabelText('field'), { key: '?' });

    expect(drawer()).toHaveAttribute('data-open', 'false');
  });

  it('should open and close sections by their heads', () => {
    mount();
    const head = document.querySelector('#s-a .pm-gsec__head') as HTMLElement;

    fireEvent.click(head);
    expect(document.getElementById('s-a')).toHaveAttribute('data-open', 'true');

    fireEvent.click(head);
    expect(document.getElementById('s-a')).toHaveAttribute('data-open', 'false');
  });
});

describe('HelpHint', () => {
  it('should render nothing outside a guide provider', () => {
    render(<HelpHint guide="g-a" label="About A" />);
    expect(screen.queryByLabelText('About A')).not.toBeInTheDocument();
  });
});
