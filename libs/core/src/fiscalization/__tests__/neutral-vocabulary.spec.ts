/**
 * Neutral-vocabulary litmus - regression guard
 *
 * ADR-042 decision 4 states the litmus test in exactly these terms: zero
 * `paragon` / `kasa` / `printer` / `eparagony` strings in
 * `libs/core/src/fiscalization`, covering FIELD NAMES and core reads, not only
 * prose. This spec is that sentence made executable, because the rule is one a
 * reviewer reads past easily and a first non-PL adapter would pay for.
 *
 * `ksef` is included too: it names the sibling clearance regime, and leaking it
 * here would blur precisely the boundary ADR-042 decision 1 draws between
 * fiscalization and invoicing.
 *
 * A regime-specific value legitimately reaches core as a neutral identity field
 * or as an opaque `regimeExtras` entry written by an adapter - never as a
 * column, a TypeScript property, or a key any code here indexes. So the ban is
 * on this directory's SOURCE, not on the data flowing through it.
 *
 * @module libs/core/src/fiscalization/__tests__
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const CONTEXT_ROOT = join(__dirname, '..');

/** Verbatim from ADR-042 decision 4, plus the sibling regime's name. */
const FORBIDDEN_TERMS = ['paragon', 'kasa', 'printer', 'eparagony', 'ksef'] as const;

function collectSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectSourceFiles(full));
      continue;
    }
    if (entry.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

describe('fiscalization neutral-vocabulary litmus (ADR-042 decision 4)', () => {
  const files = collectSourceFiles(CONTEXT_ROOT).filter(
    (file) => !file.endsWith('neutral-vocabulary.spec.ts'),
  );

  it('finds source files to check (guards against a silently empty sweep)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN_TERMS)(
    'never mentions the regime-specific term "%s"',
    (term) => {
      const offenders = files.filter((file) =>
        readFileSync(file, 'utf8').toLowerCase().includes(term),
      );
      expect(offenders.map((file) => relative(CONTEXT_ROOT, file))).toEqual([]);
    },
  );
});
