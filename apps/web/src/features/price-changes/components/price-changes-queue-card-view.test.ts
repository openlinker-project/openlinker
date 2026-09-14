/**
 * Price-changes queue — mobile card view contract (#3223)
 *
 * `docs/frontend-ui-style-guide.md` § Responsive makes mobile first-class and
 * its parity matrix specifies a CARD VIEW for tables there. The queue shipped
 * with zero `@media` queries, `min-width: 900px` on the table and a horizontal
 * scroller — a 7-column grid behind a scrollbar, which is not that.
 *
 * The rules under test are pure stylesheet, and there is no CSS parser
 * anywhere in this pipeline (#2674), so a test over the stylesheet text is the
 * only gate they can have — the `card-button-reset-styles.test.ts` precedent.
 *
 * The BOUNDARY assertion is the load-bearing one. § Responsive calls the
 * fraction load-bearing: a rounded `max-width: 768px` matches AT 768px and
 * overlaps the tablet `min-width: 768px` band by one pixel, so the queue would
 * be in its mobile branch while every other table on the page is in its
 * desktop one. That section also says to read the branch off `matchMedia`
 * rather than infer it from a rect, because a classic scrollbar makes
 * `documentElement.clientWidth` ~15px narrower than the width media queries
 * evaluate against — which inverts the answer exactly at the boundary. So this
 * asserts the QUERY, never a measured width.
 *
 * @module apps/web/src/features/price-changes/components
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(__dirname, '..', '..', '..', 'index.css'), 'utf8');

/** The queue's mobile block, from its `@media` opener to the matching brace. */
function queueMobileBlock(): string {
  const marker = '/* ── Price changes queue — mobile card view (#3223)';
  const start = CSS.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const mediaAt = CSS.indexOf('@media', start);
  let depth = 0;
  for (let i = CSS.indexOf('{', mediaAt); i < CSS.length; i += 1) {
    if (CSS[i] === '{') depth += 1;
    else if (CSS[i] === '}') {
      depth -= 1;
      if (depth === 0) return CSS.slice(mediaAt, i + 1);
    }
  }
  throw new Error('unterminated media block');
}

describe('price-changes queue mobile card view (#3223)', () => {
  it('switches at 767.98px, the same bound the shared DataTable uses', () => {
    const block = queueMobileBlock();
    expect(block.startsWith('@media (max-width: 767.98px)')).toBe(true);
    // Not a rounded 768px, which would overlap the tablet band by one pixel.
    expect(block).not.toContain('max-width: 768px');
    // And the primitive's own switch is still spelled the same way, so this
    // fails if the house breakpoint moves without this block following.
    expect(CSS).toContain('.data-table__cell--hide-below-768');
  });

  it('removes the horizontal scroller and the 900px floor in the mobile branch', () => {
    const block = queueMobileBlock();
    // Leaving either in place would keep the scrollbar the card view exists
    // to replace, which is the whole defect.
    expect(block).toMatch(/\.table-wrap table\s*\{[^}]*min-width:\s*0/);
    expect(block).toMatch(/\.table-scroll\s*\{[^}]*overflow-x:\s*visible/);
  });

  it('hides the header row and labels every cell that needed it', () => {
    const block = queueMobileBlock();
    expect(block).toMatch(/thead\s*\{[^}]*display:\s*none/);
    // Without this the labelled cells lose the meaning the header carried.
    expect(block).toContain('content: attr(data-label)');
  });

  it('keeps the row action a 44px touch target, keyed on WIDTH not pointer', () => {
    const block = queueMobileBlock();
    // The global ≥44px rule fires under `(hover: none) and (pointer: coarse)`
    // — a POINTER test — so a 767px desktop window gets nothing from it.
    expect(block).toMatch(/td\.col-num \.button\s*\{[^}]*min-height:\s*44px/);
  });

  it('keeps the grouped treatment visible as a card edge', () => {
    // The desktop treatment borders the first CELL, which is no longer a
    // column in the card layout, so it moves to the card itself.
    expect(queueMobileBlock()).toMatch(/tr\.is-grouped\s*\{[^}]*border-left/);
  });

  it('is the only media block the queue ships, so tablet keeps the full table', () => {
    // The parity matrix keeps tablet (768–1023px) on the scrolled table; a
    // second block here would mean the queue had started carding it too.
    const queueBlockStart = CSS.indexOf('/* ── Price changes review queue (#3147');
    const dialogsStart = CSS.indexOf('/* ── Price change dialogs (#3148');
    expect(queueBlockStart).toBeGreaterThan(-1);
    expect(dialogsStart).toBeGreaterThan(queueBlockStart);
    const queueRegion = CSS.slice(queueBlockStart, dialogsStart);
    expect(queueRegion.match(/@media/g)).toHaveLength(1);
  });
});
