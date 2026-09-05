/**
 * Bench touch targets and motion (#2421, `W3b-8`, story C4)
 *
 * The acceptance criterion is *"targets ≥44 px keyed to width, **not** behind a
 * coarse-pointer media query"*, and § 2.3 frames C4's conditions the same way —
 * a bench-height screen and gloves, not a particular input device.
 *
 * The stylesheet's global 44 px floor is keyed on
 * `@media (hover: none) and (pointer: coarse)`, i.e. on POINTER TYPE. A bench
 * terminal is routinely a mouse-driven all-in-one, so that rule does not fire
 * for it; it does not fire for a 768 px desktop window either, and it cannot
 * fire in jsdom at all. Inheriting it would make the criterion a claim nothing
 * proves — the trap #2380 recorded for the returns custody forms.
 *
 * This asserts the bench rules are declared UNCONDITIONALLY. It reads the
 * stylesheet as text because jsdom does not compute media-dependent styles: the
 * alternative is a component test that passes while the guarantee is absent,
 * which is the failure mode this file exists to stop.
 *
 * @module apps/web/src/features/bench/lib
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../index.css'),
  'utf8'
);

/**
 * The stylesheet with every `@media` block removed.
 *
 * Brace-counting rather than a regex, because the blocks nest and a non-greedy
 * match would stop at the first inner `}` and leave the rest of a media block
 * looking unconditional — which would make this test pass for exactly the
 * arrangement it exists to reject. Same shape as
 * `features/returns/lib/custody-touch-targets.test.ts` (#2380).
 */
function unconditionalCss(css: string): string {
  let out = '';
  let index = 0;

  while (index < css.length) {
    const at = css.indexOf('@media', index);
    if (at === -1) {
      out += css.slice(index);
      break;
    }

    out += css.slice(index, at);

    const open = css.indexOf('{', at);
    if (open === -1) break;

    let depth = 1;
    let cursor = open + 1;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1;
      else if (css[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    index = cursor;
  }

  return out;
}

describe('bench touch targets (#2421, C4)', () => {
  const unconditional = unconditionalCss(stylesheet);

  it('should declare the 44 px floor on the parcel surface outside any media query', () => {
    expect(unconditional).toMatch(
      /\.bench-parcel \.button,[\s\S]*?\{[\s\S]*?min-height:\s*44px[\s\S]*?min-width:\s*44px/
    );
  });

  it('should declare the 44 px floor on the per-line confirm control outside any media query', () => {
    expect(unconditional).toMatch(
      /\.bench-parcel-line__actions \.button \{[\s\S]*?min-height:\s*44px[\s\S]*?min-width:\s*44px/
    );
  });

  it('should keep the work-list floor unconditional too', () => {
    // #2416 already declared this; asserted here so a later "tidy-up" that
    // folds it into the pointer media query fails rather than passing quietly.
    expect(unconditional).toMatch(
      /\.bench-work-row__actions \.button \{[\s\S]*?min-height:\s*2\.75rem/
    );
  });

  it('should NOT carry the bench floor inside a coarse-pointer media query', () => {
    // The positive assertions above would still pass if a SECOND, media-scoped
    // copy existed — so this asserts the absence directly. A pointer-keyed copy
    // is not merely redundant: it is the thing a reader would then "simplify"
    // the unconditional one away into.
    const pointerBlocks = stylesheet.match(/@media \([^)]*pointer:\s*coarse[^)]*\)[\s\S]{0,4000}/g);
    for (const block of pointerBlocks ?? []) {
      expect(block.slice(0, block.indexOf('\n}\n') + 1)).not.toContain('.bench-parcel');
    }
  });

  it('should suppress the only bench animation under prefers-reduced-motion', () => {
    // The in-flight pulse. Its words remain, so nothing is lost — which is why
    // suppressing it is safe and why the marker is not animation-only.
    expect(stylesheet).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.bench-parcel-line--pending \{[\s\S]*?animation:\s*none/
    );
  });

  it('should keep the brace-counting stripper honest about nested blocks', () => {
    const sample = '.a{min-height:44px}@media (x){.b{min-height:44px}.c{min-height:1px}}.d{}';

    const stripped = unconditionalCss(sample);

    expect(stripped).toContain('.a{min-height:44px}');
    // The whole media block goes, not just up to its first closing brace.
    expect(stripped).not.toContain('.b');
    expect(stripped).not.toContain('.c');
    expect(stripped).toContain('.d{}');
  });
});
