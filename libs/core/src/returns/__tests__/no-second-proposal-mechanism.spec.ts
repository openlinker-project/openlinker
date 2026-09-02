/**
 * No Second Proposal Mechanism (#2372)
 *
 * The issue's acceptance criterion, asserted rather than promised: *"No second
 * proposal table or mechanism is introduced (asserted by review + grep test)."*
 *
 * `order_changes` is built once, in #2333, and reused. The failure this guards is
 * a plausible one — `return.authorize` differs from `return.decline` in that it
 * crosses no adapter boundary, which makes it tempting to give it its own,
 * simpler record. Two proposal stores would mean two answers to "what did the
 * operator ask for", two expiry policies, and two places a Wave-2 flow has to look.
 *
 * ## The token regex was NARROWED by #2374, not relaxed
 *
 * The third assertion below originally banned any returns-barrel `*_TOKEN`
 * matching `/PROPOSAL|.../`. #2374 adds `RETURN_CORRECTION_PROPOSAL_SERVICE_TOKEN`
 * — a service that COMPUTES a proposal and persists it through
 * `IOrderChangeService`, which is not a store. This test's own name says
 * "proposal-**store** token", so the regex was blunter than the rule it encodes
 * and now says what the name says. Renaming the token to slip past the old grep
 * was rejected: that hides the artifact from the guard instead of satisfying it,
 * and mis-names the thing the issue, ADR-060 and the product spec all call a
 * proposal. The three assertions that actually bind — the kind lives on
 * `order_changes`, no proposal-shaped entity/repository/port under `returns/`,
 * and no `OrderChangeRepositoryPort` import — are untouched and still catch a
 * genuine second mechanism.
 *
 * @module libs/core/src/returns/__tests__
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { OrderChangeKindValues } from '@openlinker/core/orders';
import * as returnsBarrel from '../index';

const RETURNS_ROOT = join(__dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// This file names the banned symbol in order to ban it, so it excludes itself —
// the `check-*-mirror.mjs` guards do the same for their own patterns.
const files = walk(RETURNS_ROOT).filter((f) => f.endsWith('.ts') && f !== __filename);

describe('returns — no second proposal mechanism (#2372)', () => {
  it('should declare every returns kind on the ADR-044 order-change vocabulary', () => {
    // The kinds live on `order_changes`, which is what "reuse" means concretely.
    expect(OrderChangeKindValues).toContain('return.authorize');
    // #2374 — the credit-note correction proposal reuses the same table.
    expect(OrderChangeKindValues).toContain('return.invoice_correction');
  });

  it('should ship no proposal-shaped ORM entity, migration or repository under returns', () => {
    const offenders = files.filter((file) => {
      const base = file.slice(RETURNS_ROOT.length + 1).toLowerCase();
      return (
        /proposal|changeset|order-change/.test(base) &&
        /\.(orm-entity|repository|port)\.ts$/.test(base)
      );
    });

    expect(offenders).toEqual([]);
  });

  it('should expose no proposal-store token from the returns barrel', () => {
    const tokenNames = Object.keys(returnsBarrel).filter((name) => name.endsWith('_TOKEN'));
    // Narrowed by #2374 to match this test's own name — a proposal STORE, not
    // any token whose name contains the word "proposal". See the file header.
    const offenders = tokenNames.filter((name) =>
      /PROPOSAL_(REPOSITORY|STORE)|CHANGESET|CHANGE_REPOSITORY/.test(name)
    );

    expect(offenders).toEqual([]);
  });

  it('should reach the proposal record only through IOrderChangeService', () => {
    // A returns file importing the orders repository PORT would be a second route
    // into the same table, bypassing the service that owns TTL expiry.
    const offenders = files.filter((file) =>
      /OrderChangeRepositoryPort/.test(readFileSync(file, 'utf8'))
    );

    expect(offenders).toEqual([]);
  });
});
