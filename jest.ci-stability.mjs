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
 *  - `maxWorkers: 2` — absolute (not '50%'), so peak memory is deterministic
 *    regardless of the runner's core count.
 *  - `workerIdleMemoryLimit` — Jest recycles a worker once its heap crosses the
 *    ceiling, before the OS OOM-kills it. Tune down (e.g. '256MB') if a runner
 *    is tight.
 *
 * The cross-package fan-out itself is bounded separately by
 * `pnpm -r --workspace-concurrency=2` in the root `test:ci` script.
 */
export const ciStabilityConfig = {
  maxWorkers: 2,
  workerIdleMemoryLimit: '512MB',
};
