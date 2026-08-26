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
});
