/**
 * A Correction Proposal Never Issues (#2374)
 *
 * The issue's first acceptance criterion — *"A proposal never issues anything
 * (asserted)"* — as a grep test rather than a promise.
 *
 * A behavioural spec can only prove that the shipped code path does not issue on
 * the branches it exercises. This proves something stronger and cheaper to keep
 * true: the proposal path does not so much as NAME the issuing seam, so a future
 * edit that reaches for it fails here rather than in production. The stakes are
 * why: a correction transmitted to a tax authority cannot be withdrawn, and the
 * single thing this whole feature exists to surface — the positional-line
 * ambiguity — is precisely the thing a machine must not resolve unattended.
 *
 * This file names the banned symbols in order to ban them, so it excludes
 * itself, exactly as `no-second-proposal-mechanism.spec.ts` does.
 *
 * @module libs/core/src/returns/__tests__
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RETURNS_ROOT = join(__dirname, '..');

/**
 * Every file on the correction-proposal path. Listed explicitly rather than
 * globbed: the guard's value is that it names what it protects, and a glob would
 * quietly stop covering a file that was renamed.
 */
const PROPOSAL_PATH_FILES = [
  'application/services/return-correction-proposal.service.ts',
  'application/services/return-correction-proposal.service.interface.ts',
  'domain/domain-services/return-correction-matching.domain-service.ts',
  'domain/types/return-correction-proposal.types.ts',
];

/**
 * Issuing an actual document goes through exactly these two symbols. Neither may
 * appear on the proposal path.
 */
const ISSUING_SYMBOLS = ['issueCorrection', 'CorrectionIssuer'];

/**
 * Strip comments before scanning.
 *
 * The proposal path's docblocks NAME the issuing seam in order to say it is
 * never reached — which is exactly the explanation a future reader needs, and the
 * first version of this guard failed on its own subject's prose. Scanning code
 * only keeps the teeth (a real call or import still fails) without forcing the
 * files to go quiet about the one property that matters most about them.
 *
 * Deliberately a crude strip rather than a parse: it can only ever remove MORE
 * than a real comment, and over-removal would make the guard miss a violation —
 * so the risk is checked by the self-test below, which feeds it a line that is
 * code and must survive.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('returns — a correction proposal never issues (#2374)', () => {
  it('should still see an issuing symbol that is real code, not a comment', () => {
    // Self-check: proves the comment strip has not blinded the guard.
    const code = "await this.invoices.issueCorrection(cmd);";
    expect(stripComments(code)).toContain('issueCorrection');
    expect(stripComments('// mentions issueCorrection in prose')).not.toContain('issueCorrection');
    expect(stripComments('/**\n * CorrectionIssuer, never called.\n */')).not.toContain(
      'CorrectionIssuer'
    );
  });

  it.each(PROPOSAL_PATH_FILES)('should not reference an issuing seam in %s', (relative) => {
    const source = stripComments(readFileSync(join(RETURNS_ROOT, relative), 'utf8'));

    const offenders = ISSUING_SYMBOLS.filter((symbol) => source.includes(symbol));

    expect(offenders).toEqual([]);
  });

  it('should not resolve any capability adapter on the proposal path', () => {
    const source = stripComments(
      readFileSync(
        join(RETURNS_ROOT, 'application/services/return-correction-proposal.service.ts'),
        'utf8'
      )
    );

    // Reaching an adapter is how a read becomes a write. The service resolves
    // none: it reads OL's own invoice projection through `IInvoiceService` and
    // records through `IOrderChangeService`.
    expect(source).not.toMatch(/getCapabilityAdapter|listCapabilityAdapters/);
  });
});
