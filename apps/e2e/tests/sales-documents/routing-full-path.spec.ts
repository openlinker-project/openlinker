/**
 * Sales documents: the full routing path across all three epics (#3196)
 *
 * One order population walked end to end: a buyer tax number in each of its
 * three states (#2599/#3180), a rule written in the composer and read back by
 * the engine (#2170/#3189/#3190), a receipt AND an invoice held by ONE
 * dual-role connection (ADR-073 decision 3, #3192), both cross-kind second
 * attempts refused (#2157/#3184), and an invoice left awaiting submission
 * (#1585/#3192).
 *
 * ── SELECTORS ─────────────────────────────────────────────────────────────
 * Every assertion below selects by a `data-testid` the mockups under
 * `docs/plans/mockups/` declare - never by copy, never by a CSS class. The
 * hooks this spec needed and the shipped components did not emit were added to
 * those components first (the preceding commit), using the mockups' literal
 * strings, so the acceptance criterion is met by the PRODUCT rather than by a
 * spec that works around it.
 *
 * Four hooks the mockups name are deliberately absent from the product and
 * therefore from this spec, because no element exists to carry them and
 * inventing one would assert a feature nobody built:
 *   - `rule-test-sample-order` - the composer's dry run. There is no endpoint
 *     behind it (`POST /sales-documents/rules/overlap-check` answers a
 *     different question), so scenario B proves "matched" through the overlap
 *     engine and the panel's `sales-document-matched-rule` instead. Stated
 *     rather than glossed: this spec does NOT fire `AutoIssueTriggerService`,
 *     which runs on an order TRANSITION produced by real ingestion.
 *   - `rule-condition-remove-{i}` - the composer has no per-row remove control.
 *   - `rule-market` - the country is carried by the parent routing dialog's
 *     heading, not repeated as a pill inside the composer.
 *   - `sales-document-buyer-tax-id` - the order-detail panel renders no tax-id
 *     row. Scenario A reads the SAME fact through `order-buyer-tax-id{,-none,
 *     -unknown}`, which are that mockup's own hooks for it and which the
 *     product does emit.
 *
 * ── WHAT IS REAL, AND WHAT IS FIXTURE ─────────────────────────────────────
 * The rule is authored through the browser and read back over HTTP. Both 409s
 * are answered by the real guards, against the real dual-role connection, with
 * no stubbing. The two terminal documents and the awaiting-submission one are
 * seeded in Postgres for the reason the two existing sales-document seeds give:
 * a `registered` receipt needs a working eparagony session and
 * `pending-submission` is a degraded-mode window no endpoint lets a caller
 * force. `salesDocumentMatchedRuleId` is stamped by the fixture because only an
 * ingestion transition writes it - but it is stamped with the id of the rule
 * THIS SPEC created in the composer, and the panel resolves it against the live
 * rules table, so a rule that did not really save renders nothing and the
 * assertion fails.
 *
 * ── ORDERING ──────────────────────────────────────────────────────────────
 * Serial and order-dependent: scenario B saves a rule scenario B2/B3 then read,
 * and scenario C's seeded documents are what scenario D's refusals stand on.
 * The `sales-documents` project already runs `retries: 0` with `workers: 1`.
 *
 * @module tests/sales-documents
 */
import { test, expect } from '../../src/fixtures/test';
import type { Page, Locator } from '@playwright/test';
import { ApiError } from '../../src/api/api-error';
import {
  seedSalesDocumentRoutingFixture,
  attributeOrderToRule,
  ROUTING_SEED_CONNECTION_ID,
  ROUTING_SEED_CONNECTION_NAME,
  ROUTING_SEED_COUNTRY,
  ROUTING_SEED_BUYER_TAX_ID,
  ROUTING_SEED_ORDER_IDS,
  AWAITING_SUBMISSION_AGE_DAYS,
} from '../../src/support/sales-document-routing-seed';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__screenshots__',
  'routing-full-path',
);

/**
 * Numbered in WALKTHROUGH order, so the files sort into the sequence an
 * operator would live through rather than into test-declaration order.
 */
async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true });
}

async function gotoOrder(page: Page, orderId: string): Promise<Locator> {
  await page.goto(`/orders/${orderId}`);
  const panel = page.getByTestId('sales-document-panel');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
}

/**
 * The market row, matched on its own name span with an EXACT regex.
 *
 * A `hasText` filter on the whole row is case-insensitive, so a two-letter
 * code like `PT` also matches unrelated copy in a sibling row - the lesson
 * `settings-market-list.spec.ts` records after `SE` matched "**Se**t up".
 */
