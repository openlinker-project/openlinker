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
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

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
  { id: 'bench-finish-no-dialog-when-printed', group: 'post-pack', pending: 'A4/A5' },
  { id: 'bench-finish-dialog-when-not-printed', group: 'post-pack', pending: 'A4/A5' },
  { id: 'bench-handed-over-leaves-the-queue', group: 'post-pack', pending: 'A4/A5' },
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
