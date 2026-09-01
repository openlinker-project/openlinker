/**
 * Sales documents: the `/orders` money-cluster document line, end to end
 * (#2563 M10)
 *
 * Verifies every state the mockup's "Orders list" page
 * (`docs/plans/mockups/sales-document-routing.html`) demonstrates against the
 * REAL app: `SalesDocumentCell` (`apps/web/src/features/orders/components/
 * sales-document-cell.tsx`) driven by `resolveSalesDocumentCellState`
 * (`apps/web/src/features/orders/lib/sales-document-cell-state.ts`), reading
 * the real `SalesDocumentViewService` projection
 * (`libs/core/src/orders/application/services/sales-document-view.service.ts`).
 *
 * FIXTURE DATA: `seedSalesDocumentStates` (`src/support/sales-document-seed.ts`)
 * writes eight fixed orders directly into Postgres, one per target state — the
 * one deliberate exception to this package's HTTP-only rule, because none of
 * these states (an authority rejection, a receipt stuck mid-registration, a
 * second document on another connection) has an HTTP write path that can force
 * it on demand. See that module's doc comment for the full rationale.
 *
 * DIVERGENCE FROM THE MOCKUP, confirmed live and pinned by
 * `'never renders the mockup's platform-named words'` below: the mockup bakes
 * the provider name into the row word ("KSeF rejected", "At KSeF") and invents
 * a "Not registered" word for a fiscal receipt with no document yet. The real
 * `resolveSalesDocumentCellState` is deliberately platform-neutral — its own
 * doc comment states "no platform name leaks into the word" — so the real
 * words are "Authority rejected", "At authority" and "Not issued". A provider
 * name appears only inside the popover's identity facts.
 *
 * VIEWPORT COVERAGE: every state is asserted and screenshotted at three
 * widths — 1440 (desktop table), 768 (tablet), 360 (mobile card) — since the
 * cell renders through two different `layout` props (`stack` / `row`) that
 * this suite must not assume behave identically. Screenshots land in
 * `__screenshots__/` as committed evidence, not gitignored scratch output.
 *
 * KEYBOARD + ARIA: covered on a representative pair of states (one `done`
 * tone, one `progress` tone) rather than all eight, since the popover's
 * keyboard contract (Enter/Space to open, Escape to close, focus restored) is
 * the SAME Radix `Popover` primitive underneath every row — repeating it per
 * state would test the same code path eight times over.
 *
 * NO aria-live REGION ON THIS PAGE, and that is a finding, not an omission:
 * unlike the order-detail panel (M9), the `/orders` row never performs the
 * async work whose progress a live region would announce — issuing or
 * registering happens from the panel this row LINKS to
 * (`/orders/:id#invoicing`), not from the list. `progress`-tone rows here are
 * a snapshot of state a bulk-issue elsewhere put the order in, not a wait this
 * page is running.
 *
 * @module tests/sales-documents
 */
import { test, expect } from '../../src/fixtures/test';
import type { Page, Locator } from '@playwright/test';
import { seedSalesDocumentStates, SEED_ORDER_IDS } from '../../src/support/sales-document-seed';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__screenshots__',
);

const VIEWPORTS = [
  { label: 'desktop-1440', width: 1440, height: 1400 },
  { label: 'tablet-768', width: 768, height: 1600 },
  { label: 'mobile-360', width: 360, height: 2200 },
] as const;

interface StateFixture {
  /** Order key from `SEED_ORDER_IDS` — identifies which seeded row this is. */
  key: keyof typeof SEED_ORDER_IDS;
  /** Slug used in screenshot filenames. */
  slug: string;
  /** Exact accessible name Playwright's `getByRole` locates the trigger by. */
  ariaLabel: string;
  tone: 'idle' | 'progress' | 'done' | 'warning' | 'error';
  hasTick: boolean;
  hasLiveDot: boolean;
  hasDupeBadge: boolean;
  /** Text the popover body must contain once opened. */
  popoverContains: RegExp;
}

