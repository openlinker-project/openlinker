/**
 * Pack bench page object (#3339/#3341/#3342)
 *
 * `/bench` (`bench-page.tsx`) shows the WORKLIST first (`BenchWorkList`) — a
 * packer clicks "Open parcel" on a row to switch to `BenchParcelView` for that
 * work. There is no route change (D18: opening a box is page state, not a
 * route), so this object drives both surfaces off one `page`.
 *
 * Auth is the ordinary app JWT session (`seedBrowserSession` in
 * `support/access-control.ts`), rendered in-page rather than via `/login`
 * redirect — `BenchIdentityOverlay`'s `state` collapses to `'locked'`
 * whenever the session is anonymous and to `'open'` the instant it is not, so
 * a packer session established before `goto()` lands directly on the
 * worklist with no separate handover step to drive.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';

export class BenchPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/bench');
  }

  /** The worklist row for `orderReference`, or a locator that resolves to nothing. */
  rowFor(orderReference: string): Locator {
    return this.page
      .locator('[data-testid="bench-work-row"]')
      .filter({ has: this.page.locator('.bench-work-row__reference', { hasText: orderReference }) });
  }

  async openParcel(orderReference: string): Promise<void> {
    await this.rowFor(orderReference).getByRole('button', { name: 'Open parcel' }).click();
    await expect(this.page.locator('[data-testid="bench-parcel"]')).toBeVisible();
  }

  get emptyIdle(): Locator {
    return this.page.locator('[data-testid="bench-work-empty-idle"]');
  }

  get emptyNotRouted(): Locator {
    return this.page.locator('[data-testid="bench-work-empty-not-routed"]');
  }

  get parcel(): Locator {
    return this.page.locator('[data-testid="bench-parcel"]');
  }

  get parcelClosed(): Locator {
    return this.page.locator('[data-testid="bench-parcel-closed"]');
  }

  get documentsUnlabelled(): Locator {
    return this.page.locator('[data-testid="bench-documents-unlabelled"]');
  }

  get holdReason(): Locator {
    return this.page.locator('.bench-parcel__hold-reason');
  }
}
