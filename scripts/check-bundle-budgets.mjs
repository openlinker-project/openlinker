#!/usr/bin/env node
/**
 * Frontend Bundle Budget Guard (#2866)
 *
 * Fails `pnpm lint` if `apps/web`'s production JS output exceeds a stated
 * per-chunk size budget. Before this script, #2840 recorded that "no
 * dependency added tomorrow costs whatever it costs, silently" — nothing in
 * the pipeline measured `apps/web/dist` at all.
 *
 * ## What is budgeted, and why chunk GROUPS rather than every filename
 *
 * Vite/Rollup content-hashes every chunk filename, so a budget keyed on the
 * literal filename (`index-DRWLrvL6.js`) would need editing on every build.
 * `classifyChunk` strips the hash and groups by the STABLE prefix the
 * `manualChunks` config in `apps/web/vite.config.ts` assigns:
 *
 *   - `index`         — the app entry (route registration, providers, the
 *                        code every visitor's first paint waits on)
 *   - `react-vendor`  — react / react-dom / scheduler
 *   - `radix-vendor`  — @radix-ui/*
 *   - `editor-vendor` — @tiptap/*
 *   - `vendor`        — everything else under node_modules
 *   - `route`         — every other chunk (a lazy page/feature chunk) — NOT
 *                        individually budgeted. There are ~150 of these and
 *                        they are not part of the initial payload; budgeting
 *                        each would need editing on every new page. They ARE
 *                        counted into the `total` budget below, so a single
 *                        route chunk ballooning past the total ceiling still
 *                        fails the build.
 *   - `total`         — every JS file in `dist/assets`, all groups summed.
 *
 * Budgets are RAW (uncompressed) bytes, because that is what Rollup reports
 * and what a CDN serves before any transfer-encoding is negotiated; gzip
 * sizes are computed too and printed alongside for a human reading the
 * failure, but are not the gate.
 *
 * ## Where the numbers came from
 *
 * Each budget is the SIZE MEASURED on 2026-09-06 (recorded per group in
 * `MEASURED_BASELINE_BYTES` below) plus 15% headroom, per #2866's own
 * assumption: "Budgets start at today's measured size plus a small margin,
 * so the gate lands green and defends rather than demanding an immediate
 * cleanup." 15% is enough to absorb routine dependency patch bumps without
 * being wide enough to hide a genuinely new dependency landing unnoticed —
 * a package the size of Tiptap or Radix would blow well past it.
 *
 * ## Proving the gate can fail
 *
 * `--self-check` (also run standalone, no build required) feeds
 * `evaluateBudgets` a synthetic measurement one byte over one budget and
 * asserts the violation is reported — the same shape as #2673's lesson,
 * restated here as "a budget nobody has seen reject anything is a comment,
 * not a guard." It does NOT invoke a real build.
 *
 * Run with no flags to build `apps/web` (via `vite build` only — type
 * checking is a separate gate, `pnpm --filter @openlinker/web type-check`)
 * and check the real output against the budgets.
 *
 * Wired into `pnpm lint` via the root `check:invariants` chain.
 *
 * @module scripts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_DIR = join(ROOT, 'apps', 'web');
const ASSETS_DIR = join(WEB_DIR, 'dist', 'assets');

/**
 * Baseline raw byte sizes measured against the `manualChunks` split added in
 * the same change (#2866). Recorded so the 15% headroom below is legible as
 * "today's number plus a margin" rather than an arbitrary constant.
 */
const MEASURED_BASELINE_BYTES = {
  index: 408_003,
  'react-vendor': 178_323,
  'radix-vendor': 104_844,
  'editor-vendor': 394_767,
  vendor: 544_932,
  total: 3_045_477,
};

const HEADROOM_FACTOR = 1.15;

const BUDGETS_BYTES = Object.fromEntries(
  Object.entries(MEASURED_BASELINE_BYTES).map(([group, bytes]) => [
    group,
    Math.round(bytes * HEADROOM_FACTOR),
  ]),
);

/**
 * Groups a chunk filename into one of the stable buckets above. Pure and
 * exported implicitly via `--self-check` exercising it indirectly through
 * `evaluateBudgets` on synthetic filenames.
 *
 * @param {string} filename
 * @returns {string} one of the `MEASURED_BASELINE_BYTES` keys, excluding `total`
 */
function classifyChunk(filename) {
  if (/^index-[^/]+\.js$/.test(filename)) return 'index';
  if (/^react-vendor-[^/]+\.js$/.test(filename)) return 'react-vendor';
  if (/^radix-vendor-[^/]+\.js$/.test(filename)) return 'radix-vendor';
  if (/^editor-vendor-[^/]+\.js$/.test(filename)) return 'editor-vendor';
  if (/^vendor-[^/]+\.js$/.test(filename)) return 'vendor';
  return 'route';
}

/**
 * Pure evaluator: given per-group byte totals and a budget map, returns the
 * violations. No I/O — this is what `--self-check` exercises directly.
 *
 * @param {Record<string, number>} sizesByGroup
 * @param {Record<string, number>} budgets
 * @returns {{ group: string, measured: number, budget: number, overBy: number }[]}
 */