const STATES: readonly StateFixture[] = [
  {
    key: 'fiscalNotIssued',
    slug: 'fiscal-receipt-not-issued',
    ariaLabel: 'Fiscal receipt: Not issued',
    tone: 'idle',
    hasTick: false,
    hasLiveDot: false,
    hasDupeBadge: false,
    // No document, no persisted block reason -> the resolver's plain
    // "Not issued" branch, which carries no reasonDetail at all.
    popoverContains: /Fiscal receipt · Not issued/,
  },
  {
    key: 'invoiceIssued',
    slug: 'invoice-issued',
    ariaLabel: 'Invoice: Issued',
    tone: 'done',
    hasTick: true,
    hasLiveDot: false,
    hasDupeBadge: false,
    popoverContains: /Invoice · Issued/,
  },
  {
    key: 'invoiceAuthorityRejected',
    slug: 'invoice-authority-rejected',
    ariaLabel: 'Invoice: Authority rejected',
    tone: 'error',
    hasTick: false,
    hasLiveDot: false,
    hasDupeBadge: false,
    popoverContains: /Authority[\s\S]*Rejected/,
  },
  {
    key: 'fiscalRegistering',
    slug: 'fiscal-receipt-registering',
    ariaLabel: 'Fiscal receipt: Registering',
    tone: 'progress',
    hasTick: false,
    hasLiveDot: true,
    hasDupeBadge: false,
    popoverContains: /Fiscal receipt · Registering/,
  },
  {
    key: 'fiscalUnconfirmed',
    slug: 'fiscal-receipt-unconfirmed',
    ariaLabel: 'Fiscal receipt: Unconfirmed',
    tone: 'warning',
    hasTick: false,
    hasLiveDot: false,
    hasDupeBadge: false,
    popoverContains: /Fiscal receipt · Unconfirmed/,
  },
  {
    key: 'noRouting',
    slug: 'no-document-no-routing',
    ariaLabel: 'No document: No routing',
    tone: 'error',
    hasTick: false,
    hasLiveDot: false,
    hasDupeBadge: false,
    // documentKind === null skips straight to the hardcoded word; there is no
    // persisted reason to quote because routing itself, not a gate, is what
    // could not decide.
    popoverContains: /No document · No routing/,
  },
  {
    key: 'invoiceNotIssued',
    slug: 'invoice-not-issued',
    ariaLabel: 'Invoice: Not issued',
    tone: 'idle',
    hasTick: false,
    hasLiveDot: false,
    hasDupeBadge: false,
    popoverContains: /Invoice · Not issued/,
  },
  {
    key: 'invoiceAtAuthorityDuplicate',
    slug: 'invoice-at-authority-duplicate',
    ariaLabel: 'Invoice: At authority',
    tone: 'progress',
    hasTick: false,
    hasLiveDot: true,
    hasDupeBadge: true,
    popoverContains: /also holds a document for this\s*\n?\s*sale/,
  },
];

async function loginAndGoToOrders(page: Page): Promise<void> {
  await page.goto('/orders');
  // Rows render as a `<table>` at desktop width and a `<ul>` of cards below
  // that breakpoint (measured live — the mobile card is a `listitem`, never
  // `.data-table__row`/`.orders-row-card`), so the one selector guaranteed to
  // exist in BOTH layouts is the trigger button itself
  // (`sales-document-cell.tsx`'s `sales-doc-trigger` class, unconditional on
  // the `layout` prop).
  await expect(page.locator('.sales-doc-trigger').first()).toBeVisible({ timeout: 30_000 });
}

function triggerFor(page: Page, ariaLabel: string): Locator {
  return page.getByRole('button', { name: ariaLabel, exact: true });
}

function popoverHeadOf(page: Page): Locator {
  return page.locator('.sales-doc-popover__head').locator('xpath=..');
}

/**
 * Open the popover for `trigger` and hand back a Locator for it, retrying the
 * whole open gesture rather than only the visibility assertion.
 *
 * On a viewport shorter than the full table, the trigger is not fully in view
 * when the interaction starts; Radix's `PopoverContent` moves focus into
 * itself on open (`onOpenAutoFocus`), the browser's native focus-scroll then
 * brings that content into view, and `Popover`'s own
 * `dismissOnViewportChange` (`apps/web/src/shared/ui/popover.tsx`) treats that
 * scroll as "the anchor moved" and closes what it just opened — a real race
 * this spec measured directly (reproducible at 768/360, absent at 1440 where
 * every row already fits with no scroll). It is not something a longer
 * `expect` timeout can fix: the popover DOES close, it does not merely take
 * longer to render. Re-issuing the same open gesture is safe because Radix
 * treats the trigger as a toggle off ITS OWN state, and once the page has
 * settled from that scroll a repeat open has nothing left to dismiss it.
 */
