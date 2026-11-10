/**
 * ComposerSection, ReadbackSentence and StickyActionBar tests (#3935)
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ComposerSection } from './composer-section';
import { ReadbackSentence } from './readback-sentence';
import { StickyActionBar } from './sticky-action-bar';

afterEach(cleanup);

describe('ComposerSection', () => {
  it('should print the step, the title and the aside in the card head', () => {
    render(
      <ComposerSection step="03" title="Channels" aside="2 of 4">
        <p>body</p>
      </ComposerSection>,
    );

    expect(screen.getByRole('heading', { name: '03 Channels' })).toBeInTheDocument();
    expect(screen.getByText('2 of 4')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('should draw no head for a card with neither a title nor an aside', () => {
    const { container } = render(
      <ComposerSection>
        <p>tabs</p>
      </ComposerSection>,
    );

    expect(container.querySelector('.pm-card__head')).toBeNull();
  });
});

describe('ReadbackSentence', () => {
  it('should frame the sentence under its eyebrow and name', () => {
    render(
      <ReadbackSentence eyebrow="The rule" name="Mug">
        When an order is big, we add a mug.
      </ReadbackSentence>,
    );

    expect(screen.getByText('The rule')).toBeInTheDocument();
    expect(screen.getByText('Mug')).toBeInTheDocument();
    expect(screen.getByText(/we add a mug/)).toBeInTheDocument();
  });
});

describe('StickyActionBar', () => {
  it('should list what is missing, and say it is ready when nothing is', () => {
    const { rerender } = render(
      <StickyActionBar missingLabel="Missing:" missing="name, gift" readyText="Ready">
        <button type="button">Go</button>
      </StickyActionBar>,
    );
    expect(screen.getByText('Missing:')).toBeInTheDocument();
    expect(screen.getByText('name, gift')).toBeInTheDocument();

    rerender(
      <StickyActionBar missingLabel="Missing:" missing="" readyText="Ready">
        <button type="button">Go</button>
      </StickyActionBar>,
    );
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });
});
