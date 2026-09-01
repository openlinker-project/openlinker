/**
 * Fulfilment worklist — stylesheet coverage and the breakpoint switch (#2410).
 *
 * Structurally the `features/fulfillment-authority/who-decides-styles.test.ts`
 * precedent, reused rather than re-derived: declared-selector MEMBERSHIP (never
 * `css.includes('.' + name)`, which let a rule-less class pass on a longer
 * sibling's selector), a BEM block-root exemption, and the guard-of-the-guard
 * that proves the matcher is stronger than the one that shipped the defect.
 *
 * Scoped to the `fulfilment-worklist` prefix. `.fulfilment-task*` is #2411's
 * and is guarded where it lives; the shared primitives own their own classes.
 *
 * @module apps/web/src/features/fulfillment
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_SRC = join(__dirname, '..', '..');
const PREFIX = 'fulfilment-worklist';

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

function worklistClassNames(source: string): string[] {
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
 * Every `@media` block, by BRACE COUNTING rather than a regex.
 *
 * A `/@media[^}]*}/` stops at the FIRST closing brace, which is the end of the
 * media block's first RULE — so a rule after it reads as outside the block. The
 * whole point of part 3 is knowing which side of a media block a declaration is
 * on, so the extraction has to be exact.
 */
function mediaBlocks(css: string): { condition: string; body: string }[] {
  const blocks: { condition: string; body: string }[] = [];
  let index = css.indexOf('@media');
  while (index !== -1) {
    const open = css.indexOf('{', index);
    if (open === -1) break;
    const condition = css.slice(index + '@media'.length, open).trim();
    let depth = 1;
    let cursor = open + 1;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1;
      else if (css[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    blocks.push({ condition, body: css.slice(open + 1, cursor - 1) });
    index = css.indexOf('@media', cursor);
  }
  return blocks;
}

/**
 * Escape a literal for use inside a `RegExp`.
 *
 * Spelled out rather than inlined into the template below: the inline form
 * silently escaped NOTHING (its character class closed early on `[\\]`, leaving
 * a pattern that matches no real class name), so a class name carrying a regex
 * metacharacter would have made {@link declaresDisplayNone} answer `false` and
 * the breakpoint guard pass while asserting nothing.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Does this chunk of CSS declare `display: none` for `className`? */
function declaresDisplayNone(chunk: string, className: string): boolean {
  const pattern = new RegExp(
    `\\.${escapeRegExp(className)}\\s*\\{[^}]*display\\s*:\\s*none`
  );
  return pattern.test(chunk);
}

describe('fulfilment worklist stylesheet coverage', () => {
  it('defines a rule for every fulfilment-worklist* class the feature renders', () => {
    const css = readCss();
    const sources = [
      ...collectSources(join(WEB_SRC, 'features', 'fulfillment')),
      join(WEB_SRC, 'pages', 'fulfillment', 'fulfillment-worklist-page.tsx'),
    ];

    const used = new Set<string>();
    for (const file of sources) {
      for (const name of worklistClassNames(readFileSync(file, 'utf8'))) used.add(name);
    }

    // A guard over an empty set would pass forever; the classes are the point.
    expect(used.size).toBeGreaterThan(0);

    // ANCHORED, not `css.includes('.' + name)`: a substring test lets a class
    // with no rule of its own pass on the strength of a longer sibling's
    // selector, so the guard could not catch the rendered-invisible defect it
    // exists for. Collect the declared selectors and test membership instead.
    const declared = new Set<string>();
    for (const match of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) declared.add(match[1]);

    // A BEM BLOCK ROOT is a namespace, not a claim of a rule. Requiring the
    // `__`/`--` separator keeps this exact — a LEAF with no rule still fails,
    // because a longer sibling no longer covers it.
    const isBlockRoot = (name: string): boolean =>
      css.includes(`.${name}__`) || css.includes(`.${name}--`);

    const undefinedClasses = [...used].filter(
      (name) => !declared.has(name) && !isBlockRoot(name)
    );
    expect(undefinedClasses).toEqual([]);

    // The guard of the guard. Under the old substring test this fabricated leaf
    // — a truncation of a real class — passed on the strength of its longer
    // sibling, so the check could not fail for the defect it exists to catch.
    const fabricatedLeaf = 'fulfilment-worklist-row__actio';
    expect(declared.has(fabricatedLeaf)).toBe(false);
    expect(isBlockRoot(fabricatedLeaf)).toBe(false);
    expect(css.includes(`.${fabricatedLeaf}`)).toBe(true);
  });

  it('references only declared custom properties from fulfilment-worklist rules', () => {
    // `var(--x)` with no declaration and no fallback is invalid at
    // computed-value time, which makes the whole shorthand `unset` — a
    // transparent row that throws nothing and shows up in no class-name check.
    const css = readCss();

    const declared = new Set<string>();
    for (const match of css.matchAll(/--([a-zA-Z0-9-]+)\s*:/g)) declared.add(match[1]);

    const referenced = new Set<string>();
    for (const block of css.matchAll(
      new RegExp(`([^{}]*${PREFIX}[^{}]*)\\{([^}]*)\\}`, 'g')
    )) {
      for (const use of block[2].matchAll(/var\(\s*--([a-zA-Z0-9-]+)\s*(\)|,)/g)) {
        // A `var(--x, fallback)` reference is safe by construction.
        if (use[2] === ',') continue;
        referenced.add(use[1]);
      }
    }

    expect(referenced.size).toBeGreaterThan(0);
    expect([...referenced].filter((name) => !declared.has(name))).toEqual([]);
  });

  it('does not assign two worklist row parts to one grid area', () => {
    // CSS Grid STACKS items assigned to one area rather than flowing them, so
    // two independently non-empty parts sharing an area print through each
    // other at every breakpoint.
    const css = readCss();

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

    // The row is a plain column grid with no named areas today. Asserted as an
    // equality rather than skipped, so the day one is introduced this case is
    // already here to be filled in rather than remembered.
    expect(areaOf('fulfilment-worklist-row__identity')).toEqual([]);
    expect(areaOf('fulfilment-worklist-row__actions')).toEqual([]);
  });
});

describe('fulfilment worklist breakpoint switch', () => {
  it('hides the desktop surface ONLY inside a max-width media block', () => {
    // Hoisted out of its `@media`, this rule hides the desktop table at every
    // width — or, inverted, renders it on a phone. A regex for `display:none`
    // near the class name passes on a match inside a comment, inside an
    // unrelated `@media`, or on a rule a later block overrides.
    const css = stripComments(readCss());
    const blocks = mediaBlocks(css);

    const inMaxWidth = blocks.filter(
      (block) =>
        block.condition.includes('max-width') &&
        declaresDisplayNone(block.body, 'fulfilment-worklist__desktop')
    );
    expect(inMaxWidth.length).toBe(1);

    // And NOWHERE else: not at top level, not in a min-width block.
    const outsideMediaBlocks = blocks.reduce(
      (rest, block) => rest.replace(block.body, ''),
      css
    );
    expect(declaresDisplayNone(outsideMediaBlocks, 'fulfilment-worklist__desktop')).toBe(false);
    expect(
      blocks
        .filter((block) => !block.condition.includes('max-width'))
        .some((block) => declaresDisplayNone(block.body, 'fulfilment-worklist__desktop'))
    ).toBe(false);
  });

  it('hides the card surface ONLY inside a min-width media block', () => {
    const css = stripComments(readCss());
    const blocks = mediaBlocks(css);

    const inMinWidth = blocks.filter(
      (block) =>
        block.condition.includes('min-width') &&
        declaresDisplayNone(block.body, 'fulfilment-worklist__cards')
    );
    expect(inMinWidth.length).toBe(1);

    const outsideMediaBlocks = blocks.reduce(
      (rest, block) => rest.replace(block.body, ''),
      css
    );
    expect(declaresDisplayNone(outsideMediaBlocks, 'fulfilment-worklist__cards')).toBe(false);
  });

  it('escapes a class name before matching it, rather than only appearing to', () => {
    // The guard of the guard for the escape. The inline escape this replaced
    // matched nothing, so `.` in a class name stayed a wildcard and the rule
    // matched a DIFFERENT class — a breakpoint assertion that reads green
    // against the wrong selector is worse than none.
    expect(declaresDisplayNone('.axb { display: none; }', 'a.b')).toBe(false);
    expect(declaresDisplayNone('.a.b { display: none; }', 'a.b')).toBe(true);
  });

  it('extracts a media block by brace counting, not to its first closing brace', () => {
    // The guard of the guard for part 3: a `/@media[^}]*}/` regex stops at the
    // end of the block's FIRST rule, so a declaration in its second rule reads
    // as top-level. This asserts the extractor sees both.
    const sample = '@media (max-width: 767px) {\n  .a { color: red; }\n  .b { display: none; }\n}';
    const [block] = mediaBlocks(sample);

    expect(block.condition).toBe('(max-width: 767px)');
    expect(declaresDisplayNone(block.body, 'b')).toBe(true);
    // The naive regex would have missed it.
    expect(/@media[^}]*}/.exec(sample)?.[0].includes('display: none')).toBe(false);
  });
});
