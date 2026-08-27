/**
 * Custody touch targets (#2380)
 *
 * The acceptance criterion is *"all targets ≥44 px; usable at 768 px"*, and the
 * returns spec § 5.2 frames its declared style-guide departure the same way —
 * in terms of WIDTH.
 *
 * The stylesheet's global 44 px floor is keyed on
 * `@media (hover: none) and (pointer: coarse)`, i.e. on POINTER TYPE. It does
 * not fire for a 768 px desktop window, and it cannot fire in jsdom at all — so
 * inheriting it would make the criterion a claim nothing proves.
 *
 * This asserts the custody rules are declared unconditionally, OUTSIDE any
 * media query. It reads the stylesheet as text because jsdom does not compute
 * media-dependent styles: the alternative is a component test that passes while
 * the guarantee is absent, which is the failure mode this file exists to stop.
 *
 * @module apps/web/src/features/returns/lib
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../index.css'),
  'utf8',
);

/**
 * The stylesheet with every `@media` block removed.
 *
 * Brace-counting rather than a regex, because the blocks nest and a
 * non-greedy match would stop at the first inner `}` and leave the rest of a
 * media block looking unconditional — which would make this test pass for
 * exactly the arrangement it exists to reject.
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

describe('custody touch targets (#2380)', () => {
  const unconditional = unconditionalCss(stylesheet);

  it('should declare the 44 px floor outside any media query', () => {
    const rule = unconditional.match(
      /\.return-custody-form input,[\s\S]*?\{[\s\S]*?min-height:\s*44px[\s\S]*?\}/,
    );

    expect(rule).not.toBeNull();
  });

  it('should apply the floor to the segmented control the dispose form uses', () => {
    expect(unconditional).toMatch(
      /\.return-custody-form \.segmented-control__option \{[\s\S]*?min-height:\s*44px/,
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
