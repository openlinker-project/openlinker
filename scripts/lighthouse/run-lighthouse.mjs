#!/usr/bin/env node
/**
 * Lighthouse CI runner (#2866)
 *
 * Audits a fixed, named set of authenticated `apps/web` routes against a
 * built `dist` served by `vite preview`, backed by the dependency-free
 * stub in `mock-api-server.mjs` (never a live dev/demo stack — see that
 * file's header for why). Each route is run REPEAT_RUNS times and the
 * MEDIAN score per category is compared against a committed baseline;
 * a category score falling more than REGRESSION_THRESHOLD below its
 * baseline fails the process.
 *
 * This is a floor-measuring harness, not a lab: it runs on whatever
 * machine invokes it, alongside whatever else is running there. A run
 * records `hostContended: true` when other containers were observed
 * consuming CPU during the measurement window, so a reader does not
 * mistake a contended score for the artifact's ceiling.
 *
 * Usage:
 *   node scripts/lighthouse/run-lighthouse.mjs                  # check against baseline, exit 1 on regression
 *   node scripts/lighthouse/run-lighthouse.mjs --update-baseline # write a fresh baseline and exit 0
 *
 * Wiring: this script BUILDS `apps/web/dist` itself, with `VITE_API_BASE_URL`
 * pointed at the mock API port — never trusting a pre-existing `dist`.
 * `apps/web`'s default `VITE_API_BASE_URL` (unset -> `http://localhost:3000`,
 * see `apps/web/src/shared/config/env.ts`) happens to be a port real
 * `apps/api` instances on this kind of shared host commonly bind — a dist
 * built by an unrelated step (e.g. `check-bundle-budgets.mjs`, which builds
 * with no override) will silently point Lighthouse's traffic at WHATEVER is
 * listening on :3000. That happened once while building this harness: a
 * stale default-built `dist` sent a handful of GET requests to another
 * stack's live API before the mismatch was caught. Building here, always
 * with the override, makes that class of leak structurally impossible
 * rather than a discipline every caller must remember.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * lighthouse's bundled chrome-launcher fails silently ("Unable to connect
 * to Chrome") on this machine with no `CHROME_PATH` set, even with Chrome
 * installed — resolved by pointing it at whichever Chrome/Chromium binary
 * is actually on PATH. Tried in this order because it is the order this
 * repo's tooling installs them: a system Chrome (common on GitHub-hosted
 * `ubuntu-latest` runners), then Playwright's own bundled Chromium (which
 * `apps/web`'s devDependencies already pull in for e2e).
 */
function resolveChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const bin of ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium']) {
    const found = spawnSync('command', ['-v', bin], { shell: '/bin/bash' });
    const path = found.stdout?.toString().trim();
    if (path) return path;
  }
  try {
    // Playwright's own resolution, if @playwright/test is reachable from here.
    const { chromium } = require('@playwright/test');
    return chromium.executablePath();
  } catch {
    return undefined;
  }
}

const CHROME_PATH = resolveChromePath();

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB_DIR = join(ROOT, 'apps', 'web');
const BASELINE_PATH = join(ROOT, 'scripts', 'lighthouse', 'baseline.json');

const PREVIEW_PORT = 4173;
const MOCK_API_PORT = 4174;
const PREVIEW_BASE = `http://localhost:${PREVIEW_PORT}`;

// Named authenticated route set (#2866 AC1). Chosen from #2840's own named
// facts (`/products` is explicitly measured there) plus `/orders` (the
// other commercial list) and `/connections` (the unpaginated read #2840
// names directly). `/` (the analytics landing page) and `/settings` were
// tried and DROPPED — both crash under this harness's generic stub (a
// `.length` read with no optional chaining), which the harness's own
// smoke-check step caught. That is a real, if narrow, defect surface —
// filed as a follow-up rather than worked around by widening the stub
// per-page, which would start modelling real domain shapes here.
const ROUTES = [
  { path: '/orders', label: 'orders-list' },
  { path: '/products', label: 'products-list' },
  { path: '/connections', label: 'connections-list' },
];

const REPEAT_RUNS = 3;
const REGRESSION_THRESHOLD = 0.05; // 5 percentage points of Lighthouse score (0-1 scale)

