/**
 * Who-decides — stylesheet coverage
 *
 * Every `who-decides-*` class this feature (and its page) puts on an element
 * must have a rule in `index.css`.
 *
 * The `features/returns` sibling exists because nine class names once shipped
 * with no rule behind them and nothing failed: an undefined class is silently
 * valid CSS, so the defect surfaced only as text run together on screen. A
 * class name is a claim that a rule exists; this checks the claim.
 *
 * Scoped to the `who-decides` prefix — the shared primitives own their own
 * classes and are guarded where they live.
 *
 * @module apps/web/src/features/fulfillment-authority
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_SRC = join(__dirname, '..', '..');

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

function whoDecidesClassNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(/className="([^"]+)"/g)) {
    for (const name of match[1].split(/\s+/)) {
      if (name.startsWith('who-decides')) names.add(name);
    }
  }
  // The row and preset components build their class strings from an array, so
  // the literal names never appear inside a `className="…"` attribute.
  for (const match of source.matchAll(/'(who-decides[^']*)'/g)) {
    const name = match[1].trim();
    if (name.length > 0) names.add(name);
  }
  return [...names];
}

describe('who-decides stylesheet coverage', () => {
  it('defines a rule for every who-decides-* class the feature renders', () => {
    const css = readFileSync(join(WEB_SRC, 'index.css'), 'utf8');
    const sources = [
      ...collectSources(join(WEB_SRC, 'features', 'fulfillment-authority')),
      join(WEB_SRC, 'pages', 'settings', 'who-decides-page.tsx'),
    ];

    const used = new Set<string>();
    for (const file of sources) {
      for (const name of whoDecidesClassNames(readFileSync(file, 'utf8'))) used.add(name);
    }

    // A guard over an empty set would pass forever; the classes are the point.
    expect(used.size).toBeGreaterThan(0);

    const undefinedClasses = [...used].filter((name) => !css.includes(`.${name}`));
    expect(undefinedClasses).toEqual([]);
  });

  /**
   * Every custom property a `who-decides-*` rule READS must be DECLARED.
   *
   * `check-design-tokens.mjs` runs catalog -> CSS only, so a reference to a
   * property that was never declared is invisible to it. `var(--x)` with no
   * declaration and no fallback is invalid at computed-value time, which makes
   * the whole shorthand `unset` — `background: var(--surface-1)` shipped seven
   * transparent rows and three transparent cards, and `--accent-strong` gave the
   * selected preset card a `currentColor` border. Neither throws, neither shows
   * up in a class-name check, and both look like a broken page.
   */
  it('references only declared custom properties from who-decides rules', () => {
    const css = readFileSync(join(WEB_SRC, 'index.css'), 'utf8');

    const declared = new Set<string>();
    for (const match of css.matchAll(/--([a-zA-Z0-9-]+)\s*:/g)) declared.add(match[1]);

    // Rule bodies whose selector list mentions a who-decides class.
    const referenced = new Set<string>();
    for (const block of css.matchAll(/([^{}]*who-decides[^{}]*)\{([^}]*)\}/g)) {
      for (const use of block[2].matchAll(/var\(\s*--([a-zA-Z0-9-]+)\s*(\)|,)/g)) {
        // A `var(--x, fallback)` reference is safe by construction.
        if (use[2] === ',') continue;
        referenced.add(use[1]);
      }
    }

    expect(referenced.size).toBeGreaterThan(0);
    expect([...referenced].filter((name) => !declared.has(name))).toEqual([]);
  });

  /**
   * `__inactive` and `__candidates` must occupy DIFFERENT grid areas.
   *
   * CSS Grid STACKS items assigned to one area rather than flowing them, and the
   * two are independently non-empty on the same row — inactive claimants are
   * filtered on `!isActive`, ambiguity is computed over ACTIVE claimants only —
   * so sharing `extras` printed the disabled-connection sentence THROUGH the
   * candidate link list, at every breakpoint.
   */
  it('does not assign two who-decides row parts to one grid area', () => {
    const css = readFileSync(join(WEB_SRC, 'index.css'), 'utf8');

    const areaOf = (className: string): string[] => {
      const areas: string[] = [];
      for (const block of css.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
        if (!block[1].split(',').some((sel) => sel.trim().startsWith(`.${className}`))) continue;
        for (const area of block[2].matchAll(/grid-area:\s*([a-zA-Z0-9_-]+)\s*;/g)) {
          areas.push(area[1]);
        }
      }
      return areas;
    };

    const inactive = areaOf('who-decides-row__inactive');
    const candidates = areaOf('who-decides-row__candidates');
    expect(inactive.length).toBeGreaterThan(0);
    expect(candidates.length).toBeGreaterThan(0);
    expect(inactive.filter((area) => candidates.includes(area))).toEqual([]);
  });
});
