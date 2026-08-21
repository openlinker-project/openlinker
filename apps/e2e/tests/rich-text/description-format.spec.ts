/**
 * Rich-text descriptions: the destination's contract drives the editor (#2201)
 *
 * The one place ADR-046's central claim can actually be proved. Three properties
 * are unreachable in the unit suites and land here:
 *
 *  1. **Typing.** `userEvent.type` inserts NOTHING into a ProseMirror surface -
 *     under jsdom and under happy-dom alike. Probed directly during #2200: five
 *     characters produced a single empty paragraph and no text. So every "the
 *     operator types, then X" assertion relocated here, including the two Save /
 *     Publish gating cases removed from `content-panel.test.tsx` and the
 *     master-draft save skipped in `content-editor.test.tsx`.
 *  2. **Paste-time filtering.** The registered extensions ARE the document
 *     schema, so a disallowed tag is dropped at parse time rather than by a pass
 *     afterwards. Only a real browser parses a real paste.
 *  3. **Sanitized rendering.** DOMPurify is LOSSY under happy-dom -
 *     `sanitize('<p>a</p>')` returns `'a'` while reporting `isSupported: true` -
 *     so a rendered-markup assertion is only meaningful in a real engine.
 *
 * One caveat worth stating rather than discovering: the derived surface is
 * identical whether the format came from the destination's declaration or from
 * the conservative fallback - by design, since the fallback IS the Allegro-shaped
 * subset. So the channel case asserts the surface AND cross-checks it against
 * what `/description-format` actually answers, instead of assuming which of the
 * two it got. Running against a deployment that predates that endpoint is a
 * legitimate configuration, and the spec must pass there while still proving the
 * "not declared" note appears.
 *
 * Self-configuring, and explicit about what it writes. One case SAVES a master
 * description draft and discards it again in a `finally`, so a leftover draft
 * cannot accumulate across runs or collide with an ingestion that moves the base
 * value underneath it. One case CREATES AN OFFER (see below). The rest only read.
 * Each skips cleanly, with a reason, on a stack that lacks what it needs - and a
 * session without `content:write` is one of those: the draft case needs it, so it
 * checks rather than failing on a disabled button.
 *
 * The last case DOES publish, because "the marketplace accepted what we sent" is
 * the epic's central claim and nothing short of a real create proves it. It is
 * gated on the stack's API actually serving `/description-format`: an older
 * deployment builds its payload with the PREVIOUS builder, so publishing there
 * would pass or fail for reasons unrelated to the format - a green run that
 * proves nothing is worse than a skip that says why.
 *
 * @module tests/rich-text
 */
import type { Locator, Page } from '@playwright/test';

import { test, expect } from '../../src/fixtures/test';
import { BulkOfferRowEditor } from '../../src/pages/bulk-offer-row-editor.page';
import { PlatformType } from '../../src/world/world';
import type { DescriptionFormatView } from '../../src/api/api.types';

/** Markup a PrestaShop TinyMCE description really carries. */
const SHOP_MARKUP = [
  '<div class="rte" style="font-family:Verdana">',
  '<h1><strong>Kurtka puchowa Alpine 300</strong></h1>',
  '<p style="margin:0">Do <span style="font-weight:700">-20 °C</span>.<br>620 g.</p>',
  '<table border="1"><tbody><tr><td>Waga</td><td>620 g</td></tr></tbody></table>',
  '<ul><li>Puch 90/10</li><li>Membrana 10 000 mm</li></ul>',
  '</div>',
].join('');

/**
 * A description using only tags Allegro allows.
 *
 * The `marker` is minted per run and sits inside ONE text node, which is what
 * makes the authoring verifiable at all: it is the needle both the row editor's
 * change detection and the wizard's pre-submit assertion match on, and being
 * per-run it cannot be satisfied by whatever the stack already held.
 */
function authoredDescription(marker: string): string {
  return [
    `<h1>Opis przygotowany w OpenLinkerze ${marker}</h1>`,
    '<p>Tekst z <b>wyróżnieniem</b> i akapitem.</p>',
    '<ul><li>Punkt pierwszy</li><li>Punkt drugi</li></ul>',
    '<ol><li>Krok jeden</li><li>Krok dwa</li></ol>',
  ].join('');
}

/**
 * Which toolbar controls a contract implies, and which it forbids.
 *
 * The single source of truth for the channel case's expectations. It mirrors
 * `deriveRichTextProfile` (`apps/web/src/shared/ui/rich-text-profiles.ts`)
 * deliberately - the point of the assertion is that the UI derives its surface
 * from the declaration, so the test must derive its expectation from the same
 * declaration rather than from a platform name.
 *
 * `null` means the stack's API predates the endpoint, which is a legitimate
 * deployment: the frontend then uses the conservative shared subset, and the
 * only honest expectation is that subset plus the visible "not declared" note.
 */
