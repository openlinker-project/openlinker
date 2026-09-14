/**
 * Neutral-vocabulary sweep - shared mechanics (#3183)
 *
 * Three contexts run a "no regime-specific term appears in this directory's
 * source" litmus: `fiscalization` (ADR-042 decision 4), `sales-documents`
 * (ADR-041 decision 5) and `invoicing` (ADR-026, contract surface only). They
 * differ only in TERM LIST, whether tests are in scope, and whether comments
 * and string literals are stripped before matching. This module holds the
 * mechanics all three share so a fix applied to one cannot silently skip the
 * others - which is exactly how the leading-segment hole below survived the
 * first port.
 *
 * NOT a spec file, so `libs/core/jest.config.js`'s `testRegex` (`.*\.spec\.ts$`)
 * never collects it as a suite. It lives outside every context directory, so
 * no context's own sweep scans it either - which is also what lets the worked
 * examples below be spelled out as literal text.
 *
 * Its own behaviour is pinned by `neutral-vocabulary-sweep.spec.ts` beside it.
 * That spec is the only thing standing between the three passes below and the
 * silent coincidence that no forbidden term happens to take a shape a deleted
 * pass was the sole reader of.
 *
 * WHAT IS DELIBERATELY NOT SHARED: the matcher is used by `sales-documents` and
 * `invoicing` but NOT by `fiscalization`, which keeps a plain lowercased
 * `.includes()`. The two are not equivalent and unifying them would be a
 * behaviour change in one direction or the other - see
 * {@link matchForbiddenTerm}'s own note for the exact residual difference
 * and why resolving it is an owner decision rather than a refactor.
 *
 * @module libs/core/src/__tests__
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Each context's own sweep spec, relative to its root. Excluded because its
 * `FORBIDDEN_TERMS` array names every banned term, so sweeping it would flag
 * every context as an offender against itself.
 *
 * Matched as a full PATH under the context root rather than by bare filename:
 * a filename test skips any file anywhere in the tree that happens to carry
 * this name, which is a wider exemption than the reason for it supports, and
 * a real one the day a context grows a second, differently-scoped sweep beside
 * a fixture of the same name.
 */
const SWEEP_SPEC_RELATIVE_PATH = ['__tests__', 'neutral-vocabulary.spec.ts'] as const;

export interface SweepScope {
  /**
   * `true` sweeps every `.ts` file, tests included (`fiscalization`,
   * `sales-documents`); `false` restricts the sweep to production files, i.e.
   * the published contract surface (`invoicing` - its own doc comments
   * sanction regime-naming prose and realistic test fixtures).
   */
  readonly includeTests: boolean;
}

/**
 * Every `.ts` file under `contextRoot`, recursively, honouring `scope` and
 * always excluding the sweep spec itself (whose term list would otherwise
 * flag every file as an offender).
 */
export function collectSweepFiles(contextRoot: string, scope: SweepScope): string[] {
  // Resolved once against the ROOT, so the recursion below compares against the
  // one file the exemption is about rather than against a name.
  const ownSweepSpec = join(contextRoot, ...SWEEP_SPEC_RELATIVE_PATH);

  const walk = (dir: string): string[] => {
    const found: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        found.push(...walk(full));
        continue;
      }
      if (!entry.endsWith('.ts') || full === ownSweepSpec) {
        continue;
      }
      if (!scope.includeTests && (entry.endsWith('.spec.ts') || entry.endsWith('.int-spec.ts'))) {
        continue;
      }
      found.push(full);
    }
    return found;
  };

  return walk(contextRoot);
}

/**
 * Strips line comments, block comments, and every `'…'` / `"…"` / backtick
 * literal (escapes respected), replacing each with a single space so word
 * boundaries either side of a removed span are preserved. Textual, not a
 * TypeScript parse - the same zero-dependency convention every
 * `scripts/check-*.mjs` invariant already uses. Fails in the SAFE direction: a
 * regex literal reads as code, so it over-flags rather than under-flags.
 */
export function stripCommentsAndStringLiterals(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      out += ' ';
      i = end === -1 ? n : end + 2;
      continue;
    }
    const char = source[i];
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      let j = i + 1;
      while (j < n) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      out += ' ';
      i = j;
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}

/** Which of {@link matchForbiddenTerm}'s three passes saw the term. */
export type ForbiddenTermMatch = 'boundary' | 'leading' | 'hump';

