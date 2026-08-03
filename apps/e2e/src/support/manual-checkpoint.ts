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
 *   2. It blocks until the operator signals completion by creating a
 *      `<resumeDir>/resume` sentinel file. To record a failure, the operator
 *      writes `fail` into the sentinel (or creates a `<resumeDir>/fail` file)
 *      before resuming. The sentinel file is the ONLY resume mechanism —
 *      Playwright workers are child processes whose stdin is not the terminal,
 *      so a "press Enter" path can never fire.
 *   3. It records a pass/fail annotation in the Playwright HTML report so the
 *      attended run leaves a durable trail.
 *
 * Severity of a FAILED checkpoint (`severity`, default `observational`):
 *   - `observational` — record-only: annotated, never fails the test. Used for
 *     the external-dashboard confirmations (Allegro / Erli / InPost / KSeF). This
 *     matters because the suite runs `serial`: a checkpoint that FAILED its test
 *     would skip EVERY downstream segment (the purchase + S5-S9), so a "not
 *     active" / visual mismatch must be recorded, not fatal.
 *   - `soft` — recorded via `expect.soft`; fails the test at the end (kept for
 *     callers that want a non-blocking-but-reported assertion).
 *   - `fatal` — hard-fail immediately (e.g. the purchase pause — nothing
 *     downstream can run without it).
 *
 * `observational` keeps the serial run moving, but it must not let the RUN
 * report green: start an attended run, walk away, and every checkpoint waits out
 * its timeout, records a FAIL annotation, and the segments that depended on it
 * pass anyway. Every failed (or unanswered) checkpoint is therefore also
 * appended to a module-scoped ledger - `manualCheckpointFailures()` - that the
 * last test in the attended describe gates on. Module state is safe here for the
 * same reason it is in `shipments.ts`: the attended project runs `workers: 1`,
 * one Node process, serial.
 *
 * @module support
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type TestInfo } from '@playwright/test';

/** How a FAILED manual checkpoint affects the run. */
export const ManualCheckpointSeverityValues = ['observational', 'soft', 'fatal'] as const;
export type ManualCheckpointSeverity = (typeof ManualCheckpointSeverityValues)[number];

export interface ManualCheckpointOptions {
  /** Human name of the surface being confirmed, e.g. "Allegro seller panel". */
  dashboard: string;
  /** Optional URL printed in the checkpoint banner for the operator to open. */
  url?: string;
  /** Bullet list of what the operator must confirm. */
  expect: string[];
  /** Concrete expected values printed under the checklist (label → value). */
  values?: Record<string, unknown>;
  /**
   * How a failed checkpoint affects the run. Default `observational`
   * (record-only) so a failed external-dashboard confirmation never aborts the
   * downstream serial segments. Use `fatal` only when the run genuinely cannot
   * proceed (the purchase pause).
   */
  severity?: ManualCheckpointSeverity;
  /** Override the resume-sentinel directory (defaults to the env resumeDir). */
  resumeDir?: string;
  /** Max time to wait for the operator before giving up (ms). Default 30 min. */
  timeoutMs?: number;
}

const DEFAULT_RESUME_DIR = '.e2e';
const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const POLL_INTERVAL_MS = 500;

export interface ManualCheckpointResult {
  passed: boolean;
  note: string | null;
  /**
   * True when the wait expired with NO operator answer. Distinct from a
   * deliberate FAIL verdict: an unanswered checkpoint means nobody looked, so
   * the surface it guards is unverified rather than verified-and-wrong. Both
   * block the run at the terminal gate; only the reason differs.
   */
  timedOut: boolean;
}

/** One failed or unanswered checkpoint, for the run's terminal gate. */
export interface RecordedCheckpointFailure {
  dashboard: string;
  note: string | null;
  timedOut: boolean;
}

const recordedFailures: RecordedCheckpointFailure[] = [];

/**
 * Every checkpoint in this worker process that the operator FAILED or never
 * answered. The attended spec's last test asserts this is empty - without it an
 * `observational` checkpoint leaves nothing that can turn the run red.
 */
