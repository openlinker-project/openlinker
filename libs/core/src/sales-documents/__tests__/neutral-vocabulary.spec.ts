/**
 * Neutral-vocabulary litmus - regression guard (#3183)
 *
 * ADR-041 decision 5's condition-types doc comment states the rule in exactly
 * these terms: nothing under `libs/core/src/sales-documents` may ever be a
 * country-specific literal - no national tax-identifier, clearance-regime or
 * tax-name string anywhere under this concern. Before this spec that sentence
 * claimed to be "grep-verified by the acceptance criteria of #2170", but no
 * such grep ran anywhere in the repo - the promise was documentation, not
 * enforcement. This spec ports the litmus fiscalization already enforces
 * (`libs/core/src/fiscalization/__tests__/neutral-vocabulary.spec.ts`, ADR-042
 * decision 4) to the sibling context that owns the routing DECISION between
 * the two document kinds a fiscal regime can require.
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
 * SAME RULE, DIFFERENT MATCHER from fiscalization - and the difference is not
 * incidental, so it is stated rather than implied. Fiscalization compares with
 * a plain lowercased `.includes()`, which is safe for its own five terms
 * because none is a substring of ordinary English. This context adds two that
 * are (see `containsForbiddenTerm`'s note in the shared module for the worked
 * list), so it matches with the three-pass matcher instead. That matcher is
 * STRICTLY STRONGER than `.includes()` in one direction - it sees a term as a
 * leading or embedded identifier segment where a substring test drowns in
 * false positives - and strictly weaker in exactly one other: a term followed
 * immediately by a lowercase letter (an inflection or plural in prose) is
 * invisible to it. Reconciling the two is an owner decision recorded in the
 * shared module, not something this spec silently resolves.
 *
 * A regime-specific value legitimately reaches a downstream context as an
 * opaque string an adapter wrote and this context never inspects - never as
 * an identifier declared in this concern's own source. So, as in
 * fiscalization, the ban is on this directory's SOURCE, not on data flowing
 * through it at runtime.
 *
 * @module libs/core/src/sales-documents/__tests__
 */
import { join, relative } from 'node:path';

import {
  collectSweepFiles,
  containsForbiddenTerm,
  readSweepSource,
} from '../../__tests__/neutral-vocabulary-sweep';

const CONTEXT_ROOT = join(__dirname, '..');

/**
 * Fiscalization's five (ADR-042 decision 4) plus this concern's own two
 * (ADR-041 decision 5's condition-types doc comment). The clearance-regime
 * term doubles as fiscalization's own reason for including it there - it
 * names the sibling regime, and leaking it into the ROUTING vocabulary both
 * document contexts share would blur exactly the boundary ADR-041 draws
 * between an invoice and a fiscal receipt.
 */
const FORBIDDEN_TERMS = ['paragon', 'kasa', 'printer', 'eparagony', 'ksef', 'nip', 'vat'] as const;

describe('sales-documents neutral-vocabulary litmus (ADR-041 decision 5)', () => {
  const files = collectSweepFiles(CONTEXT_ROOT, { includeTests: true });

  it('finds source files to check (guards against a silently empty sweep)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN_TERMS)('never mentions the regime-specific term "%s"', (term) => {
    const offenders = files.filter((file) =>
      containsForbiddenTerm(readSweepSource(file, { stripNonCode: false }), term),
    );
    expect(offenders.map((file) => relative(CONTEXT_ROOT, file))).toEqual([]);
  });
});
