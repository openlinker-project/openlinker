/**
 * Neutral-vocabulary litmus - regression guard (#3183)
 *
 * ADR-026 states the rule this concern's own doc comments already repeat
 * almost two dozen times, e.g. `invoicing.types.ts`'s own header: "Litmus
 * test: no `nip`/`ksef`/`vat`/`jpk`/`faktura` appears here" - and, more
 * precisely, `regulatory-resubmitter.capability.ts`: "the CONTRACT SURFACE -
 * interface name, method name, parameter/return types - carries no ...
 * vocabulary. The prose above names inFakt/KSeF only as illustrative
 * examples ...; those are documentation, not part of the type surface a
 * sibling context binds to." Before this spec neither statement was checked
 * by anything - `invoicing` had no equivalent of the sweep fiscalization
 * already runs (`libs/core/src/fiscalization/__tests__/neutral-vocabulary.spec.ts`,
 * ADR-042 decision 4), and this concern alone already carried roughly two
 * dozen `KSeF` mentions in prose when this spec was written.
 *
 * DELIBERATELY NARROWER than the sales-documents / fiscalization sweep
 * alongside this one. Those two ban a forbidden term ANYWHERE in the
 * directory, prose included, because neither concern's own documented rule
 * ever carved out an exception for illustrative prose. `invoicing` is
 * different: its own capability doc comments explicitly say prose naming a
 * real provider (inFakt, KSeF) is fine, and porting the wider sweep here
 * verbatim would fail the build on every one of those ~25 legitimate
 * mentions - a guard that overshoots its own context's documented contract is
 * worse than no guard, because the fix would be to delete explanatory prose
 * the ADR itself sanctions. So this guard enforces exactly what invoicing's
 * OWN rule already claims: the CONTRACT SURFACE, not the prose around it.
 *
 * "Contract surface" is operationalised as two restrictions, both required:
 *
 *   1. PRODUCTION FILES ONLY - `*.spec.ts` / `*.int-spec.ts` are excluded.
 *      A test file's job is to exercise realistic fixtures (a `pl-nip`
 *      tax-id scheme value, a `KSEF-9` clearance-reference fixture, an
 *      `'infakt'` connection id) and to document known adapter shapes by
 *      name - none of that is the published vocabulary a sibling context
 *      binds to. `invoicing.types.spec.ts` additionally carries its own
 *      narrower, COMPLEMENTARY guard - two `it()`s asserting the runtime
 *      VALUES of `DocumentTypeValues` / `InvoiceFailureCodeValues` carry no
 *      forbidden term - which this spec does not replace: that one checks
 *      literal string VALUES (which this spec's string-stripping pass
 *      below deliberately ignores in production files too - see point 2),
 *      this one checks declared IDENTIFIERS. Two different surfaces, two
 *      different mechanisms, kept side by side on purpose.
 *
 *   2. COMMENTS AND STRING/TEMPLATE LITERALS STRIPPED before matching, even
 *      within the production files that remain in scope. A `nip`/`vat`
 *      substring inside a JSDoc example, or inside an `as const` array's
 *      string VALUES (`DocumentTypeValues`, `InvoiceFailureCodeValues`, …),
 *      is documentation or data - never an interface, method, parameter or
 *      property NAME - so it is invisible to this pass by design (and is
 *      exactly what `invoicing.types.spec.ts`'s own value-level guard
 *      covers instead, per point 1).
 *
 * MATCHING, once comments/strings are stripped, still can't be a naive
 * substring test: `vat` is a substring of `private`/`derivation`/`activate`
 * and `nip` a substring of `manipulate`/`principal`, both of which are
 * ordinary words that appear throughout this concern's real code (`private
 * readonly …`, `private toDomain(...)`, `assertConditionsWellFormed`, …).
 * `containsForbiddenTerm` therefore runs two passes: a case-insensitive true
 * word-boundary match (catches a standalone identifier or type alias spelled
 * exactly `nip`/`vat`/…), and a case-SENSITIVE camelCase-segment match
 * (catches the term appearing as a capitalized or all-caps "hump" embedded in
 * a longer identifier, e.g. a hypothetical `buyerNipNumber` field or
 * `resolveVatRate` method, which a plain `\b` test cannot see because there
 * is no non-word character at a camelCase transition).
 *
 * WHAT THIS GUARD DOES NOT CATCH, stated so nobody over-trusts it (the
 * `check-ui-vocabulary.mjs` transparency convention): a forbidden term
 * assembled at runtime from smaller pieces; a term hidden inside a template
 * literal's `${...}` expression (the stripper treats the whole literal as
 * opaque, so an embedded IDENTIFIER REFERENCE there is invisible - but its
 * DECLARATION elsewhere in the file, outside any string, is still caught);
 * and anything in a `*.spec.ts` file, by design (point 1 above).
 *
 * @module libs/core/src/invoicing/__tests__
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const CONTEXT_ROOT = join(__dirname, '..');

/** Verbatim from this concern's own repeated doc-comment litmus (ADR-026). */
const FORBIDDEN_TERMS = ['nip', 'ksef', 'vat', 'jpk', 'faktura'] as const;

function isProductionSourceFile(fileName: string): boolean {
  return (
    fileName.endsWith('.ts') &&
    !fileName.endsWith('.spec.ts') &&
    !fileName.endsWith('.int-spec.ts')
  );
}

function collectSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectSourceFiles(full));
      continue;
    }
    if (isProductionSourceFile(entry)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Strips `//` line comments, `/* … *‍/` block comments, and every
 * `'…'` / `"…"` / `` `…` `` literal (escapes respected), replacing each with
 * a single space so word boundaries either side of a removed span are
 * preserved. Textual, not a TypeScript parse - the same zero-dependency
 * convention every `scripts/check-*.mjs` invariant already uses.
 */
function stripCommentsAndStringLiterals(source: string): string {
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

/** See the module doc comment for why this is two passes, not one substring test. */
function containsForbiddenTerm(text: string, term: string): boolean {
  const boundary = new RegExp(`(?<![a-zA-Z])${term}(?![a-zA-Z])`, 'i');
  if (boundary.test(text)) return true;

  const titled = term.charAt(0).toUpperCase() + term.slice(1);
  const allCaps = term.toUpperCase();
  const camelHump = new RegExp(`(?<=[a-z])(?:${titled}|${allCaps})(?![a-z])`);
  return camelHump.test(text);
}

describe('invoicing neutral-vocabulary litmus (ADR-026, contract surface only)', () => {
  const files = collectSourceFiles(CONTEXT_ROOT).filter(
    (file) => !file.endsWith('neutral-vocabulary.spec.ts'),
  );

  it('finds production source files to check (guards against a silently empty sweep)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN_TERMS)(
    'never carries the regime-specific term "%s" in a declared identifier',
    (term) => {
      const offenders = files.filter((file) =>
        containsForbiddenTerm(stripCommentsAndStringLiterals(readFileSync(file, 'utf8')), term),
      );
      expect(offenders.map((file) => relative(CONTEXT_ROOT, file))).toEqual([]);
    },
  );
});
