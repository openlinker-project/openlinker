/**
 * Bulk publish wizard page object (marketplace + shop)
 *
 * Covers `/listings/bulk-create/wizard` — the SetupStepper flow rendered by
 * `bulk/bulk-wizard.tsx`. Since #1754/#1829 this one wizard serves BOTH
 * destination kinds and branches on the connection's capability
 * (`bulk-wizard.tsx:140`):
 *   - marketplace (`OfferCreator`): Config → Resolve → Review → confirm modal →
 *     `/listings/bulk-batches/:batchId`;
 *   - shop (`ProductPublisher`): Config → Review → publish → an in-page
 *     `ShopPublishTracker` (NO batch-progress route).
 * The page title differs accordingly — "Bulk marketplace offer creation" vs
 * "Bulk shop product publishing" (`bulk-wizard.tsx:563`).
 *
 * Step CTAs mirror the real components: "Proceed →" on the config step
 * (`bulk-config-step.tsx:437`), the resolve step auto-advances when its batch
 * queries settle (`bulk-resolve-step.tsx`), and the review step submits via
 * "Create offers (N)" (`bulk-review-step.tsx:251`) / "Publish N listings"
 * (`bulk-shop-review-step.tsx:449`). Both stay disabled while any row needs
 * attention, so the flow fails fast on a non-zero needs-attention count
 * instead of timing out on a disabled button.
 *
 * Review is a product-grouped CSS grid of divs with NO ARIA table/rows
 * (`bulk-review-step.tsx:314+`): `.bulk-review__prow` is one PRODUCT (with
 * `.bulk-review__vrows` sub-rows once expanded), and the edit modal is
 * per-product too (`:400`), so this object walks products, not variants.
 *
 * Destination selection is only shown when more than one eligible connection
 * exists; with a single connection the config step shows "Publishing as {name}"
 * (`bulk-config-step.tsx:235`) and no picker.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { BulkBatchProgressPage } from './bulk-batch-progress.page';

/**
 * Dictionary entries that mean "new / unused" condition, matched
 * case-insensitively against a native <select>'s option text. Mirrors the
 * single-offer wizard's `NEW_VALUE_PATTERNS`
 * (`apps/web/.../auto-prefill-parameters.ts`) so the bulk flow prefills the
 * `Stan` (condition) parameter to the same canonical "Nowy" value.
 */
const CONDITION_NEW_PATTERN = /\b(nowy|nowe|nowa|new)\b/i;

/**
 * Matches an Allegro category parameter that expects the product's barcode —
 * "EAN (GTIN)", "EAN", "GTIN", "Kod EAN". Case-insensitive, matched against the
 * control's `aria-label` (== the parameter name). A GTIN param must carry the
 * product's REAL barcode: the generic text placeholder ("E2E") is rejected by
 * Allegro's validator, stranding the offer (#1481).
 */
const GTIN_PARAM_PATTERN = /\b(gtin|ean)\b/i;

/** Upper bound on per-row edits so an unfillable parameter fails loudly, not forever. */
const MAX_ROW_EDITS = 25;
/** Upper bound on fill passes over one row's required parameters (dependent params can appear). */
const MAX_PARAM_PASSES = 10;

/** Shop-listing visibility on the shop review step (`bulk-shop-review-step.tsx:518-540`). */
export type ShopPublishVisibility = 'draft' | 'published';

export class BulkOfferWizard {
  constructor(private readonly page: Page) {}

  /**
   * Explicit category breadcrumb (ancestor names ending at the leaf) used to
   * drive the per-product `BulkCategoryChooseModal` when the row's category did
   * not auto-resolve. Set per-run by `advanceToConfirmModal`; when unset the
   * picker falls back to first-reachable.
   */
  private categoryPath: string[] | undefined;

  /**
   * Explicit category id for a BORROWS-taxonomy destination (Erli), which ships
   * no category browser and instead exposes a plain "Allegro category ID" text
   * field in the editor (`bulk-edit-modal.tsx:1337-1351`). `categoryPath` cannot
   * drive that field — there is no tree to walk — so the two options are
   * mutually exclusive per destination.
   */
  private categoryId: string | undefined;

  /** Both wizard variants (`bulk-wizard.tsx:563`) land on the same config step. */
  async expectOnConfigStep(): Promise<void> {
    await expect(
      this.page.getByRole('heading', {
        name: /^Bulk (marketplace offer creation|shop product publishing)$/,
      }),
    ).toBeVisible();
  }

  /**
   * The config step's destination picker.
   *
   * #1828 replaced the `<select>` with the shared `PublishDestinationRail`
   * (`bulk-config-step.tsx:222-232`): a `role="radiogroup"` labelled by the
   * "Destination connection" `<label>` (`:223-225`), holding `role="radio"`
   * buttons. Absent when exactly one destination is eligible (`:233-237`).
   */
  get destinationRail(): Locator {
    return this.page.getByRole('radiogroup', { name: 'Destination connection' });
  }

  /**
   * Select the destination if the rail is present (multi-destination).
   *
   * With a single eligible destination the rail is replaced by a
   * "Publishing as {name}" alert (`bulk-config-step.tsx:235`) — assert that it
   * names the expected connection rather than silently continuing against
   * whatever the stack auto-resolved.
   */
  async selectConnectionIfPresent(connectionName: string): Promise<void> {
    if ((await this.destinationRail.count()) > 0) {
      const option = this.destinationRail.getByRole('radio').filter({ hasText: connectionName });
      await expect(
        option,
        `destination "${connectionName}" should be offered on the config step`,
      ).toHaveCount(1, { timeout: 15_000 });
      await option.click();
      await expect(option).toHaveAttribute('aria-checked', 'true');
      return;
    }
    await expect(
      this.page.getByText(`Publishing as ${connectionName}`),
      `single-destination wizard should be publishing as "${connectionName}"`,
    ).toBeVisible({ timeout: 15_000 });
  }

  /** The Allegro platform section's delivery-policy select (`allegro-bulk-config-section.tsx:62`). */
  get deliveryPolicySelect(): Locator {
    return this.page.getByLabel('Shipping rate package');
  }

  /** The Erli section's delivery-price-list select (#1530, `erli-delivery-price-list-field.tsx:103`). */
  get erliDeliveryPriceListSelect(): Locator {
    return this.page.getByLabel('Delivery price list', { exact: true });
  }

  /** The Erli section's responsible-producer select (#1531, `erli-producer-field.tsx:76`). */
  get erliProducerSelect(): Locator {
    return this.page.getByLabel('Producer', { exact: true });
  }

