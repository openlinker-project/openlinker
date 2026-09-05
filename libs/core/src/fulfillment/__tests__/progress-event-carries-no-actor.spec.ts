/**
 * A progress event cannot say WHO did it (#2420, `W3b-7`, decision D6)
 *
 * Spec § 4 decision D6: *"No actor on `FulfillmentProgressEvent`. Otherwise
 * every 3PL adapter carries a field only our bench can populate, and a
 * permanently-`null` field is later read as 'unattributed' rather than 'not
 * applicable'."*
 *
 * The failure this prevents is slow and entirely plausible. `FulfillmentProgressEvent`
 * is the INBOUND seam every executor reports through — a 3PL's webhook, a DOMS,
 * and OpenLinker's own pack bench alike. Only the bench has an actor to report:
 * a 3PL knows that a parcel was packed, not which of its staff packed it, and it
 * would not tell us if it did. Add the field and every adapter in the tree grows
 * a column it must always send `null` for; six months later a report reads that
 * `null` as *"we do not know who packed this"* rather than *"nobody here could
 * ever have known"*, and an operator is shown an attribution gap that is not one.
 *
 * Attribution belongs where it can actually be answered, and already is:
 * `fulfillment_works.packedByUserId` / `packedByService`, written by the bench's
 * own `claimParcelClose` (#2413/#2418), under `CHK_fulfillment_works_packed_actor`.
 *
 * So the absence is asserted rather than reviewed for, on the two surfaces where
 * an actor could physically arrive — modelled on `verification-indistinguishable.spec.ts`,
 * which makes the same argument for D20 one table over:
 *
 * 1. **The event declarations.** The base plus all five variants, over the WHOLE
 *    declaration text, so a field added to any one of them fails here.
 * 2. **`fulfillment_progress_claims`' column roster.** The claim row is the only
 *    thing a recorded event leaves behind (`fulfillment-progress-event.types.ts`:
 *    *"Only the `eventKind` stamped on the (burnt) claim row records which
 *    arrived"*), so it is the one place an actor could be persisted even with the
 *    event shape clean. Asserted as an EXACT set, so adding a column fails here
 *    rather than passing a deny-list somebody forgot to extend.
 *
 * What this cannot see, stated so the boundary is a decision rather than an
 * assumption: an adapter is free to carry an actor in its own vendor payload
 * above this seam. D6 is about what OpenLinker's neutral contract obliges every
 * executor to speak, not about what a vendor happens to know.
 *
 * @module libs/core/src/fulfillment/__tests__
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getMetadataArgsStorage } from 'typeorm';

import { FulfillmentProgressClaimOrmEntity } from '../infrastructure/persistence/entities/fulfillment-progress-claim.orm-entity';

const TYPES = join(__dirname, '..', 'domain', 'types', 'fulfillment-progress-event.types.ts');

/**
 * Every way an actor could be spelled on this seam.
 *
 * Deliberately wider than the two columns the work row actually carries: the
 * point is to catch the *next* author's spelling, not to restate today's.
 */
const FORBIDDEN_ACTOR_FIELDS = [
  'packedByUserId',
  'packedByService',
  'verifiedByUserId',
  'actorUserId',
  'actorService',
  'performedByUserId',
  'operatorId',
  'userId',
  'actor',
  'performedBy',
  'reportedBy',
  'packedBy',
  'pickedBy',
] as const;

/** The base and all five variants. A field on any one of them is an actor on the seam. */
const EVENT_DECLARATIONS = [
  'FulfillmentProgressEventBase',
  'FulfillmentPickedEvent',
  'FulfillmentShortPickedEvent',
  'FulfillmentPackedEvent',
  'FulfillmentShippedEvent',
  'FulfillmentClosedEvent',
] as const;

