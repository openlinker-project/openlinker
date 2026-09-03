/**
 * Playwright configuration
 *
 * Projects:
 *   - `setup`        — logs in once, writes `.auth/admin.json` (auth artifact).
 *   - `smoke`        — read-only substrate proof (health + login + connections).
 *   - `golden-path`  — the S1-S4 operator-setup flow; serial (`workers: 1`) so
 *                      the mutating steps don't interleave.
 *   - `full-flow`    — the attended S0-S9 full golden path across all 6 systems;
 *                      serial, `retries: 0` (a re-run would double-mutate), driven
 *                      headed in a coordinated operator session.
 *   - `access-control` — demo mode, registration, RBAC, and UI-reflection checks.
 *                      Self-configuring (asserts correct-for-mode, skips otherwise);
 *                      independent of the golden-path projects. `retries: 1`
 *                      (idempotent: each run provisions a fresh unique viewer).
 *   - `webhooks`     — fires a real signed inbound webhook at the receiver
 *                      (`POST /webhooks/:provider/:connectionId`) and asserts
 *                      verify -> record -> enqueue -> dedup. Self-configuring
 *                      (skips when no PrestaShop connection is present).
 *                      `retries: 0` (rotates the secret + enqueues a job).
 *   - `woocommerce-parity` — WC as master catalogue, order destination,
 *                      customer/address reuse, variant mapping, inbound
 *                      webhooks, fulfillment-status read-back, and config
 *                      validation (#1571). Fully unattended — orders are
 *                      seeded via WC REST, not a live marketplace purchase.
 *                      Self-configuring per test (skips when the stack has no
 *                      WooCommerce connection with the relevant capability).
 *                      `retries: 0` — mutates WC-native state (orders,
 *                      webhook secrets, order status).
 *   - `shipping`     — unattended InPost shipping coverage (#1572): courier +
 *                      paczkomat labels, COD, declared-value insurance,
 *                      dispatch protocol, cancellation, routing matrix,
 *                      tracking backfill, inbound ShipX webhook (env-gated).
 *                      Reuses an existing `ready` order (no marketplace
 *                      purchase) — self-configuring, skips per-scenario when
 *                      the stack lacks the order/connection a test needs.
 *                      `retries: 0` (each spec dispatches real ShipX calls).
 *   - `invoicing`    — inFakt provider run, payment marking, bulk issue/resend/
 *                      e-mail, KOR corrections, FA(3) field parity + preview,
 *                      and Transfer bank accounts (#1573). Unattended — orders
 *                      are synthesized against PrestaShop's webservice, no
 *                      marketplace purchase. `retries: 0` (mutating).
 *   - `lifecycle`    — unattended order-lifecycle + inventory-resilience
 *                      coverage (#1574): webhook/poll idempotency, cross-
 *                      channel stock propagation + oversell safety, stale-
 *                      variant pruning (#1495). Self-configuring per spec.
 *                      `retries: 0` — the propagation/pruning specs mutate
 *                      real PrestaShop stock (propagation restores it in
 *                      `afterAll`; pruning is opt-in and irreversible).
 *   - `order-ingestion` - per-order ingestion behaviour against a real source
 *                      (#2277 currency). Mutating: synthesizes PrestaShop
 *                      orders through the webservice; `retries: 0`.
 *   - `orders`       - orders list/detail UI coverage (#2148). Read-only:
 *                      every spec narrows with URL params that cannot match and
 *                      asserts on copy and URL state. `retries: 1`.
 *   - `perf`         - resolve-step latency + progress measurement for the bulk
 *                      publish wizard (#2205). Every OL route the wizard touches
 *                      is stubbed in-test, so it needs no seeded catalogue and
 *                      runs on any stack. `retries: 1` (nothing is mutated).
 *   - `rich-text`    — adapter-declared description formats (#2201, ADR-046):
 *                      typing into a ProseMirror surface, paste-time schema
 *                      filtering, sanitized rendering, and one authored offer
 *                      published to the destination. The first three are
 *                      unreachable under jsdom AND happy-dom. Self-configuring;
 *                      `retries: 0` — the publish case creates a real offer.
 *   - `wizard-blockers` - category-blocker states in the same wizard (#2240):
 *                      which cause is reported, where the fix lives, and what
 *                      the confirmation says about variants that will not be
 *                      listed. Stubbed the same way, screenshots attached per
 *                      state. `retries: 1` (nothing is mutated).
 *
 * Reporters: html + list. Retries are per-project: read-only projects (setup,
 * smoke) retry once; the mutating golden-path project runs with `retries: 0` —
 * a silent retry would double-mutate the stack (publish twice, create offers
 * twice). Trace/video/screenshot retained on failure.
 *
 * @module playwright.config
 */
import { defineConfig, devices } from '@playwright/test';
import { resolveEnv } from './src/config/env';

