/**
 * Offer Lifecycle
 *
 * The five operator-facing buckets the redesigned `/listings` page partitions
 * its rows into (#2025 / epic #2023). Both the union and the pure derivation
 * live here so the rule is unit-testable in TypeScript rather than encoded in
 * SQL - mirroring the `pricing-rule.types.ts` / `stock-safety-buffer.types.ts`
 * pure-helper-in-domain-types precedent (#1843 / #1844).
 *
 * Four of the five derive from ONE source: the `offer_status_snapshots` row
 * joined on `(externalOfferId, connectionId)`. Because they partition a single
 * closed enum plus one boolean (does the snapshot carry validator messages),
 * those four are disjoint. `Unsynced` covers the complement - a mapping with no
 * snapshot row at all - so all five together do partition the filtered total
 * and their counts sum to it. See the union's own docblock below for what
 * `Unsynced` does and does not promise; it is not simply "not reached yet".
 *
 * ⚠ The Draft bucket must NOT be sourced from `OfferCreationRecord.status`.
 * The creation poller (#447) maps BOTH a clean `inactive` AND `ended` to
 * `OFFER_CREATION_STATUS.Draft`, so a creation-record-keyed Draft bucket would
 * swallow ended offers and break disjointness against Ended. The snapshot's
 * `publicationStatus` is the only field that separates the two.
 *
 * @module libs/core/src/listings/domain/types
 * @see {@link OfferPublicationStatus} for the neutral marketplace observation
 */
import { OfferPublicationStatusValues, type OfferPublicationStatus } from './offer-status-read.types';
import type { OfferStatusSnapshotDetails } from './offer-status-snapshot.types';

/**
 * `Draft` means **not live on the channel, with no validator messages** - and
 * nothing stronger. It is tempting to read it as "never went live", but the
 * snapshot cannot support that claim: both shipping adapters map a deliberately
 * DEACTIVATED formerly-live offer to `inactive` too, and Erli's
 * `mapErliStatusToReadResult` additionally routes its `default:` branch (a
 * status OL does not recognise, or none at all) to `inactive` - carrying whatever
 * reasons the channel reported, and empty `validationErrors` when it reported
 * none (#2231). Operator-facing copy must not promise more than that.
 *
 * `Unsynced` is a deliberate deviation from the #1965 mockup's four tabs, not
 * drift: the status scan is hourly at 100 offers/tick, so most of a large
 * catalog carries no snapshot for days. Without a fifth bucket those rows
 * belong to no tab at all and an operator reads a four-figure catalog as
 * having lost most of its listings.
 *
 * It means **no status has ever been read** - NOT "will resolve shortly". Three
 * ways a row stays here, and operator-facing copy must not promise otherwise:
 *
 * - The rolling scan has not reached it yet (resolves on its own, but a fresh
 *   mapping sits at offset 0 of a `createdAt DESC` scan, so it waits a full
 *   wrap - tens of hours on a four-figure catalog).
 * - A successful wizard create writes no snapshot at all: the creation poller
 *   schedules its reconcile only on `POLL_TIMEOUT` and `Draft`, not on the
 *   `Active` terminal branch. So the happy path lands here too.
 * - **Permanently**, on a connection whose status-sync task is not scheduled -
 *   every shipping platform's task is default ON (Erli's since #2230), but an
 *   operator can still turn one off (`OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED=false`).
 *   Such a seller finds their whole catalog in this bucket forever.
 *
 * It also does NOT mean "unlisted": the duplicate guard deliberately reads an
 * absent snapshot as still-listed, so an `Unsynced` row still blocks a re-list.
 *
 * That last point is not specific to `Unsynced`, and it bites hardest on the two
 * tabs the redesign creates for the go-fix-this workflow.
 * `OfferMappingRepositoryPort.countByConnectionAndVariants` - the read behind
 * `BulkListingSubmitService.filterAlreadyListed` - excludes ONLY `ended`, so an
 * `Invalid` or `Draft` row counts as already-listed just like an `Active` one.
 * An operator who opens Invalid, selects their rejected offers and hits "Create
 * offer" gets them silently skipped, or a 400 if that was the whole selection.
 * Only `Ended` is re-listable. Changing the duplicate guard is out of scope for
 * #2026; this docblock and the response DTO's per-bucket descriptions exist so
 * the UI copy built on them does not imply otherwise.
 *
 * Named `Invalid`, not `Inactive` (#2032 review thread 9): Allegro's own
 * `publication.status` union already contains `INACTIVE`, glossed in Allegro's
 * own docs as the draft state - so an Allegro-literate operator opening a tab
 * called "Inactive" would expect most of their marketplace-`INACTIVE` offers
 * there and not find them (those, with no validator messages, are `Draft`
 * here). `Invalid` is also the vocabulary the comparable corpus uses for
 * exactly this validator-rejected bucket (BaseLinker's fourth tab is literally
 * *Invalid* / `Błędne`; ChannelEngine's is `INVALID_ON_CREATE`).
 */
