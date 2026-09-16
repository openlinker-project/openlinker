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
 *    regardless of the runner's core count, and resolved by the ONE resolver
 *    at the repo root (#3271) so prestashop and allegro cannot drift from the
 *    rest of the unit tier. See `jest.unit-workers.cjs` for the number, the
 *    8-CPU/24-GiB container fact behind it, and the local-vs-CI split.
 *
 *    This file briefly carried its own CI-only `8`, measured at
 *    prestashop 297.6 s -> 198.1 s and allegro 151.4 s -> 81.7 s. Those gains
 *    were real in isolation and are the reason the shared number is not 2; what
 *    they did not price in is the other three packages running beside them
 *    under `--workspace-concurrency`, which is the whole subject of the
 *    resolver's comment.
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
import { createRequire } from 'node:module';

const { resolveUnitTestWorkers } = createRequire(import.meta.url)('./jest.unit-workers.cjs');

export const ciStabilityConfig = {
  maxWorkers: resolveUnitTestWorkers(),
  workerIdleMemoryLimit: '512MB',
};