  /**
   * Pick the first real (non-placeholder) option of a lazily-populated,
   * controlled platform-config select and verify the value committed into the
   * form. While its options load from the platform the field renders a
   * disabled placeholder control under the same label, so the enabled-wait
   * doubles as the options-loaded wait.
   */
  private async selectFirstRealOption(select: Locator, assertion: string): Promise<void> {
    await select.waitFor({ state: 'visible', timeout: 30_000 });
    await expect(select).toBeEnabled({ timeout: 30_000 });
    const value = await select.locator('option:not([value=""])').first().getAttribute('value');
    expect(value, assertion).toBeTruthy();
    await select.selectOption(value);
    // Confirm the controlled select actually committed the value into the form.
    await expect(select).toHaveValue(value!);
  }

  /**
   * Complete the required per-platform config the config step gates "Proceed" on.
   * Allegro requires a delivery (shipping-rate) policy; currency auto-defaults to
   * PLN. The Allegro section is lazy-loaded and its select is populated
   * asynchronously from the connection's seller policies, so a one-shot
   * count check right after picking the connection races the mount — when the
   * caller says the platform requires it, WAIT for the select to appear, enable,
   * pick the first real option, and verify the value stuck.
   *
   * Erli (`requiresErliBuyabilityFields`): dispatch time carries its own
   * default, but a BUYABLE offer additionally needs the batch-default delivery
   * price list (#1530) and responsible producer (#1531) — without them Erli
   * lists the product "niekupowalny" ("brak metody dostawy" / missing
   * producer). Both selects fetch their options live from the Erli connection,
   * so pick the first real option of each (mirrors the Allegro policy pick).
   *
   * A shop destination has no platform section at all (`bulk-config-step.tsx:250`),
   * so the default (no flags) path is a no-op for it.
   */
  async completePlatformConfig(
    opts: { requiresDeliveryPolicy?: boolean; requiresErliBuyabilityFields?: boolean } = {},
  ): Promise<void> {
    if (opts.requiresErliBuyabilityFields) {
      await this.selectFirstRealOption(
        this.erliDeliveryPriceListSelect,
        'Erli connection exposes at least one delivery price list',
      );
      await this.selectFirstRealOption(
        this.erliProducerSelect,
        'Erli connection exposes at least one responsible producer',
      );
      return;
    }
    if (!opts.requiresDeliveryPolicy && (await this.deliveryPolicySelect.count()) === 0) {
      return;
    }
    await this.selectFirstRealOption(
      this.deliveryPolicySelect,
      'Allegro connection exposes at least one delivery policy',
    );
  }

  /** The config step's forward CTA ("Proceed →", `bulk-config-step.tsx:437`). */
  get proceedButton(): Locator {
    return this.page.getByRole('button', { name: /^Proceed/ });
  }

  /**
   * The marketplace review step's submit CTA ("Create offers (N)",
   * `bulk-review-step.tsx:245-252`).
   *
   * The SAME label is rendered twice — a desktop CTA in the toolbar
   * (`.bulk-review__cta--top`) and a mobile one at the foot (`:384-391`,
   * `.bulk-review__cta--mobile`, `display:none` above the mobile breakpoint,
   * `index.css:10540`). Both live in the DOM, so a bare
   * `getByRole('button', { name: … })` is a strict-mode violation; scope to the
   * desktop twin and keep the label in `hasText` so a copy change still fails.
   */
  get createOffersButton(): Locator {
    return this.page.locator('button.bulk-review__cta--top', {
      hasText: /^Create offers \(\d+\)$/,
    });
  }

  /**
   * The shop review step's submit CTA ("Publish N listings",
   * `bulk-shop-review-step.tsx:421` / `:449`). Only the desktop twin exists on
   * this step, but it is scoped the same way for symmetry with the marketplace CTA.
   */
  get publishListingsButton(): Locator {
    return this.page.locator('button.bulk-review__cta--top', {
      hasText: /^(Publish \d+ listings?|Publishing…)$/,
    });
  }

  /** The review-step summary strip (`bulk-review-step.tsx:256` / `bulk-shop-review-step.tsx:460`). */
  private get reviewSummary(): Locator {
    return this.page.locator('.bulk-review__summary');
  }

