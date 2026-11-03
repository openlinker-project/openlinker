/**
 * Standalone `<Input invalid />` — stylesheet contract (#2415)
 *
 * `Input` applies `.control--invalid` for `invalid`, but the base control group
 * in `index.css` selects `input[type='text']` and friends at specificity
 * (0,1,1) and sets the grey border. A bare `.control--invalid` is (0,1,0) and
 * lost, so the error border never painted unless `FormField` also injected
 * `aria-invalid` (whose selector is (0,1,1) and declared later). Every in-app
 * usage goes through `FormField`, which is why it went unnoticed.
 *
 * happy-dom does not run the cascade over the real stylesheet, so this asserts
 * on the stylesheet text, the same gate the other `*-styles.test.ts` files use
 * (there is no CSS parser in this pipeline, #2674).
 *
 * @module apps/web/src/shared/ui
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(__dirname, '..', '..', 'index.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);

function selectorLists(): string[][] {
  return [...CSS.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((block) =>
    block[1].split(',').map((s) => s.trim())
  );
}

describe('standalone Input invalid styling (#2415)', () => {
  it('should give the invalid border an input-qualified selector that matches the base specificity', () => {
    const rule = selectorLists().find((list) => list.includes('input.control--invalid'));
    expect(rule).toBeDefined();
    // The bare-class arm must stay: textarea/select rely on it.
    expect(rule).toContain('.control--invalid');
  });

  it('should give the invalid focus ring the same input-qualified selector', () => {
    const rule = selectorLists().find((list) =>
      list.includes('input.control--invalid:focus-visible')
    );
    expect(rule).toBeDefined();
    expect(rule).toContain('.control--invalid:focus-visible');
  });
});
