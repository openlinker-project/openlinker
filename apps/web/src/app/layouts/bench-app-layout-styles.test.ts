/**
 * Bench app layout - stylesheet contract (#3653, story A4)
 *
 * The rest of the application hides the user chip's name below 768 px and
 * shows only the avatar initials. The pack bench must not: A4 wants the
 * signed-in packer's name visible without opening a menu, and a bench terminal
 * may be a narrow or portrait touch screen. The override is a property of the
 * CASCADE, which a jsdom render cannot see, so it is asserted over the
 * stylesheet text here (the `responsive-containment-styles.test.ts` approach).
 *
 * @module app/layouts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS_PATH = join(__dirname, '..', '..', 'index.css');
const NARROW_QUERY = '@media (max-width: 767px)';

/** The bodies of every `@media (max-width: 767px)` block, brace-matched. */
function narrowMediaBlocks(css: string): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks: string[] = [];
  let from = bare.indexOf(NARROW_QUERY);
  while (from !== -1) {
    const open = bare.indexOf('{', from);
    let depth = 1;
    let i = open + 1;
    while (depth > 0 && i < bare.length) {
      if (bare[i] === '{') depth += 1;
      if (bare[i] === '}') depth -= 1;
      i += 1;
    }
    blocks.push(bare.slice(open + 1, i - 1));
    from = bare.indexOf(NARROW_QUERY, i);
  }
  return blocks;
}

/**
 * Every declared value for `property` in rules whose selector list contains
 * `selector` as a WHOLE token - anchored so a longer sibling selector cannot
 * satisfy the assertion on its own strength (#2589).
 */
function declaredValues(scope: string, selector: string, property: string): string[] {
  const values: string[] = [];
  for (const rule of scope.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selectors = rule[1].split(',').map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const decl of rule[2].split(';').map((d) => d.trim())) {
      if (decl.startsWith(`${property}:`)) values.push(decl.slice(property.length + 1).trim());
    }
  }
  return values;
}

describe('bench app layout stylesheet contract (#3653)', () => {
  const narrow = narrowMediaBlocks(readFileSync(CSS_PATH, 'utf8')).join('\n');

  it('should still hide the user chip name at narrow widths outside the bench', () => {
    // The premise: without the app-wide hide there is nothing to override, and
    // the bench assertion below would pass vacuously.
    expect(declaredValues(narrow, '.shell-user-chip__name', 'display')).toContain('none');
  });

  it('should keep the packer name visible on the bench when the viewport is narrow', () => {
    const display = declaredValues(narrow, '.shell--bench .shell-user-chip__name', 'display');

    expect(display.length).toBeGreaterThan(0);
    expect(display).not.toContain('none');
  });
});
