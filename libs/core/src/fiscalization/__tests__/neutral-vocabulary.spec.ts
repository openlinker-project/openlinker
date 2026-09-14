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
 * FILE COLLECTION is shared with the sibling sweeps (#3183); MATCHING is NOT,
 * and that is deliberate. All five terms above are rare enough as substrings
 * that a plain lowercased `.includes()` never produces a false positive here,
 * and `.includes()` catches one shape the siblings' three-pass matcher cannot:
 * a term followed immediately by a lowercase letter, i.e. an inflection or
 * plural in prose. The siblings cannot use `.includes()` because their own
 * extra terms are substrings of ordinary English. Adopting their matcher here
 * would therefore WEAKEN this sweep for no gain - so the two coexist, with the
 * exact difference recorded once, in the shared module.
 *
 * @module libs/core/src/fiscalization/__tests__
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { collectSweepFiles } from '../../__tests__/neutral-vocabulary-sweep';

const CONTEXT_ROOT = join(__dirname, '..');

/** Verbatim from ADR-042 decision 4, plus the sibling regime's name. */
const FORBIDDEN_TERMS = ['paragon', 'kasa', 'printer', 'eparagony', 'ksef'] as const;

describe('fiscalization neutral-vocabulary litmus (ADR-042 decision 4)', () => {
  const files = collectSweepFiles(CONTEXT_ROOT, { includeTests: true });

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
