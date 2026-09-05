/**
 * The bench PRINTS; it never ISSUES (#2418, story F1)
 *
 * *"The bench prints the documents the sales-document machinery already
 * issued."* Trigger models are `manual | auto-on-paid | auto-on-shipped |
 * batched`; there is **no "on packed" trigger and this wave adds none**, because
 * packing is not a fiscal event. An operation that puts an invoice in the box
 * configures `auto-on-paid`, and the document exists long before the tote
 * reaches a bench.
 *
 * The temptation this guards is specific and reasonable-sounding: a packer finds
 * no invoice to print, somebody notices the bench already holds the order id,
 * and issuing one from here looks like a small helpful addition. It is not — it
 * would make a warehouse action mint a fiscal document, on the surface with the
 * narrowest role in the system.
 *
 * Structured after `libs/core/src/returns/__tests__/proposal-never-issues.spec.ts`,
 * which makes the identical claim for the returns correction proposal.
 *
 * @module apps/api/src/bench/__tests__
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BENCH_ROOT = join(__dirname, '..');

/**
 * Every issuance seam a bench file could reach for. Names rather than a broad
 * "invoice" match, because these files legitimately READ invoices and say so at
 * length.
 */
const FORBIDDEN = [
  'issueInvoice',
  'issueCorrection',
  'registerTransaction',
  'AutoIssueTriggerService',
  'INVOICE_ISSUE',
  'FISCAL_REGISTRATION_SERVICE_TOKEN',
];

/**
 * The file with its comments removed.
 *
 * Load-bearing rather than tidy: these files explain AT LENGTH why the bench
 * never issues, naming the very seams below. Scanning raw source made the guard
 * fire on its own justification — which is the failure mode
 * `no-parcel-commit-control.spec.ts` avoids by matching declarations rather than
 * prose, and it fired here on the first run. A guard that cannot be satisfied by
 * correct code gets deleted, not fixed.
 */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

const files = walk(BENCH_ROOT);

describe('the pack bench never issues a document (#2418, F1)', () => {
  it('scans a non-empty set of bench files', () => {
    // Without this, a broken walk reports green forever — the zero-case trap
    // `check-ui-vocabulary.mjs` documents as Z3.
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(FORBIDDEN)('reaches no `%s` anywhere under apps/api/src/bench', (symbol) => {
    const offenders = files.filter((file) => codeOf(file).includes(symbol));
    expect(
      offenders.length === 0
        ? []
        : offenders.map(
            (file) =>
              `${file} reaches ${symbol}. The bench prints; it never issues (spec F1). Packing ` +
              'is not a fiscal event, and this wave adds no "on packed" trigger.'
          )
    ).toEqual([]);
  });

  it('does read the invoice, so the guard above is not vacuous', () => {
    // The bench legitimately reads what was already issued. If this stops being
    // true the guard above is passing over a surface that no longer touches
    // invoicing at all, and it should be deleted rather than left green.
    const reads = files.filter((file) => codeOf(file).includes('getLatestIssuedInvoiceForOrder'));
    expect(reads.length).toBeGreaterThan(0);
  });
});
