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
 * Walks the working tree directly rather than asking the VCS for a file list -
 * some self-hosted runners carry no git binary, where `actions/checkout`
 * succeeds through its API path and any `git ls-files` call returns nothing.
 * `node_modules` is skipped: it comes from pnpm's content-addressed store and is
 * not ours to restamp.
 *
 * @module scripts
 */

import { readdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

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
 * Directories never descended into.
 *
 * `node_modules` is pnpm's content-addressed store and is not ours to restamp;
 * the rest are build output or VCS metadata that no transform reads.
 */
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'coverage', '.next', '.turbo']);

/**
 * Walks the working tree rather than asking the VCS for its file list.
 *
 * This deliberately does NOT shell out to `git ls-files` (#3271, second
 * attempt). Some self-hosted runners carry no git binary at all -
 * `actions/checkout` then succeeds through its tarball/API path, which is the
 * condition `ci.yml`'s migration-ordering guard already documents. The first
 * version of this script asked git for the list and degraded to a no-op when
 * git was absent: on the real runner it printed "version-control listing
 * unavailable" and stamped nothing, so the whole step was inert while reading
 * as successful. A filesystem walk has no such dependency.
 */
function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      yield* walk(join(dir, entry.name));
    } else if (entry.isFile()) {
      yield join(dir, entry.name);
    }
  }
}

function main() {
  let stamped = 0;
  let skipped = 0;

  for (const file of walk(process.cwd())) {
    try {
      utimesSync(file, FIXED_MTIME_SECONDS, FIXED_MTIME_SECONDS);
      stamped += 1;
    } catch {
      // A file can vanish or be read-only mid-walk. This step only ACCELERATES
      // a build, so it must never fail one.
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
