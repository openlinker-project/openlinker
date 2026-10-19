/**
 * Invoice connection lock — stylesheet contract (#3484)
 *
 * `.invoice-connection-lock__hint` once carried `grid-column: 2` (#2047), lost
 * it (#2809) and got it back (#3484). Without it a bare hint is auto-placed into
 * the glyph's `auto` column, which grows to the hint's width and squeezes the
 * text column to one word per line. The settled state hid the loss because its
 * `__why` wrapper has its own `grid-column`, so only a stylesheet test can see
 * it — the `order-tag-styles.test.ts` precedent. Asserted per selector.
 *
 * @module apps/web/src/features/orders/components
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS_PATH = join(__dirname, '..', '..', '..', 'index.css');

/** Rule bodies whose selector list contains `selector` as a WHOLE token (#2589). */
function ruleBodiesFor(css: string, selector: string): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const bodies: string[] = [];
  for (const block of bare.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selectors = block[1].split(',').map((s) => s.trim());
    if (selectors.includes(selector)) bodies.push(block[2]);
  }
  return bodies;
}

function declaredValues(css: string, selector: string, property: string): string[] {
  return ruleBodiesFor(css, selector)
    .flatMap((body) => body.split(';'))
    .map((decl) => decl.trim())
    .filter((decl) => decl.startsWith(`${property}:`))
    .map((decl) => decl.slice(property.length + 1).trim());
}

describe('invoice connection lock stylesheet contract (#3484)', () => {
  const css = readFileSync(CSS_PATH, 'utf8');

  it('should place a bare hint in the text column when no __why wrapper carries it', () => {
    expect(declaredValues(css, '.invoice-connection-lock__hint', 'grid-column')).toContain('2');
  });
});
