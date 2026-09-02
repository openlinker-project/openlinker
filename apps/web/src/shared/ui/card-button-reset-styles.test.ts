/**
 * Card-button reset — stylesheet + markup contract
 *
 * A `<button>` that wraps a card is a reset button: it exists for the click
 * target, and the card inside it does the drawing. The global `button, .button`
 * rule in `index.css` is written for an ordinary control — it pins
 * `height: 2rem`, centres with `inline-flex`, and paints its own
 * `box-shadow` / `border-radius`. None of that survives contact with an 88px
 * card, and a wrapper that undoes only *some* of it is the bug this guards.
 *
 * `.returns-segment` reset `padding` / `border` / `background` and not `height`,
 * so every card overflowed its 32px button by 28px in each direction and ran
 * through the page description above it. `.orders-segment` and
 * `.products-segment` carried the identical unreset pin and merely hid it:
 * `display: block` sent the overflow downward and `grid-auto-rows:
 * minmax(5.5rem, auto)` happened to equal `.metric-card`'s own `min-height`, so
 * the rows lined up by coincidence. Grow one card past that floor — a
 * description, or a label that wraps at a narrow width — and the grid keeps
 * measuring the 32px button, so the row does not follow and the cards collide.
 *
 * There is no CSS parser anywhere in this pipeline (#2674), so a test over the
 * stylesheet text is the only gate this rule can ever have.
 *
 * @module apps/web/src/shared/ui
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_SRC = join(__dirname, '..', '..');
const CSS_PATH = join(WEB_SRC, 'index.css');

/** The properties the global `button` rule imposes on anything it matches. */
const IMPOSED_BY_GLOBAL_BUTTON = [
  'height',
  'display',
  'padding',
  'border',
  'background',
  'box-shadow',
  'white-space',
] as const;

/**
 * Rule bodies whose selector list contains `selector` as a WHOLE token.
 *
 * Anchored deliberately (#2589): a substring test like
 * `css.includes('.card-button-reset')` also matches
 * `.card-button-reset--wide`, so a class with no rule of its own would pass on
 * a longer sibling's strength — which is exactly the failure mode this file
 * exists to catch.
 */
function ruleBodiesFor(css: string, selector: string): string[] {
  // Comments are stripped first: they carry no braces, so an unstripped banner
  // comment lands inside the captured selector text and `.trim()` leaves it
  // glued to the first selector ("/* Buttons */\nbutton" !== "button").
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const bodies: string[] = [];
  for (const block of bare.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selectors = block[1].split(',').map((s) => s.trim());
    if (selectors.includes(selector)) bodies.push(block[2]);
  }
  return bodies;
}

/** Longhand + shorthand declarations present across every matching rule. */
function declaredProperties(bodies: string[]): Set<string> {
  const props = new Set<string>();
  for (const body of bodies) {
    for (const decl of body.split(';')) {
      const name = decl.split(':')[0]?.trim();
      if (name && !name.startsWith('/*')) props.add(name);
    }
  }
  return props;
}

function collectTsx(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsx(full));
      continue;
    }
    if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) files.push(full);
  }
  return files;
}

describe('card-button reset', () => {
  /**
   * The premise. If the global rule ever stops pinning a height, the reset is
   * still harmless — but this file's reasoning would be stale, and a stale
   * rationale is worse than none.
   */
  it('the global button rule still imposes a fixed height', () => {
    const css = readFileSync(CSS_PATH, 'utf8');
    const bodies = ruleBodiesFor(css, 'button');
    const withHeight = bodies.filter((b) => /(^|;)\s*height\s*:/.test(b));

    expect(withHeight.length).toBeGreaterThan(0);
    expect(withHeight.some((b) => /height\s*:\s*2rem/.test(b))).toBe(true);
  });

  it('.card-button-reset undoes every property the global button rule imposes', () => {
    const css = readFileSync(CSS_PATH, 'utf8');
    const bodies = ruleBodiesFor(css, '.card-button-reset');

    // A guard over a rule that does not exist would otherwise pass vacuously.
    expect(bodies.length).toBeGreaterThan(0);

    const declared = declaredProperties(bodies);
    const missing = IMPOSED_BY_GLOBAL_BUTTON.filter((prop) => !declared.has(prop));
    expect(missing).toEqual([]);
  });

  /**
   * `height: auto` specifically — the property whose absence WAS the defect.
   * Undoing `display` and `box-shadow` hides the symptoms; only releasing the
   * height stops the card overflowing its own button.
   */
  it('.card-button-reset releases the height rather than restating one', () => {
    const css = readFileSync(CSS_PATH, 'utf8');
    const bodies = ruleBodiesFor(css, '.card-button-reset');
    expect(bodies.some((b) => /height\s*:\s*auto/.test(b))).toBe(true);
  });

  /**
   * The anchoring guard-of-the-guard, mirroring the `who-decides` sibling: a
   * fabricated longer selector must NOT satisfy `ruleBodiesFor`, or the
   * assertions above would pass on a neighbour's strength.
   */
  it('matches selectors as whole tokens, not substrings', () => {
    const css = readFileSync(CSS_PATH, 'utf8');
    expect(css.includes('.card-button-reset')).toBe(true);
    expect(ruleBodiesFor(css, '.card-button-rese')).toEqual([]);
  });

  /**
   * Markup half. A surface that wraps a card in a button must SAY so, or it
   * silently inherits the 32px pin again — which is how three strips ended up
   * carrying the same defect with only one of them showing it.
   */
  it('every *-segment card button also carries card-button-reset', () => {
    const offenders: string[] = [];
    for (const file of collectTsx(join(WEB_SRC, 'features')).concat(
      collectTsx(join(WEB_SRC, 'pages')),
    )) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\[\s*'([a-z-]+-segment)'([^\]]*)\]/g)) {
        const array = match[0];
        if (!array.includes('card-button-reset')) {
          offenders.push(`${file.replace(WEB_SRC, '')} → ${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
