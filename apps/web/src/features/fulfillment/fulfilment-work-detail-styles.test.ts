/**
 * Fulfilment work detail — stylesheet coverage (#3098).
 *
 * The matcher is `fulfilment-worklist-styles.test.ts`'s, re-pointed at the
 * `fulfilment-work-detail` prefix: declared-selector MEMBERSHIP (never
 * `css.includes('.' + name)`, which lets a rule-less class pass on a longer
 * sibling's selector), a BEM block-root exemption, and a guard-of-the-guard
 * proving the matcher is stronger than the one that shipped the defect.
 *
 * ## The breakpoint half is INVERTED relative to the assign board
 *
 * That board's own card is one composition at every width — no
 * desktop/mobile swap — and so is this detail page, so the assertion that
 * carries meaning here is that nothing hides any part of it, at any width.
 * Copying a worklist-shaped `display: none` expectation would assert a
 * layout this page does not have.
 *
 * @module apps/web/src/features/fulfillment
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_SRC = join(__dirname, '..', '..');
const PREFIX = 'fulfilment-work-detail';

function collectSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSources(full));
      continue;
    }
    if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) files.push(full);
  }
  return files;
}

function detailClassNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(/className="([^"]+)"/g)) {
    for (const name of match[1].split(/\s+/)) {
      if (name.startsWith(PREFIX)) names.add(name);
    }
  }
  // A component that builds its class string from an array never puts the
  // literal inside a `className="…"` attribute.
  for (const match of source.matchAll(new RegExp(`'(${PREFIX}[^']*)'`, 'g'))) {
    const name = match[1].trim();
    if (name.length > 0) names.add(name);
  }
  return [...names];
}

function readCss(): string {
  return readFileSync(join(WEB_SRC, 'index.css'), 'utf8');
}

/** A commented-out rule is the exact vector a naive regex matches. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Escape a literal for use inside a `RegExp`.
 *
 * Spelled out rather than inlined: a class name carrying a regex
 * metacharacter must not silently make the hiding guard pass while asserting
 * nothing.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Does this chunk of CSS declare `display: none` for `className`? */
function declaresDisplayNone(chunk: string, className: string): boolean {
  const pattern = new RegExp(`\\.${escapeRegExp(className)}\\s*\\{[^}]*display\\s*:\\s*none`);
  return pattern.test(chunk);
}

function usedClassNames(): Set<string> {
  const sources = [
    ...collectSources(join(WEB_SRC, 'features', 'fulfillment')),
    join(WEB_SRC, 'pages', 'fulfillment', 'fulfillment-work-detail-page.tsx'),
  ];

  const used = new Set<string>();
  for (const file of sources) {
    for (const name of detailClassNames(readFileSync(file, 'utf8'))) used.add(name);
  }
  return used;
}

