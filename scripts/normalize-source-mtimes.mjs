#!/usr/bin/env node
/**
 * normalize-source-mtimes.mjs (#3271)
 *
 * Stamps every git-tracked file with ONE fixed modification time.
 *
 * WHY. `actions/checkout` writes every file afresh on every run, so each CI run
 * sees brand-new mtimes even though the content is byte-identical to the last
 * run. Jest's transform-cache key is a function of BOTH the file's content and
 * its mtime, so fresh mtimes mint a complete new set of cache keys per run: the
 * previous run's entries can never be read again, and a new full set is written
 * beside them. Measured on the self-hosted runner, `libs/integrations/prestashop`
 * alone wrote 1030 new cache entries after a bare `touch` of `libs/core/**\/*.ts`
 * with no content change, and went from 76 s to 168 s. The runner containers'
 * `/tmp/jest_rt` had grown to 33 GB across ~2M unreadable files, because jest
 * applies no TTL, size cap or eviction to that directory - it only ever appends.
 *
 * Pinning one constant makes an unchanged file produce an unchanged key across
 * runs AND across branches, so the cache starts hitting and stops growing.
 *
 * WHY THIS IS SAFE. The key includes the content hash, so a changed file still
 * misses the cache even when its mtime and size are identical to the previous
 * version. Verified directly rather than assumed (#3271): replacing one word in
 * a source file, preserving its exact byte length, and rolling its mtime back to
 * the same stamp still failed 21 suites. mtime decides only whether jest
 * re-examines a file, never what it believes the file contains.
 *
 * WHY NOT DERIVE THE STAMP FROM GIT HISTORY. A per-file "last commit that
 * touched it" time (the `git-restore-mtime` approach) would also be stable, but
 * `actions/checkout` clones shallow by default, so there is no history to derive
 * it from - and it buys nothing here, because content already carries the
 * identity the key needs.
 *
 * Deliberately scoped to tracked files: everything under `node_modules` comes
 * from pnpm's content-addressed store and is not ours to restamp.
 *
 * @module scripts
 */

import { execFileSync } from 'node:child_process';
import { utimesSync, statSync } from 'node:fs';

/**
 * One fixed instant, in seconds since the epoch: 2020-01-01T00:00:00Z.
 *
 * The value itself is arbitrary; what matters is that it never changes, so two
 * runs of the same content agree. Never replace this with `Date.now()` or a
 * commit timestamp - either one reintroduces exactly the churn this exists to
 * remove.
 */
const FIXED_MTIME_SECONDS = 1577836800;

/**
 * Tracked files, or `null` when the VCS cannot answer.
 *
 * Some self-hosted runners carry no VCS binary at all — `actions/checkout` then
 * falls back to its tarball/API path and the checkout still succeeds (the same
 * condition the migration-ordering guard in this workflow already tolerates).
 * This step only ACCELERATES a build, so an unavailable binary must degrade to
 * a no-op, never fail the job.
 */
function listTrackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], {
      encoding: 'buffer',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .toString('utf8')
      .split('\0')
      .filter((entry) => entry.length > 0);
  } catch {
    return null;
  }
}

function main() {
  const files = listTrackedFiles();
  if (files === null) {
    console.log(
      'normalize-source-mtimes: version-control listing unavailable, skipping (jest cache runs cold)',
    );
    return;
  }
  let stamped = 0;
  let skipped = 0;

  for (const file of files) {
    try {
      // A tracked path can be absent from the working tree (sparse checkout) or
      // be a directory entry for a submodule; both are skipped rather than
      // failing the step, which must never break a build it only accelerates.
      if (!statSync(file).isFile()) {
        skipped += 1;
        continue;
      }
      utimesSync(file, FIXED_MTIME_SECONDS, FIXED_MTIME_SECONDS);
      stamped += 1;
    } catch {
      skipped += 1;
    }
  }

  console.log(
    `normalize-source-mtimes: stamped ${stamped} file(s) at ${new Date(
      FIXED_MTIME_SECONDS * 1000,
    ).toISOString()}${skipped > 0 ? `, skipped ${skipped}` : ''}`,
  );
}

main();
