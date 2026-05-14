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
 *
 * The current canonical pre-transfer URL `SilkSoftwareHouse/openlinker`
 * is **deliberately not** watched here — bulk rename to the new org
 * happens in #641, and a watcher would require a 250+-file allowlist
 * today. Add it as a forbidden pattern in the #641 PR that flips every
 * live reference at once.
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
import { execSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const FORBIDDEN_PATTERNS = ['piotrswierzy/openlinker', 'your-org/openlinker'];

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

function trackedFiles() {
  const out = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

async function isReadableTextFile(absPath) {
  try {
    const s = await stat(absPath);
    return s.isFile();
  } catch {
    return false;
  }
}

const violations = [];

for (const rel of trackedFiles()) {
  if (ALLOWLIST.has(rel)) continue;
  const abs = resolve(ROOT, rel);
  if (!(await isReadableTextFile(abs))) continue;

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
