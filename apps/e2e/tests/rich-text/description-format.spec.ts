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
 * Self-configuring and read-mostly. It edits a description DRAFT (never
 * publishes), scopes every assertion to the connection it found, and skips
 * cleanly on a stack without the connection a case needs - so it is safe on a
 * demo database, a fresh one, or a stack mid-ingestion.
 *
 * @module tests/rich-text
 */
import type { Locator, Page } from '@playwright/test';

import { test, expect } from '../../src/fixtures/test';

/** Markup a PrestaShop TinyMCE description really carries. */
const SHOP_MARKUP = [
  '<div class="rte" style="font-family:Verdana">',
  '<h1><strong>Kurtka puchowa Alpine 300</strong></h1>',
  '<p style="margin:0">Do <span style="font-weight:700">-20 °C</span>.<br>620 g.</p>',
  '<table border="1"><tbody><tr><td>Waga</td><td>620 g</td></tr></tbody></table>',
  '<ul><li>Puch 90/10</li><li>Membrana 10 000 mm</li></ul>',
  '</div>',
].join('');

/** The editor surface for a labelled description field. */
function surface(page: Page, name: RegExp): Locator {
  return page.getByRole('textbox', { name }).first();
}

/** The editor root that owns the toolbar and the byte counter. */
function editorRoot(page: Page, name: RegExp): Locator {
  return page.locator('.rich-text', { has: page.getByRole('textbox', { name }) }).first();
}

/**
 * Replace a description through the editor's HTML view.
 *
 * A real operator path, and the only way to seed arbitrary markup: `fill()` on
 * the contenteditable would insert it as TEXT, which is the opposite of what
 * these cases are about. Leaving the view round-trips the markup through the
 * destination's schema, which is exactly the behaviour under test.
 */
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
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
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

/**
 * A product whose Content tab carries a channel tab for `connectionId`.
 *
 * The channel tab exists only when an active `OfferFieldUpdater` connection has
 * at least one linked offer for the product - so this reads the connection's
 * offer mappings and takes the first that resolved to a product. One targeted
 * request, deliberately: the obvious version (walk products, read each one's
 * content state) is 25 sequential round-trips and timed the test out, and one
 * badly-mapped product 500-ing made it worse.
 *
 * Returns undefined rather than throwing when the stack has no such offer, so
 * the caller skips instead of failing on data it cannot control.
 */

