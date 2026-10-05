/**
 * The guard that stops an empty run reading as success, guarded itself.
 *
 * This file exists because the reporter shipped INERT and nothing noticed: it
 * counted every executed test, `auth.setup.ts` always runs (every browser
 * project declares `dependencies: ['setup']`, and the workflow passes
 * `--project=setup` besides), so `executed >= 1` on any green run and the
 * reporter could never fire for the project it was written for.
 *
 * A reporter is a thing that reports about tests; leaving it the one piece of
 * the suite with no test of its own is how that happened.
 */
import { describe, expect, it } from 'vitest';
import RequireExecutedReporter, { projectNameOf } from './require-executed.reporter';
import type { FullResult, TestCase, TestResult } from '@playwright/test/reporter';

function testIn(project: string): TestCase {
  return { parent: { project: () => ({ name: project }) } } as unknown as TestCase;
}

function resultOf(status: TestResult['status']): TestResult {
  return { status } as TestResult;
}

const PASSED = { status: 'passed' } as FullResult;

function reporter(enabled: boolean): RequireExecutedReporter {
  process.env['E2E_REQUIRE_EXECUTED'] = enabled ? 'true' : '';
  return new RequireExecutedReporter();
}

describe('RequireExecutedReporter', () => {
  // THE REGRESSION. Reproduces the exact shape of a real workflow invocation:
  // `--project=setup --project=subiekt` with the opt-in flag unset, so the
  // login runs and every subiekt test skips.
  it('fails a run in which only the SETUP project executed', async () => {
    const r = reporter(true);
    r.onTestEnd(testIn('setup'), resultOf('passed'));
    for (let i = 0; i < 13; i += 1) r.onTestEnd(testIn('subiekt'), resultOf('skipped'));

    await expect(r.onEnd(PASSED)).resolves.toEqual({ status: 'failed' });
  });

  it('passes when a chosen project actually executed something', async () => {
    const r = reporter(true);
    r.onTestEnd(testIn('setup'), resultOf('passed'));
    r.onTestEnd(testIn('subiekt'), resultOf('passed'));
    r.onTestEnd(testIn('subiekt'), resultOf('skipped'));

    await expect(r.onEnd(PASSED)).resolves.toBeUndefined();
  });

  // A developer running one project locally to check a fixture is not doing
  // anything wrong when it all skips. A reporter that failed their terminal
  // would be switched off within a day.
  it('does nothing at all when the opt-in is unset', async () => {
    const r = reporter(false);
    r.onTestEnd(testIn('subiekt'), resultOf('skipped'));

    await expect(r.onEnd(PASSED)).resolves.toBeUndefined();
  });

  // A run that already failed keeps its own reason, which says more than this
  // one does.
  it('never turns a FAILED run into its own verdict', async () => {
    const r = reporter(true);
    r.onTestEnd(testIn('subiekt'), resultOf('skipped'));

    await expect(r.onEnd({ status: 'failed' } as FullResult)).resolves.toBeUndefined();
  });

  it('reads the project name, and survives Playwright not supplying one', () => {
    expect(projectNameOf(testIn('subiekt'))).toBe('subiekt');
    expect(projectNameOf({ parent: undefined } as unknown as TestCase)).toBe('');
  });
});
