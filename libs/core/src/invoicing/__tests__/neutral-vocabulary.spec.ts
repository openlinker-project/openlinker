/**
 * Neutral-vocabulary litmus - regression guard (#3183)
 *
 * ADR-026 states the rule this concern's own doc comments already repeat
 * almost two dozen times, e.g. `invoicing.types.ts`'s own header naming the
 * five forbidden terms below, and - more precisely -
 * `regulatory-resubmitter.capability.ts`: "the CONTRACT SURFACE - interface
 * name, method name, parameter/return types - carries no ... vocabulary. The
 * prose above names inFakt/KSeF only as illustrative examples ...; those are
 * documentation, not part of the type surface a sibling context binds to."
 * Before this spec neither statement was checked by anything - `invoicing` had
 * no equivalent of the sweep fiscalization already runs
 * (`libs/core/src/fiscalization/__tests__/neutral-vocabulary.spec.ts`,
 * ADR-042 decision 4), and this concern alone already carried roughly two
 * dozen clearance-regime mentions in prose when this spec was written.
 *
 * DELIBERATELY NARROWER than the sales-documents / fiscalization sweep
 * alongside this one. Those two ban a forbidden term ANYWHERE in the
 * directory, prose included, because neither concern's own documented rule
 * ever carved out an exception for illustrative prose. `invoicing` is
 * different: its own capability doc comments explicitly say prose naming a
 * real provider is fine, and porting the wider sweep here verbatim would fail
 * the build on every one of those ~25 legitimate mentions - a guard that
 * overshoots its own context's documented contract is worse than no guard,
 * because the fix would be to delete explanatory prose the ADR itself
 * sanctions. So this guard enforces exactly what invoicing's OWN rule already
 * claims: the CONTRACT SURFACE, not the prose around it.
 *
 * "Contract surface" is operationalised as two restrictions, both required:
 *
 *   1. PRODUCTION FILES ONLY - `*.spec.ts` / `*.int-spec.ts` are excluded.
 *      A test file's job is to exercise realistic fixtures (a tax-id scheme
 *      value, a clearance-reference fixture, a provider connection id) and to
 *      document known adapter shapes by name - none of that is the published
 *      vocabulary a sibling context binds to. `invoicing.types.spec.ts`
 *      additionally carries its own narrower, COMPLEMENTARY guard - two
 *      `it()`s asserting the runtime VALUES of `DocumentTypeValues` /
 *      `InvoiceFailureCodeValues` carry no forbidden term - which this spec
 *      does not replace: that one checks literal string VALUES (which this
 *      spec's string-stripping pass below deliberately ignores in production
 *      files too - see point 2), this one checks declared IDENTIFIERS. Two
 *      different surfaces, two different mechanisms, kept side by side on
 *      purpose.
 *
 *   2. COMMENTS AND STRING/TEMPLATE LITERALS STRIPPED before matching, even
 *      within the production files that remain in scope. A forbidden substring
 *      inside a JSDoc example, or inside an `as const` array's string VALUES
 *      (`DocumentTypeValues`, `InvoiceFailureCodeValues`, …), is documentation
 *      or data - never an interface, method, parameter or property NAME - so
 *      it is invisible to this pass by design (and is exactly what
 *      `invoicing.types.spec.ts`'s own value-level guard covers instead, per
 *      point 1).
 *
 * MATCHING, once comments/strings are stripped, still can't be a naive
 * substring test the way fiscalization's own sweep is: two of the five terms
 * below are substrings of ordinary English that appears throughout this
 * concern's real code (`private readonly …`, `private toDomain(...)`,
 * `assertConditionsWellFormed`, …). The shared three-pass
 * `containsForbiddenTerm` is used instead; its module doc comment carries the
 * worked list, the reason each pass exists, and the one residual shape it sees
 * differently from fiscalization's `.includes()`.
 *
 * WHAT THIS GUARD DOES NOT CATCH, stated so nobody over-trusts it (the
 * `check-ui-vocabulary.mjs` transparency convention): a forbidden term
 * assembled at runtime from smaller pieces; a term hidden inside a template
 * literal's `${...}` expression (the stripper treats the whole literal as
 * opaque, so an embedded IDENTIFIER REFERENCE there is invisible - but its
 * DECLARATION elsewhere in the file, outside any string, is still caught);
 * a term immediately followed by a lowercase letter (see the shared module);
 * and anything in a `*.spec.ts` file, by design (point 1 above).
 *
 * @module libs/core/src/invoicing/__tests__
 */
import { join, relative } from 'node:path';

import {
  collectSweepFiles,
  containsForbiddenTerm,
  readSweepSource,
} from '../../__tests__/neutral-vocabulary-sweep';

const CONTEXT_ROOT = join(__dirname, '..');

/** Verbatim from this concern's own repeated doc-comment litmus (ADR-026). */
const FORBIDDEN_TERMS = ['nip', 'ksef', 'vat', 'jpk', 'faktura'] as const;

describe('invoicing neutral-vocabulary litmus (ADR-026, contract surface only)', () => {
  const files = collectSweepFiles(CONTEXT_ROOT, { includeTests: false });

  it('finds production source files to check (guards against a silently empty sweep)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN_TERMS)(
    'never carries the regime-specific term "%s" in a declared identifier',
    (term) => {
      const offenders = files.filter((file) =>
        containsForbiddenTerm(readSweepSource(file, { stripNonCode: true }), term),
      );
      expect(offenders.map((file) => relative(CONTEXT_ROOT, file))).toEqual([]);
    },
  );
});
