# Implementation Plan — DB-derived taxonomy sync frontier (#2061)

- **Issue**: #2061 (follow-up to #1979, Wave 1 of #1937)
- **ADR**: [ADR-037](../architecture/adrs/037-destination-taxonomy-read-model.md) — amends its § Sequencing claim
- **Type**: CORE (+ one migration, + worker handler)
- **Migration**: **yes** — one additive nullable column + index

---

## 1. Goal

`destination.taxonomy.sync` persists its breadth-first progress as a **frontier**
(`{ runStartedAt, pending: string[] }`) JSON-encoded onto a connection cursor.
Move that progress into the projection itself, so the cursor holds one scalar and
a run belongs to the OWNER rather than to whichever connection was elected when
it started.

### Non-goals

- Locale-aware sync (#2059) — orthogonal, and it wants this loop settled first.
- Any Wave 2/3/4 consumer work. Reads are untouched by this change.
- Materialising breadcrumb `path` (ADR-037 decided against; still decided against).

---

## 2. What is actually wrong today

Three findings, and one correction to the issue's own framing.

1. **The cursor is not scalar.** Every other cursor in the repo is one value (a
   scan offset, an Allegro event id). This one holds every pending parent id.

   *Correction to the issue body:* it says the Cursors page "will render a
   multi-KB JSON blob". The page already truncates at 40 chars
   (`cursors-list-page.tsx:31`), so the visible cell is fine. The real costs are
   that the **whole blob ships in the list response for every cursor row**, and
   that it lands in a `title=` tooltip — a hover that dumps thousands of ids.
   Worth fixing, but it is a payload/tooltip problem, not a layout one.

2. **Progress is keyed by connection; a marketplace run's subject is the owner.**
   The scheduler re-elects a source connection every tick, so a re-election
   orphans the frontier and restarts from the roots.

3. **Two runs for one owner can overlap.** The idempotency key carries a minute
   timestamp, so it collapses same-tick duplicates only. ADR-037 § Sequencing
   claims more than the code delivers.

---

## 3. Design

### 3.1 Schema — `expandedAt timestamptz NULL`

One additive nullable column on `destination_categories`. A node carries the
watermark of the run that expanded it.

Two facts make the derivation work, and both already hold:

- **Every node is stamped `syncedAt = runStartedAt` when its parent is
  expanded** (`upsertMany` stamps the run watermark), and roots are stamped by
  the root browse. So "belongs to this run" is `syncedAt = runStartedAt`.
- **`leaf` is already persisted**, so an unexpandable node is excluded without a
  platform call.

**The load-bearing invariant: `ON CONFLICT DO UPDATE` must never touch
`expandedAt`.** A node reachable from two parents is re-upserted when the second
parent expands. The existing `DO UPDATE SET` list happens not to include
`expandedAt`, so it survives — but adding it there later would put the node back
in the frontier on every page and **the run would never terminate**. This is the
whole basis of the issue's "expanded once per run" AC, so it gets an explicit
comment at the `DO UPDATE` site and a test that expands a two-parent node across
TWO pages (one page cannot falsify it — Wave 1's run-local `Set` already covers
the single-page case).

### 3.2 The frontier becomes a query

```sql
SELECT "externalId" FROM destination_categories
WHERE <scope match>
  AND "syncedAt"  = $runStartedAt
  AND "leaf" IS NOT TRUE
  AND ("expandedAt" IS NULL OR "expandedAt" < $runStartedAt)
LIMIT $pageLimit
```

- **Termination is inherent.** Expansion is recorded on the row, so a node
  reachable from two parents — or through a cycle — cannot re-enter the frontier
  in a later page. Wave 1's run-local `Set` handled this *within* one page only;
  its own comment admits the cross-page gap and names this issue.
- **Completion** = the query returns zero rows. A run that expands exactly
  `pageLimit` nodes reports incomplete and the next tick confirms emptiness, so
  completion costs one extra tick. Deliberate: fetching `limit + 1` to avoid it
  buys a tick and costs a special case in the only loop that matters.
- **Deterministic pages**: `ORDER BY "externalId"`. Correctness does not need it
  (every row must eventually be expanded, so page order is irrelevant), but it
  makes a resumed run reproducible, which the int-spec depends on.

### 3.2.1 The sweep is gated on the run having observed something

**Completion alone must NOT authorise the sweep.** The cursor now carries
`runStartedAt` *across ticks*, so a tick can resume watermark `T`, find no row
carrying `T`, conclude "complete", and delete every row with `syncedAt < T` —
which is the entire scope.

So `deleteStaleBelow` runs only when at least one row in scope carries
`syncedAt = runStartedAt`. Zero observations ⇒ skip the sweep, log an error,
clear the cursor so the next tick walks from the roots.

This also closes a **pre-existing** hazard inherited from Wave 1: an empty root
response (a platform returning `[]` for a transient reason) currently completes
a run that observed nothing and wipes the scope. Wave 1 always browses roots in
the same tick it sweeps, so it has one way in; this design separates the two
across ticks and would otherwise add a second.

### 3.3 `expandedAt` is stamped AFTER a successful browse, not before

Claiming rows up front (`UPDATE … RETURNING`, `SKIP LOCKED`) would make
concurrent runs disjoint — but a browse that then fails would leave the node
marked expanded with its children never refreshed, and the sweep would delete
them. Stamping after means two overlapping runs can browse the same node twice;
that is wasted HTTP, not lost rows, and `upsertMany` is idempotent.

**Correctness over dedupe.** Recorded here because the opposite choice looks
tempting and is quietly destructive.

### 3.4 The cursor becomes `runStartedAt`

Value is the run watermark as an ISO string; empty means "no run in progress".
`null` ⇒ mint a new watermark and browse the roots first (the root level is
synthetic — it has no row to carry `expandedAt`, which is why the cursor cannot
go away entirely).

`TaxonomyFrontier` is deleted. `TaxonomySyncInput` / `TaxonomySyncResult` change
shape (`frontier` → `runStartedAt`, `nextFrontier` → `nextRunStartedAt`). All
three are exported from the `listings` barrel but have **no consumer outside
this repo** and shipped one day ago (#2062); the two in-repo consumers are the
worker handler and its spec.

### 3.5 The age guard changes meaning (AC-6)

Wave 1 discards a frontier older than 6h because resuming one would sweep
against its own stale `runStartedAt`, match nothing, and silently disable
disappearance detection.

**That reasoning does not survive this change.** A resumed old run keeps stamping
its own consistent watermark, and its sweep still deletes exactly "everything
this run did not observe" — correct regardless of age. What age now costs is
*freshness*: a run resumed after three days publishes a three-day-old tree.

So the guard stays but is **re-documented as a freshness policy, not a
correctness guard**, and is relaxed to 24h. Removing it entirely would let a run
interrupted indefinitely (a disabled connection re-enabled a month later) resume
and complete against month-old data.

### 3.6 Per-owner lock (AC-7)

`SyncLockPort` already exists in `sync` with two per-aggregate precedents
(`order-create-lock.ts`, `shipment-dispatch-lock.ts`) — a small key-builder
module plus a `withLock` wrapper. Cross-context use is permitted (a single
`*Port` suffix is an allowed import shape, and `orders` already does it).

Taking the lock per **owner scope** makes ADR-037's "at most one in-flight run
per owner" true instead of aspirational, and it also removes the duplicate-browse
waste § 3.3 accepts. A tick that cannot acquire simply skips — the next tick
resumes the same run, which is now safe precisely because progress is DB-derived.

**The lock key derives from the RESOLVED scope, never the job payload** — the
#2063 lesson applied to a second key. The owner comes from mutable connection
config, so a payload-derived key would let two runs on one owner take two
different locks and defeat the point. The cursor key already resolves this way;
both now read one authority.

**Scope call for review:** this is the one item that could be deferred to a
"decide and document" answer. Recommendation is to implement it (~30 lines, two
precedents, closes the ADR's overclaim) — see § 7.

---

## 4. Steps

1. **Migration** `1833000000001-add-destination-category-expanded-at.ts` —
   `expandedAt timestamptz NULL` + a supporting index (§ 6: measured, not
   assumed). `down()` drops both.
2. **ORM entity only** — `expandedAt: Date | null`. Deliberately **not** on the
   domain entity or `DestinationCategoryLike`: `findExpandable` returns only
   `externalId`s, and this file's own `searchText` precedent keeps bookkeeping
   fields off the domain shape ("an index-serving derivation, not domain data").
   Sync progress is persistence bookkeeping, not read-model data.
3. **Types** — delete `TaxonomyFrontier`; reshape `TaxonomySyncInput` /
   `TaxonomySyncResult` to the scalar watermark.
4. **Repository port + impl** — add `findExpandable(scope, runStartedAt, limit)`
   and `markExpanded(scope, externalIds, runStartedAt)`. Both parameter-bound,
   both scope-branched like the existing statements.
5. **`DestinationTaxonomyService.syncTaxonomy`** — replace the in-memory queue
   with the query loop; keep the root-browse special case; sweep only on a
   completing run that observed something (§ 3.2.1).

   **Write order per node: browse → upsert children → mark parent expanded.**
   Not incidental. A crash between the last two steps must leave the parent
   UNEXPANDED (retried next tick), never expanded-with-unstamped-children — the
   latter records the work as done while its children sit below the watermark,
   so the completing sweep deletes them. Same failure family as § 3.2.1.
6. **Worker handler** — cursor value becomes the scalar watermark. The
   `resolveScope`-derived cursor key from #2063 stays exactly as is (it is what
   keeps key and sweep on one authority).
7. **Per-owner lock** (§ 3.6, pending the scope call).
8. **Specs** — a two-parent node expanded once *across pages* (the gap Wave 1's
   `Set` could not close); a re-elected connection resuming rather than
   restarting; the completion + sweep tick; the relaxed age guard.
9. **Int-spec** — extend `destination-taxonomy.int-spec.ts` with the real
   two-parent + resume cases against Postgres.
10. **Docs** — ADR-037 amendment (§ Sequencing correction + the age-guard
    reasoning change), `architecture-overview.md` § Listings.

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| An in-flight Wave 1 frontier exists at deploy | The cursor value is unparseable as a timestamp ⇒ treated as "no run", so the next tick starts fresh. Costs one full walk, no incorrect sweep. Asserted by a spec. |
| `syncedAt = runStartedAt` equality across a timestamp round-trip | Both sides originate from the same JS `Date` bound as a parameter; the int-spec pins the equality against real Postgres rather than trusting it. |
| Deleting `TaxonomyFrontier` from the barrel | In-repo only, one day old, two consumers — both edited here. |
| An empty root response wipes the scope | **Pre-existing** (Wave 1 behaves identically), and **fixed here as a side effect** of § 3.2.1: a run that observed zero rows in scope does not sweep. Called out in the PR so the fix is not mistaken for an unrelated drive-by. |
| A resumed run whose rows were deleted out from under it sweeps the scope | The same § 3.2.1 guard. This is the path the redesign would otherwise ADD, which is why the guard is blocking rather than nice-to-have. |

---

## 6. Index: measure, do not assume

The obvious index is `(taxonomyOwner, syncedAt)` (+ the `connectionId` twin)
with a `WHERE "leaf" IS NOT TRUE` predicate. At realistic scope sizes
(single-digit thousands of rows) a sequential scan may well win — that is
exactly what happened with the GIN trigram index in #2062, where the measured
numbers contradicted the assumption.

So: build the index, `EXPLAIN ANALYZE` the frontier query at ~20k rows, and keep
it only if it pays. Whatever the outcome, record the measured numbers in the
migration comment, as #2062 does.

---

## 7. Open question for review

**Include the per-owner lock (§ 3.6) in this PR, or answer AC-7 with a documented
deferral?**

Recommendation: **include it.** The seam exists, there are two precedents, it is
the difference between ADR-037 § Sequencing being true and being aspirational,
and it subsumes the duplicate-browse waste that § 3.3 otherwise accepts. The
argument for deferring is only PR size — and the lock is the smallest of the ten
steps.