async function openPopover(page: Page, activate: () => Promise<void>): Promise<Locator> {
  const popover = popoverHeadOf(page);
  await expect(async () => {
    await activate();
    await expect(popover).toBeVisible({ timeout: 2_000 });
    // A visible snapshot alone is not enough: the dismiss listener can still
    // be mid-flight. Holding the check for one more short window is what
    // tells a genuinely-open popover apart from one about to disappear.
    await page.waitForTimeout(300);
    await expect(popover).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000, intervals: [500, 1_000, 2_000] });
  return popover;
}

test.describe('sales documents: /orders money-cluster document line (#2563 M10)', () => {
  test.beforeAll(async () => {
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    await seedSalesDocumentStates();
  });

  for (const viewport of VIEWPORTS) {
    test.describe(`at ${viewport.label}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      for (const state of STATES) {
        test(`renders "${state.ariaLabel}" and its popover`, async ({ page }) => {
          await loginAndGoToOrders(page);

          const trigger = triggerFor(page, state.ariaLabel);
          await expect(trigger).toBeVisible();

          // The word itself is never the only signal — the tone class and the
          // tick/live-dot markers must agree with it.
          await expect(trigger.locator(`.sales-doc--${state.tone}`)).toBeVisible();
          await expect(trigger.locator('.sales-doc__tick')).toHaveCount(state.hasTick ? 1 : 0);
          await expect(trigger.locator('.sales-doc__live')).toHaveCount(state.hasLiveDot ? 1 : 0);
          await expect(trigger.locator('.sales-doc__dupe')).toHaveCount(
            state.hasDupeBadge ? 1 : 0,
          );

          // Opened via KEYBOARD (focus + Enter) through the retrying
          // `openPopover` helper — see its doc comment for the scroll/dismiss
          // race this works around on a viewport shorter than the table.
          const popover = await openPopover(page, async () => {
            await trigger.focus();
            await page.keyboard.press('Enter');
          });
          await expect(popover).toContainText(state.popoverContains);

          // Every popover always offers a way back to the order, and never a
          // dead end.
          await expect(popover.getByRole('link', { name: 'Open order' })).toBeVisible();

          // Viewport-only, deliberately NOT `fullPage: true`: a full-page
          // capture on a page taller than the viewport scrolls internally to
          // stitch the image, and that scroll is indistinguishable from a real
          // one to `Popover`'s `dismissOnViewportChange` listener — verified
          // live, the first version of this screenshot showed the popover
          // already closed. The open popover is what this screenshot exists to
          // prove, so it must not be the side effect that closes it.
          await page.screenshot({
            path: path.join(SCREENSHOT_DIR, `${viewport.label}-${state.slug}.png`),
          });

          // Escape closes it and returns focus to the trigger — the Radix
          // Popover contract, verified rather than assumed.
          await page.keyboard.press('Escape');
          await expect(popover).toBeHidden();
          await expect(trigger).toBeFocused();
        });
      }
    });
  }

  test.describe('keyboard operability (representative states)', () => {
    test.use({ viewport: { width: 1440, height: 1400 } });

    test('Enter opens the popover for a finished (done-tone) document', async ({ page }) => {
      await loginAndGoToOrders(page);
      const trigger = triggerFor(page, 'Invoice: Issued');
      await trigger.focus();
      await expect(trigger).toBeFocused();

      const popover = await openPopover(page, () => page.keyboard.press('Enter'));

      await page.keyboard.press('Escape');
      await expect(popover).toBeHidden();
      await expect(trigger).toBeFocused();
    });

    test('Space opens the popover for an in-flight (progress-tone) document', async ({
      page,
    }) => {
      await loginAndGoToOrders(page);
      const trigger = triggerFor(page, 'Fiscal receipt: Registering');
      await trigger.focus();

      const popover = await openPopover(page, () => page.keyboard.press(' '));
      await expect(popover).toContainText(/Fiscal receipt · Registering/);

      await page.keyboard.press('Escape');
      await expect(popover).toBeHidden();
    });

    test('the kind label reaches assistive tech even though the glyph is decorative', async ({
      page,
    }) => {
      await loginAndGoToOrders(page);
      const trigger = triggerFor(page, 'Invoice: Issued');

      // `sr-only` text carries the kind ("Invoice: "); the glyph itself is
      // `aria-hidden` so it is never announced twice.
      await expect(trigger.locator('.sr-only')).toHaveText('Invoice: ');
      await expect(trigger.locator('.sales-doc__glyph')).toHaveAttribute('aria-hidden', 'true');
    });

    test('a mouse click also opens the popover', async ({ page }) => {
      await loginAndGoToOrders(page);
      const trigger = triggerFor(page, 'Invoice: Issued');

      const popover = await openPopover(page, () => trigger.click());
      await expect(popover).toContainText(/Invoice · Issued/);
    });
  });

  test('never renders the mockup\'s platform-named words for authority states', async ({
    page,
  }) => {
    // The mockup (docs/plans/mockups/sales-document-routing.html) shows "KSeF
    // rejected" / "At KSeF" on these exact two rows. The real, shipped
    // `resolveSalesDocumentCellState` is deliberately platform-neutral — this
    // pins that divergence as a regression guard, not just prose in a PR body.
    await loginAndGoToOrders(page);

    await expect(triggerFor(page, 'Invoice: Authority rejected')).toBeVisible();
    await expect(triggerFor(page, 'Invoice: At authority')).toBeVisible();
    await expect(page.getByText('KSeF rejected', { exact: true })).toHaveCount(0);
    await expect(page.getByText('At KSeF', { exact: true })).toHaveCount(0);

    // And the mockup's invented "Not registered" word for a fiscal receipt
    // with no document yet — the real word is "Not issued", shared with the
    // invoice case, because the resolver's plain-not-issued branch does not
    // vary its wording by kind.
    await expect(triggerFor(page, 'Fiscal receipt: Not issued')).toBeVisible();
    await expect(page.getByText('Not registered', { exact: true })).toHaveCount(0);
  });

  test('the duplicate-document warning names the other connection, not just a count', async ({
    page,
  }) => {
    await loginAndGoToOrders(page);
    const trigger = triggerFor(page, 'Invoice: At authority');

    const popover = await openPopover(page, async () => {
      await trigger.focus();
      await page.keyboard.press('Enter');
    });
    await expect(popover.locator('.sales-doc-popover__warn')).toBeVisible();
    await expect(popover.locator('.sales-doc-popover__warn')).toContainText(
      /also holds a document for this/,
    );

    await page.keyboard.press('Escape');
  });

  test('every seeded order still resolves through the real API projection', async ({ api }) => {
    // Cross-check against the same endpoint the UI reads, so a future FE
    // regression that silently swallows an API field cannot go unnoticed
    // just because the row still LOOKS right by accident.
    const orders = await api.orders.list({ limit: 20 });
    const byId = new Map(orders.items.map((o) => [o.internalOrderId, o]));

    const fiscalNotIssued = byId.get(SEED_ORDER_IDS.fiscalNotIssued);
    expect(fiscalNotIssued?.salesDocument?.documentKind).toBe('fiscal-receipt');
    expect(fiscalNotIssued?.salesDocument?.document).toBeNull();

    const rejected = byId.get(SEED_ORDER_IDS.invoiceAuthorityRejected);
    expect(rejected?.salesDocument?.document?.kind).toBe('invoice');
    expect(rejected?.salesDocument?.document?.regulatoryStatus).toBe('rejected');

    const noRouting = byId.get(SEED_ORDER_IDS.noRouting);
    expect(noRouting?.salesDocument?.documentKind).toBeNull();

    const duplicate = byId.get(SEED_ORDER_IDS.invoiceAtAuthorityDuplicate);
    expect(duplicate?.salesDocument?.otherRecords).toHaveLength(1);
  });
});
