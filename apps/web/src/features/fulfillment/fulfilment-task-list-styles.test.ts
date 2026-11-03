/**
 * Fulfilment tasks panel — mobile containment
 *
 * The task list sits in the implicit `auto` column of `.detail-section`. A grid
 * item keeps `min-width: auto` unless told otherwise, so the column grew to the
 * cards' min-content width and the panel ran off a 390px screen on the order
 * detail page (#3505). This pins the rule that lets the column shrink.
 *
 * @module apps/web/src/features/fulfillment
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(__dirname, '..', '..', 'index.css'), 'utf8');

function ruleBody(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) return '';
  return CSS.slice(start, CSS.indexOf('}', start));
}

describe('fulfilment tasks panel styles', () => {
  it('should let the task list shrink below its content width when it sits in a grid section', () => {
    expect(ruleBody('.fulfilment-task-list')).toMatch(/min-width:\s*0;/);
  });

  it('should let each task card shrink when it sits in the list', () => {
    expect(ruleBody('.fulfilment-task')).toMatch(/min-width:\s*0;/);
  });
});
