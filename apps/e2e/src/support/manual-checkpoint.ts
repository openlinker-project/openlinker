/**
 * Manual checkpoint helper
 *
 * The golden path is *attended*: some verifications (Allegro / Erli / InPost /
 * KSeF dashboards, and the buyer purchase itself) cannot be automated against a
 * live sandbox, so a human confirms them visually. `manualCheckpoint` makes that
 * pause deterministic and auditable:
 *
 *   1. It prints the concrete expected values the operator should see (never a
 *      vague "check the dashboard").
 *   2. It blocks until the operator signals completion — by creating a
 *      `<resumeDir>/resume` sentinel file, or by pressing Enter in the terminal.
 *      To record a failure, the operator writes `fail` into the sentinel (or
 *      creates a `<resumeDir>/fail` file) before resuming.
 *   3. It records a pass/fail annotation in the Playwright HTML report so the
 *      attended run leaves a durable trail.
 *
 * A failed checkpoint is *soft* by default (annotated, non-fatal) so the run can
 * continue to later segments; pass `{ fatal: true }` to hard-fail instead.
 *
 * @module support
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';

export interface ManualCheckpointOptions {
  /** Human name of the surface being confirmed, e.g. "Allegro seller panel". */
  dashboard: string;
  /** Optional URL to open in a side tab for the operator's convenience. */
  url?: string;
  /** Bullet list of what the operator must confirm. */
  expect: string[];
  /** Concrete expected values printed under the checklist (label → value). */
  values?: Record<string, unknown>;
  /** Turn a failed checkpoint into a hard test failure. Default: soft. */
  fatal?: boolean;
  /** Override the resume-sentinel directory (defaults to the env resumeDir). */
  resumeDir?: string;
  /** Max time to wait for the operator before giving up (ms). Default 30 min. */
  timeoutMs?: number;
}

export interface ManualCheckpointDeps {
  /** Opens `options.url` in a fresh tab so the operator does not lose the run. */
  page?: Page;
}

const DEFAULT_RESUME_DIR = '.e2e';
const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const POLL_INTERVAL_MS = 500;

export interface ManualCheckpointResult {
  passed: boolean;
  note: string | null;
}

/**
 * Pause the attended run for a human visual confirmation. Returns the operator's
 * verdict and records it as a report annotation.
 */
export async function manualCheckpoint(
  testInfo: TestInfo,
  options: ManualCheckpointOptions,
  deps: ManualCheckpointDeps = {},
): Promise<ManualCheckpointResult> {
  const resumeDir = resolve(options.resumeDir ?? process.env.E2E_RESUME_DIR ?? DEFAULT_RESUME_DIR);
  const resumeFile = resolve(resumeDir, 'resume');
  const failFile = resolve(resumeDir, 'fail');

  mkdirSync(resumeDir, { recursive: true });
  // Clear any stale sentinels from a previous checkpoint.
  rmSync(resumeFile, { force: true });
  rmSync(failFile, { force: true });

  printBanner(options, resumeFile, failFile);

  if (options.url && deps.page) {
    const context = deps.page.context();
    const tab = await context.newPage();
    await tab.goto(options.url).catch(() => undefined);
  }

  const verdict = await waitForResume(resumeFile, failFile, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const description = `${options.dashboard}: ${verdict.passed ? 'PASS' : 'FAIL'}${
    verdict.note ? ` — ${verdict.note}` : ''
  }`;
  testInfo.annotations.push({
    type: verdict.passed ? 'manual-checkpoint-pass' : 'manual-checkpoint-fail',
    description,
  });

  if (!verdict.passed) {
    if (options.fatal) {
      expect(verdict.passed, description).toBe(true);
    } else {
      // Soft failure: mark the test as failed at the end without aborting the flow.
      testInfo.status = 'failed';
      testInfo.errors.push({ message: `Manual checkpoint failed — ${description}` });
    }
  }

  return { passed: verdict.passed, note: verdict.note };
}

function printBanner(
  options: ManualCheckpointOptions,
  resumeFile: string,
  failFile: string,
): void {
  const lines: string[] = [
    '',
    '════════════════════════════════════════════════════════════════════',
    `  MANUAL CHECKPOINT — ${options.dashboard}`,
    '════════════════════════════════════════════════════════════════════',
  ];
  if (options.url) lines.push(`  Open: ${options.url}`);
  lines.push('  Confirm:');
  for (const item of options.expect) lines.push(`    - ${item}`);
  if (options.values && Object.keys(options.values).length > 0) {
    lines.push('  Expected values:');
    for (const [key, value] of Object.entries(options.values)) {
      lines.push(`    ${key}: ${format(value)}`);
    }
  }
  lines.push('  --------------------------------------------------------------------');
  lines.push('  To CONTINUE (pass): press Enter, or `touch ' + resumeFile + '`');
  lines.push('  To record a FAIL:   `echo reason > ' + failFile + '` (or write to resume)');
  lines.push('════════════════════════════════════════════════════════════════════');
  lines.push('');
  // eslint-disable-next-line no-console -- attended-run operator prompt, not app logging
  console.log(lines.join('\n'));
}

function format(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

async function waitForResume(
  resumeFile: string,
  failFile: string,
  timeoutMs: number,
): Promise<ManualCheckpointResult> {
  const deadline = Date.now() + timeoutMs;

  const stdinResume = new Promise<ManualCheckpointResult>((resolvePromise) => {
    const onData = (): void => {
      cleanup();
      resolvePromise({ passed: true, note: 'resumed via Enter' });
    };
    const cleanup = (): void => {
      process.stdin.off('data', onData);
      try {
        process.stdin.pause();
      } catch {
        /* stdin may not be a TTY under CI — ignored */
      }
    };
    try {
      process.stdin.resume();
      process.stdin.once('data', onData);
    } catch {
      /* no interactive stdin — file sentinel is the only path */
    }
  });

  const filePoll = (async (): Promise<ManualCheckpointResult> => {
    while (Date.now() < deadline) {
      if (existsSync(failFile)) {
        const note = readNote(failFile);
        rmSync(failFile, { force: true });
        return { passed: false, note: note ?? 'fail sentinel' };
      }
      if (existsSync(resumeFile)) {
        const note = readNote(resumeFile);
        rmSync(resumeFile, { force: true });
        const failed = note !== null && /^fail/i.test(note);
        return { passed: !failed, note };
      }
      await delay(POLL_INTERVAL_MS);
    }
    return { passed: false, note: `timed out after ${timeoutMs}ms` };
  })();

  return Promise.race([stdinResume, filePoll]);
}

function readNote(file: string): string | null {
  try {
    const raw = readFileSync(file, 'utf8').trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