const env = resolveEnv();

/** Shared browser session artifact written by the `setup` project. */
export const STORAGE_STATE = '.auth/admin.json';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  // Backstop, not the primary bound. Specs here chain several individually
  // bounded waits — job pollers (120 s), order ingestion (180 s), regulatory
  // clearance (300 s) — and a 90 s ceiling sat BELOW those budgets, so a test
  // that legitimately used its own allowance was aborted with a bare "Test
  // timeout exceeded" instead of the poller's diagnostic. Some (e.g. the
  // two-order customer-reuse case, which spends 2 x 240 s) could never pass at
  // all. Responsiveness does not depend on this value: every UI wait is capped
  // by `expect.timeout` / `actionTimeout` below, and every backend wait carries
  // its own `timeoutMs`, so a broken test still fails at the responsible step.
  timeout: 600_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: env.webUrl,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      retries: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'smoke',
      testMatch: /smoke\/.*\.spec\.ts/,
      retries: 1,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
    {
      // Mutating project — never retried (a retry would double-mutate).
      name: 'golden-path',
      testMatch: /golden-path\/operator-setup\.spec\.ts/,
      retries: 0,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
    {
      // Attended S0-S9 run. `retries: 0` — the flow mutates external systems, so
      // a silent retry would double-buy / double-issue. Run headed via
      // `--project=full-flow --headed`.
      name: 'full-flow',
      // One segment per file (`01-s0-…` … `16-…`), run in sorted path order by
      // the global `workers: 1` / `fullyParallel: false`. The numeric prefix —
      // not the S-number — is the running order: the purchase PAUSE sits
      // between S4 and S5, and the #1574 extensions follow S9.
      testMatch: /golden-path\/full-flow\/.*\.spec\.ts/,
      retries: 0,
      // The attended flow waits on worker jobs (up to 300 s), manual dashboard
      // checkpoints and the purchase pause — up to 2 hours PER purchase platform
      // (the `06-purchase-pause.spec.ts` segment), so a dual-purchase run can legitimately
      // sit for 4+ hours inside one test. No per-test timeout can bound that
      // without contradicting the checkpoint budgets, so the project runs
      // unbounded (attended semantics): every wait inside the test is itself
      // bounded — pollers, job waits, and each manualCheckpoint's timeoutMs —
      // so a hung run still fails at the responsible checkpoint, not silently.
      timeout: 0,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
    {
      // Real signed inbound-webhook receiver path (#1512) — independent of the
      // golden-path/full-flow projects. Depends only on `setup` for the admin
      // storageState (the spec rotates the connection's webhook secret and fires
      // a signed delivery via the node API client). `retries: 0` — a retry would
      // rotate the secret again and enqueue a second downstream job.
      name: 'webhooks',
      testMatch: /webhooks\/.*\.spec\.ts/,
      retries: 0,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
    {
      // WooCommerce parity (#1571) — mutating (seeds WC-native orders,
      // rotates the WC webhook secret, may create+disable a throwaway
      // connection in the config-validation checks). Serial within the
      // project (`workers: 1` global default already enforces this) so the
      // order-destination tests' customer/address-reuse assumptions about
      // per-test ordering hold.
      name: 'woocommerce-parity',
      testMatch: /woocommerce-parity\/.*\.spec\.ts/,
      retries: 0,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
    {
      // Order-lifecycle + inventory-resilience suite (#1574) — independent of
      // the golden-path/full-flow/webhooks projects. `retries: 0`: the
      // propagation spec mutates real PrestaShop stock (restored in
      // `afterAll`) and the pruning spec is destructive/irreversible by
      // design (opt-in via E2E_ALLOW_DESTRUCTIVE_PRUNE) — a silent retry
      // would double-mutate or attempt to re-delete an already-gone variant.
      name: 'lifecycle',
      testMatch: /lifecycle\/.*\.spec\.ts/,
      retries: 0,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
    {
      // Access-control coverage — independent of golden-path/full-flow. Depends
      // only on `setup` for the admin storageState the UI-reflection spec's
      // admin-session assertions consume; the viewer/guest browser cases build
      // their own fresh contexts. `retries: 1` is safe — every run provisions a
      // fresh, uniquely-named viewer (no double-mutation of shared state).
      name: 'access-control',
      testMatch: /access-control\/.*\.spec\.ts/,
      retries: 1,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
    {
      // Unattended InPost shipping coverage (#1572) — independent of the
      // golden-path/full-flow projects. `retries: 0`: each spec dispatches a
      // real ShipX label/cancel/protocol call, and a silent retry would
      // double-dispatch against the shared sandbox order.
      name: 'shipping',
      testMatch: /shipping\/.*\.spec\.ts/,
      retries: 0,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
    {
      // Invoicing suite (#1573) — inFakt provider run, payment marking (both
      // directions), bulk issue/resend/e-mail, KOR corrections, FA(3) field
      // parity + rebuilt preview, and Transfer bank accounts. Fully unattended:
      // orders are synthesized directly against PrestaShop's webservice (no
      // marketplace purchase, no manual pause). `retries: 0` — every scenario
      // mutates (issues/corrects/marks invoices, synthesizes orders), and a
      // silent retry would double-issue or double-correct.
      name: 'invoicing',
      testMatch: /invoicing\/.*\.spec\.ts/,
      retries: 0,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
    {
      // Orders list/detail UI coverage (#2148). Strictly READ-ONLY today — every
      // spec narrows with URL params that cannot match and asserts on copy and URL
      // state, so `retries: 1` is safe: a retry re-reads, it cannot re-apply an
      // effect. This project matches every `orders/*.spec.ts`, so a future spec
      // that mutates (dispatch, status change, …) must NOT be dropped in here
      // unmodified — give it its own project with `retries: 0`, matching the
      // `invoicing` project's precedent above.
      name: 'orders',
      testMatch: /orders\/.*\.spec\.ts/,
      retries: 1,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
    {
      // Order-ingestion behaviour asserted against a real source (#2277 — the
      // per-order currency). MUTATING: each spec synthesizes PrestaShop orders
      // through the webservice (customer, address, cart, order), so `retries: 0`
      // — a silent retry would create a second order and assert against the
      // wrong one. Deliberately NOT folded into `orders` above, whose
      // strictly-read-only contract that project's comment states; its regex
      // does not reach this directory.
      name: 'order-ingestion',
      testMatch: /order-ingestion\/.*\.spec\.ts/,
      retries: 0,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
    {
      // Resolve-step latency + progress measurement for the bulk publish wizard.
      // Read-only and non-mutating: the whole OL API surface the wizard touches
      // is stubbed in-test (`page.route`), with only `categories/resolve-stream`
      // carrying simulated latency derived from the production Allegro fan-out
      // cost model. Needs no Allegro connection and no seeded catalogue, so it
      // runs on any stack. `retries: 1` is safe (nothing is mutated), and the
      // longest scenario deliberately crosses the SPA's 30 s request timeout to
      // measure the retry amplification behind it.
      name: 'perf',
      testMatch: /perf\/.*\.spec\.ts/,
      retries: 1,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
    {
      // Rich-text description coverage (#2201, ADR-046). The only place typing
      // into a ProseMirror surface, paste-time schema filtering, and sanitized
      // rendering can be asserted at all - none of the three is reachable under
      // jsdom or happy-dom.
      //
      // `retries: 0`, following the `invoicing` precedent: the last case CREATES
      // AN OFFER on the destination, and a retry would create a second one. The
      // other cases are read-mostly (a description draft at most) and would be
      // safe to retry, but retry granularity is per project, and silently
      // duplicating a live listing is the worse failure - so the whole project
      // takes the strict setting rather than the convenient one.
      name: 'rich-text',
      testMatch: /rich-text\/.*\.spec\.ts/,
      retries: 0,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
    {
      // Category-blocker states in the bulk publish wizard (#2240). Every OL
      // route the wizard touches is stubbed in-test, so it needs no seeded
      // catalogue and no Allegro connection. `retries: 1` (nothing is mutated).
      name: 'wizard-blockers',
      testMatch: /wizard-blockers\/.*\.spec\.ts/,
      retries: 1,
      // No `setup` dependency and no shared storage state: the spec stubs the
      // session bootstrap along with every other route, so it needs only a
      // served web app. The states it pins are decided by resolve outcomes and
      // connection config - a real session would add a stack dependency without
      // making any assertion more truthful.
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Label-download failure-class mapping on the /shipments row accordion
      // (#2671). Every OL route the page touches is stubbed in-test, following
      // the `wizard-blockers` shape - no seeded stack, no shared auth artifact,
      // just a served web app. `retries: 1` (nothing is mutated; the download
      // call always fails by design).
      name: 'label-download-errors',
      testMatch: /label-download-errors\/.*\.spec\.ts/,
      retries: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Analytics mockup-parity: screenshots + content assertions comparing the
      // real, running /analytics page against the repo-committed mockup
      // (docs/plans/mockups/analytics-display-currency-picker.html), state by
      // state (#2482). MUTATING: synthesizes PrestaShop orders and, for the
      // currency-mismatch states, temporarily flips the system-wide reporting
      // currency (restored in `afterAll`) — never run this against a shared
      // stack another session is reading `/analytics` on. `retries: 0`: a
      // silent retry could re-flip the reporting currency mid-run.
      name: 'analytics',
      testMatch: /analytics\/.*\.spec\.ts/,
      retries: 0,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
  ],
});