/**
 * The declaration text of one interface, comments stripped.
 *
 * Stripping is load-bearing rather than tidy: this module explains at length
 * which idempotency keys it is NOT reusing, and one of those explanations names
 * a user-shaped concept. Matching prose would make the guard either unpassable
 * or — worse — quietly passable for the wrong reason. That is the trap
 * `bench-never-issues.spec.ts` fell into on its first run.
 *
 * Two shapes must both be admitted, and getting either wrong makes the guard
 * pass vacuously rather than fail loudly: the base is declared WITHOUT `export`
 * (it is composed into the union rather than published), and the five variants
 * carry an `extends` clause. Anchoring on `export interface X {` would match
 * none of the six.
 */
function declarationOf(name: string): string {
  const source = readFileSync(TYPES, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  const start = source.search(new RegExp(`\\binterface ${name}\\b`));
  // Non-vacuity: a name that no longer exists would otherwise make every
  // assertion below pass for ever while checking nothing.
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('\n}', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function declaredClaimColumns(): string[] {
  const storage = getMetadataArgsStorage();
  const names = storage.columns
    .filter((column) => column.target === FulfillmentProgressClaimOrmEntity)
    .map((column) => column.propertyName);
  // Non-vacuity, for the same reason: a filter matching nothing passes every
  // `not.toContain` below.
  expect(names.length).toBeGreaterThan(0);
  return names.sort();
}

describe('`FulfillmentProgressEvent` carries no actor (#2420, D6)', () => {
  it.each(EVENT_DECLARATIONS)('%s names no actor', (name) => {
    const declaration = declarationOf(name);
    for (const forbidden of FORBIDDEN_ACTOR_FIELDS) {
      expect(
        declaration.includes(forbidden)
          ? `${name} declares \`${forbidden}\`. Decision D6: a progress event carries NO ` +
              'actor. Only OpenLinker’s own bench can populate one — a 3PL knows a parcel ' +
              'was packed, not by whom — so the field would be permanently `null` on every ' +
              'other executor and would later be read as "unattributed" rather than "not ' +
              'applicable". Attribution lives on `fulfillment_works.packedByUserId` / ' +
              '`packedByService`, written by `claimParcelClose` under ' +
              'CHK_fulfillment_works_packed_actor.'
          : null
      ).toBeNull();
    }
  });

  it('still declares the four facts an event IS about, so the guard is not vacuous', () => {
    // If this file were renamed or emptied, every assertion above would pass
    // against an empty string. These four are what the base is FOR.
    const base = declarationOf('FulfillmentProgressEventBase');
    for (const required of ['workId', 'connectionId', 'idempotencyKey', 'occurredAt']) {
      expect(base).toContain(required);
    }
  });

  it('reports the executor CONNECTION, which is not an actor and must stay', () => {
    // `connectionId` answers "which system told us", a fact every executor has.
    // D6 forbids "which person did it", a fact only one executor has. Asserted
    // so the guard above is not read as banning provenance altogether.
    expect(declarationOf('FulfillmentProgressEventBase')).toContain('connectionId');
  });
});

describe('the progress claim row cannot persist an actor either (#2420, D6)', () => {
  /**
   * The claim is what a recorded event leaves behind. An actor kept out of the
   * event type but written onto the claim would defeat D6 with the contract
   * still looking clean.
   */
  const EXPECTED_COLUMNS = [
    'workId',
    'idempotencyKey',
    'connectionId',
    'eventKind',
    'claimedAt',
  ].sort();

  it('carries exactly the columns it is supposed to and no others', () => {
    expect(declaredClaimColumns()).toEqual(EXPECTED_COLUMNS);
  });

  it.each(FORBIDDEN_ACTOR_FIELDS)('has no `%s` column', (forbidden) => {
    // Redundant with the equality above, deliberately: this is the assertion
    // whose FAILURE MESSAGE names the decision, so somebody adding one reads
    // why rather than only that a list changed.
    expect(declaredClaimColumns()).not.toContain(forbidden);
  });
});