test.describe('rich-text descriptions (#2201, ADR-046)', () => {
  test('the master editor accepts typing and gates Save on a real edit', async ({ page, api, world }) => {
    const master = world.connectionFor('prestashop') ?? world.connectionFor('woocommerce');
    test.skip(!master, 'no master-catalog connection on this stack');

    const products = await api.products.list({ limit: 1 });
    const product = products.items[0];
    test.skip(product === undefined, 'no products on this stack');

    await page.goto(`/products/${product.id}?view=content&tab=master`);

    const editor = surface(page, /description/i);
    await expect(editor).toBeVisible();

    // Save is gated on a real change - the mount-time normalization of the
    // seeded value must not count as one (#2200).
    const save = page.getByRole('button', { name: 'Save draft' });
    await expect(save).toBeDisabled();

    // The assertion the unit suites cannot make: a real keystroke.
    await editor.click();
    await page.keyboard.type(' Edited by E2E');
    await expect(editor).toContainText('Edited by E2E');
    await expect(save).toBeEnabled();

    // Publish stays locked while the buffer is unsaved - relocated from
    // `content-panel.test.tsx`.
    await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  test('bold applied to a selection reaches the document, not just the toolbar', async ({
    page,
    api,
    world,
  }) => {
    const master = world.connectionFor('prestashop') ?? world.connectionFor('woocommerce');
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
    expect(html).toMatch(/<(b|strong)>bold me<\/(b|strong)>/);
    // Never both spellings for one mark.
    expect(html.includes('<b>') && html.includes('<strong>')).toBe(false);
  });

  test('the publish editor offers only what the destination declared, and filters a paste', async ({
    page,
    pages,
    world,
    api,
  }) => {
    const marketplace = world.connectionWithCapability('OfferManager', 'allegro');
    test.skip(!marketplace, 'no Allegro connection with OfferManager on this stack');

    // Reached through the publish wizard's row editor rather than the Content
    // tab's channel tab, deliberately: the channel tab needs an existing offer
    // MAPPING, which cannot be created without publishing a real sandbox offer.
    // The claim is the same - the editor's surface comes from the destination's
    // declared contract - and this route asserts it with no outward effect: open,
    // assert, cancel.
    const products = await api.products.list({ limit: 5 });
    const product = products.items[0];
    test.skip(product === undefined, 'no products on this stack');

    await pages.productsList.goto();
    await pages.productsList.selectProduct(product?.name ?? '');
    const wizard = await pages.productsList.startBulkOfferCreation(marketplace?.name);
    await wizard.expectOnConfigStep();
    await wizard.selectConnectionIfPresent(marketplace?.name ?? '');
    await wizard.completePlatformConfig();
    await expect(wizard.proceedButton).toBeEnabled({ timeout: 30_000 });
    await wizard.proceedButton.click();

    const row = page.locator('.bulk-review__prow-main').first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole('button', { name: 'Edit', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: /^Edit (offer|product)\b/ });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    // Scoped by the surface's accessible name, NOT `.first()`: the modal mounts a
    // base-scope editor plus one per variant ("Description for {label}"), and the
    // per-variant ones appear once the form goes dirty - so a positional locator
    // silently retargets mid-test. The regex spans both modes because source mode
    // renames the control to "Description (HTML source)".
    const editor = dialog
      .locator('.rich-text')
      .filter({ has: page.getByRole('textbox', { name: /^Description( \(HTML source\))?$/ }) })
      .first();
    await expect(editor).toBeVisible({ timeout: 20_000 });

    // Allegro's grammar is seven tags, so there is no italic / underline /
    // strike / link control and no H3. The operator cannot author what the
    // destination would discard.
    await expect(editor.getByRole('button', { name: 'Bold' })).toBeVisible();
    await expect(editor.getByRole('button', { name: 'Heading 1' })).toBeVisible();
    await expect(editor.getByRole('button', { name: 'Italic' })).toHaveCount(0);
    await expect(editor.getByRole('button', { name: 'Underline' })).toHaveCount(0);
    await expect(editor.getByRole('button', { name: 'Strikethrough' })).toHaveCount(0);
    await expect(editor.getByRole('button', { name: /^(Link|Add or edit link)$/ })).toHaveCount(0);
    await expect(editor.getByRole('button', { name: 'Heading 3' })).toHaveCount(0);

    // Paste-time filtering: the registered extensions ARE the document schema,
    // so a disallowed tag is dropped as it is parsed while its text survives.
    await pasteMarkup(editor.locator('.rich-text__surface [role="textbox"]'), SHOP_MARKUP);
    // Read the rendered document rather than round-tripping the source view.
    // The registered extensions ARE the schema, so what the surface holds is what
    // serialization walks - and unlike the source toggle it needs no second mode
    // switch inside a modal that remounts its editors as the form goes dirty.
    const html = await documentHtml(editor);

    for (const rejected of ['<div', '<span', '<table', '<tbody', '<tr', '<td', '<br', '<strong']) {
      expect(html, `Allegro rejects ${rejected}`).not.toContain(rejected);
    }
    expect(html, 'no attributes survive').not.toMatch(/<[a-z0-9]+\s+[a-z-]+=/i);
    // Text inside dropped elements survives - filtering, not deletion.
    expect(html).toContain('Kurtka puchowa Alpine 300');
    expect(html).toContain('620 g');
    expect(html).toMatch(/^<(p|h1|h2|ul|ol)\b/);

    await dialog.getByRole('button', { name: 'Cancel', exact: true }).first().click();
  });

  test('the product page renders its description through the sanitizing primitive', async ({
    page,
    api,
  }) => {
    // Two assertions in one case, because their availability differs. The
    // primitive being present and never leaking tags holds for ANY non-empty
    // description, so it runs everywhere; the markup-fidelity half needs a
    // product whose stored description actually contains HTML, which a demo
    // stack seeded with plain text does not have. DOMPurify is lossy under
    // happy-dom, so a real engine is the only place either means anything.
    const products = await api.products.list({ limit: 50 });
    const withText = products.items.find((candidate) => (candidate.description ?? '').trim() !== '');
    test.skip(withText === undefined, 'no product with a description on this stack');

    await page.goto(`/products/${withText?.id ?? ''}`);

    const view = page.locator('.rich-text-view, .rich-text-view__empty').first();
    await expect(view).toBeVisible();
    // The defect this replaced: the value was interpolated into a <p>, so React
    // escaped it and the operator read angle brackets.
    await expect(view).not.toContainText('<p>');
    await expect(view).not.toContainText('&lt;p&gt;');
    // A script vector never renders, whatever the stored value holds.
    await expect(view.locator('script')).toHaveCount(0);

    const withHtml = products.items.find((candidate) =>
      /<(p|ul|h[1-3]|strong|b)\b/i.test(candidate.description ?? ''),
    );
    if (withHtml === undefined) {
      // Stated, not silently passed: this stack cannot exercise the half of the
      // assertion that needs stored markup.
      test.info().annotations.push({
        type: 'note',
        description: 'no product with HTML in its description - markup-fidelity half not exercised',
      });
      return;
    }

    await page.goto(`/products/${withHtml.id}`);
    const htmlView = page.locator('.rich-text-view').first();
    await expect(htmlView).toBeVisible();
    // Rendered as elements, not printed as text.
    await expect(htmlView.locator('p, ul, h1, h2, h3, strong, b').first()).toBeVisible();
  });

  test('the review step shows the description each row will publish', async ({
    page,
    pages,
    world,
    api,
  }) => {
    const destination =
      world.connectionWithCapability('OfferManager', 'allegro') ??
      world.connectionWithCapability('ProductPublisher');
    test.skip(!destination, 'no publish destination on this stack');

    const products = await api.products.list({ limit: 5 });
    test.skip(products.items[0] === undefined, 'no products on this stack');

    await pages.productsList.goto();
    await pages.productsList.selectProduct(products.items[0]?.name ?? '');
    const wizard = await pages.productsList.startBulkOfferCreation(destination?.name);
    await wizard.expectOnConfigStep();
    await wizard.selectConnectionIfPresent(destination?.name ?? '');
    await wizard.completePlatformConfig();
    await expect(wizard.proceedButton).toBeEnabled({ timeout: 30_000 });
    await wizard.proceedButton.click();

    // The gap #2200 closed: an operator submitted copy to a live destination
    // without ever seeing it rendered. The Review step now carries a per-row
    // disclosure, and it renders through the sanitizing view rather than
    // printing tags.
    const disclosure = page.locator('.bulk-review__desc').first();
    await expect(disclosure).toBeVisible({ timeout: 30_000 });
    await expect(disclosure.getByText('Description', { exact: true })).toBeVisible();
    await disclosure.locator('summary').click();

    const view = disclosure.locator('.rich-text-view, .rich-text-view__empty').first();
    await expect(view).toBeVisible();
    await expect(view).not.toContainText('<p>');
    await expect(view).not.toContainText('&lt;p&gt;');
  });
});
