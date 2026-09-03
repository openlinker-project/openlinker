/**
 * Returns — stylesheet coverage
 *
 * Every `returns-*` class the feature's components and pages put on an element
 * must have a rule in `index.css`.
 *
 * This exists because nine class names shipped with no rule behind them, and
 * nothing failed: an undefined class is silently valid CSS, so the defect
 * surfaced only as an item name run into its SKU ("Blue ShirtSKU-1") and a
 * badge butted against an id. A class name is a claim that a rule exists; this
 * checks the claim rather than trusting it.
 *
 * Scoped to the `returns-` prefix on purpose — the shared primitives own their
 * own classes and are guarded where they live.
 *
 * @module apps/web/src/features/returns
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

function returnsClassNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(/className="([^"]+)"/g)) {
    for (const name of match[1].split(/\s+/)) {
      if (name.startsWith('returns-')) names.add(name);
    }
  }
  return [...names];
}

describe('returns stylesheet coverage', () => {
  it('defines a rule for every returns-* class the feature renders', () => {
    const css = readFileSync(join(WEB_SRC, 'index.css'), 'utf8');
    const sources = [
      ...collectSources(join(WEB_SRC, 'features', 'returns')),
      ...collectSources(join(WEB_SRC, 'pages', 'returns')),
    ];

    const used = new Set<string>();
    for (const file of sources) {
      for (const name of returnsClassNames(readFileSync(file, 'utf8'))) used.add(name);
    }

    // A guard over an empty set would pass forever; the classes are the point.
    expect(used.size).toBeGreaterThan(0);

    const undefinedClasses = [...used].filter((name) => !css.includes(`.${name}`));
    expect(undefinedClasses).toEqual([]);
  });
});
