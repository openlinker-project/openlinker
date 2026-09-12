/**
 * Neutral-vocabulary litmus - regression guard (#3183)
 *
 * ADR-041 decision 5's condition-types doc comment states the rule in exactly
 * these terms: nothing under `libs/core/src/sales-documents` may ever be a
 * country-specific literal - no `"NIP"` / `"KSeF"` / `"VAT"` string anywhere
 * under this concern. Before this spec that sentence claimed to be
 * "grep-verified by the acceptance criteria of #2170", but no such grep ran
 * anywhere in the repo - the promise was documentation, not enforcement. This
 * spec is the port of the identical litmus fiscalization already enforces
 * (`libs/core/src/fiscalization/__tests__/neutral-vocabulary.spec.ts`, ADR-042
 * decision 4), made real for the sibling context that owns the routing
 * DECISION between the two document kinds a fiscal regime can require.
 *
 * `sales-documents` is a zero-outbound-CORE-context-edge leaf precisely so a
 * fiscal receipt is not modelled as an invoice and vice versa (see this
 * context's own barrel doc comment) - so it is exactly as load-bearing here as
 * in fiscalization that no single country's vocabulary leaks into the shared
 * routing vocabulary both document contexts speak.
 *
 * FULL SWEEP, prose included - unlike the invoicing guard alongside this one
 * (`libs/core/src/invoicing/__tests__/neutral-vocabulary.spec.ts`), which is
 * scoped to the CONTRACT SURFACE of non-test files only. `sales-documents` has
 * no equivalent "prose is fine, only the type surface is banned" carve-out
 * anywhere in its own doc comments - ADR-041 decision 5 states the ban over
 * "this concern" without qualification, so this guard scans every `.ts` file
 * under the directory, tests included, exactly as fiscalization's does.
 *
 * MATCHING is deliberately NOT a naive substring test. Fiscalization's own
 * five terms (`paragon` / `kasa` / `printer` / `eparagony` / `ksef`) are rare
 * enough as substrings that `.includes()` never produces a false positive.
 * This context's own two additional terms - `nip` and `vat` - are NOT: `vat`
 * is a substring of `private`/`derivation`/`activate`, and `nip` is a
 * substring of `manipulate`/`principal`. A naive substring ban on those two
 * would either flag ordinary English prose (if literal) or be too narrow to
 * catch a real violation quietly embedded in an identifier (if word-bounded
 * alone) - `buyerHasNip` contains no `\bnip\b` because there is no
 * non-letter boundary before the capital `N`. `containsForbiddenTerm` below
 * therefore runs TWO passes: a case-insensitive true word-boundary match
 * (catches a standalone mention in prose, a kebab/snake-case fixture id, or a
 * quoted literal), and a case-SENSITIVE camelCase-segment match (catches the
 * term appearing as a capitalized or all-caps "hump" inside a longer
 * identifier, e.g. `buyerHasNip` or `orderVatAmount`, which a plain `\b`
 * cannot see because there is no non-word character at the transition).
 *
 * A regime-specific value legitimately reaches a downstream context as an
 * opaque string an adapter wrote and this context never inspects - never as
 * an identifier declared in this concern's own source. So, as in
 * fiscalization, the ban is on this directory's SOURCE, not on data flowing
 * through it at runtime.
 *
 * @module libs/core/src/sales-documents/__tests__
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const CONTEXT_ROOT = join(__dirname, '..');

/**
 * Fiscalization's five (ADR-042 decision 4) plus this concern's own two
 * (ADR-041 decision 5's condition-types doc comment: no `NIP` / `VAT` string).
 * `ksef` doubles as fiscalization's own reason for including it there - it
 * names the sibling clearance regime, and leaking it into the ROUTING
 * vocabulary both document contexts share would blur exactly the boundary
 * ADR-041 draws between an invoice and a fiscal receipt.
 */
const FORBIDDEN_TERMS = ['paragon', 'kasa', 'printer', 'eparagony', 'ksef', 'nip', 'vat'] as const;

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

/**
 * True if `text` mentions `term` either as a standalone, boundary-delimited
 * token (any casing) or as a capitalized/all-caps "hump" embedded inside a
 * larger camelCase/PascalCase identifier. See the module doc comment for why
 * a plain substring or a plain `\b` test alone is wrong for this term list.
 */
function containsForbiddenTerm(text: string, term: string): boolean {
  const boundary = new RegExp(`(?<![a-zA-Z])${term}(?![a-zA-Z])`, 'i');
  if (boundary.test(text)) return true;

  const titled = term.charAt(0).toUpperCase() + term.slice(1);
  const allCaps = term.toUpperCase();
  const camelHump = new RegExp(`(?<=[a-z])(?:${titled}|${allCaps})(?![a-z])`);
  return camelHump.test(text);
}

describe('sales-documents neutral-vocabulary litmus (ADR-041 decision 5)', () => {
  const files = collectSourceFiles(CONTEXT_ROOT).filter(
    (file) => !file.endsWith('neutral-vocabulary.spec.ts'),
  );

  it('finds source files to check (guards against a silently empty sweep)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN_TERMS)('never mentions the regime-specific term "%s"', (term) => {
    const offenders = files.filter((file) =>
      containsForbiddenTerm(readFileSync(file, 'utf8'), term),
    );
    expect(offenders.map((file) => relative(CONTEXT_ROOT, file))).toEqual([]);
  });
});
