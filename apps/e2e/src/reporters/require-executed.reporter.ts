/**
 * Require-Executed Reporter
 *
 * Fails a run in which NOTHING executed (#3365).
 *
 * ## The problem this exists for
 *
 * The last live `subiekt` run produced `{"total": 15, "expected": 0,
 * "unexpected": 0, "flaky": 0, "skipped": 15, "ok": true}` - fifteen tests,
 * zero passed, fifteen skipped, and the run reported success. That is exactly
 * what Playwright is specified to do, and nothing downstream contradicted it:
 * the workflow uploads an artifact and parses no result file.
 *
 * Every spec in an opt-in project opens with `test.skip(!env.someFlag, ...)`.
 * So on any machine without the flag the whole project is INDISTINGUISHABLE
 * from a passing one - which is precisely how a suite comes to be cited as
 * evidence that something works while asserting nothing about it.
 *
 * ## What it does, and what it deliberately does not
 *
 * It fails when a run executed zero tests. It does NOT police the ratio, name
 * a minimum, or object to individual skips: a spec that skips because the
 * fixture it needs is genuinely absent is behaving correctly, and turning that
 * into a failure would push authors toward writing tests that pass vacuously
 * instead of skipping honestly. The line it draws is narrower and harder to
 * argue with - a run where nothing at all ran proves nothing at all.
 *
 * ## The `setup` project does not count, and that is the whole mechanism
 *
 * Every browser project declares `dependencies: ['setup']`, and the workflow
 * additionally passes `--project=setup` explicitly - so `auth.setup.ts` runs on
 * every invocation and always passes. Counting it makes `executed >= 1` on any
 * green run whatsoever, which is precisely how the first version of this
 * reporter shipped INERT: it could not fire for the project it was written for.
 *
 * So the count is scoped to the projects the operator actually chose. A run in
 * which only the scaffolding ran executed nothing that asserts anything.
 *
 * ## Opt-in, and why
 *
 * Active only under `E2E_REQUIRE_EXECUTED`. A developer running one project
 * locally to check a fixture is not doing anything wrong when it all skips,
 * and a reporter that failed their terminal would be turned off within a day.
 * CI sets it, because CI is where a green badge gets believed.
 *
 * @module apps/e2e/src/reporters
 */
import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';

/**
 * Projects that exist to make other projects runnable and assert nothing about
 * the product. A run consisting only of these has proved nothing.
 */
const SCAFFOLDING_PROJECTS = new Set(['setup']);

/** The project a test belongs to, or '' when Playwright cannot say. */
export function projectNameOf(test: Pick<TestCase, 'parent'>): string {
  return test.parent?.project()?.name ?? '';
}

export default class RequireExecutedReporter implements Reporter {
  private executed = 0;
  private skipped = 0;

  private get enabled(): boolean {
    return process.env['E2E_REQUIRE_EXECUTED']?.trim() === 'true';
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // Scaffolding is not evidence. See the header: counting it is what made the
    // first version of this reporter unable to fire at all.
    if (SCAFFOLDING_PROJECTS.has(projectNameOf(test))) return;
    if (result.status === 'skipped') {
      this.skipped += 1;
      return;
    }
    this.executed += 1;
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] } | void> {
    if (!this.enabled) return;
    await Promise.resolve();
    // Only ever turns a PASS into a failure. A run that already failed keeps
    // its own reason, which is more informative than this one.
    if (result.status !== 'passed') return;
    if (this.executed > 0) return;

    // eslint-disable-next-line no-console -- a reporter writes to the terminal by definition
    console.error(
      `\n✗ E2E_REQUIRE_EXECUTED: the run reported success and executed NOTHING ` +
        `(${this.skipped} skipped, 0 run).\n` +
        `  An opt-in project skips every test when its flag is unset, which is ` +
        `indistinguishable from a project that passed.\n` +
        `  For the \`subiekt\` project, set E2E_TEST_SUBIEKT=true and point the ` +
        `connection at a reachable Subiekt GT bridge.\n`,
    );
    return { status: 'failed' };
  }
}