describe('fulfilment work detail stylesheet coverage', () => {
  it('defines a rule for every fulfilment-work-detail* class the page renders', () => {
    const css = readCss();
    const used = usedClassNames();

    // A guard over an empty set would pass forever; the classes are the point.
    expect(used.size).toBeGreaterThan(0);

    // ANCHORED, not `css.includes('.' + name)`: a substring test lets a class
    // with no rule of its own pass on the strength of a longer sibling's
    // selector, so the guard could not catch the rendered-invisible defect it
    // exists for. Collect the declared selectors and test membership instead.
    const declared = new Set<string>();
    for (const match of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) declared.add(match[1]);

    // A BEM BLOCK ROOT is a namespace, not a claim of a rule. Requiring the
    // `__`/`--` separator keeps this exact - a LEAF with no rule still fails,
    // because a longer sibling no longer covers it.
    const isBlockRoot = (name: string): boolean =>
      css.includes(`.${name}__`) || css.includes(`.${name}--`);

    expect([...used].filter((name) => !declared.has(name) && !isBlockRoot(name))).toEqual([]);

    // The guard of the guard. Under a substring test this fabricated leaf - a
    // truncation of a real class - passes on the strength of its longer
    // sibling, so the check could not fail for the defect it exists to catch.
    const fabricatedLeaf = `${PREFIX}__hero-su`;
    expect(declared.has(fabricatedLeaf)).toBe(false);
    expect(isBlockRoot(fabricatedLeaf)).toBe(false);
    expect(css.includes(`.${fabricatedLeaf}`)).toBe(true);
  });

  it('references only declared custom properties from fulfilment-work-detail rules', () => {
    // `var(--x)` with no declaration and no fallback is invalid at
    // computed-value time, which makes the whole shorthand `unset` - an
    // invisible section that throws nothing and shows up in no class-name
    // check.
    const css = readCss();

    const declared = new Set<string>();
    for (const match of css.matchAll(/--([a-zA-Z0-9-]+)\s*:/g)) declared.add(match[1]);

    const referenced = new Set<string>();
    for (const block of css.matchAll(new RegExp(`([^{}]*${PREFIX}[^{}]*)\\{([^}]*)\\}`, 'g'))) {
      for (const use of block[2].matchAll(/var\(\s*--([a-zA-Z0-9-]+)\s*(\)|,)/g)) {
        // A `var(--x, fallback)` reference is safe by construction.
        if (use[2] === ',') continue;
        referenced.add(use[1]);
      }
    }

    expect(referenced.size).toBeGreaterThan(0);
    expect([...referenced].filter((name) => !declared.has(name))).toEqual([]);
  });

  it('never hides a part of the detail page, at any width', () => {
    // The page is ONE composition rather than a desktop/card swap, so a
    // `display: none` on any of its parts hides an operator-facing fact
    // outright - the hero's two axis labels most of all - instead of handing
    // it to a sibling surface the way a breakpoint swap would.
    const css = stripComments(readCss());

    const hidden = [...usedClassNames()].filter((name) => declaresDisplayNone(css, name));
    expect(hidden).toEqual([]);
  });

  /**
   * The box model the mockups are drawn with (#3096). The page used to pass
   * every class-presence check while rendering its sections as flat blocks on
   * the page background, so the declarations themselves are asserted here.
   */
  describe('the mockup box model (#3096)', () => {
    function ruleBody(css: string, selector: string): string {
      const match = new RegExp(`(^|[\\s}])${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`).exec(css);
      expect(match, `no rule for ${selector}`).not.toBeNull();
      return match?.[2] ?? '';
    }

    it('should draw every detail section as a bordered, raised card', () => {
      const body = ruleBody(stripComments(readCss()), '.detail-card');

      expect(body).toMatch(/border:\s*1px solid var\(--border-default\)/);
      expect(body).toMatch(/border-radius:\s*var\(--radius-lg\)/);
      expect(body).toMatch(/box-shadow:\s*var\(--shadow-xs\)/);
      expect(body).toMatch(/background:\s*var\(--bg-surface\)/);
      expect(body).toMatch(/padding:\s*1\.25rem var\(--space-5\)/);
    });

    // e2e v2: the reused order-page panels kept their own 15 px title and inset
    // beside the 12 px uppercase DetailSection titles.
    it('should give the reused Shipment and Sales document panels the card title and box', () => {
      const css = stripComments(readCss());
      const title = ruleBody(
        css,
        `.${PREFIX}__slot--invoicing .sales-document-panel__header > .detail-section__title`
      );
      const box = ruleBody(css, `.${PREFIX}__slot--invoicing .sales-document-panel`);

      expect(title).toMatch(/font-size:\s*0\.75rem/);
      expect(title).toMatch(/font-weight:\s*700/);
      expect(title).toMatch(/text-transform:\s*uppercase/);
      expect(title).toMatch(/color:\s*var\(--text-muted\)/);
      expect(box).toMatch(/padding:\s*1\.25rem var\(--space-5\)/);
      expect(box).toMatch(/border-color:\s*var\(--border-default\)/);
      expect(css).toContain(`.${PREFIX}__slot--shipment .order-shipment-panel__header > .detail-section__title`);
    });

    it('should lay the facts out in two columns at every width', () => {
      const body = ruleBody(stripComments(readCss()), `.${PREFIX}__facts`);

      expect(body).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    });

    it('should give the board filter a width, never a flex-basis a column turns into a height', () => {
      const css = stripComments(readCss());
      const body = ruleBody(css, '.assign-packing-work-toolbar__filter');

      expect(body).toMatch(/flex:\s*none/);
      expect(body).toMatch(/width:\s*min\(20rem,\s*100%\)/);
      // The rule that drew 324 x 320 px inputs on a phone must not come back.
      expect(css).not.toMatch(/\.assign-packing-work-filters\s*>\s*\*\s*\{[^}]*flex:\s*0 1 20rem/);
    });

    it('should wrap the board metrics by grid track, never by flex line', () => {
      const body = ruleBody(stripComments(readCss()), '.kpi-grid');

      expect(body).toMatch(/display:\s*grid/);
      expect(body).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(160px,\s*1fr\)\)/);
    });
  });

  it('escapes a class name before matching it, rather than only appearing to', () => {
    // The guard of the guard for the escape: an escape that matched nothing
    // would leave `.` a wildcard, so the rule above would test a DIFFERENT
    // class and read green against the wrong selector.
    expect(declaresDisplayNone('.axb { display: none; }', 'a.b')).toBe(false);
    expect(declaresDisplayNone('.a.b { display: none; }', 'a.b')).toBe(true);
  });
});
