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
 * Its limit is worth stating: stylesheet text cannot see the CASCADE, so the
 * neutralisers asserted below are checked for PRESENCE only. Whether they
 * actually win is a specificity argument recorded beside them in `index.css`.
 *
 * The BOUNDARY assertion is the load-bearing one, and it asserts the queue's
 * query EQUALS the shared primitive's rather than a hardcoded string
 * (§ Responsive, and `who-decides-styles.test.ts` before it): a component has
 * to follow the primitive if the house breakpoint ever moves, and a hardcoded
 * number would instead have to be edited to let it. § Responsive calls the
 * fraction load-bearing — a rounded `max-width: 768px` matches AT 768px and
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

/**
 * The literal opening of the queue's mobile section comment in `index.css`.
 *
 * It carries an em-dash and box-drawing characters because that is the file's
 * house style for a section header. Every assertion below is anchored on it,
 * so a one-character edit to that comment fails the whole suite on
 * `toBeGreaterThan(-1)` — edit both together, or move the anchor.
 */
const MOBILE_SECTION_MARKER = '/* ── Price changes queue — mobile card view (#3223)';

/** The queue's mobile block, from its `@media` opener to the matching brace. */
function queueMobileBlock(): string {
  const start = CSS.indexOf(MOBILE_SECTION_MARKER);
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

/**
 * The media query guarding `selector`, or `undefined` when it is in no media
 * block at all. Brace-matched, so only a block's OWN body is searched — the
 * `who-decides-styles.test.ts` primitive. A naive `split('@media ')` sweeps up
 * every rule that follows a block until the next one, and these selectors also
 * appear outside any media query, so a looser guard finds the wrong block and
 * passes by luck.
 */
function queryFor(selector: string): string | undefined {
  for (let at = CSS.indexOf('@media '); at !== -1; at = CSS.indexOf('@media ', at + 1)) {
    const open = CSS.indexOf('{', at);
    let depth = 0;
    let close = open;
    for (; close < CSS.length; close += 1) {
      if (CSS[close] === '{') depth += 1;
      else if (CSS[close] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (CSS.slice(open + 1, close).includes(`${selector} {`)) {
      return CSS.slice(at + '@media '.length, open).trim();
    }
  }
  return undefined;
}

describe('price-changes queue mobile card view (#3223)', () => {
  it('switches on the same query the shared DataTable primitive uses', () => {
    const block = queueMobileBlock();
    const queueQuery = block.slice('@media '.length, block.indexOf('{')).trim();
    const primitiveQuery = queryFor('.data-table__cell--hide-below-768');

    expect(primitiveQuery).toBeDefined();
    // Equality, not a hardcoded bound: if the house breakpoint moves and this
    // block does not follow, the queue silently keeps the old one — the drift
    // § Responsive names by file. A hardcoded string still passes on the class
    // merely existing, which is what this assertion replaces.
    expect(queueQuery).toBe(primitiveQuery);
    // And the fraction rule itself: a rounded bound matches AT 768px and
    // overlaps the tablet band by one pixel.
    expect(block).not.toContain('max-width: 768px');

    // Guard of the guard: a selector in NO media block must come back
    // undefined, or `queryFor` has decayed into a substring scan and the
    // equality above is comparing two accidental hits.
    expect(queryFor('.price-changes-queue__nonexistent-leaf')).toBeUndefined();
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

  it('keeps both card controls a 44px touch target, keyed on WIDTH not pointer', () => {
    const block = queueMobileBlock();
    // The global ≥44px rule fires under `(hover: none) and (pointer: coarse)`
    // — a POINTER test — so a 767px desktop window gets nothing from it, and
    // § Responsive is unconditional ("every interactive element").
    expect(block).toMatch(/td\.col-num \.button\s*\{[^}]*min-height:\s*44px/);
    expect(block).toMatch(/td\.cell-select input\[type='checkbox'\]\s*\{[^}]*min-height:\s*44px/);
    expect(block).toMatch(/td\.cell-select input\[type='checkbox'\]\s*\{[^}]*min-width:\s*44px/);
  });

  it('neutralises every desktop `td` rule that out-specifies the card reset', () => {
    const block = queueMobileBlock();
    // `tbody td { border: 0 }` is (0,2,2); each of these is (0,3,3) and a
    // media query adds no specificity, so the reset never reaches them and
    // the desktop treatment keeps painting inside the card.
    expect(block).toMatch(/tr\.is-group-start td\s*\{[^}]*border-top:\s*0/);
    expect(block).toMatch(/tr\.is-grouped td:first-child\s*\{[^}]*box-shadow:\s*none/);
    // `border: 0` never touches a `box-shadow` at any specificity, which is
    // why the accent needs its own neutraliser rather than riding the reset.
    expect(block).toMatch(/tr\.is-resolved td,\s*[^{]*tr\.is-flagged td\s*\{[^}]*background:\s*transparent/);
  });

  it('re-homes the row tints on the card instead of its cells', () => {
    const block = queueMobileBlock();
    // Left on `td` they paint per-cell rectangles with the card's own surface
    // showing through the `gap`, on exactly the rows an operator triages.
    expect(block).toMatch(/tr\.is-resolved\s*\{[^}]*background:\s*var\(--bg-surface-muted\)/);
    expect(block).toMatch(/tr\.is-flagged\s*\{[^}]*background:\s*color-mix\(/);
    // Composited against the card surface, not left translucent over the page
    // ground the way the desktop value would be on an opaque card.
    expect(block).toMatch(/tr\.is-flagged\s*\{[^}]*var\(--bg-surface\)\s*\)/);
    expect(block).toMatch(/tr\.is-grouped\s*\{[^}]*border-left/);
  });

  it('is the only media block the queue ships, so tablet keeps the full table', () => {
    // The parity matrix keeps tablet (768–1023px) on the scrolled table; a
    // second block here would mean the queue had started carding it too.
    const queueBlockStart = CSS.indexOf('/* ── Price changes review queue (#3147');
    const dialogsStart = CSS.indexOf('/* ── Price change dialogs (#3148');
    expect(queueBlockStart).toBeGreaterThan(-1);
    expect(dialogsStart).toBeGreaterThan(queueBlockStart);
    // Comments are stripped first, or the count measures MENTIONS rather than
    // blocks: naming the global `@media (hover: none) and (pointer: coarse)`
    // rule in a comment — which the touch-target rules above do, because that
    // is the rule they compensate for — would otherwise fail this.
    const queueRegion = CSS.slice(queueBlockStart, dialogsStart).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(queueRegion.match(/@media/g)).toHaveLength(1);
  });
});