function marketRow(page: Page, country: string): Locator {
  return page.locator('.sales-document-market-row').filter({
    has: page.locator('.sales-document-market-row__name', { hasText: new RegExp(`^${country}$`) }),
  });
}

async function openRoutingDialog(page: Page): Promise<void> {
  await page.goto('/settings/sales-documents');
  // "Document routing", not "Sales documents": #3307 renamed this page
  // precisely so it stops sharing a name with the merged /sales-documents LIST
  // page it is unrelated to. (The two older specs in this directory still
  // assert the pre-#3307 name and are stale against it.)
  await expect(page.getByRole('heading', { name: 'Document routing' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole('list', { name: 'Sales-document markets' }).or(page.getByText('No markets yet')),
  ).toBeVisible({ timeout: 30_000 });

  const row = marketRow(page, ROUTING_SEED_COUNTRY);
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: /Configure/ }).click();
  await expect(
    page.getByRole('heading', { name: `Sales-document routing · ${ROUTING_SEED_COUNTRY}` }),
  ).toBeVisible();
}

/**
 * Fill the composer with the walkthrough's rule: a buyer WITH a tax ID gets an
 * invoice, on the dual-role connection.
 *
 * `buyerHasTaxId = yes` deliberately, not `no`: #3189 deleted the Poland
 * starter template's `no-tax-id` rule precisely because `false` reads only for
 * a positively asserted "has none", which no shipped order source produces - so
 * a rule this spec wrote on `no` could never match anything and the walkthrough
 * would be asserting against a dead rule.
 */
async function fillComposer(page: Page): Promise<Locator> {
  const composer = page.getByTestId('rule-composer');
  await expect(composer).toBeVisible();
  await composer.getByTestId('rule-condition-field-0').selectOption('buyerHasTaxId');
  await composer.getByTestId('rule-condition-value-0').selectOption('true');
  await composer.getByTestId('rule-document-kind').selectOption('invoice');
  await composer
    .getByTestId('rule-connection')
    .selectOption({ label: ROUTING_SEED_CONNECTION_NAME });
  return composer;
}

test.describe.configure({ mode: 'serial' });