/**
 * The pass that matched `term` in `text` - a standalone token, the LEADING
 * segment of a longer identifier, or a capitalized/all-caps "hump" inside one -
 * or `null` when none does.
 *
 * Reports WHICH pass rather than a bare boolean so each pass is separately
 * pinnable: three shapes are visible to exactly one pass each, and the sweeps'
 * own boolean could never tell a live pass from a deleted one.
 *
 * Why not a plain `.includes()`, the way `fiscalization` matches its own five
 * terms: those five are rare enough as substrings never to collide, but
 * `sales-documents`/`invoicing` add terms that are substrings of ordinary
 * English appearing throughout real code (`private`, `activate`,
 * `derivation`, `innovation`, `manipulate`, `principal`). A literal substring
 * ban on those would fail the build on prose; a plain `\b` ban alone would
 * miss a term embedded in an identifier, because a camelCase transition has no
 * non-word character at it. Hence three passes:
 *
 *   1. BOUNDARY, case-insensitive - a standalone mention in prose, a
 *      kebab/snake-case id, or a quoted literal.
 *   2. LEADING, case-SENSITIVE - the term opening an identifier, with the next
 *      segment's capital (or a digit/underscore) closing it: `ksefEnvironment`,
 *      `nipValue`, `VatRateResolver`, `paragonMode`. Pass 1 cannot see these
 *      (its `(?![a-zA-Z])` lookahead is blocked by the next segment's capital)
 *      and neither can pass 3 (its `(?<=[a-z])` lookbehind has nothing before
 *      an identifier's first character). This is the most likely real
 *      violation shape: `docs/frontend-architecture.md` recommends exactly this
 *      platform-prefixed naming for connection-config fields.
 *   3. HUMP, case-SENSITIVE - the term as a capitalized or all-caps segment
 *      inside a longer identifier, e.g. `buyerHasTaxId`'s regime-named
 *      counterpart or `orderTaxAmount`'s.
 *
 * Passes 2 and 3 must stay case-sensitive (a lowercase run is ordinary
 * English), and pass 1 must stay case-insensitive or a term named in prose
 * stops being caught.
 *
 * RESIDUAL DIFFERENCE vs `fiscalization`'s `.includes()`, stated so nobody
 * over-trusts this (the `check-ui-vocabulary.mjs` transparency convention):
 * a term followed immediately by a LOWERCASE letter is invisible here but
 * visible to `.includes()` - an inflection or plural such as a printer term
 * pluralised in prose. That is the price of not failing the build on
 * `private`/`manipulate`, and it is why the two matchers are still separate:
 * giving `fiscalization` this matcher would WEAKEN it for its own five terms,
 * while giving these two contexts `.includes()` would fail the build on
 * ordinary English. Reconciling them needs a per-term policy, which is an
 * owner decision, not a refactor.
 */
export function matchForbiddenTerm(text: string, term: string): ForbiddenTermMatch | null {
  const titled = term.charAt(0).toUpperCase() + term.slice(1);
  const allCaps = term.toUpperCase();

  const boundary = new RegExp(`(?<![a-zA-Z])${term}(?![a-zA-Z])`, 'i');
  if (boundary.test(text)) return 'boundary';

  const leading = new RegExp(`(?<![a-zA-Z])(?:${term}|${titled}|${allCaps})(?![a-z])`);
  if (leading.test(text)) return 'leading';

  const camelHump = new RegExp(`(?<=[a-z])(?:${titled}|${allCaps})(?![a-z])`);
  return camelHump.test(text) ? 'hump' : null;
}

/**
 * The three sweeps' own predicate: any pass matching is an offender.
 *
 * Kept as the consumed API so a sweep never has to care WHICH pass fired -
 * only `neutral-vocabulary-sweep.spec.ts` does, and it needs to, because a
 * boolean cannot distinguish "the boundary pass caught this" from "the leading
 * pass did" and therefore cannot fail when a pass is deleted.
 */
export function containsForbiddenTerm(text: string, term: string): boolean {
  return matchForbiddenTerm(text, term) !== null;
}

export interface SweepRead {
  /**
   * `true` narrows the sweep to the contract surface by removing comments and
   * string/template literals first (`invoicing`); `false` matches the raw
   * source, prose included (`fiscalization`, `sales-documents`).
   */
  readonly stripNonCode: boolean;
}

/** Reads `file`, honouring `read`. */
export function readSweepSource(file: string, read: SweepRead): string {
  const source = readFileSync(file, 'utf8');
  return read.stripNonCode ? stripCommentsAndStringLiterals(source) : source;
}