function run(cmd, args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: opts.stdio ?? 'pipe', ...opts });
    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', (d) => (stdout += d));
    if (child.stderr) child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${stderr}`));
    });
    child.on('error', reject);
  });
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Samples whole-host container CPU so a contended run says so. Best-effort. */
async function sampleHostContention() {
  try {
    const { stdout } = await run('docker', [
      'stats',
      '--no-stream',
      '--format',
      '{{.Name}} {{.CPUPerc}}',
    ]);
    const lines = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [name, cpu] = l.split(/\s+/);
        return { name, cpuPercent: parseFloat(cpu) };
      });
    return lines;
  } catch {
    return null; // no docker, or nothing running — not an error for this harness
  }
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return true;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error(`server at ${url} did not become ready within ${timeoutMs}ms`);
}

async function runLighthouseOnce(url) {
  // Lighthouse is invoked via npx rather than added as a workspace
  // dependency, deliberately — see the report for why (keeps the
  // workspace install path untouched; npx caches after first fetch).
  const outFile = join(ROOT, 'scripts', 'lighthouse', `.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  // A dedicated Chrome profile dir per run, explicitly passed. On this WSL
  // host, chrome-launcher's own temp-dir default left a *literal* directory
  // named `C:\Users\...\lighthouse.NNNNN` in the repo's cwd on every single
  // invocation (not just failures) — a WSL/chrome-launcher interaction, not
  // anything this script does. Passing `--user-data-dir` explicitly bypasses
  // that default entirely; `cwd: tmpdir()` below is the second, independent
  // layer so a future chrome-launcher version choosing a different bogus
  // relative path still lands outside the repo rather than inside it.
  const profileDir = join(tmpdir(), `lighthouse-profile-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await run('npx', [
    '--yes',
    'lighthouse@12.8.2',
    url,
    '--output=json',
    `--output-path=${outFile}`,
    `--chrome-flags=--headless=new --no-sandbox --disable-gpu --user-data-dir=${profileDir}`,
    '--only-categories=performance,accessibility,best-practices,seo',
    '--quiet',
  ], {
    cwd: tmpdir(),
    env: { ...process.env, ...(CHROME_PATH ? { CHROME_PATH } : {}) },
  });
  try {
    rmSync(profileDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
  const report = JSON.parse(readFileSync(outFile, 'utf8'));
  return {
    performance: report.categories.performance?.score ?? null,
    accessibility: report.categories.accessibility?.score ?? null,
    'best-practices': report.categories['best-practices']?.score ?? null,
    seo: report.categories.seo?.score ?? null,
    // Raw timing metrics for the "request count / time before content" AC —
    // these are informational, not gated.
    metrics: {
      firstContentfulPaintMs: report.audits['first-contentful-paint']?.numericValue ?? null,
      largestContentfulPaintMs: report.audits['largest-contentful-paint']?.numericValue ?? null,
      timeToInteractiveMs: report.audits['interactive']?.numericValue ?? null,
      totalBlockingTimeMs: report.audits['total-blocking-time']?.numericValue ?? null,
      numRequests: report.audits['network-requests']?.details?.items?.length ?? null,
    },
    _outFile: outFile,
  };
}

async function main() {
  const updateBaseline = process.argv.includes('--update-baseline');

  console.log(`[lighthouse] building apps/web with VITE_API_BASE_URL=http://localhost:${MOCK_API_PORT}...`);
  await run('pnpm', ['exec', 'vite', 'build'], {
    cwd: WEB_DIR,
    env: { ...process.env, VITE_API_BASE_URL: `http://localhost:${MOCK_API_PORT}` },
  });

  console.log('[lighthouse] starting mock API server...');
  const mockApi = spawn('node', [join(ROOT, 'scripts', 'lighthouse', 'mock-api-server.mjs')], {
    env: { ...process.env, LH_MOCK_API_PORT: String(MOCK_API_PORT), LH_MOCK_ORIGIN: PREVIEW_BASE },
    stdio: 'ignore',
  });

  console.log('[lighthouse] starting `vite preview` on apps/web/dist...');
  const preview = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], {
    cwd: WEB_DIR,
    stdio: 'ignore',
  });

  try {
    await waitForServer(`${PREVIEW_BASE}/`);
    await waitForServer(`http://localhost:${MOCK_API_PORT}/v1/auth/me`);

    const contention = await sampleHostContention();
    const hostContended = Array.isArray(contention) && contention.length > 0;
    if (hostContended) {
      console.log(
        `[lighthouse] host contention detected: ${contention.length} container(s) running ` +
          `(e.g. ${contention.slice(0, 3).map((c) => `${c.name}:${c.cpuPercent}%`).join(', ')}). ` +
          'Scores below are a FLOOR, not this bundle\'s ceiling.',
      );
    } else {
      console.log('[lighthouse] no other containers observed (or docker unavailable) during the run.');
    }

    const results = {};
    for (const route of ROUTES) {
      const url = `${PREVIEW_BASE}${route.path}`;
      console.log(`\n[lighthouse] auditing ${route.label} (${url}), ${REPEAT_RUNS} runs...`);
      const runs = [];
      for (let i = 0; i < REPEAT_RUNS; i++) {
        const r = await runLighthouseOnce(url);
        runs.push(r);
        console.log(
          `  run ${i + 1}/${REPEAT_RUNS}: perf=${r.performance} a11y=${r.accessibility} ` +
            `bp=${r['best-practices']} seo=${r.seo} FCP=${Math.round(r.metrics.firstContentfulPaintMs ?? -1)}ms`,
        );
        try {
          const { unlinkSync } = await import('node:fs');
          unlinkSync(r._outFile);
        } catch {
          /* best-effort cleanup */
        }
      }
      const categories = ['performance', 'accessibility', 'best-practices', 'seo'];
      const summary = { runs: runs.length };
      for (const cat of categories) {
        const scores = runs.map((r) => r[cat]).filter((s) => s !== null);
        summary[cat] = {
          median: median(scores),
          min: Math.min(...scores),
          max: Math.max(...scores),
          spread: Math.max(...scores) - Math.min(...scores),
        };
      }
      summary.metrics = {
        firstContentfulPaintMsMedian: median(runs.map((r) => r.metrics.firstContentfulPaintMs)),
        largestContentfulPaintMsMedian: median(runs.map((r) => r.metrics.largestContentfulPaintMs)),
        totalBlockingTimeMsMedian: median(runs.map((r) => r.metrics.totalBlockingTimeMs)),
        numRequestsMedian: median(runs.map((r) => r.metrics.numRequests)),
      };
      results[route.label] = summary;
    }

    const output = {
      generatedAt: new Date().toISOString(),
      hostContended,
      repeatRuns: REPEAT_RUNS,
      routes: results,
    };

    if (updateBaseline) {
      writeFileSync(BASELINE_PATH, JSON.stringify(output, null, 2) + '\n');
      console.log(`\n[lighthouse] baseline written to ${BASELINE_PATH}`);
      return;
    }

    if (!existsSync(BASELINE_PATH)) {
      console.error(`[lighthouse] no baseline at ${BASELINE_PATH} — run with --update-baseline first`);
      process.exitCode = 1;
      return;
    }

    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    let regressed = false;
    console.log('\n[lighthouse] comparing against baseline:');
    for (const route of ROUTES) {
      const label = route.label;
      const current = results[label];
      const base = baseline.routes?.[label];
      if (!base) {
        console.log(`  ${label}: no baseline entry — skipping comparison`);
        continue;
      }
      for (const cat of ['performance', 'accessibility', 'best-practices', 'seo']) {
        const curScore = current[cat].median;
        const baseScore = base[cat].median;
        const delta = curScore - baseScore;
        const status = delta < -REGRESSION_THRESHOLD ? 'REGRESSION' : 'ok';
        if (status === 'REGRESSION') regressed = true;
        console.log(
          `  ${status.padEnd(10)} ${label.padEnd(18)} ${cat.padEnd(16)} ${curScore.toFixed(2)} ` +
            `(baseline ${baseScore.toFixed(2)}, delta ${delta.toFixed(2)})`,
        );
      }
    }

    if (regressed) {
      console.error(
        `\n[lighthouse] FAILED — a category score dropped more than ${REGRESSION_THRESHOLD} below baseline.`,
      );
      process.exitCode = 1;
    } else {
      console.log('\n[lighthouse] all routes within threshold of baseline.');
    }

    writeFileSync(
      join(ROOT, 'scripts', 'lighthouse', 'last-run.json'),
      JSON.stringify(output, null, 2) + '\n',
    );
  } finally {
    mockApi.kill();
    preview.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