  /**
   * The needs-attention count on the review step.
   *
   * Read from the summary strip's OWN `.attn` cell
   * (`bulk-review-step.tsx:260-263`: `<div class="attn"><span class="n">{n}</span>
   * <span class="lbl">need attention</span></div>`). There is no aria hook on
   * the individual counters, so the class is the only precise selector — but the
   * `hasText` guard pins it to the "need attention" cell, and a missing strip
   * throws instead of reporting a fabricated 0.
   *
   * NOT `getByRole('status').filter({ hasText: /needs? attention/ })`: BOTH the
   * summary strip (`:256`) and the banner below it (`:294`) are `role="status"`
   * and both contain that phrase, so the old locator resolved to the summary and
   * then parsed its LEADING number — the READY count — as the needs-attention
   * count. That silently green-lit a review with unresolved blockers.
   */
  async needsAttentionCount(): Promise<number> {
    const cell = this.reviewSummary.locator('.attn').filter({ hasText: /need attention/ });
    if ((await cell.count()) === 0) {
      throw new Error(
        'Bulk review summary strip is not rendered — cannot read the needs-attention count.',
      );
    }
    const raw = (await cell.first().locator('.n').innerText()).trim();
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Bulk review needs-attention counter is not numeric: "${raw}"`);
    }
    return parsed;
  }

  /**
   * The review step's "Only flagged" filter (`bulk-review-step.tsx:277-284`).
   * Its predicate is exactly "this product has an included variant with
   * blockers" (`:149-151`), which is the FE's own definition of a
   * needs-attention row — so driving it is how this object enumerates them
   * rather than guessing from chip text.
   */
  private get onlyFlaggedCheckbox(): Locator {
    return this.page.getByRole('checkbox', { name: 'Only flagged' });
  }

  private async setOnlyFlagged(on: boolean): Promise<void> {
    if ((await this.onlyFlaggedCheckbox.count()) === 0) return;
    await this.onlyFlaggedCheckbox.setChecked(on);
  }

  /**
   * Drive Config → (Resolving) → Review and open the confirm modal.
   *
   * The resolve step runs two batch queries and auto-advances to Review on
   * settle, so the config click is just "Proceed →". At Review, any product
   * flagged "needs attention" is resolved by driving the wizard's OWN per-product
   * edit modal — the bulk wizard is OpenLinker's own UI, so the automated flow
   * fills it fully (required category parameters + description) rather than
   * hard-failing. A fresh, attribute-less product (no auto-prefilled `Stan`) is
   * therefore listable without operator intervention. The fast path (zero
   * needs-attention rows) stays a no-op. Finally "Publish immediately" is
   * asserted checked so the offers are created ACTIVE, not as drafts. (#1481)
   *
   * `gtin` is the driver variant's real barcode; it is stamped into any
   * GTIN/EAN-typed category parameter so Allegro's validator accepts the offer
   * (the generic placeholder is rejected). Absent → the GTIN param falls back to
   * the placeholder (only correct when the category has no GTIN param).
   */
  async advanceToConfirmModal(
    opts: {
      requiresDeliveryPolicy?: boolean;
      requiresErliBuyabilityFields?: boolean;
      gtin?: string;
      categoryPath?: string[];
      categoryId?: string;
    } = {},
  ): Promise<void> {
    this.categoryPath = opts.categoryPath;
    this.categoryId = opts.categoryId;
    await this.completePlatformConfig(opts);
    await expect(this.proceedButton).toBeEnabled({ timeout: 30_000 });
    await this.proceedButton.click();
    await expect(this.createOffersButton).toBeVisible({ timeout: 60_000 });

    await this.resolveNeedsAttentionRows(opts.gtin);
    // Blocker-clearing only edits rows the FE flags "needs attention". A
    // destination whose FE validator does NOT surface missing required category
    // parameters as a blocker (Erli — its only bulk blocker is missing-image;
    // `Stan`/quantity are never blockers, #1096/#1367) therefore leaves a row
    // READY with its required params still empty, and the fast path submits an
    // empty `overrides.parameters` → the marketplace rejects with
    // PARAMETER_REQUIRED (#1481). Allegro DOES surface those as
    // `needs-product-parameters`, so its rows are covered by the loop above.
    // Top up EVERY listable row's required params so both paths are covered.
    await this.fillEveryRowRequiredParameters(opts.gtin);

    // `canApprove` also waits out platform parameter resolution (`paramsResolving`).
    await expect(this.createOffersButton).toBeEnabled({ timeout: 30_000 });
    await this.createOffersButton.click();
    // #1837: an included variant that already has an offer here routes through a
    // soft duplicate confirm before the submit modal opens (`bulk-wizard.tsx:521`).
    await this.confirmDuplicateGuardIfPresent();
    await expect(this.confirmModalConfirmButton).toBeVisible();

    // Publish the offers ACTIVE, not as drafts. The config default is already
    // `true`, but assert it explicitly (idempotent) so a changed default can't
    // silently create drafts.
    await this.publishImmediatelyCheckbox.check();
  }

  /**
   * Drive Config → Review → publish for a SHOP destination (#1829).
   *
   * There is no Resolve step and no confirm modal: the shop review step's
   * "Publish N listings" submits straight through the duplicate guard, and the
   * wizard swaps its body for a `ShopPublishTracker` (`bulk-wizard.tsx:583`) —
   * it never navigates to `/listings/bulk-batches/:id`.
   */
  async publishToShop(opts: { visibility?: ShopPublishVisibility } = {}): Promise<void> {
    await expect(this.proceedButton).toBeEnabled({ timeout: 30_000 });
    await this.proceedButton.click();
    await expect(this.publishListingsButton).toBeVisible({ timeout: 60_000 });

    if (opts.visibility) {
      await this.setShopVisibility(opts.visibility);
    }
    // #1842: an out-of-stock line is the shop review's ONLY flag, and it is a
    // SOFT block — it publishes once acknowledged (`bulk-shop-review-step.tsx:566-579`).
    // `canPublish` (`:409-410`) gates on that ack, NOT on the needs-attention
    // count, so there is deliberately no per-row edit loop here: nothing in the
    // shop editor can raise master stock.
    await this.acknowledgeOutOfStockIfPresent();

    await expect(this.publishListingsButton).toBeEnabled({ timeout: 30_000 });
    await this.publishListingsButton.click();
    await this.confirmDuplicateGuardIfPresent();
    await expect(this.shopPublishTracker).toBeVisible({ timeout: 60_000 });
  }

  /** The shop review step's visibility segmented control (`bulk-shop-review-step.tsx:518-540`). */
  async setShopVisibility(visibility: ShopPublishVisibility): Promise<void> {
    const group = this.page.getByRole('group', { name: 'Visibility' });
    const option = group.getByRole('button', {
      name: visibility === 'published' ? 'Published' : 'Draft',
      exact: true,
    });
    await option.click();
    await expect(option).toHaveAttribute('aria-pressed', 'true');
  }

  /**
   * Tick the required out-of-stock acknowledgement when the shop review step
   * raises it (`bulk-shop-review-step.tsx:570-579`); no-op otherwise.
   */
  async acknowledgeOutOfStockIfPresent(): Promise<void> {
    const ack = this.page.getByRole('checkbox', { name: /^Publish anyway/ });
    if ((await ack.count()) === 0) return;
    await ack.check();
  }

  /** The in-page shop publish tracker (`shop-publish-tracker.tsx:206`). */
  get shopPublishTracker(): Locator {
    return this.page.locator('section.shop-publish-tracker');
  }

  /** Leave the shop flow (`bulk-wizard.tsx:583`). */
  async finishShopPublish(): Promise<void> {
    await this.page.getByRole('button', { name: 'Done', exact: true }).click();
    await this.page.waitForURL(/\/listings$/, { timeout: 30_000 });
  }

  /** Every product row on the review grid (`bulk-review-step.tsx:494-498`). */
  private productRows(): Locator {
    return this.page.locator('.bulk-review__prow');
  }

  /**
   * Every EDITABLE product row — one whose main row exposes an "Edit" button
   * (`bulk-review-step.tsx:603-612`). A product with no variants renders the
   * text "No variant" there instead (`:601`) and is skipped on submit.
   *
   * The review grid carries no ARIA table/row semantics (it is a CSS grid of
   * divs, `:314+`), so the block classes are the only structural hook; the
   * `has:` filter pins the Edit button to the PRODUCT main row so an expanded
   * product's variant sub-rows (`:617-636`, each with their own Edit) don't
   * change the row set.
   */
  private editableProductRows(): Locator {
    return this.productRows().filter({
      has: this.page.locator('.bulk-review__prow-main button.bulk-review__edit'),
    });
  }

  /**
   * Wait until the Review step has SETTLED — i.e. the async per-category
   * parameter schema has resolved and the row blockers reflect it.
   *
   * The wizard gates its submit CTA on `!paramsResolving`
   * (`bulk-review-step.tsx:138-139`), and Allegro's `needs-product-parameters`
   * blocker (`allegro-offer-validation.ts`) only appears AFTER that per-category
   * schema loads — an effect that races the operator landing on Review. So a
   * naive needs-attention read right after "Proceed" can catch the transient
   * limbo of "0 rows need attention, button disabled (still resolving)" and
   * wrongly take the fast path; the blocker then appears and the button stays
   * disabled at "Create offers (0)" forever.
   *
   * The settled state is unambiguous: EITHER the button is enabled (nothing
   * needs attention) OR at least one row explicitly needs attention. Poll until
   * one of those holds before reading the needs-attention count.
   */
  private async waitForReviewSettled(): Promise<void> {
    await expect(async () => {
      const [enabled, attention] = await Promise.all([
        this.createOffersButton.isEnabled(),
        this.needsAttentionCount(),
      ]);
      if (!enabled && attention === 0) {
        throw new Error(
          'Review still resolving: the submit CTA is disabled with no needs-attention rows — ' +
            'the per-category parameter schema has not settled yet.',
        );
      }
    }).toPass({ timeout: 60_000 });
  }

  /**
   * Resolve every "needs attention" product via its edit modal until the
   * needs-attention count reaches 0.
   *
   * The walk is driven by the review step's own "Only flagged" filter rather
   * than by chip-text guesswork: with it on, the rendered product rows ARE
   * exactly the flagged set (`bulk-review-step.tsx:149-151`), so "the first row"
   * is always a real target and a fixed row simply drops out of the list.
   * Bounded, and requires forward progress per edit so a parameter that can't be
   * auto-filled fails loudly (naming the offending row) instead of looping.
   */
  private async resolveNeedsAttentionRows(gtin?: string): Promise<void> {
    await this.setOnlyFlagged(true);
    try {
      for (let attempt = 0; attempt < MAX_ROW_EDITS; attempt += 1) {
        await this.waitForReviewSettled();
        const before = await this.needsAttentionCount();
        if (before === 0) return; // settled + submittable (fast path or done).

        const row = this.editableProductRows().first();
        await expect(
          row,
          `a flagged review product should be editable (needsAttention=${before})`,
        ).toBeVisible({ timeout: 15_000 });
        const rowSummary = (await row.innerText()).replace(/\s+/g, ' ').trim();

        await this.fillRowEditor(row, gtin, 'always');

        // The Save recomputes the row's blockers; require the count to drop so an
        // unfilled required field surfaces here with its row. Re-settle first so a
        // recompute gated behind a (re)loading schema isn't read mid-flight.
        try {
          await expect(async () => {
            await this.waitForReviewSettled();
            expect(await this.needsAttentionCount()).toBeLessThan(before);
          }).toPass({ timeout: 15_000 });
        } catch {
          throw new Error(
            `Editing a review row did not clear its blocker (needsAttention stuck at ${before}). ` +
              `Row: "${rowSummary}". A required field/parameter could not be auto-filled.`,
          );
        }
      }
      const remaining = await this.needsAttentionCount();
      if (remaining > 0) {
        throw new Error(
          `Bulk review still shows ${remaining} row(s) needing attention after ${MAX_ROW_EDITS} edits.`,
        );
      }
    } finally {
      await this.setOnlyFlagged(false);
    }
  }

  /**
   * Top up EVERY listable product's required category parameters via its edit
   * modal, saving only products that actually gained a value. This closes the
   * gap for a destination whose FE surfaces required category params as an
   * editor field but NOT as a review blocker (Erli — #1481): such a row is
   * READY, so the needs-attention loop skips it, yet it still needs `Stan` +
   * the required quantity parameter filled or the marketplace rejects with
   * PARAMETER_REQUIRED. Idempotent for a destination already handled by the
   * needs-attention loop (Allegro): the reopened product's params are restored
   * from the FE stash, the fill finds nothing empty, and the modal is cancelled.
   */
  private async fillEveryRowRequiredParameters(gtin?: string): Promise<void> {
    // Reorder-safe: a "Save all" can re-render or reorder the review grid, so
    // iterating `nth(i)` against a pre-captured count could revisit an
    // already-filled row and SKIP another (its required params then surface
    // later as a marketplace PARAMETER_REQUIRED rejection with no local
    // signal). Instead, restart the walk from the top after every actual save:
    // already-complete rows are cheap no-ops (`if-changed` cancels without
    // saving), so each restarted pass permanently completes at least one more
    // row and a full pass with zero saves means every row is topped up.
    await this.setOnlyFlagged(false);
    await this.waitForReviewSettled();
    const maxPasses = (await this.editableProductRows().count()) + 1;
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const count = await this.editableProductRows().count();
      let saved = false;
      for (let i = 0; i < count; i += 1) {
        saved = await this.fillRowEditor(this.editableProductRows().nth(i), gtin, 'if-changed');
        if (saved) {
          // The save recomputes blockers / re-loads the schema (and may
          // reorder); re-settle, then restart the walk from the top.
          await this.waitForReviewSettled();
          break;
        }
      }
      if (!saved) return;
    }
    throw new Error(
      `Bulk review row top-up did not converge within ${maxPasses} passes — a row keeps ` +
        'reporting empty required parameters after being saved.',
    );
  }

  /**
   * The per-product edit modal (`bulk-edit-modal.tsx:306`).
   *
   * Scoped by accessible name — Radix labels `DialogContent` from its
   * `DialogTitle`, which reads "Edit offer - {product}" for a marketplace
   * (`:819-821`) and "Edit product - {product}" for a shop (`:2811-2813`).
   * Naming it is required, not cosmetic: the nested Choose-category modal
   * (`:1024`) and the editor's own discard guard (`:373`) are sibling dialogs.
   */
  private get editModal(): Locator {
    return this.page.getByRole('dialog', { name: /^Edit (offer|product)\b/ });
  }

  /**
   * Open a product's edit modal, ensure its category resolved, fill the required
   * fields (title + description + every required, still-empty category
   * parameter), and either always save or save only when something was filled.
   *
   * `save: 'if-changed'` (top-up pass) cancels out of an already-complete
   * product so a ready row with its params intact isn't needlessly re-saved; a
   * previously-saved row restores its values from the row's FE stash, so the
   * fill helpers report "nothing empty" and the modal is dismissed untouched.
   *
   * Returns whether "Save all" was actually clicked (false = cancelled with
   * nothing to change), so the top-up pass can restart its reorder-safe walk
   * only after a save that may have re-rendered the review grid.
   */
  private async fillRowEditor(
    row: Locator,
    gtin: string | undefined,
    save: 'always' | 'if-changed',
  ): Promise<boolean> {
    await row
      .locator('.bulk-review__prow-main')
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
    const dialog = this.editModal;
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await this.focusBaseScope(dialog);

    let changed = await this.ensureCategoryResolved(dialog);
    changed = (await this.fillRequiredTextField(dialog, 'Title', 'E2E offer')) || changed;
    changed =
      (await this.fillRequiredTextField(
        dialog,
        'Description',
        'Automated E2E golden-path offer.',
      )) || changed;
    changed = (await this.fillRequiredCategoryParameters(dialog, gtin)) || changed;

    // Both footer actions are scoped to `.bulk-editor__foot`
    // (`bulk-edit-modal.tsx:998-1021`): the image-add row renders its own
    // "Cancel" (`:1523-1533`, and again per variant at `:2167`), so an
    // unscoped exact match could go ambiguous.
    const footer = dialog.locator('.bulk-editor__foot');
    if (save === 'if-changed' && !changed) {
      await footer.getByRole('button', { name: 'Cancel', exact: true }).click();
      await this.dismissEditorDiscardGuardIfPresent();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      return false;
    }

    await footer.getByRole('button', { name: 'Save all', exact: true }).click();
    // A successful save closes the modal; a validation error keeps it open.
    try {
      await expect(dialog).toBeHidden({ timeout: 15_000 });
    } catch {
      const errors = await dialog
        .locator('.form-field__error, .bulk-editor__ean-err')
        .allTextContents();
      throw new Error(
        `Bulk edit modal did not close after "Save all" — validation failed: ${
          errors.length ? errors.join('; ') : '(no field errors surfaced)'
        }`,
      );
    }
    return true;
  }

  /**
   * Make the shared-base scope the active one.
   *
   * For a MULTI-variant product the editor mounts a scope rail
   * (`role="radiogroup"`, `aria-label="Variant scope selector"`,
   * `bulk-edit-modal.tsx:878-882`) and hides every inactive scope form with
   * `hidden` (`:1224`). Opening from the product main row already starts on
   * "Shared base" (`:481-482`), but a chip-triggered open focuses a variant —
   * so re-select base defensively, because the base scope is where the shared
   * title / description / category parameters live.
   */
  private async focusBaseScope(dialog: Locator): Promise<void> {
    const rail = dialog.getByRole('radiogroup', { name: 'Variant scope selector' });
    if ((await rail.count()) === 0) return; // simple product — single scope.
    const base = rail.getByRole('radio', { name: 'Shared base', exact: true });
    if ((await base.getAttribute('aria-checked')) !== 'true') {
      await base.click();
    }
  }

  /** Confirm the editor's unsaved-edits guard when a Cancel raised it (`bulk-edit-modal.tsx:373-387`). */
  private async dismissEditorDiscardGuardIfPresent(): Promise<void> {
    const guard = this.page.getByRole('dialog', { name: 'Discard changes?' });
    if (!(await this.isVisibleWithin(guard, 1_000))) return;
    await guard.getByRole('button', { name: 'Discard changes', exact: true }).click();
  }

  /**
   * Ensure the product's category is resolved so its parameter schema can load.
   *
   * #1741 moved category selection OUT of the editor body: a browsable
   * destination now shows a Category chip whose crumb is a
   * `aria-label="Change category"` button (`bulk-edit-modal.tsx:849-856`) that
   * opens the nested `BulkCategoryChooseModal`; the inline `CategoryPicker` /
   * `.category-tree-browser` is gone. Three states reach the parameter schema:
   *
   * 1. **Auto-resolved** (Allegro, and any row whose EAN/mapping resolved in the
   *    Resolve step): the chip renders a breadcrumb and no "Category is
   *    required" warning — nothing to pick.
   * 2. **Operator-picked** (a browsable destination whose preview came back
   *    `no-match`): the chip reads "Not set" and carries the warning triangle
   *    (`:860-871`); drive the Choose-category modal the way an operator does.
   * 3. **Borrowed taxonomy** (Erli, `canBrowseCategories === false`): NO chip
   *    button and NO modal — the base form exposes a plain "Allegro category ID"
   *    text field instead (`:1337-1351`), which is optional (blank ⇒ the
   *    category is resolved server-side from the configured mappings at submit,
   *    #1045/#1096). A caller that needs the parameter schema for that
   *    destination must pass `categoryId`; a `categoryPath` cannot drive a
   *    picker that does not exist, so passing one throws rather than silently
   *    leaving the category unset.
   */
  private async ensureCategoryResolved(dialog: Locator): Promise<boolean> {
    // Anything that means "the category-parameters query is no longer pending":
    // the rendered fieldset (`category-parameters-step.tsx:144`), the in-flight
    // "Loading…" line, the resolved-but-empty line, OR the query-error Alert
    // (`bulk-edit-modal.tsx:1653-1668`). The error state is in the union ONLY so
    // the wait short-circuits instead of burning its full timeout — every caller
    // immediately rejects it via `assertCategoryParametersLoaded`, because a
    // failed query is NOT a resolved schema.
    const paramsSettled = dialog
      .locator('fieldset.category-parameters-step__group')
      .or(dialog.getByText('Loading category parameters'))
      .or(dialog.getByText('No category parameters required'))
      .or(this.categoryParametersError(dialog));

    const changeCategoryButton = dialog.getByRole('button', { name: 'Change category' });
    if ((await changeCategoryButton.count()) === 0) {
      // Borrowed-taxonomy destination — inline id field, no browser.
      if (this.categoryPath && this.categoryPath.length > 0) {
        throw new Error(
          'A categoryPath was supplied but this destination ships no category browser ' +
            '(canBrowseCategories === false) — its editor only exposes the "Allegro category ID" ' +
            'text field. Pass `categoryId` instead of `categoryPath` for this destination.',
        );
      }
      if (this.categoryId) {
        const field = dialog.getByLabel('Allegro category ID', { exact: true });
        await expect(
          field,
          'the borrowed-taxonomy editor should expose an "Allegro category ID" field',
        ).toHaveCount(1, { timeout: 10_000 });
        await field.fill(this.categoryId);
        const settled = await this.isVisibleWithin(paramsSettled, 20_000);
        await this.assertCategoryParametersLoaded(dialog);
        if (settled) return true;
        throw new Error(
          `Filling the Allegro category ID "${this.categoryId}" never surfaced a parameter ` +
            'schema — the category-parameters query for that id did not resolve.',
        );
      }
      // Blank is a supported operator choice (resolve at submit); no schema loads.
      return false;
    }

    const categoryMissing = dialog.getByRole('img', { name: 'Category is required' });
    // Picking a category IS an edit. Reported so `fillRowEditor`'s `if-changed`
    // mode saves it: a row whose category only resolved here, and whose required
    // params then all came pre-filled, used to be CANCELLED — discarding the
    // pick. The submit then carried no category, the server resolved its own
    // from the mappings, and its required params (never shown in this editor)
    // came back as PARAMETER_REQUIRED.
    let picked = false;
    if ((await categoryMissing.count()) > 0) {
      await changeCategoryButton.click();
      await this.pickCategoryInChooseModal(this.categoryPath);
      picked = true;
    }

    const settled = await this.isVisibleWithin(paramsSettled, 20_000);
    await this.assertCategoryParametersLoaded(dialog);
    if (settled) return picked;

    throw new Error(
      'The bulk edit modal never surfaced a category parameter schema. The category is either ' +
        'still unset or its category-parameters query never resolved.',
    );
  }

  /**
   * The edit modal's category-parameters FAILURE state (`bulk-edit-modal.tsx:1657-1661`).
   * Its own copy — "You can still save - the worker may reject if required params
   * are missing" — is why it must never be read as a resolved schema.
   */
  private categoryParametersError(dialog: Locator): Locator {
    return dialog.getByText('Could not load category parameters');
  }

  /**
   * Reject the edit modal's category-parameters error state.
   *
   * `BaseParameterSection` has four states (`bulk-edit-modal.tsx:1653-1668`) and
   * only three of them mean the schema resolved. Treating the fourth — the
   * `parametersQuery.error` Alert — as "resolved" is a silent failure with a very
   * long fuse: `fillRequiredCategoryParameters` then finds no required fieldset,
   * the wizard submits `parameters: []`, and the run dies ~120 s later as an
   * opaque marketplace PARAMETER_REQUIRED rejection with nothing pointing back at
   * the FE query that 500'd. Same class as the `needsAttentionCount` fix above.
   *
   * A `count()` rather than a visibility wait: every call site has already waited
   * out the pending state, so the Alert is either mounted at this instant or the
   * query succeeded.
   */
  private async assertCategoryParametersLoaded(dialog: Locator): Promise<void> {
    if ((await this.categoryParametersError(dialog).count()) === 0) return;
    throw new Error(
      'The bulk edit modal reported "Could not load category parameters" — its ' +
        'category-parameters query failed, so no required parameter can be read or filled. ' +
        'The modal lets an operator save anyway, but the submit would be rejected ' +
        'marketplace-side with PARAMETER_REQUIRED.',
    );
  }

  /**
   * Drive `BulkCategoryChooseModal` (`bulk-category-choose-modal.tsx`) to pick a
   * leaf category.
   *
   * With an explicit breadcrumb, each non-final name is drilled via its
   * `aria-label="Browse into {name}"` button (`:219`) and the final one is
   * picked via its row's "Select" button (`:212`). Without one, drills the first
   * browsable child at each level until a selectable leaf is reachable. Bounded
   * by tree depth so an unexpectedly childless level fails loudly rather than
   * looping.
   */
  private async pickCategoryInChooseModal(categoryPath?: string[]): Promise<void> {
    const modal = this.page.getByRole('dialog', { name: /^Choose category/ });
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await this.waitForCategoryLevelSettled(modal);

    if (categoryPath && categoryPath.length > 0) {
      await this.drillCategoryPath(modal, categoryPath);
    } else {
      await this.selectFirstReachableCategoryLeaf(modal);
    }
    // Picking a leaf closes the modal (`bulk-category-choose-modal.tsx:111-114`).
    await expect(modal).toBeHidden({ timeout: 15_000 });
  }

  /**
   * Drill the Choose-category modal along an explicit breadcrumb of node names.
   * Each node row is `li.bulk-editor__catpick-item` (`:190-199`); the button
   * click is scoped to the matching row so it targets the right node.
   */
  private async drillCategoryPath(modal: Locator, path: string[]): Promise<void> {
    for (let i = 0; i < path.length; i += 1) {
      const name = path[i];
      const isLeaf = i === path.length - 1;
      const row = modal
        .locator('li.bulk-editor__catpick-item')
        .filter({ has: this.page.getByText(name, { exact: true }) })
        .first();
      await expect(
        row,
        `category node "${name}" (depth ${i}) should be present in the Choose-category modal`,
      ).toBeVisible({ timeout: 15_000 });
      if (isLeaf) {
        // A leaf already carrying this selection renders "Selected" (`:212`).
        await row.getByRole('button', { name: /^Select(ed)?$/ }).click();
        return;
      }
      await row.getByRole('button', { name: `Browse into ${name}`, exact: true }).click();
      await this.waitForCategoryLevelSettled(modal);
    }
  }

  /** Drill the first browsable child at each level until a leaf's "Select" is reachable. */
  private async selectFirstReachableCategoryLeaf(modal: Locator): Promise<void> {
    for (let depth = 0; depth < 12; depth += 1) {
      const selectButton = modal.getByRole('button', { name: /^Select(ed)?$/ }).first();
      if (await this.isVisibleWithin(selectButton, 1_500)) {
        await selectButton.click();
        return;
      }
      const browseButton = modal.locator('button[aria-label^="Browse into"]').first();
      if (!(await this.isVisibleWithin(browseButton, 1_500))) {
        throw new Error(
          `Category level ${depth} has neither a selectable leaf nor a browsable child — ` +
            'cannot pick a category.',
        );
      }
      await browseButton.click();
      await this.waitForCategoryLevelSettled(modal);
    }
    throw new Error('Could not reach a selectable category leaf within 12 levels.');
  }

  /**
   * Wait out the Choose-category modal's per-level fetch so the next scan sees
   * the new level. The modal renders `LoadingState title="Loading categories"`
   * while `useAllegroCategoriesQuery` is in flight
   * (`bulk-category-choose-modal.tsx:176`); a cached level never shows it.
   */
  private async waitForCategoryLevelSettled(modal: Locator): Promise<void> {
    const loading = modal.getByText('Loading categories');
    await this.isVisibleWithin(loading, 1_000);
    await expect(async () => {
      expect(await loading.count()).toBe(0);
    }).toPass({ timeout: 15_000 });
  }

  /**
   * Fill a required top-level text control (Title / Description) when empty.
   * Freshly-provisioned products carry no description, and the modal schema
   * requires a non-empty one, so an empty value would block the save. Returns
   * true when it actually wrote a value.
   *
   * `exact: true` is load-bearing: the editor also renders per-variant override
   * fields named "Title for {variant}" / "Description for {variant}"
   * (`bulk-edit-modal.tsx:2009` / `:2028`), which a substring match would sweep
   * in. The base controls' names come from `FormField`'s `<label htmlFor>`
   * (`:1262-1274`) and the base textarea's `aria-label="Description"` (`:1628`).
   */
  private async fillRequiredTextField(
    dialog: Locator,
    label: string,
    value: string,
  ): Promise<boolean> {
    const field = dialog.getByLabel(label, { exact: true }).first();
    if ((await field.count()) === 0) return false;
    if ((await field.inputValue()).trim() !== '') return false;
    await field.fill(value);
    return true;
  }

  /**
   * Fill every required, still-empty category parameter in the edit modal,
   * type-driven and generic (not hardcoded to one category). Re-scans each pass
   * so parameters that appear only after a parent value is set (dependency-gated
   * fields) are also filled. Optional parameters live in a collapsed <details>
   * and are intentionally left untouched — only required params gate submit.
   * Returns true when it wrote at least one value.
   *
   * Scoped to the BASE scope's `CategoryParametersStep`
   * (`category-parameters-step.tsx:144`), which is where the shared parameter
   * values live; per-variant overrides (`bulk-edit-modal.tsx:2180-2200`) inherit
   * from it and are intentionally left alone.
   */
  private async fillRequiredCategoryParameters(dialog: Locator, gtin?: string): Promise<boolean> {
    // Wait out the per-category schema load before deciding there's nothing to
    // fill (the fieldset only appears once parameters resolve).
    await expect(async () => {
      expect(await dialog.getByText('Loading category parameters').count()).toBe(0);
    }).toPass({ timeout: 20_000 });
    // The query can also settle into its ERROR state — including on a re-fetch
    // after the category changed inside this same modal, which is past every
    // check `ensureCategoryResolved` made. "No required params" and "the schema
    // never loaded" look identical from here, so reject the latter explicitly.
    await this.assertCategoryParametersLoaded(dialog);

    const requiredFieldset = dialog.locator(
      'fieldset.category-parameters-step__group:not(.category-parameters-step__group--optional)',
    );
    // The required fieldset mounts a tick after the "Loading…" text clears, so a
    // bare count check here races the render and can wrongly conclude "no
    // required params" (submitting empty `parameters`). Give the resolved schema
    // a bounded moment to mount before scanning; if it never appears the pass
    // loop below still exits cheaply.
    await this.isVisibleWithin(requiredFieldset, 5_000);

    let filledAny = false;
    for (let pass = 0; pass < MAX_PARAM_PASSES; pass += 1) {
      if ((await requiredFieldset.count()) === 0) return filledAny; // no required params.
      let filledSomething = false;

      // Native dictionaries (small, single-select) — e.g. `Stan`: prefer "Nowy".
      const selects = requiredFieldset.locator('select.control');
      for (let i = 0; i < (await selects.count()); i += 1) {
        if (await this.fillNativeSelectIfEmpty(selects.nth(i))) filledSomething = true;
      }
      // Free-text parameters. A GTIN/EAN param gets the product's real barcode
      // (Allegro rejects a placeholder); everything else gets the placeholder.
      const texts = requiredFieldset.locator('input.control[type="text"]');
      for (let i = 0; i < (await texts.count()); i += 1) {
        if (await this.fillTextInputIfEmpty(texts.nth(i), gtin)) filledSomething = true;
      }
      // Numeric parameters (scalars + both ends of a range).
      const numbers = requiredFieldset.locator('input.control[type="number"]');
      for (let i = 0; i < (await numbers.count()); i += 1) {
        if (await this.fillNumberInputIfEmpty(numbers.nth(i))) filledSomething = true;
      }
      // Large / multi / custom-value dictionaries rendered as a Combobox.
      const combos = requiredFieldset.locator('button[role="combobox"]');
      for (let i = 0; i < (await combos.count()); i += 1) {
        if (await this.fillComboboxIfEmpty(combos.nth(i))) filledSomething = true;
      }

      filledAny = filledAny || filledSomething;
      if (!filledSomething) {
        return filledAny; // steady state — every required control has a value.
      }
    }
    return filledAny;
  }

  /** Select the best option in an empty native dictionary select (prefer "Nowy"). */
  private async fillNativeSelectIfEmpty(select: Locator): Promise<boolean> {
    if ((await select.inputValue()) !== '') return false;
    const options = select.locator('option');
    const count = await options.count();
    let firstRealValue: string | null = null;
    let newValue: string | null = null;
    for (let i = 0; i < count; i += 1) {
      const option = options.nth(i);
      const value = await option.getAttribute('value');
      if (!value) continue; // skip the "Select…" placeholder (value="").
      if (firstRealValue === null) firstRealValue = value;
      if (CONDITION_NEW_PATTERN.test((await option.innerText()).trim())) {
        newValue = value;
        break;
      }
    }
    const chosen = newValue ?? firstRealValue;
    if (chosen === null) return false;
    await select.selectOption(chosen);
    return true;
  }

  /**
   * Fill an empty free-text parameter. A GTIN/EAN-typed param (detected by its
   * `aria-label`, which mirrors the parameter name) gets the product's REAL
   * barcode when one is available — Allegro's validator rejects a placeholder
   * GTIN and strands the offer (#1481). Every other text param gets the generic
   * placeholder. When a GTIN param is present but no barcode was threaded in, it
   * still falls back to the placeholder (surfaced downstream as an Allegro
   * rejection rather than silently mis-filling).
   */
  private async fillTextInputIfEmpty(input: Locator, gtin?: string): Promise<boolean> {
    if ((await input.inputValue()).trim() !== '') return false;
    const label = (await input.getAttribute('aria-label')) ?? '';
    const value = gtin && GTIN_PARAM_PATTERN.test(label) ? gtin : 'E2E';
    await input.fill(value);
    return true;
  }

  /** Enter a valid default into an empty numeric parameter (respecting `min`). */
  private async fillNumberInputIfEmpty(input: Locator): Promise<boolean> {
    if ((await input.inputValue()).trim() !== '') return false;
    const min = await input.getAttribute('min');
    await input.fill(min && Number(min) > 1 ? min : '1');
    return true;
  }

  /**
   * Pick the first selectable option in an empty single-select Combobox.
   *
   * A large (filter-first) dictionary renders nothing until the query matches,
   * and its entries can be alphabetic (brands, materials) OR numeric (clothing
   * sizes like 56/62/68) — so a single hardcoded letter probe (the old "a")
   * matches nothing for a numeric dictionary and the fill wrongly reports "no
   * options". Probe a broad alphabet (digits first — numeric dictionaries are
   * common) and stop at the first probe that reveals a real dictionary option.
   * Falls back to committing a custom value for a `customValuesEnabled` field
   * whose dictionary matched nothing.
   */
  private async fillComboboxIfEmpty(trigger: Locator): Promise<boolean> {
    if (!(await this.isComboboxEmpty(trigger))) return false;

    await trigger.click();
    // The popover is portaled to the document body — scope to the page, not the dialog.
    const search = this.page.locator('.combobox__search');
    await expect(search).toBeVisible({ timeout: 10_000 });

    const listbox = this.page.getByRole('listbox');
    // Real dictionary rows — exclude the "use as custom value" affordance and
    // any disabled (parent-filtered) rows.
    const realOptions = listbox.locator(
      '[role="option"]:not(.combobox__option--disabled):not(.combobox__option--custom)',
    );
    // Any committable row, including the custom-value affordance (last resort).
    const anyOptions = listbox.locator('[role="option"]:not(.combobox__option--disabled)');

    // Small, non-filter-first dictionaries render every option immediately.
    if (await this.isVisibleWithin(realOptions, 800)) {
      await realOptions.first().click();
      return true;
    }

    // Filter-first dictionary: probe until a real option surfaces.
    const PROBES = '0123456789aeiouymslxrtnkpbcdfgh';
    for (const probe of PROBES) {
      await search.fill(probe);
      if (await this.isVisibleWithin(realOptions, 400)) {
        await realOptions.first().click();
        return true;
      }
    }

    // No dictionary entry matched any probe — commit a custom value if the field
    // offers one (customValuesEnabled renders a "use as custom value" row).
    await search.fill('E2E');
    if (await this.isVisibleWithin(anyOptions, 1_000)) {
      await anyOptions.first().click();
      return true;
    }

    await this.page.keyboard.press('Escape');
    throw new Error(
      'A required Combobox parameter exposed no selectable options after probing digits + ' +
        'letters and a custom value — cannot auto-fill it.',
    );
  }

  /**
   * Decide whether a required Combobox parameter still has NO value.
   *
   * Two of the trigger's three bodies are structurally decisive
   * (`combobox.tsx:272-292`): a multi-select with picks renders
   * `span.combobox__chips`, and a committed custom value renders
   * `span.combobox__custom-value`. Neither can exist while the field is empty.
   *
   * The third, `span.combobox__summary`, is ambiguous by construction — it holds
   * the PLACEHOLDER when `value` is null and the chosen option's LABEL otherwise
   * (`formatTriggerSummary`, `:445-456`). There is no `data-empty` / distinguishing
   * class, so the copy is the only discriminator available. Rather than sniff for
   * a hardcoded word, derive the exact placeholder the FE must render: the same
   * call site passes `ariaLabel={parameter.name}` and
   * `placeholder={`Pick ${parameter.name.toLowerCase()}`}`
   * (`category-parameters-step.tsx:277-279`), so an empty trigger reads exactly
   * "Pick {aria-label lowercased}"; a control mounted with no placeholder falls
   * back to the shared default "Select…" (`combobox.tsx:449`, `:455`).
   *
   * A label that still LOOKS like placeholder copy but doesn't match either form
   * throws instead of being read as a value. That is the whole point: rename the
   * placeholder to "Select {name}" and the old prefix test classified every
   * required dictionary as already-filled, left the row READY, and submitted empty
   * parameters — failing remotely as a marketplace rejection instead of here.
   */
  private async isComboboxEmpty(trigger: Locator): Promise<boolean> {
    if (
      (await trigger.locator('span.combobox__chips, span.combobox__custom-value').count()) > 0
    ) {
      return false;
    }

    const summary = trigger.locator('span.combobox__summary');
    const name = ((await trigger.getAttribute('aria-label')) ?? '').trim();
    if ((await summary.count()) === 0) {
      throw new Error(
        `Required Combobox parameter "${name || '(unlabelled)'}" renders none of the three ` +
          'known trigger bodies (chips / custom value / summary) — cannot tell whether it ' +
          'already has a value.',
      );
    }

    const label = (await summary.innerText()).trim();
    if (name && label.toLowerCase() === `pick ${name.toLowerCase()}`) return true;
    if (/^select[.…]{0,3}$/i.test(label)) return true;
    if (/^(pick|select|choose)\b/i.test(label)) {
      throw new Error(
        `Required Combobox parameter "${name || '(unlabelled)'}" shows "${label}", which reads ` +
          `like placeholder copy but is neither "Pick ${name.toLowerCase()}" nor "Select…" — ` +
          'the FE placeholder was probably renamed. Refusing to guess: treating it as filled ' +
          'would submit the offer with this required parameter empty.',
      );
    }
    return false;
  }

  /** True if the locator's first match becomes visible within `timeoutMs`. */
  private async isVisibleWithin(locator: Locator, timeoutMs: number): Promise<boolean> {
    return locator
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
  }

  /**
   * The submit confirmation modal (`bulk-confirm-modal.tsx:77-80`), scoped by
   * its title "Create {N} {marketplace} offers on {connection}?" so it can't be
   * confused with the duplicate guard that may precede it.
   */
  private get confirmModal(): Locator {
    return this.page.getByRole('dialog', { name: /^Create \d+ .* offers on .+\?$/ });
  }

  get confirmModalConfirmButton(): Locator {
    return this.confirmModal.getByRole('button', { name: 'Create offers', exact: true });
  }

  /**
   * The confirm modal's publish toggle (`bulk-confirm-modal.tsx:95-119`).
   *
   * The wrapping `<label>` also contains the tooltip trigger
   * (`aria-label="About publish immediately"`) and the "Uncheck to create
   * everything as drafts." helper, so the checkbox's accessible name is the
   * CONCATENATION of all three — an exact "Publish immediately" match resolves
   * to nothing. Anchor on the prefix instead.
   */
  get publishImmediatelyCheckbox(): Locator {
    return this.confirmModal.getByRole('checkbox', { name: /^Publish immediately\b/ });
  }

  /**
   * Confirm the destination-aware duplicate guard when it opens (#1837,
   * `duplicate-guard-modal.tsx`). It is a soft warning raised between the review
   * CTA and the actual submit whenever an included variant already has a listing
   * on the destination (`bulk-wizard.tsx:521-527` / `:531-541`); no-op otherwise.
   */
  private async confirmDuplicateGuardIfPresent(): Promise<void> {
    const guard = this.page.getByRole('dialog', { name: /already on / });
    if (!(await this.isVisibleWithin(guard, 2_000))) return;
    await guard
      .getByRole('button', { name: /^(Publish anyway \(creates duplicate\)|Update existing)$/ })
      .click();
    await expect(guard).toBeHidden({ timeout: 15_000 });
  }

  /** Confirm creation in the final modal and land on the batch progress page. */
  async confirmCreation(): Promise<BulkBatchProgressPage> {
    await this.confirmModalConfirmButton.click();
    await this.page.waitForURL(/\/listings\/bulk-batches\/[^/]+$/);
    return new BulkBatchProgressPage(this.page);
  }
}
