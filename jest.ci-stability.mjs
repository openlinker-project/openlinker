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
 *    (#3271), and the raise is deliberately scoped to THIS file, i.e. to
 *    prestashop and allegro alone. Measured on the real runner, not a lab box:
 *    prestashop 297.6 s -> 198.1 s and allegro 151.4 s -> 81.7 s. The same
 *    raise applied to `libs/core`, `apps/api` and `apps/worker` was REVERTED —
 *    there it starved the package running beside it under
 *    `--workspace-concurrency=2` and took apps/api from 80.0 s to 163.0 s with
 *    an OOM SIGKILL on one suite. Those two packages are big enough to use
 *    eight workers; a package with a handful of test files is not, and only
 *    denies them to its co-runner. Do not lift this value into a shared
 *    default without measuring the package it would apply to.
 *
 *    OFF CI the value stays 2, because this file is also reached by
 *    `.husky/pre-commit` -> `pnpm smart-test`, which falls back to a bare
 *    `pnpm test` on a contributor's own machine.
 *  - `workerIdleMemoryLimit` — Jest recycles a worker once its heap crosses the
 *    ceiling, before the OS OOM-kills it. Tune down (e.g. '256MB') if a runner
 *    is tight.
 *
 * The cross-package fan-out itself is bounded separately in the root `test:ci`
 * script, which is now `--no-sort --workspace-concurrency=4` (#3271). The
 * bound was `2` for #976; `4` is pnpm's own default, so on its own it throttles
 * nothing — what actually protects the box is that `apps/web` moved to its own
 * CI job and every remaining package declares an absolute worker cap here or in
 * its own config. Raising either number again without re-measuring the WHOLE
 * job is how this went wrong three times; see `libs/core/jest.config.js`.
 */
export const ciStabilityConfig = {
  maxWorkers: process.env.CI ? 8 : 2,
  workerIdleMemoryLimit: '512MB',
};
