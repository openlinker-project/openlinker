/**
 * Release card layout contract (#4154)
 *
 * jsdom has no layout, so the sticky actions and the bounded steps scroller are
 * pinned at the stylesheet: an edit that drops either would bring back a card
 * whose buttons scroll away with its steps.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

describe('release card layout', () => {
  it('should pin the actions to the bottom of the panel list with an opaque background', () => {
    const actions = rule('.release-card__actions');
    expect(actions).toContain('position: sticky');
    expect(actions).toContain('bottom: 0');
    expect(actions).toContain('background: inherit');
  });

  it('should scroll only the steps, within a bounded height', () => {
    const steps = rule('.release-card__collapse > .release-card__steps');
    expect(steps).toContain('overflow-y: auto');
    expect(steps).toContain('max-height');
  });

  it('should keep a focused control clear of the pinned actions', () => {
    expect(rule('.release-panel__list')).toContain('scroll-padding-bottom');
  });
});
