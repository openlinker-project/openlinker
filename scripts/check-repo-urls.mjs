#!/usr/bin/env node
/**
 * Repo URL Drift Guard (#664 / #556 follow-up)
 *
 * Fails `pnpm lint` if any tracked file outside the historical-context
 * allowlist contains a forbidden repo-URL substring. Catches accidental
 * re-introductions of the personal-fork URL or the `your-org` placeholder
 * after PR #690 converged on a single canonical form.
 *
 * Scope:
 *   - `piotrswierzy/openlinker` — personal-fork URL; the live damage
 *     fixed in #556 / #690.
 *   - `your-org/openlinker` — README/CONTRIBUTING placeholder template
 *     URL flagged in #664; cleaned up in earlier PRs.
 *   - `SilkSoftwareHouse/openlinker` — pre-transfer URL; the repo
 *     transferred to `openlinker-project/openlinker` per #641. All live
 *     references were flipped in the same bulk-rename PR, so this
 *     pattern is forbidden going forward to catch drift back to the
 *     old slug.
 *
 * Allowlist policy: a file may keep a forbidden substring only when the
 * substring is an annotated historical reference (e.g., a plan / review
 * doc citing past state with a "tracked in #N" marker). Add a new entry
 * sparingly — the default answer to a violation is to fix the URL, not
 * extend the allowlist.
 *
 * Wired into `pnpm lint` via the root `check:invariants` chain.
 *
 * Exits non-zero on drift, with one line per violation to stderr.
 *
 * @module scripts
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const FORBIDDEN_PATTERNS = [
  'piotrswierzy/openlinker',
  'your-org/openlinker',
  'SilkSoftwareHouse/openlinker',
];

// Files allowed to contain forbidden substrings because they preserve a
// historical audit trail (annotated "tracked in #664" or describing
// past state). Keep this list tight — prefer fixing the URL over
// adding entries.
const ALLOWLIST = new Set([
  'docs/plans/implementation-plan-566-568-pr-template-and-codeowners.md',
  'docs/reviews/modularity-and-plugin-readiness-2026-05-09.md',
  // The script itself names the forbidden patterns in source comments
  // and string literals. Self-exclude so the guard can describe what
  // it guards.
  'scripts/check-repo-urls.mjs',
]);

// Directories to skip during the walk. The walk is filesystem-based
// rather than git-based because the CI runner that invokes
// `pnpm lint` does not have `git` on its PATH (the workflow checks
// the tree out and then runs lint in a context where the binary
// isn't required for anything else). A pure-fs walk keeps the
// invariant working in both local and CI environments.
const SKIP_DIRS = new Set([
  '.git',
  '.claude',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.vite',
  '.turbo',
  '.cache',
  '.pnpm-store',
  '.husky',
]);

// File extensions that are almost certainly binary and not worth
// scanning. Keeping this list small — the readFile + UTF-8 decode
// catches the rest cheaply, and including a text file by accident
// only costs one extra millisecond.
const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.pdf', '.zip', '.tar', '.gz', '.tgz',
  '.lock',
]);

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name);
}

function shouldSkipFile(name) {
  const dotIdx = name.lastIndexOf('.');
  if (dotIdx === -1) return false;
  return SKIP_EXTENSIONS.has(name.slice(dotIdx).toLowerCase());
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      yield* walk(abs);
    } else if (entry.isFile()) {
      if (shouldSkipFile(entry.name)) continue;
      yield abs;
    }
  }
}

const violations = [];

for await (const abs of walk(ROOT)) {
  const rel = relative(ROOT, abs);
  if (ALLOWLIST.has(rel)) continue;

  let content;
  try {
    content = await readFile(abs, 'utf8');
  } catch {
    // Binary or unreadable — skip silently.
    continue;
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (!content.includes(pattern)) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(pattern)) {
        violations.push({ file: rel, line: i + 1, pattern });
      }
    }
  }
}

if (violations.length > 0) {
  process.stderr.write('check-repo-urls: forbidden URL substrings found\n');
  for (const v of violations) {
    process.stderr.write(`  ${v.file}:${v.line} — "${v.pattern}"\n`);
  }
  process.stderr.write(
    '\nFix the URL, or add the file to ALLOWLIST in scripts/check-repo-urls.mjs\n' +
      'if it intentionally preserves a historical reference.\n',
  );
  process.exit(1);
}

process.stdout.write(
  `check-repo-urls: OK (scanned ${FORBIDDEN_PATTERNS.length} pattern${
    FORBIDDEN_PATTERNS.length === 1 ? '' : 's'
  })\n`,
);