test.describe('sales documents: routing full path (#3196)', () => {
  /** Set by scenario B, read by B2/B3. */
  let savedRuleId: string | null = null;

  test.beforeAll(async () => {
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    await seedSalesDocumentRoutingFixture();
  });

  // ══════════════════ A — the buyer tax number, three states ══════════════

  test('A1 — a tax number the source asserted renders as the number itself', async ({ page }) => {
    await gotoOrder(page, ROUTING_SEED_ORDER_IDS.taxIdAsserted);

    await expect(page.getByTestId('order-buyer-tax-id')).toHaveText(ROUTING_SEED_BUYER_TAX_ID);
    // The three renderings are mutually exclusive by construction
    // (`order-buyer-tax-id-value.tsx` switches on presence-then-nullness), and
    // asserting the absence of the other two is what proves the switch took
    // the right arm rather than merely rendering something.
    await expect(page.getByTestId('order-buyer-tax-id-none')).toHaveCount(0);
    await expect(page.getByTestId('order-buyer-tax-id-unknown')).toHaveCount(0);

    await shot(page, '01-tax-id-asserted');
  });

  test('A2 — "the buyer has none" is its own rendering, never an empty value', async ({ page }) => {
    await gotoOrder(page, ROUTING_SEED_ORDER_IDS.taxIdAssertedNone);

    await expect(page.getByTestId('order-buyer-tax-id-none')).toBeVisible();
    await expect(page.getByTestId('order-buyer-tax-id')).toHaveCount(0);
    await expect(page.getByTestId('order-buyer-tax-id-unknown')).toHaveCount(0);

    await shot(page, '02-tax-id-asserted-none');
  });

  test('A3 — "not asserted" is distinct from "has none", and carries the PII caveat', async ({
    page,
  }) => {
    await gotoOrder(page, ROUTING_SEED_ORDER_IDS.taxIdNotAsserted);

    const unknown = page.getByTestId('order-buyer-tax-id-unknown');
    await expect(unknown).toBeVisible();
    await expect(page.getByTestId('order-buyer-tax-id')).toHaveCount(0);
    await expect(page.getByTestId('order-buyer-tax-id-none')).toHaveCount(0);

    // The caveat is a real tooltip rather than a `title` attribute - the point
    // of #3180's rendering, since an operator has to be able to tell "the
    // source said nothing" from "this deployment stores no PII", and the two
    // are indistinguishable from the value alone.
    //
    // Driven by HOVER, not by `focus()`: Radix opens a tooltip on pointer
    // enter or on a KEYBOARD focus, and a programmatic `focus()` is neither -
    // it sets `:focus` without `:focus-visible`, so the tooltip never opens and
    // the assertion fails against a component that is working correctly.
    await unknown.hover();
    await expect(page.getByRole('tooltip')).toBeVisible();

    await shot(page, '03-tax-id-not-asserted');
  });

  // ══════════════ B — a rule written, read back, saved, matched ═══════════

  test('B1 — the composer opens empty, withholds the save, and states why', async ({ page }) => {
    await openRoutingDialog(page);
    await shot(page, '04-market-routing-dialog');

    await page.getByTestId('rules-add').click();
    const composer = page.getByTestId('rule-composer');
    await expect(composer).toBeVisible();

    // No connection picked yet, so the save is inert. Asserting `rule-save`
    // (not `rule-save-blocked`) matters: the testid swaps with the state, and
    // an unpicked connection is NOT an overlap conflict.
    await expect(composer.getByTestId('rule-save')).toBeDisabled();

    await shot(page, '05-composer-empty');
  });

  test('B2 — the composer reads the draft back, then saves it', async ({ page, api }) => {
    await openRoutingDialog(page);
    await page.getByTestId('rules-add').click();
    const composer = await fillComposer(page);

    // The readback is the composer's own sentence assembled from all three
    // sections (#3189). It must name the resolved connection - a rule whose
    // destination is unset reads differently, and that is the state this
    // assertion rules out.
    await expect(composer.getByTestId('rule-readback')).toContainText(
      ROUTING_SEED_CONNECTION_NAME,
    );
    await shot(page, '06-composer-filled-readback');

    // Nothing to collide with yet, so the overlap gate must have ANSWERED and
    // left the save available under its available-state testid.
    const save = composer.getByTestId('rule-save');
    await expect(save).toBeEnabled({ timeout: 20_000 });
    await save.click();
    await expect(composer).toBeHidden({ timeout: 20_000 });

    // Read back from the ENGINE's own store, not from the list's cache - the
    // only evidence a UI save reached persistence.
    const rules = await api.salesDocuments.rules(ROUTING_SEED_COUNTRY);
    expect(rules).toHaveLength(1);
    expect(rules[0].documentKind).toBe('invoice');
    expect(rules[0].connectionId).toBe(ROUTING_SEED_CONNECTION_ID);
    savedRuleId = rules[0].id;

    await expect(page.getByTestId('rule-row-0')).toBeVisible();
    await shot(page, '07-rule-saved-in-list');
  });

  test('B3 — the saved rule survives a reload and the engine reasons about it', async ({
    page,
  }) => {
    expect(savedRuleId, 'B2 must have saved a rule').not.toBeNull();

    await openRoutingDialog(page);
    await expect(page.getByTestId('rule-row-0')).toBeVisible();
    await shot(page, '08-rule-persisted-after-reload');

    // "Matched" against a rule that is genuinely live: an IDENTICAL draft is
    // one the engine can prove would match the same order, so it answers
    // `rule-conflict` and the save swaps to its blocked testid. That is the
    // overlap engine reading the saved rule back and reasoning about it - the
    // closest real backend confirmation available, since the composer's own
    // dry run (`rule-test-sample-order`) has no endpoint behind it.
    await page.getByTestId('rules-add').click();
    const composer = await fillComposer(page);

    await expect(composer.getByTestId('rule-conflict')).toBeVisible({ timeout: 20_000 });
    await expect(composer.getByTestId('rule-save-blocked')).toBeDisabled();
    await expect(composer.getByTestId('rule-save')).toHaveCount(0);
    await shot(page, '09-composer-overlap-refused');

    await composer.getByTestId('rule-cancel').click();
    await expect(composer).toBeHidden();
  });

  test('B4 — an order routed by that rule says which rule decided it', async ({ page }) => {
    expect(savedRuleId, 'B2 must have saved a rule').not.toBeNull();
    // Attributed to an order that already carries a document: the panel renders
    // `sales-document-why-kind` inside a FILLED document slot only. On an order
    // with nothing issued there is no kind to explain, so the disclosure is
    // correctly absent - asserting it there would be asserting against a state
    // the panel does not have.
    await attributeOrderToRule(ROUTING_SEED_ORDER_IDS.invoiceIssued, savedRuleId as string);

    const panel = await gotoOrder(page, ROUTING_SEED_ORDER_IDS.invoiceIssued);

    // `sales-document-why-kind` is a `<details>`; the sentence inside it is
    // resolved against the LIVE rules table, so a rule that had not really
    // saved would render no disclosure at all.
    const whyKind = panel.getByTestId('sales-document-why-kind');
    await expect(whyKind).toBeVisible();
    await whyKind.click();
    await expect(panel.getByTestId('sales-document-matched-rule')).toBeVisible();
    await expect(panel.getByTestId('sales-document-matched-rule')).toContainText(
      ROUTING_SEED_CONNECTION_NAME,
    );

    await shot(page, '10-order-matched-rule');
  });

  // ═══════════ C — one dual-role connection, two document kinds ═══════════

  test('C1 — the connection carries BOTH sales-document lanes', async ({ page }) => {
    await page.goto(`/connections/${ROUTING_SEED_CONNECTION_ID}`);

    // The capability rows are what make the two 409s below a DUAL-ROLE
    // refusal rather than the older cross-connection one (#2157): with two
    // separate connections the same status code would prove something weaker.
    await expect(page.getByTestId('capability-invoicing')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('capability-fiscalization')).toBeVisible();
    await expect(page.getByTestId('capability-toggle-invoicing')).toBeChecked();
    await expect(page.getByTestId('capability-toggle-fiscalization')).toBeChecked();
    await expect(page.getByTestId('capability-count')).toBeVisible();

    await shot(page, '11-dual-role-connection-capabilities');
  });

  test('C2 — a fiscal receipt issued on that connection reads as terminal', async ({
    page,
    api,
  }) => {
    const panel = await gotoOrder(page, ROUTING_SEED_ORDER_IDS.receiptIssued);

    await expect(panel.getByTestId('sales-document-status')).toContainText('Fiscal receipt');
    // `registration-final` renders only on a terminally registered record, so
    // its presence IS the assertion that this is a settled receipt rather than
    // one mid-flight.
    await expect(panel.getByTestId('registration-final')).toBeVisible();

    const records = await api.fiscalRegistrations.listForOrder(
      ROUTING_SEED_ORDER_IDS.receiptIssued,
    );
    expect(records).toHaveLength(1);
    expect(records[0].connectionId).toBe(ROUTING_SEED_CONNECTION_ID);
    expect(records[0].status).toBe('registered');

    await shot(page, '12-receipt-issued');
  });

  test('C3 — an invoice issued on the SAME connection, for a different order', async ({
    page,
    api,
  }) => {
    const panel = await gotoOrder(page, ROUTING_SEED_ORDER_IDS.invoiceIssued);
    await expect(panel.getByTestId('sales-document-status')).toContainText('Invoice');

    const invoice = await api.invoices.getForOrder(
      ROUTING_SEED_ORDER_IDS.invoiceIssued,
      ROUTING_SEED_CONNECTION_ID,
    );
    expect(invoice.status).toBe('issued');
    // The whole point of the scenario: ONE connection id behind both kinds.
    expect(invoice.connectionId).toBe(ROUTING_SEED_CONNECTION_ID);

    await shot(page, '13-invoice-issued-same-connection');
  });

  // ═══════════════ D — both cross-kind second attempts refused ════════════

  test('D1 — asking for an invoice on an order that already has a receipt is refused', async ({
    page,
    api,
  }) => {
    // The REAL guard, on the REAL dual-role connection. #3184 is specifically
    // that the cross-kind check has no exemption for the requested connection
    // itself, so this is the case a two-connection fixture could not reach.
    const refusal = await api.invoices
      .issue({
        connectionId: ROUTING_SEED_CONNECTION_ID,
        orderId: ROUTING_SEED_ORDER_IDS.receiptIssued,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(refusal, 'issuing a second document kind must be refused').toBeInstanceOf(ApiError);
    expect((refusal as ApiError).status).toBe(409);

    const panel = await gotoOrder(page, ROUTING_SEED_ORDER_IDS.receiptIssued);
    await expect(panel.getByTestId('one-document-guard')).toBeVisible();
    await shot(page, '14-cross-kind-refusal-invoice-blocked');
  });

  test('D2 — and the reverse: no receipt on an order that already has an invoice', async ({
    page,
    api,
  }) => {
    const refusal = await api.fiscalRegistrations
      .register({
        connectionId: ROUTING_SEED_CONNECTION_ID,
        orderId: ROUTING_SEED_ORDER_IDS.invoiceIssued,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );

    // 409, never 422: a 422 would mean the sale could not be COMPOSED into a
    // registrable command, which is a different refusal and would leave the
    // one-document guard unexercised. The fixture's order snapshots are
    // arithmetically consistent precisely so composition succeeds and this
    // assertion reaches the guard.
    expect(refusal, 'registering a receipt over an invoice must be refused').toBeInstanceOf(
      ApiError,
    );
    expect((refusal as ApiError).status).toBe(409);

    // Nothing was created by the refused attempt.
    const records = await api.fiscalRegistrations.listForOrder(
      ROUTING_SEED_ORDER_IDS.invoiceIssued,
    );
    expect(records).toHaveLength(0);

    const panel = await gotoOrder(page, ROUTING_SEED_ORDER_IDS.invoiceIssued);
    await shot(page, '15-cross-kind-refusal-receipt-blocked');
    await expect(panel).toBeVisible();
  });

  // ═════════════ E — an invoice awaiting submission, with its age ═════════

  test('E1 — the awaiting-submission invoice is visible on the list with its age', async ({
    page,
  }) => {
    await page.goto('/invoices');
    await expect(page.getByTestId('invoices-table')).toBeVisible({ timeout: 30_000 });
    await shot(page, '16-invoices-list-unfiltered');

    // Narrow through the page's OWN filter control rather than by URL, so the
    // hook the mockup declares for it is exercised as an operator would.
    await page.getByTestId('invoices-filter-regulatory').selectOption('pending-submission');
    await expect(page.getByTestId('invoices-table')).toBeVisible();

    // `sales-document-status-waiting` is emitted ONLY for `pending-submission`,
    // so its presence is the state assertion - a hook on every badge would say
    // nothing about which state the badge is in.
    const waitingBadges = page.getByTestId('sales-document-status-waiting');
    await expect(waitingBadges.first()).toBeVisible({ timeout: 20_000 });

    // The row, and its age. `invoice-row-waiting-0` is emitted only on a row
    // that really is awaiting submission, and carries the instant the document
    // has been waiting since.
    await expect(page.getByTestId('invoice-row-0')).toBeVisible();
    const age = page.getByTestId('invoice-row-waiting-0');
    await expect(age).toBeVisible();

    // A real elapsed age, not today's date: the fixture backdated the issuance.
    const backdated = new Date(Date.now() - AWAITING_SUBMISSION_AGE_DAYS * 86_400_000);
    await expect(age).not.toHaveText(new Date().toLocaleDateString());
    await expect(age).toHaveAttribute(
      'datetime',
      new RegExp(`^${backdated.toISOString().slice(0, 10)}`),
    );

    await shot(page, '17-invoices-awaiting-submission-filtered');
  });

  test('E2 — the same document reads as awaiting submission on its detail page', async ({
    page,
    api,
  }) => {
    const invoice = await api.invoices.getForOrder(
      ROUTING_SEED_ORDER_IDS.awaitingSubmission,
      ROUTING_SEED_CONNECTION_ID,
    );
    expect(invoice.regulatoryStatus).toBe('pending-submission');

    await page.goto(`/invoices/${invoice.id}`);

    // Two hooks, two different claims: the badge says the clearance STATE, and
    // the ladder node says the timeline is sitting on the waiting step rather
    // than having fallen through to a "Submitted" node that would tell the
    // operator the document reached the authority when nothing was sent.
    await expect(page.getByTestId('sales-document-status-waiting').first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('clearance-ladder-waiting')).toBeVisible();
    await expect(page.getByTestId('clearance-node-waiting')).toBeVisible();

    await shot(page, '18-invoice-detail-awaiting-submission');
  });

  test('E3 — the tax-id filter narrows the same list by what the document carries', async ({
    page,
  }) => {
    await page.goto('/invoices');
    await expect(page.getByTestId('invoices-table')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('invoices-filter-tax-id').selectOption('with');
    await expect(page.getByTestId('invoices-table')).toBeVisible();

    // #3188: the value is FROZEN at issue, so this states what the document
    // carries rather than what the order asserts today - the same three-state
    // rendering scenario A read on the order.
    await expect(page.getByTestId('invoice-row-tax-id-0')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('invoice-row-tax-id-0')).toContainText(
      ROUTING_SEED_BUYER_TAX_ID,
    );

    await shot(page, '19-invoices-filtered-by-tax-id');
  });
});
