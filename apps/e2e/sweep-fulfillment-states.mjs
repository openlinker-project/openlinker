/**
 * Every state of the pack bench and the fulfilment board, driven and captured.
 *
 * One screenshot per state, one assertion per state, one JSON manifest at the
 * end. A state counts as covered only when its assertion passed — reaching the
 * route proves nothing, and a screenshot of a loading spinner is not evidence
 * that a state renders.
 *
 * Runs against a REAL stack with the real demo database. Nothing here seeds or
 * mutates catalogue data; the few states that need specific work rows are
 * seeded beforehand by `seed-fulfillment-board.sql`.
 *
 *   node apps/e2e/sweep-fulfillment-states.mjs
 *   node apps/e2e/sweep-fulfillment-states.mjs --only=board          # one group
 *   node apps/e2e/sweep-fulfillment-states.mjs --base=http://…
 *
 * A state whose feature is not built yet is declared `pending` and REPORTED as
 * such rather than skipped silently — the point of the sweep is to say what is
 * missing, and an omitted row cannot.
 */
import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

/**
 * One SQL statement against the real stack's Postgres. There is no psql on
 * the host — every call goes through the container the stack actually runs
 * in. Used only by the handful of states that reach behind the UI to force a
 * condition the product has no button for (a concurrent edit, a supervisor's
 * lock taking effect mid-pack), and each such state restores the row it
 * touched before it returns.
 */
function psql(sql) {
  return execSync(
    'docker exec -i ol-apw-verify-postgres psql -U postgres -d openlinker -tA -v ON_ERROR_STOP=1',
    { input: sql, encoding: 'utf8' }
  ).trim();
}

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const BASE = arg('base', 'http://localhost:38090');
const ONLY = arg('only', null);
const OUT = arg('out', '/tmp/apw-screenshots/states');

const ACTORS = {
  admin: { user: 'admin', pass: 'admin' },
  packer: { user: 'anna.pakowska', pass: 'Pakowanie!2026' },
};

const DESKTOP = { width: 1440, height: 1100 };
const PHONE = { width: 390, height: 844 };
const TABLET = { width: 820, height: 1180 };

/**
 * The work a label was bought for AUTOMATICALLY, with no operator click — the
 * seeded row `seed-fulfillment-board.sql` produces and the auto-dispatch job
 * then acts on. Named here rather than inlined so the one state that depends
 * on a specific row says which row, and fails legibly if the seed changes.
 */
const AUTO_DISPATCH_WORK = 'ol_fwork_e2e_13';

/**
 * The seeded parcel that is CLOSED and carries a label nobody printed.
 *
 * Deliberately NOT the other closed one (`_28`): that one's carrier refused it
 * a label and no invoice was ever made, so there is nothing this bench could
 * print for it and completion correctly goes straight through. Pointing the
 * dialog states at it tested the wrong parcel and read as a missing feature.
 */
const CLOSED_WORK = 'ol_fwork_e2e_13';

/**
 * The OTHER closed parcel, used ONLY by the take-it-back state.
 *
 * It needs a box it can complete ITSELF, and `CLOSED_WORK` above has already
 * been completed by the two dialog states by the time it runs - leaving no
 * "Mark as done here" to press and nothing to take back. `_28` carries no
 * label and no invoice, so its completion goes straight through with no
 * dialog, which is exactly what this state wants: it is about the undo, not
 * about the prompt.
 */
const UNDO_WORK = 'ol_fwork_e2e_28';

/**
 * A packable, unassigned, self-serve-eligible parcel used ONLY by the
 * scan-lock state below — nothing else in this file opens it by name. It is
 * mutated mid-state (a fake supervisor lock, forced from behind the UI) and
 * restored to these exact values before the state returns.
 */
const SCAN_LOCK_WORK = 'ol_fwork_e2e_09';
/** A real seeded packer, distinct from both actors, playing "someone else". */
const SCAN_LOCK_OTHER_PACKER = 'e4a80767-0cd9-4831-98a9-ec47fc507a1e'; // e2e-packer-manual

/**
 * A seeded, unassigned parcel used ONLY by the board version-conflict state
 * below. Its `version` is captured before the state bumps it behind the UI,
 * and restored to that captured value once the state has finished — never a
 * hardcoded number, since a prior run (or manual poking) may have already
 * moved it off its seeded `1`.
 */
