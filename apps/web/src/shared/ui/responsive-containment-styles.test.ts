/**
 * Responsive containment — stylesheet contract (#2388)
 *
 * Two shared-primitive rules that a unit test, a type check and a rendered
 * jsdom tree are all structurally blind to, because each is a property of the
 * CASCADE rather than of any component's output. There is no CSS parser
 * anywhere in this pipeline (#2674), so a test over the stylesheet text is the
 * only gate either rule can ever have.
 *
 * Both were found by measuring the running app during the Wave-2 responsive
 * audit, and both had already shipped: neither is hypothetical.
 *
 * 1. `.data-table__container` must establish a containing block. An element
 *    with `overflow` only clips a descendant for which it is in the
 *    containing-block chain, and a `position: static` box never is. `.sr-only`
 *    is `position: absolute`, so every screen-reader label inside a row sat at
 *    its static x — inside the wide table — and escaped the container's
 *    `overflow-x` entirely. Measured on `/orders` at 768 px:
 *    `documentElement.scrollWidth` 947 against `clientWidth` 768, and the page
 *    really scrolled ~180 px sideways onto blank space.
 *
 * 2. `.key-value-list` must let an over-wide value shrink. Its
 *    `grid-template-columns: 1fr` is `minmax(auto, 1fr)`, and that `auto`
 *    minimum floors the track at the widest item's min-content — so a value
 *    carrying a non-wrapping inline-flex child pushed the track past the list's
 *    own box, which `overflow: hidden` then CUT, with no ellipsis and no
 *    scrollbar. Measured on `/returns` at 375 px: 3 of 8 lists held a 434 px
 *    track inside a 311 px box.
 *
 * Both are asserted as PER-SELECTOR facts, never as a file-wide property.
 * `index.css` is one global stylesheet with no provenance marker, so a test
 * cannot know which rules belong to which wave; a file-wide assertion would
 * either fail on rules this audit deliberately left alone or be quietly
 * narrowed to an unstated list — and a guard weakened after it first went red
 * is the #2589 failure in a new costume.
 *
 * @module apps/web/src/shared/ui
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS_PATH = join(__dirname, '..', '..', 'index.css');

/**
 * Rule bodies whose selector list contains `selector` as a WHOLE token.
 *
 * Anchored deliberately (#2589, and copied from
 * `card-button-reset-styles.test.ts`): a substring test like
 * `css.includes('.key-value-list')` also matches `.key-value-list__value`, so a
 * selector with no rule of its own would pass on a longer sibling's strength.
 */
function ruleBodiesFor(css: string, selector: string): string[] {
  // Comments are stripped first: they carry no braces, so an unstripped banner
  // comment lands inside the captured selector text and `.trim()` leaves it
  // glued to the first selector.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const bodies: string[] = [];
  for (const block of bare.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selectors = block[1].split(',').map((s) => s.trim());
    if (selectors.includes(selector)) bodies.push(block[2]);
  }
  return bodies;
}

/** Every declared value for `property` across the rules matching `selector`. */
function declaredValues(css: string, selector: string, property: string): string[] {
  return ruleBodiesFor(css, selector)
    .flatMap((body) => body.split(';'))
    .map((decl) => decl.trim())
    .filter((decl) => decl.startsWith(`${property}:`))
    .map((decl) => decl.slice(property.length + 1).trim());
}

describe('responsive containment stylesheet contract (#2388)', () => {
  const css = readFileSync(CSS_PATH, 'utf8');

  describe('.data-table__container clips its absolutely-positioned descendants', () => {
    it('still declares the horizontal overflow the clip depends on', () => {
      // The premise. Without `overflow-x`, `position` below would be clipping
      // nothing and the test would pass while asserting something vacuous.
      expect(declaredValues(css, '.data-table__container', 'overflow-x')).toContain('auto');
    });

    it('establishes a containing block, so that overflow actually clips', () => {
      const positions = declaredValues(css, '.data-table__container', 'position');
      expect(positions.length).toBeGreaterThan(0);
      // `static` is the one value that does NOT create a containing block, so
      // it is the one value that reopens the ~180 px page scroll.
      expect(positions).not.toContain('static');
    });
  });

  describe('.key-value-list lets an over-wide value shrink instead of clipping it', () => {
    it('still hides its own overflow, which is what made the cut silent', () => {
      // The premise, again: this is why the symptom was a truncation with no
      // scrollbar rather than a visible overflow.
      expect(declaredValues(css, '.key-value-list', 'overflow')).toContain('hidden');
    });

    it('releases the min-content floor on the value and its label', () => {
      expect(declaredValues(css, '.key-value-list__label', 'min-width')).toContain('0');
      expect(declaredValues(css, '.key-value-list__value', 'min-width')).toContain('0');
    });

    it('bounds the value’s children, so a child’s own ellipsis can fire', () => {
      // `min-width: 0` alone lets the TRACK shrink; an inline-level child in a
      // block value box still sizes to its own max-content. This is the host
      // half of the containment pattern the #2094 connection fold documents.
      expect(declaredValues(css, '.key-value-list__value > *', 'max-width')).toContain('100%');
    });
  });

  describe('guard of the guard', () => {
    it('matches selectors as whole tokens, not as substrings', () => {
      // A deliberately truncated selector must find nothing. If this ever
      // returns rules, `ruleBodiesFor` has decayed into a substring match and
      // every assertion above is passing on a longer sibling's strength.
      expect(ruleBodiesFor(css, '.data-table__containe')).toEqual([]);
      expect(ruleBodiesFor(css, '.key-value-list__valu')).toEqual([]);
    });

    it('does not treat a longer sibling as the selector it prefixes', () => {
      // `.key-value-list` and `.key-value-list__value` are distinct rules; a
      // substring matcher would conflate them and silently read the wrong body.
      const listOverflow = declaredValues(css, '.key-value-list', 'overflow');
      const valueOverflow = declaredValues(css, '.key-value-list__value', 'overflow');
      expect(listOverflow).toContain('hidden');
      expect(valueOverflow).not.toContain('hidden');
    });
  });
});
