# Implementation plan — inert-state reason vocabulary + persisted reason columns (#2352)

Wave-2 body C, second in the chain (after #2351). Design of record: Wave-2 product spec §4.2/§4.3,
ADR-052/053/056, DESIGN §2/§5.3, and the #2100 `SalesDocumentBlockOutcome` persistence discipline.

## Phase 1 — What the slice is

Spec §4.2 enumerates the operator-facing **inert states**. #2352 asks for their vocabulary in the
`fulfillment-authority` leaf, the aggregate-worthy subset, coercion guards, and persistence "following
the owning row". #2353 (status API), #2356 (Needs-attention section + row badges) and #2357 (copy
module + `check-attention-reason-mirror.mjs`) all consume the union; **#2357, not this slice, owns the
mirror script and the FE copy.**

## Phase 2 — Decisions

### D1. One flat attention-reason union, NOT a widening of an existing one

`FulfillmentAuthorityBlockReason` (#2304) answers *"why did authority resolution fail"*.
`AuthorityAmbiguityReason` answers *"why could `selectAuthorityHolder` not pick one"*. §4.2's states
answer a third question — *"what is the operator looking at, and where"* — and four of the eight
(UF-L, RS-S, RB-L, OR-P) are not authority-resolution failures at all: a reservation shortfall is not
an ambiguity. So a new union in its own file. `AuthorityWhy`'s two arms are untouched, per #2351.

### D2. Eight members, spec-code-named, with a descriptor table

`authority-attention-reason.types.ts`:

| Member | §4.2 | Badge | Subject | Producer |
|---|---|---|---|---|
| `availability-unknown` | A1-U | `stopped` | connection | derived (#2351) |
| `sourcing-ambiguous` | A2-A | `stopped` | connection | derived (#2351) |
| `fulfillment-unaccepted` | A3-X | `stopped` | order | persisted (Wave 3) |
| `line-unfulfillable` | UF-L | `at-risk` | order | persisted (Wave 3) |
| `reservation-shortfall` | RS-S | `at-risk` | order | persisted (body B, #2349) |
| `returns-disposition-ambiguous` | A5-A | `stopped` | connection | derived (#2351) |
| `restock-blocked` | RB-L | `blocked` | return | persisted (body E) |
| `return-unmatched` | OR-P | `not-matched` | return | **derived** (#2332 orphan bucket) |

Badge vocabulary is spec §4.2's closed four (`Stopped`/`At risk`/`Blocked`/`Not matched`) as codes —
core emits no English (#2351's rule). `AUTHORITY_ATTENTION_REASON_DESCRIPTORS` is the one data table
§4.3 mandates ("one table, two readers").

**AF-X is deliberately absent.** Spec §4.2 lists nine states; the issue, and #2356, say eight. AF-X is
the automation-failure state produced by body D (§5.3/§5.6) with its own per-firing record and its own
clearing rule ("I handled this myself"), which no column here models. Flagged to the orchestrator.

### D3. Counted subset derived, not hand-listed

`AuthorityAttentionCountedReasonValues` filters on the descriptor's `counted` flag (today: all eight —
§4.3 makes every §4.2 row attention-worthy). The routine half of §4.3 lives on the who-decides ROW,
not here: it is `AuthorityState`/`AuthoritySource` from #2351, and its members are structurally
incapable of entering this union. That is why A2-`none` (the regression #2356 tests for) cannot be
counted: `nobody-to-route` is an `AuthorityAnswer`, never an attention reason.

### D4. Derived states are NOT persisted — deviation from the issue text, stated loudly

The issue says "connection-scoped states on the connection". A1-U / A2-A / A5-A are **pure functions of
`Connection.config`**, already computed by `resolveAuthorities` over ≤ a handful of connections, and
#2353 recomputes them per request anyway. A persisted copy would be a second answer to a question the
pure function already answers — the exact failure ADR-053's "resolution lives where the write lives"
and #2351's own docblock forbid — with a staleness window and a level-triggered writer that has no
natural trigger other than a config write. Same for OR-P: `ReturnBucket` is derived from one nullable
column (`internalOrderId IS NULL`, #2332), so a reason column would mirror it.

Therefore: **no `connections` migration, no OR-P column.** Instead two pure derivations in the leaf:

- `authorityAttentionReasonForQuestion(question)` → the A1-U/A2-A/A3-X/A5-A member, or `null`. This is
  also what spec §3.3 needs ("an ambiguous row's why-line is *replaced* by the §4.2 body copy"), so
  #2353/#2356 get it from one source instead of restating a question→state map in the browser.
- `attentionReasonsForAuthorityRows(views)` → the derived attention rows for a resolved table.

Persistence is added only where the fact is genuinely not derivable.

### D5. Persisted columns, #2100's discipline verbatim

`order_records` (A3-X / UF-L / RS-S) and `returns` (RB-L) each gain:

- `<x>AttentionReason` — `varchar`, nullable, **indexed on `order_records`** (it is a filter axis:
  `?attention=` in #2356; partial `WHERE … IS NOT NULL`, never on a value list — see Phase 6.1), unindexed on `returns` (small table, no filter chip in scope).
- `<x>AttentionDetail` — `text`, nullable, PII-free elaboration, never parsed.

Discipline copied from `updateSalesDocumentBlock`:

1. **Excluded from every `toOrm`** — a regression spec pins it. `persistOrder` runs on every ingestion
   and would otherwise null-then-reset a reason a peer wrote.
2. **One writer**, a targeted `UPDATE … WHERE id = $ AND (col IS DISTINCT FROM $)` — the no-op guard
   in the WHERE, never caller-side (#2100 review: a caller-side compare races a concurrent writer).
3. **Level-triggered**: the writer takes `AuthorityAttentionBlock | null` and storing `null` is what
   clears a stale reason. The three-armed `AuthorityAttentionOutcome` (`none` / `blocked` /
   `indeterminate`) is the reporting shape; `indeterminate` must never be collapsed into `none`.
4. **`toDomain` coerces via the guard** — an unrecognised persisted value reads back `null`.
5. **The aggregate is an IN-list** built from `AuthorityAttentionCountedReasonValues` at
   class-definition time (not a hand-written SQL twin, so no mirror script is owed), with
   `COALESCE(col, '')` so the negation stays two-valued — the exact `IS_SALES_DOCUMENT_BLOCKED` trap.

### D6. No writer ships in this slice for the persisted three-plus-one

RS-S's ledger is body B, RB-L is body E, A3-X/UF-L are Wave 3. None exist on this branch. The columns
+ the single-writer method + the guards ship; the producers adopt them. This mirrors #2304 shipping a
vocabulary with no caller, and #2100 shipping `missing-required-tax-id` declared-never-written.
The states this slice can actually *produce* are the derived three (A1-U/A2-A/A5-A) plus OR-P — all
four via D4's pure functions, consumed by #2353.

## Phase 3 — Files

- NEW `libs/core/src/fulfillment-authority/domain/types/authority-attention-reason.types.ts` (+ `.spec.ts`)
- `libs/core/src/fulfillment-authority/index.ts` — one export line
- `libs/core/src/orders/infrastructure/persistence/entities/order-record.orm-entity.ts` — 2 columns
- `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts` —
  `updateFulfillmentAttention`, `toDomain` coercion, `IS_FULFILLMENT_ATTENTION` predicate
- `libs/core/src/orders/domain/ports/order-record-repository.port.ts` + the record entity/type
- `libs/core/src/returns/**` — same shape (entity, port, repository, `ReturnRecord`)
- NEW `apps/api/src/migrations/1853000000000-add-oms-attention-reason-columns.ts`
- Int-spec extension for the round-trip + level-triggered clear

## Phase 4 — Tests

- Union spec: membership, order, descriptor totality, guard rejects unknown, counted subset non-empty,
  badge/subject vocabulary closed, `authorityAttentionReasonForQuestion` total over all 7 questions.
- Repo unit spec: `toOrm` exclusion regression (both tables), coercion of an unknown stored value to
  `null`, the `IS DISTINCT FROM` no-op guard.
- Int-spec: migration applies; write → read → clear (level-triggered) → unknown value is not counted.

## Phase 5 — Risks

- **Migration slot** `1853000000000` reserved for body C. Re-prefix after `migration:generate`.
- **Column-name collision** with a sibling body writing the same table concurrently (body A adds hold
  columns to `order_records`). Names are prefixed distinctly and the migration is `IF NOT EXISTS`-guarded.
- **D4 is a deviation** and must be adjudicated by the orchestrator, not silently absorbed.

## Phase 6 — Live-tree audit findings (pre-implement), and what they changed

1. **The #2100 migration's partial index is keyed on a hardcoded value list and is ALREADY STALE**
   (`1833000000006-…`: `WHERE "salesDocumentBlockReason" IN ('unresolved-routing','missing-required-tax-id','tax-rate-conflict','trigger-model-batched')` — `'missing-tax-rate'` was added to the union
   by #2248 and never to the index, so the counted-reason query silently stopped using the index for
   it). **Do not copy that.** The new index is partial on `IS NOT NULL` only, which cannot go stale as
   the union grows, and the counted-subset filtering stays in the generated IN-list predicate.
2. **`ConnectionRepository.update` is a read-modify-write full-row `save()`**, the opposite of #2100's
   narrow-UPDATE doctrine — a reason column there would need its own targeted writer and would race
   `ConnectionService.update`. Independently reinforces D4 (derive, do not persist, the three
   config-derived states).
3. Returns models the orphan state **structurally** (`ReturnRecord.isOrphan()` = `internalOrderId IS NULL`,
   partial index `IDX_returns_orphans`); `ReturnBucketValues`' own header already cites the #2100
   attention/routine split. Confirms OR-P is derived, not persisted.
4. `RoutingPlan` / `unfulfillable` (UF-L), a reservation ledger (RS-S) and a fulfillment job-rejection
   (A3-X) **do not exist anywhere in the tree**. Confirms D6: columns + writer + guards ship, producers adopt.
5. Migration tail is `1848000000000`; the reserved body-C slot `1853000000000` is strictly greater. OK.
6. `fulfillment-authority`'s allow-set is `[]`; the new file imports only siblings *inside* the leaf.

## Phase 7 — Plan review (3 BLOCKING / 8 IMPORTANT / 4 SUGGESTION). Revision.

**All findings applied; none declined.** The two that reshape the design:

### R-B1 (BLOCKING, applied) — one scalar cannot hold three uncoordinated level-triggered producers

D5 copied `updateSalesDocumentBlock`'s single scalar. That column is safe *because
`AutoIssueTriggerService` is ONE authority that re-decides the whole question on every transition*, so
its `null` is a complete statement. Here the eventual producers are three unrelated subsystems (the
reservation ledger, routing's `unfulfillable[]`, job acceptance) and an order can genuinely be in two
states at once — one line unroutable, another short. Each producer's `none` is honest about its own
question and a **lie about the others'**, so a level-triggered scalar makes the Needs-attention count
depend on which subsystem ran last. Invisible in this slice (no writers), unrecoverable once three exist.

**Revised shape — one `jsonb` column, a PRODUCER-SCOPED upsert** (the review's option (c)):

- `order_records.omsAttention` / `returns.omsAttention` — `jsonb`, nullable, an array of
  `AuthorityAttentionEntry` = `{ producer, reason, detail?, subjectRef?, since }`.
- `AuthorityAttentionProducer` is a closed union naming WHICH question is being answered
  (`reservations` | `routing` | `acceptance` | `returns-restock`). The writer signature carries it, so
  "clear" means *clear my entry*, never *clear the row*.
- The writer replaces or removes exactly the caller's entry and leaves every other producer's alone —
  level-triggered **per producer**, which is the property the AC actually wants and the scalar could
  not give. `since` is stamped when a producer's entry first appears and preserved across a change of
  reason within one episode (#2248's `blockedAt` rule, applied per entry — which also settles **I7**
  without a second migration, and **S15**: `subjectRef` names the return line RB-L refused).

### R-B3 (BLOCKING, applied) — the three ambiguity members must PROJECT the existing block, not parallel it

`availability-unknown` / `sourcing-ambiguous` / `returns-disposition-ambiguous` are structurally the
`FulfillmentAuthorityBlock` the leaf already ships (`unresolved-authority` + an `ambiguous-*` reason).
`fulfillment-authority-outcome.types.ts` warns in terms against a second shape. So:
`attentionReasonForAuthorityBlock(block) → AuthorityAttentionReason | null` is the primitive, carried in
the descriptor as `equivalentAuthorityKind`, and `authorityAttentionReasonForQuestion` is a thin
composition over it. The persisted (owning-context) and derived (read-model) paths then cannot diverge.

### R-B2 (BLOCKING, applied) — A1-U is only half derivable, and the plan must say so

Spec §4.2 A1-U is *"two connections claim the same stock, **or the claiming system errored**"*. The
second half is a RUNTIME fact (`getCapabilityAdapter` is active-only — which is why the leaf already
carries `holder-connection-unresolvable`) and is not expressible in `Connection.config`, so
`resolveAuthorities` cannot derive it. D4 covers the **ambiguity half only**; the errored-claimant half
belongs to `inventory`'s own enforcement resolution (ADR-053) and is out of scope here. Stated in the
docblock so #2353 cannot ship believing A1-U is complete.

### Other applied findings

- **I4** — `subject` was conflating origin with render surface (A1-U originates on a connection and
  renders on a product row). Replaced by `surfaces: readonly AuthorityAttentionSurface[]`.
- **I5** — columns named `omsAttention`, not `fulfillmentAttention*`: `order_records.fulfillmentState`
  already exists and means something else, and a sibling body is adding `hold*` columns concurrently.
- **I6** — **no index in this slice.** A partial index on a column with no writer is permanently empty
  DDL, and the review is right that an `IS NOT NULL` partial index does not serve a counted-value
  predicate anyway. The producing issue sizes and adds it. Recorded in the docblock.
- **I8** — D6 is named as a SECOND deviation against AC1: this slice writes none of the five
  "written by their owning service" states through a persisted column. Proposed AC rewording is in
  Phase 8.
- **I9** — the `IF NOT EXISTS` guard is the repo's re-runnability idiom, NOT the collision defence
  (it would silently adopt a sibling's column). Claim deleted; pre-merge `origin/main` re-fetch + grep added.
- **I10** — two new inbound edges (`orders → fulfillment-authority`, `returns → fulfillment-authority`)
  registered in `docs/architecture-overview.md`'s dependency map, and `check-cross-context-imports.mjs`
  asserted (not assumed) to accept a `*Values` const + `is*` guards from that barrel.
- **I11** — added: derived-vs-persisted partition totality; `authorityAttentionReasonForQuestion` pinned
  against real `resolveAuthorities` output (not just "total"); an int-spec for `returns` too; a
  both-directions test of the counted predicate's NULL negation; migration `down()` reversibility.
- **S12/S13/S14** — docblock states that `counted` discriminates nothing *today* and why; that AF-X is
  deliberately outside this union with body D as owner (totality asserted against an explicit eight,
  never a spec row count); and a handoff note that #2357's mirror must cover `badge` + `counted`, not
  only titles.

## Phase 8 — Proposed AC rewording for the orchestrator

AC1 ("the five reachable ones are written by their owning service") is unsatisfiable here: three of the
five are derived by design (R-B2/D4) and the other two have no producer on this branch (D6). Proposed:

> All eight values declared; the three config-derived states are produced by pure functions in the leaf
> and consumed by #2353; the persisted states are adopted by their producers (body B / body E / Wave 3)
> against the producer-scoped writer this slice ships and tests.

## Phase 9 — Diff review (1 BLOCKING / 3 IMPORTANT / 6 SUGGESTION). All applied, none declined.

### R2-B1 (BLOCKING) — the CTE did not actually close the race its docblock rested on

The reading CTE was a plain, non-locking `SELECT`. Under READ COMMITTED that is only
*narrower* than a caller-side rebuild, not safe: a peer producer committing between the statement's
snapshot and its row lock is re-checked by EPQ against the `WHERE`, but `next.value` was already
materialised from the **stale** snapshot and is not recomputed — so the write lands and the peer's
entry is dropped, permanently, because a producer only writes when its own answer changes. That is
precisely the lost update the array shape exists to prevent, asserted as a guarantee in a docblock
three future producers would copy. Fixed with `FOR UPDATE` on the `cur` CTE, which blocks on a
concurrent writer and then follows the update chain so the rebuild sees the latest committed version.
A non-existent row still yields an empty CTE and a clean zero-row no-op.

### R2-I2/I3 (IMPORTANT) — two unguarded copies of the statement, one of them behaviourally untested

The forty-line CTE existed twice, differing only in table, id column and alias, with nothing failing
the build if a fix landed on one — and the returns copy's `since`/NULL-normalisation/peer-survival
behaviour was asserted only by string-matching its SQL, so the orders integration spec proved nothing
about it. Both dissolved by extracting `buildAuthorityAttentionUpsertSql` +
`buildAuthorityAttentionPayload` into the leaf (pure string construction over caller-supplied
compile-time literals — the `engineering-standards.md` pure-rule exception), with its own spec pinning
the clauses whose absence is *silent* (`FOR UPDATE` above all) and a test that the two targets differ
only in those three identifiers. The behavioural cases were then added to the returns half of the
integration spec anyway: one statement is not one table, and only real Postgres proves what SQL does.

### R2-I1 (IMPORTANT) — the port's most important docblock was attached to nothing

`updateOmsAttention`'s 30-line contract sat above `countOrdersWithOmsAttention`'s own docblock, so the
count method carried two stacked blocks and the write carried none. Reordered.

### Suggestions applied

- **S2** — the count's docblock now states it is the ORDER half, that the return half is counted on
  the returns side, and that OR-P is derived and unreachable by that predicate, so a #2353 implementer
  does not invent a third filter at the call site.
- **S3** — a spec assertion that every member matches `/^[a-z][a-z-]*[a-z]$/`, making the
  jsonpath-literal interpolation structurally safe rather than safe by convention.
- **S4** — `OrderRecord` deliberately gets NO `attentionReasons()`: an order has no derived half, and
  an accessor whose body can only be `map(...)` would read as evidence that some order state IS
  derived. Stated in the field docblock.
- **S5** — an integration case pinning the malformed-`since` path (a non-string `since` was never
  readable, `->>` yields SQL NULL, `COALESCE` restamps — the row repairs itself rather than carrying a
  corrupt value forward silently).
- **S1 / S6** — recorded in the docblocks as deliberate: the count is its own statement rather than a
  `COUNT(*) FILTER` folded into the orders summary aggregate, because nothing writes the column yet so
  there is no shared render to fold into; and `NOT (HAS_OMS_ATTENTION)` has no caller, so its negation
  direction is a tripwire for the future filter rather than a behavioural claim.

### One gate finding of its own

`check-architecture-gates.mjs` flagged the new types file as a per-connection config knob (it exports
`read*` helpers and its docblock mentions `Connection.config`). Registered under `NON_KNOBS` with the
reason: it coerces a **persisted jsonb column OL itself writes**, not an operator-authored config
value, and nothing in the file reads `Connection.config` at all — the breadcrumb is the sentence
explaining why three of the eight states are derived from it and therefore deliberately not persisted.
Counting it would inflate the #1032 threshold with a read that is not what that conversation is about.