export const OfferLifecycleValues = ['Active', 'Invalid', 'Draft', 'Ended', 'Unsynced'] as const;
export type OfferLifecycle = (typeof OfferLifecycleValues)[number];

/**
 * The two - and only two - snapshot facts the lifecycle rule reads. Isolating
 * them is what lets a grouped SQL aggregate count per bucket (#2026) without
 * the query ever learning the rule: the database groups by these raw facts and
 * `resolveOfferLifecycle` folds each group, exactly as it classifies each list
 * row. One implementation, two call sites, so the counts and the list cannot
 * disagree about what an `Invalid` offer is.
 */
export interface OfferSnapshotFacts {
  publicationStatus: OfferPublicationStatus;
  hasValidationMessages: boolean;
}

/**
 * Per-bucket row counts. `Record` over the union rather than a hand-written
 * shape, so adding a sixth bucket fails to compile at every producer.
 */
export type OfferLifecycleCounts = Record<OfferLifecycle, number>;

/**
 * The single lifecycle rule. `null` facts mean the status-snapshot join found
 * no row - the `Unsynced` complement, classified here rather than at each call
 * site so the five buckets provably partition their input.
 *
 * `activating` / `inactivating` fold into `Active`: both describe an offer the
 * marketplace is mid-transition on, and an operator scanning the Active tab
 * should still see it (the row carries an `ACTIVATING` badge instead).
 */
export function resolveOfferLifecycle(facts: OfferSnapshotFacts | null): OfferLifecycle {
  if (facts === null) return 'Unsynced';
  switch (facts.publicationStatus) {
    case 'active':
    case 'activating':
    case 'inactivating':
      return 'Active';
    case 'ended':
      return 'Ended';
    case 'inactive':
      // The marketplace validator rejected it (Invalid) versus not live with
      // nothing to say about why (Draft) - the only signal separating the two.
      // Draft deliberately claims no more than that; see the union's docblock.
      return facts.hasValidationMessages ? 'Invalid' : 'Draft';
  }
}

/**
 * Resolve the lifecycle bucket of one mapped offer from its persisted status
 * snapshot. Pure - no I/O, no defaults invented from absence.
 *
 * Its domain is a snapshot that EXISTS; it never returns `Unsynced`. A caller
 * whose join found no snapshot row classifies that absence itself (by passing
 * `null` to `resolveOfferLifecycle`), keeping this function a total map over
 * the closed `OfferPublicationStatus` union.
 */
export function deriveOfferLifecycle(
  publicationStatus: OfferPublicationStatus,
  statusDetails: OfferStatusSnapshotDetails | null
): OfferLifecycle {
  return resolveOfferLifecycle({
    publicationStatus,
    hasValidationMessages: readValidationMessages(statusDetails).length > 0,
  });
}

/**
 * Every snapshot-fact combination that exists, enumerated from the closed
 * `OfferPublicationStatus` union crossed with the one boolean.
 */
const ALL_SNAPSHOT_FACTS: readonly OfferSnapshotFacts[] = OfferPublicationStatusValues.flatMap(
  (publicationStatus) =>
    [true, false].map((hasValidationMessages) => ({ publicationStatus, hasValidationMessages }))
);