export function manualCheckpointFailures(): readonly RecordedCheckpointFailure[] {
  return recordedFailures;
}

/** Reset the ledger (for a spec that drives checkpoints across describes). */
export function clearManualCheckpointFailures(): void {
  recordedFailures.length = 0;
}

/**
 * Pause the attended run for a human visual confirmation. Returns the operator's
 * verdict and records it as a report annotation.
 */
export async function manualCheckpoint(
  testInfo: TestInfo,
  options: ManualCheckpointOptions,
): Promise<ManualCheckpointResult> {
  const resumeDir = resolve(options.resumeDir ?? process.env.E2E_RESUME_DIR ?? DEFAULT_RESUME_DIR);
  const resumeFile = resolve(resumeDir, 'resume');
  const failFile = resolve(resumeDir, 'fail');

  mkdirSync(resumeDir, { recursive: true });
  // Clear any stale sentinels from a previous checkpoint.
  rmSync(resumeFile, { force: true });
  rmSync(failFile, { force: true });

  printBanner(options, resumeFile, failFile);

  const verdict = await waitForResume(resumeFile, failFile, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const outcome = verdict.passed ? 'PASS' : verdict.timedOut ? 'UNANSWERED' : 'FAIL';
  const description = `${options.dashboard}: ${outcome}${verdict.note ? ` - ${verdict.note}` : ''}`;
  testInfo.annotations.push({
    type: verdict.passed
      ? 'manual-checkpoint-pass'
      : verdict.timedOut
        ? 'manual-checkpoint-unanswered'
        : 'manual-checkpoint-fail',
    description,
  });

  if (!verdict.passed) {
    // Recorded BEFORE the severity switch: a `fatal` checkpoint throws below, so
    // pushing afterwards would drop the one verdict that matters most from the
    // terminal gate's ledger.
    recordedFailures.push({
      dashboard: options.dashboard,
      note: verdict.note,
      timedOut: verdict.timedOut,
    });
    const severity: ManualCheckpointSeverity = options.severity ?? 'observational';
    if (severity === 'fatal') {
      expect(verdict.passed, description).toBe(true);
    } else if (severity === 'soft') {
      // Recorded on the test result (fails at the end), but the flow continues.
      expect.soft(verdict.passed, `Manual checkpoint failed — ${description}`).toBe(true);
    }
    // 'observational' → this segment stays green so downstream serial segments
    // still execute; the ledger above is what turns the RUN red at the gate.
  }

  return { passed: verdict.passed, note: verdict.note, timedOut: verdict.timedOut };
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
  lines.push('  To CONTINUE (pass): `touch ' + resumeFile + '`');
  lines.push('  To record a FAIL:   `echo reason > ' + failFile + '` (or write "fail …" into resume)');
  lines.push('════════════════════════════════════════════════════════════════════');
  lines.push('');
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

/**
 * Poll for the resume/fail sentinel until the operator responds or the timeout
 * elapses. Single mechanism — no stdin listener (worker stdin is not the
 * operator's terminal) and therefore no racing loops to cancel.
 */
async function waitForResume(
  resumeFile: string,
  failFile: string,
  timeoutMs: number,
): Promise<ManualCheckpointResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(failFile)) {
      const note = readNote(failFile);
      rmSync(failFile, { force: true });
      return { passed: false, note: note ?? 'fail sentinel', timedOut: false };
    }
    if (existsSync(resumeFile)) {
      const note = readNote(resumeFile);
      rmSync(resumeFile, { force: true });
      const failed = note !== null && /^fail/i.test(note);
      return { passed: !failed, note, timedOut: false };
    }
    await delay(POLL_INTERVAL_MS);
  }
  // Flagged, not just noted: "nobody answered" and "the operator looked and said
  // no" are different findings, and only the flag survives into the ledger.
  return {
    passed: false,
    note: `no operator answer within ${timeoutMs}ms - this surface was NOT looked at`,
    timedOut: true,
  };
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
