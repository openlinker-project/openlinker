/**
 * Bulk offer wizard page object (Allegro / Erli)
 *
 * Covers `/listings/bulk-create/wizard` → the SetupStepper flow
 * (Config → Resolving → Review → Confirm) rendered by `bulk/bulk-wizard.tsx`,
 * the confirm modal, and the transition to the batch progress page
 * (`/listings/bulk-batches/:batchId`).
 *
 * Step CTAs mirror the real components: "Proceed →" on the config step
 * (`bulk-config-step.tsx`), the resolve step auto-advances when its batch
 * queries settle (`bulk-resolve-step.tsx`), and "Approve all (N)" on the
 * review step opens the confirm modal (`bulk-review-step.tsx`). "Approve all"
 * stays disabled while any row needs attention, so the flow fails fast on a
 * non-zero needs-attention count instead of timing out on a disabled button.
 *
 * Marketplace connection selection is only shown when more than one eligible
 * connection exists; with a single connection the wizard shows "Publishing as
 * {name}" and no select.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { selectOptionByText } from '../support/selectors';
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

export class BulkOfferWizard {
  constructor(private readonly page: Page) {}

  /**
   * Explicit category breadcrumb (ancestor names ending at the leaf) used to
   * drive the per-row `CategoryTreeBrowser` for a `borrows`-taxonomy destination
   * (Erli) whose category did not auto-resolve. Set per-run by
   * `advanceToConfirmModal`; when unset the picker falls back to first-reachable.
   */
  private categoryPath: string[] | undefined;

  async expectOnConfigStep(): Promise<void> {
    await expect(
      this.page.getByRole('heading', { name: 'Bulk marketplace offer creation' }),
    ).toBeVisible();
  }

  get marketplaceConnectionSelect(): Locator {
    return this.page.getByLabel('Marketplace connection');
  }

  /** Select the marketplace connection if the picker is present (multi-connection). */
  async selectConnectionIfPresent(connectionName: string): Promise<void> {
    if (await this.marketplaceConnectionSelect.count()) {
      await selectOptionByText(this.marketplaceConnectionSelect, connectionName);
    }
  }

  /** The Allegro platform section's delivery-policy select ("Shipping rate package"). */
  get deliveryPolicySelect(): Locator {
    return this.page.getByLabel('Shipping rate package');
  }

  /** The Erli section's delivery-price-list select (#1530, "Delivery price list"). */
  get erliDeliveryPriceListSelect(): Locator {
    return this.page.getByLabel('Delivery price list', { exact: true });
  }

  /** The Erli section's responsible-producer select (#1531, "Producer"). */
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

  /** The config step's forward CTA ("Proceed →", `bulk-config-step.tsx`). */
  get proceedButton(): Locator {
    return this.page.getByRole('button', { name: /^Proceed/ });
  }

  /** The review step's submit CTA ("Approve all (N)", `bulk-review-step.tsx`). */
  get approveAllButton(): Locator {
    return this.page.getByRole('button', { name: /^Approve all \(\d+\)$/ });
  }

  /**
   * The needs-attention count on the review step (0 when the hint is absent).
   * Rendered as a `role="status"` hint: "N row(s) need attention…".
   */
  async needsAttentionCount(): Promise<number> {
    const hint = this.page.getByRole('status').filter({ hasText: /needs? attention/ });
    if ((await hint.count()) === 0) {
      return 0;
    }
    const text = (await hint.first().innerText()).trim();
    const match = /^(\d+)/.exec(text);
    return match ? Number(match[1]) : 1;
  }

  /**
   * Drive Config → Resolving → Review and open the confirm modal.
   *
   * The resolve step runs two batch queries and auto-advances to Review on
   * settle, so the config click is just "Proceed →". At Review, any row flagged
   * "needs attention" is resolved by driving the wizard's OWN per-row edit modal
   * — the bulk wizard is OpenLinker's own UI, so the automated flow fills it
   * fully (required category parameters + description) rather than hard-failing.
   * A fresh, attribute-less product (no auto-prefilled `Stan`) is therefore
   * listable without operator intervention. The fast path (zero needs-attention
   * rows) stays a no-op. Finally "Publish immediately" is asserted checked so the
   * offers are created ACTIVE, not as drafts. (#1481)
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
    } = {},
  ): Promise<void> {
    this.categoryPath = opts.categoryPath;
    await this.completePlatformConfig(opts);
    await expect(this.proceedButton).toBeEnabled({ timeout: 30_000 });
    await this.proceedButton.click();
    await expect(this.approveAllButton).toBeVisible({ timeout: 60_000 });

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
    await expect(this.approveAllButton).toBeEnabled({ timeout: 30_000 });
    await this.approveAllButton.click();
    await expect(this.confirmModalConfirmButton).toBeVisible();

    // Publish the offers ACTIVE, not as drafts. The config default is already
    // `true`, but assert it explicitly (idempotent) so a changed default can't
    // silently create drafts.
    await this.publishImmediatelyCheckbox.check();
  }

  /** The Review-step DataTable (its sr-only caption is its accessible name). */
  private get reviewTable(): Locator {
    return this.page.getByRole('table', { name: 'Bulk listing review' });
  }

  /** Every listable review row — one that exposes an "Edit" button (a
   * no-variant row shows "No variant" instead and is skipped on submit). */
  private editableRows(): Locator {
    return this.reviewTable
      .getByRole('row')
      .filter({ has: this.page.getByRole('button', { name: 'Edit', exact: true }) });
  }

  /**
   * The first review row that needs attention: a listable row (exposes an
   * "Edit" button; a no-variant row shows "No variant" instead) whose status
   * cell is NOT "ready" (ready rows carry a lone "ready" badge, flagged rows
   * carry blocker chips like "add product params").
   */
  private firstNeedsAttentionRow(): Locator {
    return this.editableRows().filter({ hasNotText: /\bready\b/i }).first();
  }

  /**
   * Wait until the Review step has SETTLED — i.e. the async per-category
   * parameter schema has resolved and the row blockers reflect it.
   *
   * The wizard gates "Approve all" on `!paramsResolving`
   * (`bulk-review-step.tsx`), and Allegro's `needs-product-parameters` blocker
   * (`allegro-offer-validation.ts`) only appears AFTER that per-category schema
   * loads — an effect that races the operator landing on Review. So a naive
   * needs-attention read right after "Proceed" can catch the transient limbo of
   * "0 rows need attention, button disabled (still resolving)" and wrongly take
   * the fast path; the blocker then appears and the button stays disabled at
   * "Approve all (0)" forever.
   *
   * The settled state is unambiguous: EITHER the button is enabled (nothing
   * needs attention) OR at least one row explicitly needs attention. Poll until
   * one of those holds before reading the needs-attention count.
   */
  private async waitForReviewSettled(): Promise<void> {
    await expect(async () => {
      const [enabled, attention] = await Promise.all([
        this.approveAllButton.isEnabled(),
        this.needsAttentionCount(),
      ]);
      if (!enabled && attention === 0) {
        throw new Error(
          'Review still resolving: "Approve all" is disabled with no needs-attention rows — ' +
            'the per-category parameter schema has not settled yet.',
        );
      }
    }).toPass({ timeout: 60_000 });
  }

  /**
   * Resolve every "needs attention" review row via the per-row edit modal until
   * the needs-attention count reaches 0. Bounded, and requires forward progress
   * per edit so a parameter that can't be auto-filled fails loudly (naming the
   * offending row) instead of looping. Each pass first waits out the async
   * category-parameter resolution (`waitForReviewSettled`) so a late-appearing
   * platform blocker is never missed.
   */
  private async resolveNeedsAttentionRows(gtin?: string): Promise<void> {
    for (let attempt = 0; attempt < MAX_ROW_EDITS; attempt += 1) {
      await this.waitForReviewSettled();
      const before = await this.needsAttentionCount();
      if (before === 0) return; // settled + approvable (fast path or done).

      const row = this.firstNeedsAttentionRow();
      await expect(
        row,
        `a review row needing attention should be editable (needsAttention=${before})`,
      ).toBeVisible({ timeout: 15_000 });
      const rowSummary = (await row.innerText()).replace(/\s+/g, ' ').trim();

      await this.resolveRowViaEditor(row, gtin);

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
  }

  /**
   * Resolve a needs-attention row: open its editor, fill the required fields,
   * and ALWAYS save (the fill is the resolution). Thin wrapper over
   * `fillRowEditor` so the needs-attention loop and the top-up pass share one
   * fill implementation.
   */
  private async resolveRowViaEditor(row: Locator, gtin?: string): Promise<void> {
    await this.fillRowEditor(row, gtin, 'always');
  }

  /**
   * Open a row's edit modal, ensure its category resolved, fill the required
   * fields (title + description + every required, still-empty category
   * parameter), and either always save or save only when something was filled.
   * The modal reuses the single-offer wizard's `CategoryPicker` +
   * `CategoryParametersStep`, so the controls are the same primitives.
   *
   * `save: 'if-changed'` (top-up pass) cancels out of an already-complete row
   * so a ready row with its params intact isn't needlessly re-saved; a
   * previously-saved row restores its values from the row's FE stash, so the
   * fill helpers report "nothing empty" and the modal is dismissed untouched.
   *
   * Returns whether "Save row" was actually clicked (false = cancelled with
   * nothing to change), so the top-up pass can restart its reorder-safe walk
   * only after a save that may have re-rendered the review table.
   */
  private async fillRowEditor(
    row: Locator,
    gtin: string | undefined,
    save: 'always' | 'if-changed',
  ): Promise<boolean> {
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = this.page.getByRole('dialog');
    await expect(dialog.getByText(/^Edit offer/)).toBeVisible({ timeout: 15_000 });

    await this.ensureCategoryResolved(dialog);
    let changed = false;
    changed = (await this.fillRequiredTextField(dialog, 'Title', 'E2E offer')) || changed;
    changed =
      (await this.fillRequiredTextField(
        dialog,
        'Description',
        'Automated E2E golden-path offer.',
      )) || changed;
    changed = (await this.fillRequiredCategoryParameters(dialog, gtin)) || changed;

    if (save === 'if-changed' && !changed) {
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      return false;
    }

    await dialog.getByRole('button', { name: 'Save row' }).click();
    // A successful save closes the modal; a validation error keeps it open.
    try {
      await expect(dialog).toBeHidden({ timeout: 15_000 });
    } catch {
      const errors = await dialog.locator('.form-field__error').allTextContents();
      throw new Error(
        `Bulk edit modal did not close after "Save row" — validation failed: ${
          errors.length ? errors.join('; ') : '(no field errors surfaced)'
        }`,
      );
    }
    return true;
  }

  /**
   * Top up EVERY listable row's required category parameters via its edit
   * modal, saving only rows that actually gained a value. This closes the gap
   * for a destination whose FE surfaces required category params as an editor
   * field but NOT as a review blocker (Erli — #1481): such a row is READY, so
   * the needs-attention loop skips it, yet it still needs `Stan` + the required
   * quantity parameter filled or the marketplace rejects with
   * PARAMETER_REQUIRED. Idempotent for a destination already handled by the
   * needs-attention loop (Allegro): the reopened row's params are restored from
   * the FE stash, the fill finds nothing empty, and the modal is cancelled.
   */
  private async fillEveryRowRequiredParameters(gtin?: string): Promise<void> {
    // Reorder-safe: a "Save row" can re-render or reorder the review table, so
    // iterating `nth(i)` against a pre-captured count could revisit an
    // already-filled row and SKIP another (its required params then surface
    // later as a marketplace PARAMETER_REQUIRED rejection with no local
    // signal). Instead, restart the walk from the top after every actual save:
    // already-complete rows are cheap no-ops (`if-changed` cancels without
    // saving), so each restarted pass permanently completes at least one more
    // row and a full pass with zero saves means every row is topped up.
    await this.waitForReviewSettled();
    const maxPasses = (await this.editableRows().count()) + 1;
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const count = await this.editableRows().count();
      let saved = false;
      for (let i = 0; i < count; i += 1) {
        saved = await this.fillRowEditor(this.editableRows().nth(i), gtin, 'if-changed');
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
   * Ensure the row's category is resolved so its parameter schema can load.
   *
   * The browse-mode picker (`CategoryPicker`) shows a resolved id as a prefill
   * row and an unresolved one as the browsable category tree
   * (`CategoryTreeBrowser`). Two legitimate states reach the parameter schema:
   *
   * 1. **Auto-resolved** (Allegro, and any row whose EAN/mapping resolved in the
   *    Resolve step): the picker prefills the id, so `.category-tree-browser`
   *    is absent — nothing to do here.
   * 2. **Operator-picked** (a `borrows`-taxonomy destination like Erli whose
   *    preview came back `no-match`, ADR-025 §3 / #1522): the batch resolve
   *    deliberately degrades borrows destinations to `no-match`, so the row
   *    carries no category and the modal shows the tree with nothing selected.
   *    A human operator then browses the tree and Selects a leaf — the offer's
   *    real category is resolved server-side at submit from the barcode +
   *    configured mapping (#1045/#1096), so the picked leaf only drives the
   *    param schema the wizard renders. This is NOT a fault (params load fine
   *    once a leaf is chosen — verified against the live UI); the previous
   *    "empty picker = fault" assumption was an E2E gap: the flow never drove
   *    the picker the way an operator does. So drive it.
   *
   * Only a tree that stays empty *after* driving the picker — no selectable
   * leaf reachable at all — is a genuine fault.
   */
  private async ensureCategoryResolved(dialog: Locator): Promise<void> {
    if ((await dialog.locator('.category-tree-browser').count()) === 0) return; // prefill / non-browse.

    const paramsSignal = dialog
      .locator('fieldset.category-parameters-step__group')
      .or(dialog.getByText('Loading category parameters'))
      .or(dialog.getByText('No category parameters required'))
      .or(dialog.getByText('Could not load category parameters'));
    // Already resolved (barcode/mapping hit, or a prior pass picked a leaf that
    // stuck): the param section is present even though the tree is still mounted.
    if (await this.isVisibleWithin(paramsSignal, 3_000)) return;

    // Unresolved borrows row — pick a leaf the way an operator does, then wait
    // for the schema to load off the chosen category.
    await this.selectFirstReachableCategoryLeaf(dialog, this.categoryPath);
    if (await this.isVisibleWithin(paramsSignal, 20_000)) return;

    throw new Error(
      'Bulk edit modal category picker did not surface a parameter schema even after ' +
        'selecting a category leaf in the tree. The category-parameters query for the picked ' +
        'leaf never resolved.',
    );
  }

  /**
   * Drive the `CategoryTreeBrowser` to select a category leaf, mirroring what an
   * operator does for a `borrows`-taxonomy row (Erli) whose category did not
   * auto-resolve. Drills into the first browsable child at each level until a
   * selectable leaf is reachable, then clicks its "Select" button. Bounded by
   * tree depth so an unexpectedly childless level fails loudly rather than
   * looping. The specific leaf is immaterial for a borrows destination — the
   * real offer category is resolved server-side at submit (#1045); the pick only
   * drives which parameter schema the wizard renders (matching the operator's
   * "any leaf loads params" behaviour).
   */
  private async selectFirstReachableCategoryLeaf(dialog: Locator, categoryPath?: string[]): Promise<void> {
    const tree = dialog.locator('.category-tree-browser');
    // When the caller supplies the exact breadcrumb (ancestor names ending at the
    // leaf), drill it deterministically — the picked category then MATCHES the
    // Allegro row's mapped category (golden-path parity) and loads that category's
    // known parameter schema, instead of whatever first-reachable leaf the tree
    // happens to expose. Falls back to first-reachable when no path is given.
    if (categoryPath && categoryPath.length > 0) {
      await this.drillCategoryPath(tree, categoryPath);
      return;
    }
    for (let depth = 0; depth < 12; depth += 1) {
      // A leaf at this level exposes a "Select" button (exact — never "Selected").
      const selectButton = tree.getByRole('button', { name: 'Select', exact: true }).first();
      if (await this.isVisibleWithin(selectButton, 1_500)) {
        await selectButton.click();
        return;
      }
      // No leaf here — drill into the first browsable child and let the next
      // level's children load before re-scanning.
      const browseButton = tree.locator('button[aria-label^="Browse into"]').first();
      if (!(await this.isVisibleWithin(browseButton, 1_500))) {
        throw new Error(
          `Category tree level ${depth} has neither a selectable leaf nor a browsable child — ` +
            'cannot pick a category.',
        );
      }
      await browseButton.click();
      await this.waitForTreeLevelSettled(tree);
    }
    throw new Error('Could not reach a selectable category leaf within 12 tree levels.');
  }

  /**
   * Drill the category tree along an explicit breadcrumb of node names. Every
   * name except the last is a non-leaf drilled via its "Browse into {name}"
   * button; the last name is the leaf selected via its row "Select" button. Each
   * node row is matched by its `.category-tree-browser__name` text, scoped to the
   * `<li>` so the button click targets the right row.
   */
  private async drillCategoryPath(tree: Locator, path: string[]): Promise<void> {
    for (let i = 0; i < path.length; i += 1) {
      const name = path[i];
      const isLeaf = i === path.length - 1;
      const row = tree
        .locator('li.category-tree-browser__item')
        .filter({ has: this.page.getByText(name, { exact: true }) })
        .first();
      await expect(
        row,
        `category tree node "${name}" (depth ${i}) should be present`,
      ).toBeVisible({ timeout: 15_000 });
      if (isLeaf) {
        await row.getByRole('button', { name: 'Select', exact: true }).click();
        return;
      }
      await row.getByRole('button', { name: `Browse into ${name}` }).click();
      await this.waitForTreeLevelSettled(tree);
    }
  }

  /** Wait out the tree's child-level fetch so the next scan sees the new level. */
  private async waitForTreeLevelSettled(tree: Locator): Promise<void> {
    await this.isVisibleWithin(tree.getByText('Fetching categories'), 1_000);
    await expect(async () => {
      expect(await tree.getByText('Fetching categories').count()).toBe(0);
    }).toPass({ timeout: 15_000 });
  }

  /**
   * Fill a required top-level text control (Title / Description) when empty.
   * Freshly-provisioned products carry no description, and the modal schema
   * requires a non-empty one, so an empty value would block the save. Returns
   * true when it actually wrote a value.
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
   */
  private async fillRequiredCategoryParameters(dialog: Locator, gtin?: string): Promise<boolean> {
    // Wait out the per-category schema load before deciding there's nothing to
    // fill (the fieldset only appears once parameters resolve).
    await expect(async () => {
      expect(await dialog.getByText('Loading category parameters').count()).toBe(0);
    }).toPass({ timeout: 20_000 });

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
        await this.logRequiredParamReadback(requiredFieldset);
        return filledAny; // steady state — every required control has a value.
      }
    }
    await this.logRequiredParamReadback(requiredFieldset);
    return filledAny;
  }

  /**
   * Diagnostic: dump every required control's current value once the fill has
   * reached steady state, so a run log shows whether the DOM values actually
   * stuck (vs. a serialization gap where the values are present in the DOM but
   * missing from the submitted override). Never throws — pure observation.
   */
  private async logRequiredParamReadback(requiredFieldset: Locator): Promise<void> {
    try {
      if ((await requiredFieldset.count()) === 0) {
        console.log('[e2e][param-readback] no required fieldset present');
        return;
      }
      const controls = requiredFieldset.locator(
        'select.control, input.control, button[role="combobox"]',
      );
      const n = await controls.count();
      const readback: string[] = [];
      for (let i = 0; i < n; i += 1) {
        const c = controls.nth(i);
        const tag = await c.evaluate((el) => el.tagName.toLowerCase());
        const label =
          (await c.getAttribute('aria-label')) ?? (await c.getAttribute('name')) ?? `#${i}`;
        const value =
          tag === 'button' ? (await c.innerText()).trim() : await c.inputValue().catch(() => '?');
        readback.push(`${label}=${JSON.stringify(value)}`);
      }
      console.log(`[e2e][param-readback] required controls (${n}): ${readback.join(', ')}`);
    } catch {
      // Diagnostic only — never let it affect the run.
    }
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
   * whose dictionary matched nothing. An empty trigger shows its "Pick …"
   * placeholder; a filled one shows the chosen label.
   */
  private async fillComboboxIfEmpty(trigger: Locator): Promise<boolean> {
    if (!/^pick\b/i.test((await trigger.innerText()).trim())) return false; // already has a value.

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

  /** True if the locator's first match becomes visible within `timeoutMs`. */
  private async isVisibleWithin(locator: Locator, timeoutMs: number): Promise<boolean> {
    return locator
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
  }

  get confirmModalConfirmButton(): Locator {
    return this.page.getByRole('dialog').getByRole('button', { name: 'Create offers' });
  }

  get publishImmediatelyCheckbox(): Locator {
    return this.page.getByRole('dialog').getByRole('checkbox', { name: 'Publish immediately' });
  }

  /** Confirm creation in the final modal and land on the batch progress page. */
  async confirmCreation(): Promise<BulkBatchProgressPage> {
    await this.confirmModalConfirmButton.click();
    await this.page.waitForURL(/\/listings\/bulk-batches\/[^/]+$/);
    return new BulkBatchProgressPage(this.page);
  }
}