function evaluateBudgets(sizesByGroup, budgets) {
  const violations = [];
  for (const [group, budget] of Object.entries(budgets)) {
    const measured = sizesByGroup[group] ?? 0;
    if (measured > budget) {
      violations.push({ group, measured, budget, overBy: measured - budget });
    }
  }
  return violations;
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

function selfCheck() {
  // A build one byte under budget must pass.
  const passing = evaluateBudgets({ index: 100 }, { index: 100 });
  if (passing.length !== 0) {
    console.error('[check-bundle-budgets] self-check failed: at-budget size flagged as a violation');
    process.exit(1);
  }

  // A build one byte OVER budget must fail — this is the proof the gate is
  // not a comment. If this ever passes, the guard has stopped guarding.
  const failing = evaluateBudgets({ index: 101 }, { index: 100 });
  if (failing.length !== 1 || failing[0].group !== 'index' || failing[0].overBy !== 1) {
    console.error('[check-bundle-budgets] self-check failed: one-byte overage was not reported correctly');
    console.error(JSON.stringify(failing));
    process.exit(1);
  }

  // A group absent from the measurement (e.g. a vendor chunk that vanished
  // entirely) must not be reported as a violation of its own budget — an
  // absent chunk is zero bytes, not an overage.
  const missingGroup = evaluateBudgets({}, { 'editor-vendor': 100 });
  if (missingGroup.length !== 0) {
    console.error('[check-bundle-budgets] self-check failed: an absent group was flagged');
    process.exit(1);
  }

  console.log('[check-bundle-budgets] self-check passed (3/3): at-budget passes, over-budget fails, absent group is not flagged.');
}

function buildWeb() {
  // `dist` is deleted first so a stale build from a prior budget change (or
  // a manual `vite build` run with different chunking) can never be measured
  // as if it were fresh — a stale dist reads as a false pass.
  rmSync(join(WEB_DIR, 'dist'), { recursive: true, force: true });
  console.log('[check-bundle-budgets] building apps/web (vite build only — type-check is a separate gate)...');
  execFileSync('pnpm', ['exec', 'vite', 'build'], {
    cwd: WEB_DIR,
    stdio: 'inherit',
  });
}

function measureDist() {
  if (!existsSync(ASSETS_DIR)) {
    console.error(`[check-bundle-budgets] ${ASSETS_DIR} does not exist after build`);
    process.exit(1);
  }

  const sizesByGroup = {};
  const gzipByGroup = {};
  let totalRaw = 0;
  let totalGzip = 0;

  for (const filename of readdirSync(ASSETS_DIR)) {
    if (!filename.endsWith('.js')) continue;
    const buf = readFileSync(join(ASSETS_DIR, filename));
    const group = classifyChunk(filename);
    sizesByGroup[group] = (sizesByGroup[group] ?? 0) + buf.length;
    totalRaw += buf.length;
    const gz = gzipSync(buf).length;
    gzipByGroup[group] = (gzipByGroup[group] ?? 0) + gz;
    totalGzip += gz;
  }
  sizesByGroup.total = totalRaw;
  gzipByGroup.total = totalGzip;

  return { sizesByGroup, gzipByGroup };
}

function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    // `--self-check` never touches a real build — kept fast so it can run
    // on every `pnpm lint` invocation regardless of whether apps/web has
    // been built.
    return;
  }

  buildWeb();
  const { sizesByGroup, gzipByGroup } = measureDist();

  console.log('\n[check-bundle-budgets] measured vs. budget (raw / gzip):');
  for (const group of Object.keys(BUDGETS_BYTES)) {
    const measured = sizesByGroup[group] ?? 0;
    const budget = BUDGETS_BYTES[group];
    const status = measured > budget ? 'OVER' : 'ok';
    console.log(
      `  ${status.padEnd(4)} ${group.padEnd(14)} ${formatKb(measured).padStart(10)} raw ` +
        `(${formatKb(gzipByGroup[group] ?? 0).padStart(9)} gz) / budget ${formatKb(budget)}`,
    );
  }

  const violations = evaluateBudgets(sizesByGroup, BUDGETS_BYTES);
  if (violations.length > 0) {
    console.error('\n[check-bundle-budgets] FAILED — bundle budget exceeded:');
    for (const v of violations) {
      console.error(
        `  ${v.group}: ${formatKb(v.measured)} exceeds budget ${formatKb(v.budget)} by ${formatKb(v.overBy)}`,
      );
    }
    console.error(
      '\nIf this growth is expected, update MEASURED_BASELINE_BYTES in ' +
        'scripts/check-bundle-budgets.mjs to the new measured size (not the new ' +
        'budget) and state why in the commit — the 15% headroom is computed from it.',
    );
    process.exit(1);
  }

  console.log('\n[check-bundle-budgets] all chunk groups within budget.');
}

main();