function expectedControls(contract: DescriptionFormatView | null): {
  present: string[];
  absent: string[];
  tags: string[];
} {
  // The fallback, kept in step with `OFFER_DESCRIPTION_FALLBACK_FORMAT`.
  const tags = contract?.allowedTags ?? ['h1', 'h2', 'p', 'ul', 'ol', 'li', 'b'];
  const has = (tag: string): boolean => tags.includes(tag);

  const control: Record<string, boolean> = {
    Bold: has('b') || has('strong'),
    // ADR-046 decision 2 rewrites `i`/`em` to `b` on the way OUT, which is a
    // WRITE-path rule; it does not put an italic control in an editor whose
    // destination declares no italic tag. When a destination does declare one,
    // the control appears and carries the lossy-conversion note - so this stays
    // keyed on the declaration and does not need revisiting when that note ships.
    Italic: has('i') || has('em'),
    Underline: has('u'),
    Strikethrough: has('s') || has('del'),
    'Bullet list': has('ul') && has('li'),
    'Numbered list': has('ol') && has('li'),
    'Heading 1': has('h1'),
    'Heading 2': has('h2'),
    'Heading 3': has('h3'),
    // 4-6 exist in the profile derivation, so a destination declaring `h4` must
    // get an assertion rather than falling through both lists unchecked.
    'Heading 4': has('h4'),
    'Heading 5': has('h5'),
    'Heading 6': has('h6'),
    'Add or edit link': has('a'),
  };

  return {
    present: Object.keys(control).filter((name) => control[name]),
    absent: Object.keys(control).filter((name) => !control[name]),
    tags,
  };
}

/**
 * The base-scope description editor inside a row-edit modal.
 *
 * Located by the surface's accessible name, never positionally: the modal mounts
 * a base-scope editor plus one per variant ("Description for {label}"), and the
 * per-variant ones appear once the form goes dirty - so `.first()` on the class
 * silently retargets mid-test. The regex spans both modes because source mode
 * renames the control to "Description (HTML source)".
 */
function descriptionEditor(dialog: Locator, page: Page): Locator {
  return dialog
    .locator('.rich-text')
    .filter({ has: page.getByRole('textbox', { name: /^Description( \(HTML source\))?$/ }) })
    .first();
}

/** The editor surface for a labelled description field. */
function surface(page: Page, name: RegExp): Locator {
  return page.getByRole('textbox', { name }).first();
}

/** The editor root that owns the toolbar and the byte counter. */
function editorRoot(page: Page, name: RegExp): Locator {
  return page.locator('.rich-text', { has: page.getByRole('textbox', { name }) }).first();
}

/**
 * The source-mode toggle is located by class, not by name: its label flips
 * between "HTML" and "Rich text" with the mode, so a name-based locator only
 * works in one direction and reads as a mystery timeout in the other.
 */
function sourceToggle(root: Locator): Locator {
  return root.locator('.rich-text__source-toggle');
}

/**
 * Enter / leave source mode IDEMPOTENTLY, driven by the toggle's own
 * `aria-pressed`. Blind clicking is what made this flaky: a helper that assumes
 * the mode it starts in silently inverts the state for the next helper, and the
 * failure then surfaces as a missing textarea several lines later.
 */
async function setSourceMode(root: Locator, on: boolean): Promise<void> {
  const toggle = sourceToggle(root);
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-pressed')) === String(on)) return;
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', String(on));
}

/**
 * The document once it contains `settled`, then returned for exact assertions.
 *
 * Polling for "not empty" was useless: select-all does not clear the surface, so
 * the pre-paste document satisfied it immediately and the assertions after it
 * were as racy as a bare read. Polling for something the PASTE introduces is the
 * only wait that means anything here.
 */
async function pollDocumentHtml(root: Locator, settled: string): Promise<string> {
  await expect.poll(() => documentHtml(root), { timeout: 10_000 }).toContain(settled);
  return documentHtml(root);
}

/**
 * Paste markup as a real clipboard event, which is the path this test exists to
 * cover: an operator copying a description out of their shop's editor. It also
 * avoids the source view entirely - inside the row-edit modal the editors remount
 * as the form goes dirty, and a two-step mode switch there is not reliable.
 */
async function pasteMarkup(surface: Locator, markup: string): Promise<void> {
  await surface.click();
  await surface.press('ControlOrMeta+a');
  await surface.evaluate((el, html) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', html.replace(/<[^>]+>/g, ''));
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    );
  }, markup);
}

