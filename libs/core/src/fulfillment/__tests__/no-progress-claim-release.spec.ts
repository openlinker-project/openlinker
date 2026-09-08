/**
 * The progress claim is NEVER released — structural guard (#2728, AC2)
 *
 * #2728's second acceptance criterion is that the `(workId, idempotencyKey)`
 * progress claim is **not** released, *"proven by a test that fails if it is"*.
 * This is that test, and it is deliberately structural rather than behavioural:
 * a behavioural test can only observe the paths it happens to drive, whereas the
 * property that must hold is that **no code anywhere in this context can release
 * a claim** — which is true iff the port declares no way to and nothing reaches
 * around it to the table.
 *
 * ## Why the rule exists
 *
 * Releasing the claim alongside `dispatchRelayedAt` is the obvious fix for the
 * gap #2728 closes, and it reverses #2400's core design. That key is **permanent
 * memory**, not a held slot — argued there explicitly against the partial-unique
 * precedents (`reservations WHERE status = 'held'`, `order_changes` on the open
 * statuses), both of which are partial precisely because they express
 * SLOT-HOLDING and must not block a legitimate fresh holder. A progress dedup key
 * is the opposite: a replay must be a no-op *forever*, and any window in which the
 * row leaves the index lets a replayed vendor event re-move counters. That trades a
 * missed relay for corrupted quantities, which is the worse failure — and is why
 * the recovery had to be a sweep reading OL's own rows rather than a retry driven
 * off the event stream.
 *
 * ## What each assertion catches
 *
 * 1. The PORT declares exactly one method. Adding `release` / `delete` / `clear`
 *    to it fails here before any caller exists.
 * 2. The REPOSITORY issues no delete against the claims table — the reach-around
 *    a port assertion alone cannot see.
 * 3. No file in this context deletes a claim through an entity manager either.
 *
 * A source-text scan is the established shape for a prohibition in this repo
 * (`returns/__tests__/proposal-never-issues.spec.ts`,
 * `no-second-proposal-mechanism.spec.ts`,
 * `check-contract-suite-not-in-production.mjs`).
 *
 * @module libs/core/src/fulfillment/__tests__
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CONTEXT_ROOT = join(__dirname, '..');

const CLAIM_PORT = join(
  CONTEXT_ROOT,
  'domain/ports/fulfillment-progress-claim-repository.port.ts'
);
const CLAIM_REPOSITORY = join(
  CONTEXT_ROOT,
  'infrastructure/persistence/repositories/fulfillment-progress-claim.repository.ts'
);

/** Every `.ts` under the context except its own tests. */
function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__' || entry === 'testing') continue;
      found.push(...listSourceFiles(path));
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) found.push(path);
  }
  return found;
}

describe('the fulfilment progress claim is never released (#2728 AC2, #2400)', () => {
  it('should declare exactly one method on FulfillmentProgressClaimRepositoryPort', () => {
    const source = readFileSync(CLAIM_PORT, 'utf8');
    const body = source.slice(source.indexOf('export interface FulfillmentProgressClaimRepositoryPort'));

    // Method signatures inside the interface body, ignoring the docblocks around
    // them. `claim` is the only one that may exist: a second method is how a
    // release arrives, whatever it is named.
    const methods = [...body.matchAll(/^\s{2}(\w+)\s*\(/gm)].map((match) => match[1]);

    expect(methods).toEqual(['claim']);
  });

  it('should never name a release, delete or clear on the claim port', () => {
    const source = readFileSync(CLAIM_PORT, 'utf8');
    const body = source.slice(source.indexOf('export interface FulfillmentProgressClaimRepositoryPort'));

    for (const forbidden of ['release', 'delete', 'clear', 'remove', 'unclaim']) {
      expect(body.toLowerCase()).not.toContain(`${forbidden}(`);
    }
  });

  it('should issue no delete against the claims table from its own repository', () => {
    const source = readFileSync(CLAIM_REPOSITORY, 'utf8');
    // The reach-around a port assertion cannot see: a delete written straight on
    // the injected TypeORM repository or its query builder.
    expect(source).not.toMatch(/\.delete\s*\(/);
    expect(source).not.toMatch(/\.remove\s*\(/);
    expect(source).not.toMatch(/\.softDelete\s*\(/);
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('should delete no progress claim anywhere in the fulfilment context', () => {
    const offenders = listSourceFiles(CONTEXT_ROOT).filter((path) => {
      const source = readFileSync(path, 'utf8');
      // A delete keyed on the claims entity or its table name, however it is
      // spelled — the entity class, the table literal, or raw SQL.
      const mentionsClaims =
        source.includes('FulfillmentProgressClaimOrmEntity') ||
        source.includes('fulfillment_progress_claims');
      if (!mentionsClaims) return false;
      return (
        /\.delete\s*\(/.test(source) ||
        /\.remove\s*\(/.test(source) ||
        /\bDELETE\s+FROM\b/i.test(source)
      );
    });

    expect(offenders).toEqual([]);
  });
});