const BOARD_CONFLICT_WORK = 'ol_fwork_e2e_10';
const BOARD_CONFLICT_PACKER = 'ca560b27-bcd2-4d62-bb7f-b6952f7207f1'; // anna.pakowska
let boardConflictOriginalVersion = null;

/**
 * Open the closed parcel from the rail.
 *
 * It lives in the "waiting on carrier" section rather than among the work to
 * pack, because it is finished and unlabelled — so the rail has to be scrolled
 * to reach it, and a capture taken without opening it shows the queue instead
 * of the state.
 */
async function openClosedParcel(page, workId = CLOSED_WORK) {
  await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  for (const selector of [
    `.bench-work-row__surface`,
    `[data-testid="bench-section-waiting-on-carrier"] button`,
  ]) {
    const row = page.locator(selector).filter({ hasText: workId }).first();
    if ((await row.count()) > 0) {
      await row.scrollIntoViewIfNeeded();
      await row.click();
      await page.waitForTimeout(1800);
      return;
    }
  }
  // Fall back to the section's own first row: the seeded closed parcel is the
  // only thing in it, and its reference is friendlier than its work id.
  const first = page.locator(`[data-testid="bench-section-waiting-on-carrier"] button`).first();
  if ((await first.count()) > 0) {
    await first.scrollIntoViewIfNeeded();
    await first.click();
    await page.waitForTimeout(1800);
  }
}

/**
 * `reach` navigates and settles. `check` returns true, or a string explaining
 * what it saw instead — never a bare false, because "it did not render" and
 * "it rendered the wrong thing" send you to different places.
 */