/**
 * The rendered document, with ProseMirror's own bookkeeping removed: it decorates
 * the surface with `class="ProseMirror-*"` nodes that belong to the view, not to
 * the document, and asserting "no attributes survive" against them would fail on
 * the library rather than on the destination's contract.
 */
async function documentHtml(root: Locator): Promise<string> {
  const raw = await root.locator('.rich-text__surface [role="textbox"]').innerHTML();
  return raw
    .replace(/<br class="ProseMirror-trailingBreak"\s*\/?>/g, '')
    .replace(/\s*class="ProseMirror[^"]*"/g, '')
    .replace(/\s*data-placeholder="[^"]*"/g, '')
    .replace(/\s*contenteditable="[^"]*"/g, '')
    .trim();
}

/** What the editor would submit: its own serialization, read back from source view. */
async function serializedHtml(root: Locator): Promise<string> {
  await setSourceMode(root, true);
  const html = await root.getByRole('textbox', { name: /HTML source/ }).inputValue();
  await setSourceMode(root, false);
  return html;
}

test.describe('rich-text descriptions (#2201, ADR-046)', () => {
  test('the master editor saves the typed buffer as a draft', async ({ page, api, world }) => {
    const master =
      world.connectionWithCapability('ProductMaster') ??
      world.connectionFor(PlatformType.prestashop);
    test.skip(!master, 'no master-catalog connection on this stack');

    // Not scoped by connection: `GET /products` takes no `connectionId`
    // (`list-products-query.dto.ts` accepts search / limit / offset only), and
    // passing one the read ignores would imply a scoping this case does not have.
    // The master connection is a precondition - a stack with no ProductMaster has
    // no master description to edit - not a filter.
    const products = await api.products.list({ limit: 1 });
    const product = products.items[0];
    test.skip(product === undefined, 'no products on this stack');

    const before = await api.content.forProduct(product.id);
    await page.goto(`/products/${product.id}?view=content&tab=master`);

    const editor = surface(page, /description/i);
    await expect(editor).toBeVisible();

    // A read-only session (viewer role, or demo mode) renders the panel with an
    // explanatory info Alert and every action disabled, so no draft can be saved
    // at all. That is a stack/session condition, not a defect: skip with the
    // reason named rather than fail on a permanently disabled button.
    // `role="status"`, not `alert`: `Alert` maps only `tone === 'error'` to `alert`
    // and the write-lock reason is rendered `tone="info"` (`alert.tsx`). Getting
    // this wrong makes the skip dead code and the case fails on a disabled button
    // instead.
    const readOnlyNotice = page.getByText(/read-only access to content/i);
    test.skip(
      (await readOnlyNotice.count()) > 0,
      'this session has read-only access to content, so no draft can be saved'
    );

    const save = page.getByRole('button', { name: 'Save draft' });

    // Save is gated on a real change - the mount-time normalization of the
    // seeded value must not count as one (#2200).
    await expect(save).toBeDisabled();

    // The assertion the unit suites cannot make: a real keystroke.
    const marker = `E2E ${Date.now()}`;
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(` ${marker}`);
    await expect(editor).toContainText(marker);
    await expect(save).toBeEnabled();

    // Publish is asserted in BOTH polarities, because it is also disabled when
    // there is no draft at all and for a session without `content:write` - so a
    // one-sided assertion cannot tell "gated on the unsaved buffer" from
    // "always disabled". Relocated from `content-panel.test.tsx`.
    const publish = page.getByRole('button', { name: 'Publish' });
    await expect(publish).toBeDisabled();

    let saved = false;
    try {
      await save.click();
      saved = true;
      await expect(publish).toBeEnabled({ timeout: 20_000 });

      // The persisted fact, read back from the API: the typed buffer became the
      // MASTER draft (`connectionId: null`), not a channel one. This is the case
      // relocated from `content-editor.test.tsx`, where it survives as a skip.
      const after = await api.content.forProduct(product.id);
      expect(after.master.draftValue ?? '').toContain(marker);
      expect(
        after.channels.every((c) => !(c.draftValue ?? '').includes(marker)),
        'the master edit must not land on a channel'
      ).toBe(true);
      // The base value is untouched by a draft save.
      expect(after.master.baseValue).toEqual(before.master.baseValue);
    } finally {
      // Leave the stack as found. A leftover draft grows by one marker per run
      // and, once an ingestion moves the base value under it, raises a conflict
      // that would fail the NEXT run's publish-enabled assertion for a reason
      // unrelated to the code.
      //
      // Gated on `saved`, so a failure BEFORE the save cannot delete a
      // pre-existing draft this case never created; and wrapped, because a throw
      // inside `finally` replaces the real error - the cleanup would then be the
      // reported failure instead of the assertion that actually broke.
      if (saved) {
        try {
          const discard = page.getByRole('button', { name: 'Discard draft' });
          await discard.click();
          await expect
            .poll(async () => (await api.content.forProduct(product.id)).master.draftValue, {
              timeout: 20_000,
            })
            .toBeNull();
        } catch (cleanupError) {
          test.info().annotations.push({
            type: 'warning',
            description: `left a master draft behind on ${product.id}: ${String(cleanupError).slice(0, 200)}`,
          });
        }
      }
    }
  });

  test('bold applied to a selection reaches the document, not just the toolbar', async ({
    page,
    api,
    world,
  }) => {
    const master =
      world.connectionFor(PlatformType.prestashop) ?? world.connectionFor(PlatformType.woocommerce);
    test.skip(!master, 'no master-catalog connection on this stack');

    const products = await api.products.list({ limit: 1 });
    test.skip(products.items[0] === undefined, 'no products on this stack');

    await page.goto(`/products/${products.items[0].id}?view=content&tab=master`);
    const root = editorRoot(page, /description/i);
    const editor = surface(page, /description/i);
    await expect(editor).toBeVisible();

    // Replace the whole document, then select it again: an explicit selection
    // makes the assertion about the MARK rather than about stored-mark state at
    // a caret, which is what made a caret-only version of this flaky.
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('bold me');
    await page.keyboard.press('ControlOrMeta+a');
    await root.getByRole('button', { name: 'Bold' }).click();

    // The document is what gets published, so that is what is asserted. The tag
    // is whichever one the format declares - `b` for a destination that rejects
    // `<strong>`, `strong` for the permissive master.
    const html = await serializedHtml(root);
    expect(html).toMatch(/<(b|strong)>bold me<\/\1>/);
    // Never both spellings for one mark.
    expect(html.includes('<b>') && html.includes('<strong>')).toBe(false);
  });

  test('the publish editor offers only what the destination declared, and filters a paste', async ({
    page,
    pages,
    world,
    api,
  }) => {
    const marketplace = world.connectionWithCapability('OfferManager', PlatformType.allegro);
    test.skip(!marketplace, 'no Allegro connection with OfferManager on this stack');

    // Reached through the publish wizard's row editor rather than the Content
    // tab's channel tab, deliberately: the channel tab needs an existing offer
    // MAPPING, which cannot be created without publishing a real sandbox offer.
    // The claim is the same - the editor's surface comes from the destination's
    // declared contract - and this route asserts it with no outward effect: open,
    // assert, cancel.
    //
    // Read the contract FIRST and derive every expectation from it. Hard-coding
    // Allegro's seven tags would make this case pass against a stack where the
    // whole declaration pipeline is dead: the conservative fallback IS the
    // Allegro-shaped subset, so the toolbar looks identical either way. The one
    // observable difference is the "not declared" note, so that is what
    // distinguishes them here.
    const contract = await api.listings.descriptionFormat(marketplace?.id ?? '');
    // This branch is what SHIPS that endpoint, so when the stack serves it the
    // declaration must be the adapter's own - not the fallback wearing its shape.
    // Asserted in this case specifically because it is the one that never skips
    // for want of a taxonomy or a contract, unlike the publish and Erli cases.
    if (contract !== null) {
      expect(contract.declared, 'an Allegro OfferManager connection declares its format').toBe(
        true
      );
      expect(contract.resolvedVia).toBe('OfferManager');
    }
    const expected = expectedControls(contract);

    const products = await api.products.list({ limit: 5 });
    const product = products.items[0];
    test.skip(product === undefined, 'no products on this stack');

    await pages.productsList.goto();
    await pages.productsList.selectProduct(product?.name ?? '');
    const wizard = await pages.productsList.startBulkOfferCreation(marketplace?.name);
    await wizard.selectConnectionIfPresent(marketplace?.name ?? '');
    await wizard.completePlatformConfig();
    await expect(wizard.proceedButton).toBeEnabled({ timeout: 60_000 });
    await wizard.proceedButton.click();

    const row = page.locator('.bulk-review__prow-main').first();
    // 60 s to match the page object's own budget for the same Config -> Resolve ->
    // Review transition (`bulk-offer-wizard.page.ts`), which waits on the async
    // per-category parameter schema.
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.getByRole('button', { name: 'Edit', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: /^Edit (offer|product)\b/ });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    const editor = descriptionEditor(dialog, page);
    await expect(editor).toBeVisible({ timeout: 20_000 });

    // Every control the contract allows is present; every one it does not is
    // absent. Both directions matter: presence alone would pass on a permissive
    // fallback, absence alone would pass on an editor with no toolbar at all.
    for (const name of expected.present) {
      await expect(editor.getByRole('button', { name }), `${name} is declared`).toBeVisible();
    }
    for (const name of expected.absent) {
      await expect(
        editor.getByRole('button', { name }),
        `${name} is not declared, so it must not be offerable`
      ).toHaveCount(0);
    }

    // The state that tells the two apart. ADR-046 decision 1: an undeclared
    // destination gets the conservative subset AND must say so rather than
    // presenting it as authoritative. This is the assertion that fails if the
    // declaration pipeline - controller, read service, adapter constant - is
    // dead, because then the note appears where it should not.
    const note = editor.locator('.rich-text__undeclared');
    if (contract === null || contract.declared === false) {
      await expect(note, 'an undeclared destination must say so').toBeVisible();
    } else {
      await expect(note, 'a declared destination must not claim otherwise').toHaveCount(0);
      // The cap is the destination's own, not a default. An UNBOUNDED format
      // renders no counter at all (`rich-text-editor.tsx`), so matching text
      // against it would hang - assert its absence instead. And the digits are
      // compared without a grouping separator, because the page formats with a
      // bare `toLocaleString()` in the browser's locale.
      const bytes = editor.locator('.rich-text__bytes');
      if (contract.maxBytes === null) {
        await expect(bytes, 'an unbounded format shows no byte counter').toHaveCount(0);
      } else {
        const digits = String(contract.maxBytes);
        await expect(bytes).toContainText(
          new RegExp(digits.split('').join('[\\s,.\u00a0\u202f]*'))
        );
      }
    }

    // Paste-time filtering: the registered extensions ARE the document schema,
    // so a disallowed tag is dropped as it is parsed while its text survives.
    await pasteMarkup(editor.locator('.rich-text__surface [role="textbox"]'), SHOP_MARKUP);
    // Read the rendered document rather than round-tripping the source view.
    // The registered extensions ARE the schema, so what the surface holds is what
    // serialization walks - and unlike the source toggle it needs no second mode
    // switch inside a modal that remounts its editors as the form goes dirty.
    // Polled, not read once: every other wait in this file auto-retries, and a
    // paste that lands a tick late would otherwise flake on a bare string compare.
    const html = await pollDocumentHtml(editor, 'Kurtka puchowa Alpine 300');

    // The pasted markup's tags, minus whatever the contract allows: a tag the
    // destination accepts must NOT be asserted absent (Erli accepts `br`, Allegro
    // does not), so the expectation follows the declaration rather than the
    // platform this stack happens to run.
    const allowed = new Set(expected.tags);
    for (const tag of ['div', 'span', 'table', 'tbody', 'tr', 'td', 'br', 'strong']) {
      if (allowed.has(tag)) continue;
      expect(html, `${tag} is not in the declared tag set`).not.toContain(`<${tag}`);
    }
    expect(html, 'no attributes survive').not.toMatch(/<[a-z0-9]+\s+[a-z-]+=/i);
    // Text inside dropped elements survives - filtering, not deletion.
    expect(html).toContain('Kurtka puchowa Alpine 300');
    expect(html).toContain('620 g');
    expect(html).toMatch(/^<(p|h1|h2|ul|ol)\b/);

    await dialog.getByRole('button', { name: 'Cancel', exact: true }).first().click();
  });

  test('authored markup renders as markup in the review step, and the product page never prints tags', async ({
    page,
    pages,
    world,
    api,
  }) => {
    // A SHOP destination specifically. The marketplace Review step deliberately
    // carries no description (an offer's copy is authored in the row editor and
    // reviewed there), so the shop publish step is the only Review surface that
    // renders one - which makes it the only place this claim can be made through
    // a review row.
    const destination = world.connectionWithCapability('ProductPublisher');
    test.skip(!destination, 'no shop publish destination on this stack');

    // The row editor this case must open resolves a category first, and it cannot
    // when the destination's category projection is empty (`destination.taxonomy
    // .sync` has not populated it). Named explicitly so an empty tree reads as
    // "this stack has no taxonomy" rather than as a broken category browser.
    const taxonomy = await api.listings.taxonomyCategories(destination?.id ?? '');
    test.skip(
      taxonomy === null || taxonomy.length === 0,
      "the destination's category projection is empty on this stack - no review row can resolve a category"
    );

    // A SINGLE-variant product specifically: the shop step's disclosure lives on
    // the product row only when the product has exactly one variant (a
    // multi-variant product carries it per variant row, and those render only
    // while the row is expanded). Picking blind would report a data condition as
    // "expected 1, received 0".
    //
    // Read from `variantCount`, NOT from `variants`: the list projection omits
    // variants on purpose (pinned by `products.controller.spec.ts`), so a filter
    // on `variants.length` is always false and the case would skip forever while
    // blaming the stack.
    const products = await api.products.list({ limit: 25 });
    const product = products.items.find((candidate) => candidate.variantCount === 1);
    test.skip(product === undefined, 'no single-variant product on this stack');

    await pages.productsList.goto();
    await pages.productsList.selectProduct(product?.name ?? '');
    const wizard = await pages.productsList.startBulkOfferCreation(destination?.name);
    await wizard.selectConnectionIfPresent(destination?.name ?? '');
    await wizard.completePlatformConfig();
    await expect(wizard.proceedButton).toBeEnabled({ timeout: 60_000 });
    await wizard.proceedButton.click();

    // Author the copy this case then asserts on, rather than hunting the stack for
    // a product that happens to hold HTML. A stack seeded with plain text made the
    // earlier version of this assertion vacuous - "no tags are printed" passes on
    // plain text even if the sanitizing view is replaced by a raw interpolation.
    //
    // What this adds over `rich-text-view.test.tsx`, which covers the same
    // primitive under an explicit jsdom pragma, is the REAL engine plus the real
    // composition: the value travels operator -> editor -> wizard state -> the
    // view, in the browser the operator uses. So when this skips for want of a
    // category projection the primitive is still covered; what is missing is the
    // end-to-end confirmation, and the skip says which.
    const marker = `Alpine ${Date.now()}`;
    // The OUTER row: `fillRowEditor` scopes its own Edit-button lookup to the
    // row's `.bulk-review__prow-main` child, so handing it that child already
    // would nest the selector and never match.
    const row = page.locator('.bulk-review__prow').first();
    const productRow = row.locator('.bulk-review__prow-main');
    await expect(productRow).toBeVisible({ timeout: 60_000 });

    // Through the row-editor page object rather than a hand-rolled open/paste/save:
    // a review row routinely carries a category blocker, and the editor's Save is
    // gated on the required parameters that category brings with it. Driving it by
    // hand fails on the blocker, not on anything this case is about.
    const rowEditor = new BulkOfferRowEditor(page);
    const primary = product?.variants?.[0];
    await rowEditor.fillRowEditor(row, primary?.ean ?? primary?.gtin ?? undefined, 'always', {
      descriptionMarkup: `<h1>${marker}</h1><p>Do <b>-20 °C</b>.</p><ul><li>Puch 90/10</li></ul>`,
    });

    // Scoped to the PRODUCT row, not `.first()` on the class: the variant-row
    // disclosure carries the same class, so an unscoped locator would assert the
    // pre-existing behaviour instead of the single-variant row the fix added.
    const disclosure = productRow.locator('.bulk-review__desc');
    await expect(disclosure).toHaveCount(1);
    await disclosure.locator('summary').click();

    const view = disclosure.locator('.rich-text-view').first();
    await expect(view).toBeVisible();
    // Rendered as ELEMENTS - the claim. The old surface interpolated the value
    // into a paragraph, so React escaped it and the operator read angle brackets.
    await expect(view.locator('h1')).toContainText(marker);
    await expect(view.locator('b')).toContainText('-20');
    await expect(view.locator('ul li')).toContainText('Puch 90/10');
    await expect(view).not.toContainText('<h1>');
    await expect(view).not.toContainText('&lt;h1&gt;');
    await expect(view.locator('script')).toHaveCount(0);

    // The product page reads the MASTER value, which this case deliberately does
    // not write (that would mean publishing to the source platform), so the
    // assertion there is the weaker one it can honestly make.
    await page.goto(`/products/${product?.id ?? ''}`);
    const detail = page.locator('.rich-text-view, .rich-text-view__empty').first();
    await expect(detail).toBeVisible({ timeout: 20_000 });
    await expect(detail).not.toContainText('&lt;p&gt;');
    await expect(detail.locator('script')).toHaveCount(0);
  });

  test('an authored description survives the marketplace validator', async ({
    pages,
    world,
    api,
    poll,
  }) => {
    const marketplace = world.connectionWithCapability('OfferManager', PlatformType.allegro);
    test.skip(!marketplace, 'no Allegro connection with OfferManager on this stack');

    // Capability probe, not a data check: a stack whose API predates ADR-046
    // builds the publish payload with the previous builder, so a create there
    // says nothing about the declared format either way.
    const contract = await api.listings.descriptionFormat(marketplace?.id ?? '');
    test.skip(
      contract === null,
      'stack API predates /description-format - a publish here would exercise the old builder'
    );
    // The declaration itself is worth asserting once: the rest of the epic is
    // downstream of it being right.
    expect(contract?.declared, 'Allegro declares its own format').toBe(true);
    expect(contract?.allowedTags.slice().sort()).toEqual(
      ['b', 'h1', 'h2', 'li', 'ol', 'p', 'ul'].sort()
    );
    expect(contract?.allowedAttributes).toEqual({});
    expect(contract?.requiresBlockOpener).toBe(true);

    const taxonomy = await api.listings.taxonomyCategories(marketplace?.id ?? '');
    test.skip(
      taxonomy === null || taxonomy.length === 0,
      "the destination's category projection is empty on this stack - the wizard cannot resolve a category to list under"
    );

    const connectionId = marketplace?.id ?? '';

    // Variants come from the DETAIL read: the list projection omits them
    // deliberately, so filtering `items[].variants` is always false and this case
    // would skip forever while blaming the stack for a client bug.
    //
    // Then a variant that is NOT already listed on this destination. Re-running
    // against the same stack otherwise hits the #1837 duplicate guard: the variant
    // is filtered out of the batch and an all-filtered submit is a 400, so the
    // case would fail on its second run for a reason unrelated to descriptions.
    const page1 = await api.products.list({ limit: 8 });
    const detailed = await Promise.all(page1.items.map((p) => api.products.getById(p.id)));
    const candidates = detailed.filter(
      (p) => (p.variants?.[0]?.ean ?? p.variants?.[0]?.gtin) != null
    );
    test.skip(candidates.length === 0, 'no product with a barcode to list on this stack');

    // Every sibling is checked, not just the first: the wizard expands a
    // multi-variant product into one offer per variant (#824), so a product whose
    // first variant is free but whose siblings are listed still meets the filter
    // on those rows.
    const variantIds = candidates.flatMap((p) => (p.variants ?? []).map((v) => v.id));
    test.skip(variantIds.length === 0, 'no resolvable variants on this stack');
    const listed = new Set(await api.listings.publishedVariants(connectionId, variantIds));
    const product = candidates.find((p) => (p.variants ?? []).every((v) => !listed.has(v.id)));
    test.skip(
      product === undefined,
      'every barcoded product is already listed on this destination - nothing left to publish'
    );

    const before = (await api.listings.list({ connectionId, limit: 1 })).total;

    await pages.productsList.goto();
    await pages.productsList.selectProduct(product?.sku ?? product?.name ?? '');
    const wizard = await pages.productsList.startBulkOfferCreation(marketplace?.name);
    await wizard.selectConnectionIfPresent(marketplace?.name ?? '');

    // Author the description in the editor on the way through, so what reaches
    // the marketplace is what the operator wrote in THIS run - not a value the
    // stack happened to already hold. Every tag used is one Allegro allows.
    const primary = product?.variants?.[0];
    await wizard.advanceToConfirmModal({
      requiresDeliveryPolicy: true,
      gtin: primary?.ean ?? primary?.gtin ?? undefined,
      descriptionMarkup: authoredDescription(`E2E-${Date.now()}`),
    });
    const progress = await wizard.confirmCreation();
    expect(progress.batchId).toBeTruthy();

    // A batch whose every job is rejected still exists, so waiting only on the
    // mapping would report "nothing appeared" for what is really a validator
    // rejection. Read the batch's own reasons and name them.
    try {
      await poll.until(
        () => api.listings.list({ connectionId, limit: 1 }),
        (listed) => listed.total > before,
        { message: 'an offer mapping to appear for the authored description', timeoutMs: 180_000 }
      );
    } catch (error) {
      const batch = await api.listings.bulkBatch(progress.batchId).catch(() => null);
      const reasons = (batch?.records ?? [])
        .filter((r) => r.status === 'failed')
        .flatMap((r) =>
          (r.errors ?? []).map((e) =>
            `${e.code ?? 'ERROR'} ${e.field ?? ''}: ${e.message ?? ''}`.trim()
          )
        );
      // A description-shaped rejection is the failure this epic exists to
      // prevent, so it gets its own message rather than being buried in a list.
      const descriptionFault = reasons.filter((r) => /description|tag|html/i.test(r));
      if (descriptionFault.length > 0) {
        throw new Error(
          `the marketplace rejected the DESCRIPTION we sent - the format was not applied:\n- ${[
            ...new Set(descriptionFault),
          ].join('\n- ')}`
        );
      }
      if (reasons.length > 0) {
        throw new Error(
          `batch ${progress.batchId} rejected ${batch?.failedCount ?? '?'}/${batch?.totalCount ?? '?'} offers for reasons unrelated to the description:\n- ${[
            ...new Set(reasons),
          ].join('\n- ')}`
        );
      }
      throw error;
    }

    // Read-back caveat, stated rather than silently skipped: OL's own offer
    // response DTO does not expose the marketplace's description field, so the
    // strongest available assertion is "the validator that used to 422 on our
    // markup accepted this offer". The document's tag set is asserted directly in
    // the paste case above.
    test.info().annotations.push({
      type: 'note',
      description:
        'offer created; description read-back is not exposed by GET /listings/:id/offer, so the tag-set assertion lives in the paste case',
    });
  });

  test('a borrowing destination offers what IT declared, not what Allegro did', async ({
    page,
    pages,
    world,
    api,
  }) => {
    const erli = world.connectionWithCapability('OfferManager', PlatformType.erli);
    test.skip(!erli, 'no Erli connection with OfferManager on this stack');

    // Erli is the interesting second destination precisely because it never
    // errors: it silently converts a payload it dislikes, so a rejection can
    // never tell us the shape was wrong. Its declaration differs from Allegro's
    // in exactly two tags - `h3` and `br` - and the editor must reflect that
    // rather than inheriting the marketplace default.
    const contract = await api.listings.descriptionFormat(erli?.id ?? '');
    test.skip(
      contract === null,
      'stack API predates /description-format - the declaration cannot be read'
    );
    expect(contract?.declared, 'Erli declares its own format').toBe(true);
    expect(contract?.allowedTags).toContain('h3');
    expect(contract?.allowedTags).toContain('br');
    // The published requirement that no rejection would ever reveal: Erli wants
    // its void elements written self-closing. Asserted at the contract, because
    // the spelling is a serialization detail the browser's DOM cannot show - the
    // applier's own spec covers the emitted bytes.
    expect(contract?.selfClosingVoids, 'Erli requires <br/>').toBe(true);

    const taxonomy = await api.listings.taxonomyCategories(erli?.id ?? '');
    test.skip(
      taxonomy === null || taxonomy.length === 0,
      "the destination's category projection is empty on this stack - no review row can resolve a category"
    );

    const products = await api.products.list({ limit: 5 });
    const product = products.items[0];
    test.skip(product === undefined, 'no products on this stack');

    await pages.productsList.goto();
    await pages.productsList.selectProduct(product?.name ?? '');
    const wizard = await pages.productsList.startBulkOfferCreation(erli?.name);
    await wizard.selectConnectionIfPresent(erli?.name ?? '');
    await wizard.completePlatformConfig({ requiresErliBuyabilityFields: true });
    await expect(wizard.proceedButton).toBeEnabled({ timeout: 60_000 });
    await wizard.proceedButton.click();

    const row = page.locator('.bulk-review__prow').first();
    await expect(row.locator('.bulk-review__prow-main')).toBeVisible({ timeout: 60_000 });
    await row
      .locator('.bulk-review__prow-main')
      .getByRole('button', { name: 'Edit', exact: true })
      .click();

    const dialog = page.getByRole('dialog', { name: /^Edit (offer|product)\b/ });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    const editor = descriptionEditor(dialog, page);
    await expect(editor).toBeVisible({ timeout: 20_000 });

    const expected = expectedControls(contract);
    for (const name of expected.present) {
      await expect(editor.getByRole('button', { name }), `${name} is declared`).toBeVisible();
    }
    for (const name of expected.absent) {
      await expect(
        editor.getByRole('button', { name }),
        `${name} is not declared, so it must not be offerable`
      ).toHaveCount(0);
    }
    // The two-tag difference, asserted as a difference: H3 exists here and does
    // not on Allegro.
    await expect(editor.getByRole('button', { name: 'Heading 3' })).toBeVisible();

    // A line break survives the paste here, where Allegro's declaration turns it
    // into a paragraph break. Same pasted markup, two documents - which is the
    // whole point of declaring the format per destination.
    await pasteMarkup(
      editor.locator('.rich-text__surface [role="textbox"]'),
      '<h3>Sekcja</h3><p>Pierwsza linia<br>Druga linia</p>'
    );
    const html = await pollDocumentHtml(editor, 'Druga linia');
    expect(html).toContain('<h3>');
    expect(html).toContain('<br');
    expect(html).toContain('Druga linia');

    await dialog.getByRole('button', { name: 'Cancel', exact: true }).first().click();
  });
});
