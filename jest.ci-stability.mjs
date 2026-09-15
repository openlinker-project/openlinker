/**
 * Shared Jest worker/memory caps for CI stability (#976).
 *
 * Heavy integration packages (prestashop, allegro) spread this into their
 * `jest.config.mjs` so the OOM-prevention policy lives in one place. Under the
 * full-suite `pnpm -r test` fan-out, each package's default ~(cores-1) workers
 * combined across packages could exhaust RAM on the self-hosted runner and
 * OOM-kill a worker (SIGKILL/exitCode=null), which looks identical to a real
 * test failure.
 *
 *  - `maxWorkers` — absolute (not '50%'), so peak memory is deterministic
 *    regardless of the runner's core count. Raised 2 -> 8 under CI only
 *    (#3271): the self-hosted runner is a 64-core / 251 GB box, and the whole
 *    job's measured peak RSS at 8 workers was 32.4 GB. The original `2` was
 *    sized against a fan-out where every package took jest's default
 *    `cores-1` — which on this machine is 63, not the handful assumed in
 *    #976. OFF CI the value stays 2, because this file is also reached by
 *    `.husky/pre-commit` -> `pnpm smart-test`, which falls back to a bare
 *    `pnpm test` on a contributor's own machine.
 *  - `workerIdleMemoryLimit` — Jest recycles a worker once its heap crosses the
 *    ceiling, before the OS OOM-kills it. Tune down (e.g. '256MB') if a runner
 *    is tight.
 *
 * The cross-package fan-out itself is bounded separately by
 * `pnpm -r --workspace-concurrency=2` in the root `test:ci` script. That `2`
 * is load-bearing and must not drift to `4`: pnpm's own default IS 4, so the
 * bound has to sit below it to throttle anything at all (see
 * `docs/testing-guide.md` and the #976 implementation plan). Measured cost of
 * keeping it while raising `maxWorkers`: 2-11% of wall time (#3271).
 */
export const ciStabilityConfig = {
  maxWorkers: process.env.CI ? 8 : 2,
  workerIdleMemoryLimit: '512MB',
};