const STATES = [
  // ── Pack bench ────────────────────────────────────────────────────────────
  {
    id: 'bench-queue',
    group: 'bench',
    actor: 'packer',
    title: 'The queue, as a packer sees it',
    async reach(page) {
      await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
    },
    async check(page) {
      const rows = await page.locator('.bench-work-row').count();
      return rows > 0 ? true : 'no rail rows rendered';
    },
  },
  {
    id: 'bench-rail-no-other-packers',
    group: 'bench',
    actor: 'packer',
    title: 'A packer is not shown other packers’ work',
    async reach(page) {
      await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
    },
    async check(page) {
      const n = await page.getByText('Assigned to other packers').count();
      return n === 0 ? true : `the section rendered ${String(n)} time(s)`;
    },
  },
  {
    id: 'bench-rail-all-sections-admin',
    group: 'bench',
    actor: 'admin',
    title: 'An admin sees every section',
    async reach(page) {
      await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
    },
    async check(page) {
      // Only meaningful when such work exists; report that rather than pass blindly.
      const assigned = await page.getByText('Assigned to other packers').count();
      return assigned > 0 ? true : 'no work is assigned to another packer right now';
    },
  },
  {
    id: 'bench-rail-status-not-clipped',
    group: 'bench',
    actor: 'packer',
    title: 'No rail row clips its status badge',
    async reach(page) {
      await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
    },
    async check(page) {
      const clipped = await page.$$eval('.bench-work-row__top .status-badge', (badges) =>
        badges
          .filter((b) => b.scrollWidth > b.clientWidth + 1)
          .map((b) => b.textContent?.trim() ?? '')
      );
      return clipped.length === 0 ? true : `clipped: ${clipped.join(', ')}`;
    },
  },
  {
    id: 'bench-parcel-open',
    group: 'bench',
    actor: 'packer',
    title: 'A parcel open, items outstanding',
    async reach(page) {
      await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      const row = page.locator('.bench-work-row__surface').first();
      if ((await row.count()) > 0) await row.click();
      await page.waitForTimeout(1500);
    },
    async check(page) {
      const hero = await page.locator('[data-testid="bench-parcel"]').count();
      return hero > 0 ? true : 'the parcel pane did not render';
    },
  },
  {
    id: 'bench-no-camera-control',
    group: 'bench',
    actor: 'packer',
    title: 'No camera-preview control anywhere',
    async reach(page) {
      await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      const row = page.locator('.bench-work-row__surface').first();
      if ((await row.count()) > 0) await row.click();
      await page.waitForTimeout(1500);
    },
    async check(page) {
      const n = await page.getByRole('button', { name: /camera preview/i }).count();
      return n === 0 ? true : 'the inert camera-preview button is still rendered';
    },
  },
  {
    id: 'bench-ship-by-says-how-long-is-left',
    group: 'bench',
    actor: 'packer',
    title: 'The order head says how long is left, not only a clock time',
    async reach(page) {
      await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      const row = page.locator('.bench-work-row__surface').first();
      if ((await row.count()) > 0) await row.click();
      await page.waitForTimeout(1500);
    },
    async check(page) {
      // The rail says "Past its deadline"; the head used to say "5:44 AM" and
      // hide the rest in a `title` no touch kiosk can reach.
      const shipBy = page.locator('.bench-parcel__ship-by');
      if ((await shipBy.count()) === 0) return 'this parcel carries no deadline to render';
      const remaining = await page.locator('.bench-parcel__ship-by-remaining').count();
      return remaining > 0 ? true : 'the head shows a clock time and nothing else';
    },
  },
  {
    id: 'bench-no-wrapped-timestamps',
    group: 'bench',
    actor: 'packer',
    title: 'No timestamp in the activity log wraps mid-value',
    async reach(page) {
      await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      const row = page.locator('.bench-work-row__surface').first();
      if ((await row.count()) > 0) await row.click();
      await page.waitForTimeout(1500);
    },
    async check(page) {
      const wrapped = await page.$$eval('.bench-activity time', (times) =>
        times
          .filter((t) => {
            const lineHeight = parseFloat(getComputedStyle(t).lineHeight) || 16;
            return t.getBoundingClientRect().height > lineHeight * 1.6;
          })
          .map((t) => t.textContent?.trim() ?? '')
      );
      return wrapped.length === 0 ? true : `wrapped: ${wrapped.join(', ')}`;
    },
  },
  {
    id: 'bench-hold',
    group: 'bench',
    actor: 'packer',
    title: 'A held parcel — do not pack, and it says why',
    async reach(page) {
      await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      const tab = page.getByRole('tab', { name: /on hold/i });
      if ((await tab.count()) > 0) await tab.first().click();
      await page.waitForTimeout(800);
      const row = page.locator('[data-testid="bench-section-hold"] .bench-work-row__surface').first();
      if ((await row.count()) > 0) await row.click();
      await page.waitForTimeout(1500);
    },
    async check(page) {
      const panel = await page.locator('[data-testid="bench-tab-panel-hold"]').count();
      if (panel === 0) return 'the hold tab did not render';
      const rows = await page.locator('.bench-work-row').count();
      return rows > 0 ? true : 'the hold tab is empty — no held work on this stack';
    },
  },
  {
    id: 'bench-unlabelled',
    group: 'bench',
    actor: 'packer',
    title: 'Packed, and the carrier would not give us a label',
    async reach(page) {
      await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      // The section lives at the bottom of a rail that scrolls, so a screenshot
      // taken here shows the queue and not the state. OPEN the parcel — the
      // point of the capture is Surface F itself, not the row that leads to it.
      const row = page
        .locator('[data-testid="bench-section-waiting-on-carrier"] button')
        .first();
      if ((await row.count()) > 0) {
        await row.scrollIntoViewIfNeeded();
        await row.click();
        await page.waitForTimeout(1800);
      }
    },
    async check(page) {
      // Reached only where a shipment actually failed. Reported as unreachable
      // rather than passed, so the sweep never claims to have seen a state it
      // could not produce.
      const section = await page.locator('[data-testid="bench-section-waiting-on-carrier"]').count();
      if (section === 0) return 'no parcel on this stack is waiting on a carrier';
      const panel = await page.locator('[data-testid="bench-documents-unlabelled"]').count();
      return panel > 0 ? true : 'the row is listed but its unlabelled panel did not open';
    },
  },
  {
    id: 'bench-phone',
    group: 'bench',
    actor: 'packer',
    viewport: PHONE,
    title: 'The bench on a phone',
    async reach(page) {
      await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
    },
    async check(page) {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1
      );
      return overflow ? 'the page scrolls sideways' : true;
    },
  },
  {
    id: 'bench-tablet',
    group: 'bench',
    actor: 'packer',
    viewport: TABLET,
    title: 'The bench on a tablet',
    async reach(page) {
      await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
    },
    async check(page) {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1
      );
      return overflow ? 'the page scrolls sideways' : true;
    },
  },

  // ── The merged board ──────────────────────────────────────────────────────
  {
    id: 'board-by-packer',
    group: 'board',
    actor: 'admin',
    title: 'Lanes grouped by packer',
    async reach(page) {
      await page.goto(`${BASE}/fulfillment`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
    },
    async check(page) {
      const lanes = await page.locator('.assign-packing-work-lane').count();
      return lanes > 0 ? true : 'no lanes rendered';
    },
  },
  {
    id: 'board-by-location',
    group: 'board',
    actor: 'admin',
    title: 'Lanes grouped by location, drag off',
    async reach(page) {
      await page.goto(`${BASE}/fulfillment?groupBy=location`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
    },
    async check(page) {
      const lanes = await page.locator('.assign-packing-work-lane').count();
      if (lanes === 0) return 'no lanes rendered';
      const draggable = await page.locator('.assign-packing-work-card[draggable="true"]').count();
      if (draggable > 0) return `${String(draggable)} cards are still draggable`;
      const said = await page.getByText(/Drag moves a task between packers/).count();
      return said > 0 ? true : 'nothing explains why drag is off';
    },
  },
  {
    id: 'board-lane-heading-names-the-location',
    group: 'board',
    actor: 'admin',
    title: 'A location lane is named, not an internal id',
    async reach(page) {
      await page.goto(`${BASE}/fulfillment?groupBy=location`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
    },
    async check(page) {
      const raw = await page.getByText(/ol_location_/).count();
      return raw === 0 ? true : 'a raw ol_location_* id is on screen';
    },
  },
  {
    id: 'board-rows-aligned',
    group: 'board',
    actor: 'admin',
    title: 'Rows in a lane line up column to column',
    async reach(page) {
      await page.goto(`${BASE}/fulfillment`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
    },
    async check(page) {
      // Comparing only the reference's x is too weak: it already agrees on a
      // layout that reads as ragged, because what actually differs is row
      // HEIGHT (controls wrapping onto their own lines, and only in the lane
      // that carries the self-serve checkbox). Height is the assertion that
      // fails on the real defect.
      const faults = await page.$$eval('.assign-packing-work-lane', (lanes) =>
        lanes.flatMap((lane) => {
          const cards = [...lane.querySelectorAll('.assign-packing-work-card')];
          if (cards.length < 2) return [];
          const heights = cards.map((c) => Math.round(c.getBoundingClientRect().height));
          const spread = Math.max(...heights) - Math.min(...heights);
          return spread > 2 ? [`heights differ by ${String(spread)}px`] : [];
        })
      );
      // And across lanes: one packer's card and one unassigned card are the
      // same component and must not be two different shapes.
      const acrossLanes = await page.$$eval('.assign-packing-work-card', (cards) => {
        if (cards.length < 2) return 0;
        const heights = cards.map((c) => Math.round(c.getBoundingClientRect().height));
        return Math.max(...heights) - Math.min(...heights);
      });
      if (acrossLanes > 2) faults.push(`cards differ by ${String(acrossLanes)}px between lanes`);
      return faults.length === 0 ? true : faults.join('; ');
    },
  },
  {
    id: 'board-deadline-is-actionable',
    group: 'board',
    actor: 'admin',
    title: 'A deadline badge says how long is left, not a bare clock time',
    async reach(page) {
      await page.goto(`${BASE}/fulfillment`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
    },
    async check(page) {
      // A board spans days, so `11:59 PM` alone does not say which day — and a
      // badge that is `warning` on every row says nothing about urgency at all.
      const clockOnly = await page.$$eval('.assign-packing-work-card .status-badge', (badges) =>
        badges
          .map((b) => (b.textContent ?? '').trim())
          .filter((t) => /^\d{1,2}:\d{2}(\s?[AP]M)?$/i.test(t))
      );
      return clockOnly.length === 0
        ? true
        : `${String(clockOnly.length)} badge(s) show only a time, e.g. "${clockOnly[0]}"`;
    },
  },
  {
    id: 'board-filter-matches-nothing',
    group: 'board',
    actor: 'admin',
    title: 'A filter that matches nothing says so, and offers a way out',
    async reach(page) {
      await page.goto(`${BASE}/fulfillment?orderId=ol_order_definitely_missing`, {
        waitUntil: 'networkidle',
      });
      await page.waitForTimeout(1800);
    },
    async check(page) {
      const said = await page.getByText('No fulfilment tasks match these filters').count();
      if (said === 0) return 'the filtered-empty sentence is missing';
      const out = await page.getByRole('button', { name: 'Clear filters' }).count();
      return out > 0 ? true : 'no way out of the filtered state';
    },
  },
  {
    id: 'board-past-the-end',
    group: 'board',
    actor: 'admin',
    title: 'Paged past the end says something different',
    async reach(page) {
      await page.goto(`${BASE}/fulfillment?offset=500`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1800);
    },
    async check(page) {
      const said = await page.getByText('Nothing on this page').count();
      return said > 0 ? true : 'the past-the-end sentence is missing';
    },
  },
  {
    id: 'board-legacy-path-redirects',
    group: 'board',
    actor: 'admin',
    title: 'The old /fulfillment/assign path redirects',
    async reach(page) {
      await page.goto(`${BASE}/fulfillment/assign`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
    },
    async check(page) {
      const path = new URL(page.url()).pathname;
      return path === '/fulfillment' ? true : `landed on ${path}`;
    },
  },
  {
    id: 'board-metrics',
    group: 'board',
    actor: 'admin',
    title: 'The metric row counts what is on screen',
    async reach(page) {
      await page.goto(`${BASE}/fulfillment`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
    },
    async check(page) {
      const n = await page.locator('.assign-packing-work-metrics').count();
      return n > 0 ? true : 'no metric row';
    },
  },

  // ── Documents ─────────────────────────────────────────────────────────────
  {
    id: 'documents-panel',
    group: 'documents',
    actor: 'packer',
    title: 'The paper that travels with the box',
    async reach(page) {
      await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      const row = page.locator('.bench-work-row__surface').first();
      if ((await row.count()) > 0) await row.click();
      await page.waitForTimeout(1800);
    },
    async check(page) {
      const n = await page.locator('[data-testid="bench-documents"]').count();
      return n > 0 ? true : 'the documents panel did not render';
    },
  },

  // ── Not built yet — declared so the sweep reports them ────────────────────
  {
    id: 'bench-label-print-goes-through-the-bench',
    group: 'auto',
    actor: 'packer',
    title: 'Printing the label goes through the bench route, not the shipment one',
    async reach(page) {
      await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      const row = page
        .locator('.bench-work-row__surface')
        .filter({ hasText: AUTO_DISPATCH_WORK })
        .first();
      if ((await row.count()) === 0) return;
      await row.scrollIntoViewIfNeeded();
      await row.click();
      await page.waitForTimeout(1800);
    },
    async check(page) {
      const print = page.getByRole('button', { name: /print label/i }).first();
      if ((await print.count()) === 0) return 'no print-label control on this parcel';

      const seenUrls = [];
      page.on('request', (req) => seenUrls.push(req.url()));
      const responsePromise = page
        .waitForResponse((res) => res.url().includes('/documents/label'), { timeout: 20_000 })
        .catch(() => null);
      await print.click();
      const response = await responsePromise;
      await page.waitForTimeout(500);

      const hit = seenUrls.find((u) => u.includes('/documents/label'));
      if (hit === undefined) return 'the print click made no request to a label route';
      if (!hit.includes('/bench/work/')) return `the label request went to ${hit}, not the bench route`;
      if (hit.includes('/shipments/'))
        return `the label request also reached the legacy shipments route: ${hit}`;
      if (response !== null && response.status() >= 400)
        return `the label request answered ${String(response.status())}`;

      const stamped = psql(
        `SELECT "labelPrintedAt" IS NOT NULL FROM fulfillment_works WHERE id = '${AUTO_DISPATCH_WORK}';`
      );

      // Put the stamp back. This state PRINTS, and "nothing printed yet" is
      // exactly the precondition the two completion-dialog states below rely
      // on - so leaving the stamp behind silently removes their dialog and
      // reads as a missing feature rather than as this state's leftovers. The
      // scan-lock state restores its own mutation for the same reason.
      psql(
        `UPDATE fulfillment_works SET "labelPrintedAt" = NULL WHERE id = '${AUTO_DISPATCH_WORK}';`
      );

      return stamped === 't'
        ? true
        : 'labelPrintedAt was not stamped in the database after printing through the bench';
    },
  },
  {
    id: 'bench-completion-control',
    group: 'post-pack',
    actor: 'packer',
    title: 'A closed box offers one explicit way to finish with it',
    async reach(page) {
      await openClosedParcel(page);
    },
    async check(page) {
      const action = await page.getByRole('button', { name: /mark as done here/i }).count();
      if (action === 0) return 'the closed box offers no way to finish with it';
      // Never a claim the product cannot support: the same box may have been
      // refused a label, and "sent" or "labelled" would be false there.
      const overclaims = await page
        .locator('.bench-completion')
        .filter({ hasText: /\b(sent|labelled|labeled|shipped)\b/i })
        .count();
      return overclaims === 0 ? true : 'the control claims more than completion records';
    },
  },
  {
    id: 'bench-completion-asks-when-nothing-printed',
    group: 'post-pack',
    actor: 'packer',
    title: 'Nothing printed — it asks first, and names what is missing',
    async reach(page) {
      await openClosedParcel(page);
      const action = page.getByRole('button', { name: /mark as done here/i }).first();
      if ((await action.count()) === 0) return;
      await action.click();
      await page.waitForTimeout(900);
    },
    async check(page) {
      const dialog = page.getByRole('dialog');
      if ((await dialog.count()) === 0) return 'it went straight through with nothing printed';
      // "Are you sure" would be a dialog that tells the packer nothing.
      const named = await dialog
        .filter({ hasText: /(label|invoice).*has not been printed|Neither the label nor the invoice/i })
        .count();
      return named > 0 ? true : 'the dialog does not name what was not printed';
    },
  },
  {
    id: 'bench-completion-offers-both-ways-out',
    group: 'post-pack',
    actor: 'packer',
    title: 'The dialog lets a packer print now, or go ahead anyway',
    async reach(page) {
      await openClosedParcel(page);
      const action = page.getByRole('button', { name: /mark as done here/i }).first();
      if ((await action.count()) === 0) return;
      await action.click();
      await page.waitForTimeout(900);
    },
    async check(page) {
      const dialog = page.getByRole('dialog');
      if ((await dialog.count()) === 0) return 'no dialog to inspect';
      const print = await dialog.getByRole('button', { name: /print the (label|invoice)/i }).count();
      const anyway = await dialog.getByRole('button', { name: /anyway/i }).count();
      if (print === 0) return 'no way to print from inside the dialog';
      // A packer who printed at another terminal must not be stuck here.
      return anyway > 0 ? true : 'no way past the warning';
    },
  },
  {
    id: 'label-bought-automatically',
    group: 'auto',
    actor: 'packer',
    title: 'A label the packer never asked for is waiting to print',
    async reach(page) {
      // Asserted through the PACKER's own screen rather than a database row:
      // what the feature promises is that the paper is there when the box
      // reaches the bench, and a row in `shipments` does not promise that.
      await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      // Found by walking the rail rather than typing into the search box: the
      // rail's search matches the order reference and the buyer's name and
      // deliberately not the work id (`matchesBenchSearch`), so a search for
      // one silently matches nothing and the state fails for the wrong reason.
      const row = page
        .locator('.bench-work-row__surface')
        .filter({ hasText: AUTO_DISPATCH_WORK })
        .first();
      if ((await row.count()) === 0) return;
      await row.scrollIntoViewIfNeeded();
      await row.click();
      await page.waitForTimeout(1800);
    },
    async check(page) {
      const panel = page.locator('[data-testid="bench-documents"]');
      if ((await panel.count()) === 0) return 'the documents panel did not render';
      const print = await page.getByRole('button', { name: /print label/i }).count();
      return print > 0
        ? true
        : 'no label to print — the automatic purchase did not reach this parcel';
    },
  },

  // ── Four behaviours with no live coverage yet (#3340 follow-ups) ──────────
  {
    id: 'bench-completion-can-be-taken-back',
    group: 'post-pack',
    actor: 'packer',
    title: 'A completion can be taken back without reopening the box',
    async reach(page) {
      await openClosedParcel(page, UNDO_WORK);
      const markDone = page.getByRole('button', { name: /mark as done here/i }).first();
      if ((await markDone.count()) === 0) return; // already completed from a prior run

      // Waited for EXPLICITLY, never a blind timeout: the completion POST
      // fires straight off this click when there is no print gap, or off the
      // dialog's "anyway" a moment later when there is one — either way this
      // is the one request that actually records the act, and a fixed delay
      // guessed wrong under real backend latency and left the row stuck
      // completed with nothing to undo it.
      const isCompleteResponse = (res) =>
        res.request().method() === 'POST' &&
        res.url().includes('/complete') &&
        !res.url().includes('/complete/undo');
      const completed = page.waitForResponse(isCompleteResponse, { timeout: 15_000 }).catch(() => null);

      await markDone.click();
      await page.waitForTimeout(600);
      const dialog = page.getByRole('dialog');
      if ((await dialog.count()) > 0) {
        const anyway = dialog.getByRole('button', { name: /anyway/i }).first();
        if ((await anyway.count()) > 0) await anyway.click();
      }
      await completed;
      await page.waitForTimeout(500);
    },
    async check(page) {
      // Asserted through what a packer can actually see, never a data-testid:
      // the two this check first reached for (`bench-parcel-completed`,
      // `bench-parcel-closed`) exist nowhere in the app, so every run answered
      // "never reached the completed state" about a parcel the database showed
      // as completed. A selector that cannot match is not a strict assertion,
      // it is an assertion about nothing.
      const undoAction = page.getByRole('button', { name: /take this back/i }).first();
      if ((await undoAction.count()) === 0) {
        return 'the parcel is not showing as completed - nothing offers to take it back';
      }
      const undone = page
        .waitForResponse(
          (res) => res.request().method() === 'POST' && res.url().includes('/complete/undo'),
          { timeout: 15_000 }
        )
        .catch(() => null);
      await undoAction.click();
      await undone;
      await page.waitForTimeout(500);

      const stillOffered = await page.getByRole('button', { name: /take this back/i }).count();
      if (stillOffered > 0) return 'it still reads as completed after taking it back';

      // This doubles as the proof that the box stayed CLOSED, which is the
      // whole point of the feature: "Mark as done here" is offered only on a
      // closed parcel (D18), so its return means the completion was undone
      // WITHOUT reopening the box. A reopen would have put the parcel back to
      // scanning and this control would be gone.
      const markDoneAgain = await page.getByRole('button', { name: /mark as done here/i }).count();
      if (markDoneAgain === 0) {
        return 'taking it back did not restore the completion control - the box looks reopened';
      }

      // And the scans themselves must stand. A reopen clears them.
      const zeroed = await page.getByText(/All 0 units matched/i).count();
      return zeroed === 0
        ? true
        : 'the scan count reset to zero - the box was reopened rather than un-completed';
    },
  },
  {
    id: 'bench-scan-locked-mid-pack-does-not-say-trolley',
    group: 'bench',
    actor: 'packer',
    title: 'A parcel locked to another packer mid-pack does not say "take it to the trolley"',
    async reach(page) {
      await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      const row = page
        .locator('.bench-work-row__surface')
        .filter({ hasText: SCAN_LOCK_WORK })
        .first();
      if ((await row.count()) === 0) return;
      await row.scrollIntoViewIfNeeded();
      await row.click();
      await page.waitForTimeout(1500);

      // The lock takes effect WHILE the packer already has the parcel open —
      // a supervisor reassigning it mid-pack. There is no product control for
      // this yet, so it is forced from behind the UI.
      psql(
        `UPDATE fulfillment_works SET "assignedToUserId" = '${SCAN_LOCK_OTHER_PACKER}', ` +
          `"selfServeEligible" = false WHERE id = '${SCAN_LOCK_WORK}';`
      );

      const confirm = page.getByRole('button', { name: /confirm this item/i }).first();
      if ((await confirm.count()) > 0) {
        await confirm.click();
        await page.waitForTimeout(1200);
      }
    },
    async check(page) {
      try {
        const alert = page.getByRole('alert');
        if ((await alert.count()) === 0) return 'no refusal was rendered for the scan';
        const text = (await alert.first().textContent()) ?? '';
        if (/trolley/i.test(text)) return `still says to take it back to the trolley: "${text}"`;
        return /another packer/i.test(text)
          ? true
          : `refused, but does not name the assignment: "${text}"`;
      } finally {
        // Leave the row exactly as this state found it, whatever the check found.
        psql(
          `UPDATE fulfillment_works SET "assignedToUserId" = NULL, "selfServeEligible" = true ` +
            `WHERE id = '${SCAN_LOCK_WORK}';`
        );
      }
    },
  },
  {
    id: 'board-move-refused-when-somebody-moved-it-first',
    group: 'board',
    actor: 'admin',
    title: 'A move sent against a stale version is refused, not silently applied',
    async reach(page) {
      await page.goto(`${BASE}/fulfillment`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
      const card = page.locator(`.assign-packing-work-card[data-task-id="${BOARD_CONFLICT_WORK}"]`);
      if ((await card.count()) === 0) return;
      await card.scrollIntoViewIfNeeded();

      boardConflictOriginalVersion = psql(
        `SELECT version FROM fulfillment_works WHERE id = '${BOARD_CONFLICT_WORK}';`
      );
      // Somebody else's write lands on the row the board already rendered —
      // there is no product control for this, so it is forced from behind.
      psql(`UPDATE fulfillment_works SET version = version + 1 WHERE id = '${BOARD_CONFLICT_WORK}';`);

      const select = card.getByRole('combobox', { name: /move to/i });
      if ((await select.count()) > 0) {
        await select.selectOption(BOARD_CONFLICT_PACKER);
        await page.waitForTimeout(1200);
      }
    },
    async check(page) {
      try {
        const conflictToast = page
          .locator('.toast__description')
          .filter({ hasText: /somebody changed this task first/i });
        if ((await conflictToast.count()) > 0) return true;
        const succeeded = await page.getByText('Task moved.').count();
        return succeeded > 0
          ? 'the stale move went through and was toasted as a success'
          : 'no conflict toast appeared for the stale move';
      } finally {
        if (boardConflictOriginalVersion !== null) {
          psql(
            `UPDATE fulfillment_works SET version = ${boardConflictOriginalVersion} ` +
              `WHERE id = '${BOARD_CONFLICT_WORK}';`
          );
          boardConflictOriginalVersion = null;
        }
      }
    },
  },
];

async function signIn(browser, actor, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Username or email').fill(ACTORS[actor].user);
  await page.getByPlaceholder('Enter your password').fill(ACTORS[actor].pass);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(2000);
  return { ctx, page };
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const results = [];

for (const state of STATES) {
  if (ONLY !== null && state.group !== ONLY) continue;

  if (state.pending !== undefined) {
    console.log(`  pending  ${state.id} — waiting on ${state.pending}`);
    results.push({ ...state, outcome: 'pending' });
    continue;
  }

  const { ctx, page } = await signIn(browser, state.actor, state.viewport ?? DESKTOP);
  let outcome = 'ok';
  let detail = '';
  try {
    await state.reach(page);
    const verdict = await state.check(page);
    if (verdict !== true) {
      outcome = 'failed';
      detail = String(verdict);
    }
  } catch (error) {
    outcome = 'error';
    detail = error instanceof Error ? error.message : String(error);
  }
  // A screenshot must never decide the run. A `fullPage` capture waits for
  // fonts and can time out on a long board, and losing every later state's
  // verdict to a missing picture is the wrong trade — the assertion above is
  // the evidence, the picture is the illustration.
  const shot = `${OUT}/${state.id}.png`;
  let shotTaken = true;
  try {
    await page.screenshot({ path: shot, fullPage: true, timeout: 15_000 });
  } catch {
    shotTaken = false;
  }
  await ctx.close();

  console.log(
    `  ${outcome === 'ok' ? 'ok     ' : outcome.toUpperCase().padEnd(7)} ${state.id}${detail ? ` — ${detail}` : ''}`
  );
  results.push({
    id: state.id,
    group: state.group,
    actor: state.actor,
    title: state.title,
    outcome,
    detail,
    screenshot: shotTaken ? shot : null,
  });
}

await browser.close();
await writeFile(`${OUT}/manifest.json`, JSON.stringify(results, null, 2));

const tally = results.reduce((acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }), {});
console.log(`\n  ${JSON.stringify(tally)}`);
console.log(`  manifest: ${OUT}/manifest.json`);
if ((tally.failed ?? 0) + (tally.error ?? 0) > 0) process.exitCode = 1;
