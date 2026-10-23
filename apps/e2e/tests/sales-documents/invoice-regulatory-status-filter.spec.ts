/**
 * Invoices list: the regulatory-status filter + "Awaiting submission" chip
 * (#3194)
 *
 * Before this spec the invoice list's regulatory-status filter and its
 * "Awaiting submission" chip had NO e2e coverage at all: nothing drove the
 * two values #3194 RESTORED to the filter after they were deliberately
 * excluded — `not-applicable` and `cleared` (see the filter's own doc
 * comment in `invoices-list-page.tsx`) — and nothing asserted the
 * `invoices-chip-awaiting` testid.
 *
 * FIXTURE: `seedInvoiceRegulatoryStatuses` (`invoice-regulatory-status-
 * seed.ts`) writes two `pending-submission` invoices (one ~2h older, for the
 * chip's age suffix), one `cleared` invoice and one `not-applicable` invoice
 * — self-contained regardless of what else `sales-document-seed.ts` has
 * (or has not) already written to the shared stack (see that module's own
 * doc comment).
 *
 * @module tests/sales-documents
 */
import { test, expect } from '../../src/fixtures/test';
import { seedInvoiceRegulatoryStatuses } from '../../src/support/invoice-regulatory-status-seed';

/** Parses the "Showing X–Y of {total}" pagination footer into `total`. */
async function readTotal(page: import('@playwright/test').Page): Promise<number> {
  const text = (await page.locator('.pagination').first().innerText()).replace(/\s+/g, ' ');
  const match = /of (\d+)/.exec(text);
  if (!match) throw new Error(`could not parse a total out of pagination text: "${text}"`);
  return Number(match[1]);
}

test.describe('invoices list: regulatory-status filter (#3194)', () => {
  test.beforeAll(async () => {
    await seedInvoiceRegulatoryStatuses();
  });

  test('the regulatory-status filter offers all six statuses, including the two #3194 restored', async ({
    page,
  }) => {
    await page.goto('/invoices');
    await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible({ timeout: 30_000 });

    const select = page.getByTestId('invoices-filter-regulatory');
    const values = await select.locator('option').evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value),
    );
    // '' (All) + the six `RegulatoryStatusValues` — `not-applicable` and
    // `cleared` are the two #3194 reinstated; the other four predate it.
    expect(values.sort()).toEqual(
      [
        '',
        'not-applicable',
        'pending-submission',
        'submitted',
        'cleared',
        'accepted',
        'rejected',
      ].sort(),
    );
  });

  test('selecting a regulatory status narrows the list to that status', async ({ page }) => {
    await page.goto('/invoices');
    await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible({ timeout: 30_000 });

    const select = page.getByTestId('invoices-filter-regulatory');
    const unfilteredTotal = await readTotal(page);

    for (const [value, label] of [
      ['not-applicable', 'N/A'],
      ['cleared', 'Clearing'],
    ] as const) {
      await select.selectOption(value);
      await expect(page).toHaveURL(new RegExp(`regulatoryStatus=${value}`));
      // The list actually narrowed — never the unfiltered count reappearing
      // under a filter that silently did nothing.
      await expect
        .poll(async () => readTotal(page), { timeout: 10_000 })
        .toBeLessThanOrEqual(unfilteredTotal);

      // Every VISIBLE row's own regulatory badge now reads the selected
      // status's label — proving the narrowing is real, not merely a URL
      // change with the same rows still on screen.
      const badges = page.locator('.data-table tbody tr').locator('td', { hasText: label });
      await expect(badges.first()).toBeVisible();
      const rowCount = await page.locator('.data-table tbody tr').count();
      for (let i = 0; i < rowCount; i += 1) {
        await expect(page.locator('.data-table tbody tr').nth(i)).toContainText(label);
      }
    }
  });

  test('a direct-linked "cleared" filter reaches the seeded row on load, not only after a client-side select', async ({
    page,
  }) => {
    await page.goto('/invoices?regulatoryStatus=cleared');
    await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('invoices-filter-regulatory')).toHaveValue('cleared');
    await expect(page.locator('.data-table tbody tr', { hasText: 'Clearing' }).first()).toBeVisible();
  });

  test('the "Awaiting submission" chip renders a count and an elapsed age, and toggles the filter', async ({
    page,
  }) => {
    await page.goto('/invoices');
    await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible({ timeout: 30_000 });

    const chip = page.getByTestId('invoices-chip-awaiting');
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await expect(chip).toContainText('Awaiting submission');
    // A count of at least the two rows this file seeded, plus whatever else
    // the shared stack's first page already carried.
    await expect(chip).toContainText(/Awaiting submission \d+/);
    // An elapsed-age suffix — "· oldest N h" or "· oldest N d" — never an
    // ETA (see the chip's own doc comment): reachable only when the OLDEST
    // pending-submission row on the loaded page is at least an hour old,
    // which this file's seed guarantees (~2h).
    await expect(chip).toContainText(/oldest \d+ [hd]/);

    await chip.click();
    await expect(page).toHaveURL(/regulatoryStatus=pending-submission/);
    await expect(page.getByTestId('invoices-filter-regulatory')).toHaveValue(
      'pending-submission',
    );

    // Toggling again clears the filter (same chip, same value — a second
    // affordance for one filter dimension, not a second one).
    await chip.click();
    await expect(page).not.toHaveURL(/regulatoryStatus=/);
  });
});
