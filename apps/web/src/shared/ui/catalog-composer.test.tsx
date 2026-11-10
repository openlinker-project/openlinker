/**
 * Tests for the composer building blocks: GuideDrawer, HelpHint/GuideTrigger,
 * ComposerSection, ReadbackSentence, SaveButton and StickyActionBar.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ComposerSection } from './composer-section';
import { GuideDrawer } from './guide-drawer';
import { GuideTrigger, HelpHint } from './help-hint';
import { ReadbackSentence } from './readback-sentence';
import { SaveButton } from './save-button';
import { StickyActionBar } from './sticky-action-bar';

const SECTIONS = [
  { id: 'a', number: '01', title: 'First', content: <p>First body</p> },
  { id: 'b', number: '02', title: 'Second', summary: 'two', content: <p>Second body</p> },
];

describe('GuideDrawer', () => {
  it('should open the section a hint pointed at and toggle others on click', async () => {
    render(
      <GuideDrawer
        open
        onOpenChange={() => undefined}
        eyebrow="Guide"
        title="How it works"
        closeLabel="Close"
        sections={SECTIONS}
        initialSectionId="b"
      />,
    );
    expect(screen.getByRole('button', { name: /First/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Second/ })).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('button', { name: /First/ }));
    expect(screen.getByRole('button', { name: /First/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('should ask to close from the close button', async () => {
    const onOpenChange = vi.fn();
    render(
      <GuideDrawer open onOpenChange={onOpenChange} eyebrow="Guide" title="T" closeLabel="Close" sections={SECTIONS} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('HelpHint and GuideTrigger', () => {
  it('should call back when pressed', async () => {
    const hint = vi.fn();
    const trigger = vi.fn();
    render(
      <>
        <HelpHint label="Help: x" onClick={hint} />
        <GuideTrigger label="How it works" onClick={trigger} />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Help: x' }));
    await userEvent.click(screen.getByTestId('guide-trigger'));
    expect(hint).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledTimes(1);
  });
});

describe('ComposerSection and ReadbackSentence', () => {
  it('should render the step, title, aside and body', () => {
    render(
      <ComposerSection step="01" title="Product" aside="the one you sell">
        <p>body</p>
      </ComposerSection>,
    );
    expect(screen.getByRole('heading', { name: /Product/ })).toBeInTheDocument();
    expect(screen.getByText('the one you sell')).toBeInTheDocument();
  });

  it('should render the readback with its name', () => {
    render(
      <ReadbackSentence eyebrow="In one sentence" name="Morning set" sentenceKey="k">
        <b>Coffee</b> in one package.
      </ReadbackSentence>,
    );
    expect(screen.getByText('Morning set')).toBeInTheDocument();
    expect(screen.getByText('Coffee')).toBeInTheDocument();
  });
});

describe('SaveButton and StickyActionBar', () => {
  it('should disable the button while saving and mark the saved state', () => {
    const { rerender } = render(
      <SaveButton state="saving" idleLabel="Save" savingLabel="Saving" savedLabel="Saved" onClick={() => undefined} />,
    );
    expect(screen.getByRole('button')).toBeDisabled();
    rerender(
      <SaveButton state="saved" idleLabel="Save" savingLabel="Saving" savedLabel="Saved" onClick={() => undefined} />,
    );
    expect(screen.getByRole('button')).toHaveClass('is-saved');
  });

  it('should show what is missing and flag ready', () => {
    const { rerender } = render(
      <StickyActionBar statusLabel="Missing" statusText="a component" ready={false}>
        <button>Go</button>
      </StickyActionBar>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Missing');
    expect(screen.getByRole('status')).not.toHaveClass('is-ready');
    rerender(
      <StickyActionBar statusLabel="Ready" statusText="all set" ready>
        <button>Go</button>
      </StickyActionBar>,
    );
    expect(screen.getByRole('status')).toHaveClass('is-ready');
  });
});
