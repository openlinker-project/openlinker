/**
 * Release card layout contract (#4154)
 *
 * jsdom has no layout, so the card's structure is pinned at the stylesheet. In the panel and on
 * the What's new rail the actions sit at the end of the card (not floating over its steps, which
 * left a blank band above them) and the step list takes the height it needs instead of scrolling
 * in a box of its own inside the scrolling panel.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');

describe('release card layout', () => {
  it('should place the actions at the end of the card in the panel and on the rail', () => {
    expect(css).toMatch(
      /:is\(\.release-panel, \.whats-new__setup\) \.release-card__actions,[^{]*\{[^}]*position: static/
    );
  });

  it('should let the steps take their natural height and keep no scroll box of their own', () => {
    expect(css).toMatch(/\.release-card__list \{[^}]*display: grid/);
    expect(css).not.toMatch(/\.release-card__steps/);
  });
});