/**
 * The snapshot facts that land in `lifecycle` - derived by running the rule
 * over the whole (small, closed) fact space rather than by restating it.
 *
 * This is how a *filter* for one bucket reaches SQL (#2026): the repository
 * turns these facts into a WHERE predicate, so the predicate is generated from
 * the same rule that classifies rows and can never drift from it. Reclassify a
 * status and the predicate follows with no SQL edit.
 *
 * Returns `[]` for `Unsynced`, which is the complement of every snapshot fact
 * (no snapshot row at all) and therefore has no fact combination of its own -
 * a caller filtering for it must test for the absence of the join instead.
 */
export function listSnapshotFactsForLifecycle(
  lifecycle: OfferLifecycle
): readonly OfferSnapshotFacts[] {
  return ALL_SNAPSHOT_FACTS.filter((facts) => resolveOfferLifecycle(facts) === lifecycle);
}

/**
 * A zeroed count for every bucket, so a bucket the query returned no rows for
 * still reports `0` rather than being absent from the response.
 */
export function emptyOfferLifecycleCounts(): OfferLifecycleCounts {
  return { Active: 0, Invalid: 0, Draft: 0, Ended: 0, Unsynced: 0 };
}

/**
 * Total across all buckets. Because the buckets partition the filtered set,
 * this equals the unfiltered-by-lifecycle row total.
 */
export function sumOfferLifecycleCounts(counts: OfferLifecycleCounts): number {
  return OfferLifecycleValues.reduce((sum, lifecycle) => sum + counts[lifecycle], 0);
}

/**
 * The `OfferStatusSnapshotDetails` key holding the validator messages, pinned
 * as a constant because SQL has to name it too (#2026 reads it out of the
 * `statusDetails` jsonb to group by "has messages"). `satisfies keyof` turns a
 * rename of the field into a compile error instead of a query that silently
 * classifies every rejected offer as a Draft.
 */
export const OFFER_VALIDATION_MESSAGES_KEY = 'validationMessages' satisfies keyof OfferStatusSnapshotDetails;

/**
 * Normalise the optional, intentionally-loose validator message list off a
 * snapshot's detail blob into an always-present array.
 *
 * Guards the shape at runtime (#2032 review thread 10), mirroring
 * `HAS_VALIDATION_MESSAGES_SQL`'s `jsonb_typeof(...) = 'array'` guard on the
 * SQL side: `statusDetails` is unconstrained `jsonb`, so the declared
 * `string[]` type is trusted by the compiler but not enforced by the column.
 * A future adapter or migration writing a scalar (e.g.
 * `{"validationMessages": "Brak parametru"}`) would otherwise make this side
 * report `hasValidationMessages = true` (`"Brak parametru".length > 0`) while
 * the SQL side reports `false` - a row landing on Draft's count but Invalid's
 * page - and `[...validationMessages]` downstream would silently explode a
 * string into one-character "messages".
 *
 * Residual gap, currently unreachable (#2032 review round 2, finding 8): the
 * SQL side counts ANY non-empty jsonb array as "has messages"
 * (`jsonb_array_length(...) > 0`, regardless of element type), while this
 * side filters out non-string elements before measuring length - so a
 * non-empty array of non-strings (e.g. `[123]`) would read `true` in SQL but
 * `false` here. Unreachable today because the one writer
 * (`OfferStatusSyncService`'s `validationErrors.map((error) => error.message)`)
 * always produces `string[]`. Left as a documented residual rather than
 * fixed, since closing it for real means computing `hasValidationMessages`
 * independently of the string filter on both sides - a real behaviour
 * change for a case no writer can currently produce.
 */
export function readValidationMessages(
  statusDetails: OfferStatusSnapshotDetails | null
): readonly string[] {
  const raw = statusDetails?.[OFFER_VALIDATION_MESSAGES_KEY];
  return Array.isArray(raw) ? raw.filter((message): message is string => typeof message === 'string') : [];
}
