/**
 * Order tag pill — stylesheet contract (#3507, mockup M3)
 *
 * The tag pill measured 38 px instead of 22 px on the live order header: its
 * `×` is a `<button>`, and every `<button>` inherits the global button box
 * (`height: 2rem`, padding, border, fill, shadow). A rendered jsdom tree has no
 * cascade, so — the `responsive-containment-styles.test.ts` precedent — a test
 * over the stylesheet text is the only gate this can have. Asserted per
 * selector, never file-wide.
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

describe('order tag pill stylesheet contract (#3507)', () => {
  const css = readFileSync(CSS_PATH, 'utf8');

  it('should keep the pill at the mockup height when it carries a remove button', () => {
    expect(declaredValues(css, '.order-tag', 'height')).toContain('22px');
    expect(declaredValues(css, '.order-tag--sm', 'height')).toContain('18px');
  });

  it('should reset the inherited button box on the bare remove button', () => {
    // The doubled class outranks the toned `.button--*` rules declared later.
    const selector = '.button--bare.button--bare';
    expect(declaredValues(css, selector, 'height')).toContain('1rem');
    expect(declaredValues(css, selector, 'height')).not.toContain('2rem');
    expect(declaredValues(css, selector, 'min-height')).toContain('0');
    expect(declaredValues(css, selector, 'padding')).toContain('0');
    expect(declaredValues(css, selector, 'border')).toContain('0');
    expect(declaredValues(css, selector, 'box-shadow')).toContain('none');
  });

  it('should grow the coarse-pointer tap target through a pseudo-element, not the box', () => {
    expect(declaredValues(css, '.button--bare.button--bare::after', 'inset')).toContain('-14px');
  });

  it('should reset the inherited button box on the picker Create row', () => {
    const selector = '.tag-picker__create.tag-picker__create';
    expect(declaredValues(css, selector, 'height')).toContain('auto');
    expect(declaredValues(css, selector, 'border')).toContain('0');
    expect(declaredValues(css, selector, 'box-shadow')).toContain('none');
  });
});
