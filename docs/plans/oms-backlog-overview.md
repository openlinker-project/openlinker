# OMS Programme — Backlog Overview

The map of the OMS authority-model programme: what each wave is for, what gates it, and where the
long chains run. It is a **navigation document**, not a source of truth — the decisions live in
[`analysis/DESIGN-oms-authority-model.md`](./analysis/DESIGN-oms-authority-model.md) and
[`analysis/REVIEW-oms-authority-model.md`](./analysis/REVIEW-oms-authority-model.md), and the
architectural commitments in [ADRs 052–062](../architecture/adrs/) (merged in PR #2281).

Two product specs cover the operator-facing half of Wave 2:

- [`../specs/product-spec-oms-wave2-operator-experience.md`](../specs/product-spec-oms-wave2-operator-experience.md)
  — order holds, the authority surface and presets, automation v1.
- [`../specs/product-spec-oms-returns-operator-ux.md`](../specs/product-spec-oms-returns-operator-ux.md)
  — returns custody, disposition, money and the commission-refund flow.

The authority surface's shape is prototyped in
[`mockups/mockup-who-decides-what.html`](./mockups/mockup-who-decides-what.html).

## Reading the slugs

Backlog issues are referenced here by **W-slug** (`W1a-3`, `W2-14`, `W3a-19`, `W4-7`). GitHub
numbers are assigned at filing time; every issue in the programme carries the **`oms`** label, so
`label:oms` is the durable way to find them. Wave 0 is the exception — it is already filed and is
referenced by its real numbers.

Streams used throughout: **S1** = core inventory/fulfillment BE · **S2** = orders/returns BE ·
**S3** = product/FE. Sizes: **S** ≤2d · **M** ≤5d · **L** ≤10d.

---

## Wave structure at a glance

| Wave | Subject | Children | Status |
|---|---|---|---|
| **0** | Preconditions and correctness fixes | 8 | **Filed** — #2282–#2289 |
| **1a** | Vocabulary leaves + derived order lifecycle phase | 8 | To file |
| **1b** | Inventory foundations: locations, provenance, availability seam | 11 | To file (+1 unscheduled, Wave 1d) |
| **1c** | Returns, observed | 10 filed / 9 active | To file (scope fork on #2289) |
| **2** | The majority's OMS value | 51 | To file |
| **3a** | Fulfilment routing, work objects, desktop worklist | 22 | To file |
| **3b** | Store-associate scan/pick surface | 8 | To file |
| **4** | Third-party OMS, posture B, port hardening | 11 | To file |

Both demand gates have **fired**: a live multi-location routing pain case exists (Wave 3) and
third-party OMS/3PL demand exists (Wave 4). Only `W4-9` — the vendor adapter — stays parameterized,
because no vendor is named yet.

---

## Wave 0 — preconditions (filed: #2282–#2289)

The correctness work that later waves name as preconditions rather than assume. `persistOrder`
source-attribution immutability (#2282, also ADR-057's stated precondition), the ingestion line-diff
and `amended` fact (#2283), the `WHERE cancelledAt IS NULL` provisioning predicate (#2284, an
ADR-059 named precondition), the quantity-derived `inv:{hash}` idempotency-key swap (#2285, which
must be gone before propagation behaviour changes or the corrective write dedups against the stale
key), `never`-default exhaustiveness on the five `OrderLifecycleEvent` consumers (#2286), `packedAt`
BE/FE (#2287/#2288 — automation trigger T5's backing fact), and the Allegro customer-returns feed
spike (#2289, which sets Wave 1c's scope fork). #2296/#2297 (CI) are done; #2298 is the
design-freshness reconciliation.

## Wave 1a — vocabulary leaves + derived lifecycle phase (8 children)

The only genuinely zero-behaviour wave in the programme — the delivery panel split the original
Wave 1 into 1a/1b/1c/1d precisely because the "zero behaviour" label was false of the other three.
It lands the two vocabulary leaf contexts every later wave imports (fulfillment-authority,
order-lifecycle) plus the one operator-facing read that pays for itself immediately: the derived
`OrderLifecyclePhase`. `order_records` already carries six quasi-status axes and `OrderHealth`
answers *sync* health; nothing answers "what is this order waiting on, and who holds it up". ADR-059
supersedes the reverted ADR-043 by persisting facts and deriving the phase — no new persisted
column, no write-path change. `W1a-8` also owns the `architecture-overview.md` pointer lines for
ADRs 052, 053 and 059; the other eight ADRs in the block are assigned to the wave that first
implements them.

**Gated on:** #2284, #2286, #2283 merged; the ADR 052–062 block merged; #2298 resolved.

## Wave 1b — inventory foundations (11 children)

`inventory_items` is nominally location-aware and behaviourally single-location: one line in
`inventory.service.ts` disables propagation outright for a non-null `locationId`, the row carries no
connection provenance (which is why the #1904 rival-master guard is detect-and-withhold rather than
attributable), both partial unique indexes include the nullable `locationId` so duplicate
locationless positions are permitted and silently summed, and no `inventory_locations` table exists.
Wave 1b ships steps (i) and (ii) of ADR-058's three-step ladder — nullable `sourceConnectionId` plus
a `'legacy'` sentinel backfill — the locations table and CRUD, provenance-scoped lookup and
per-source pruning, and the `IAvailabilityService` computed seam that every publishing site is then
rewired onto. **Not zero-behaviour**, and it carries the programme's one declared plugin-breaking
change (retiring the `locationId` propagation skip). Step (iii) is filed as Wave 1d, unscheduled —
migrations run in one transaction, so `CREATE INDEX CONCURRENTLY` is unavailable and index
recreation would hold `ACCESS EXCLUSIVE` on the live oversell table.

**Gated on:** #2285 merged; ADR-058 merged; `W1a-8` landed.

## Wave 1c — returns, observed (10 filed / 9 active)

OL has no returns model; `libs/core/src/returns/` does not exist and the only adjacent persistence
is the capture-only `RefundRecord` (#2036). ADR-060 keeps ANALYSIS-1032's source-shape findings
wholesale (verbatim `rawStatus`, nullable `resolvedOrderLineId` by design) and puts an OL-owned
aggregate above the projection. This wave **observes** only: the aggregate, the orphan bucket,
ingestion, the read API, list and detail, and the single source write `return.decline`. Nothing here
writes stock, money or an invoice correction.

Scope forks on **#2289**: if the Allegro feed is cursor- or watermark-shaped, returns get their own
poll/sync jobs through a `ReturnSourceReader` sub-capability (`W1c-4A`); if the kill condition
fires, they land as projection-only observations off order sync (`W1c-4B`). Exactly one of the two
is filed — everything else in the epic is identical either way, because the aggregate, orphan
bucket, read API and FE do not depend on how the observation arrived.

**Gated on:** #2289 resolved with the fork decided; Wave 1a landed; ADR-060 merged.

## Wave 2 — the majority's OMS value (51 children)

Waves 1a–1c land vocabulary, a derived phase, inventory foundations and an observed returns record.
None of them change what an operator can **do**. Wave 2 is the first wave with operator value on the
majority topology — the single-location, self-shipping seller — and the roadmap names it as part of
the minimal coherent V1. Five bodies of work share one epic because they share the attention surface
and the authority read:

1. **Order holds** (5 children) — the first OL-owned lifecycle write.
2. **The reservation ledger** (8) — the only thing in the programme that makes an ingested order
   reduce what channels may promise.
3. **The authority surface + presets** (7) — shipping *together with* the first operator-settable
   authority flag; the design forbids shipping the flag without the surface.
4. **Automation v1** (12) — 8 triggers × 6 actions over a closed legality matrix, plus its
   operational half: every firing recorded, landed on the acted-on order's timeline, and a failed
   action raised as its own attention state (AF-X). Automation that spends real money without
   leaving a trace where the operator looks is a configuration surface, not an operational one.
5. **Returns custody, disposition, money and the Allegro commission refund** (17, incl. one spike) —
   plus the `InventoryMasterPort.adjustInventory` amendment, without which `restock_blocked` is the
   *default* outcome on the most common OL master.

Two DX gates close the wave (`W2-46a` vocabulary, `W2-46b` responsive audit). **`W2-50`** (Allegro
commission-claim spike) and **`W2-46a`** are scheduled first: both are dependency-free, and their
answers constrain later work.

**Gated on:** Wave 1a in full; `W1b-6`, `W1b-7`, `W1b-9`, `W1b-11`; #2283, #2287/#2288 merged; Wave
1c landed with its fork decided; `W1c-6` (`order_changes` — reused, never rebuilt); and both product
specs signed off including spec §8 Q1. A `no` on Q1 deletes `W2-21`…`W2-29` and nothing else.

## Wave 3a — routing, work objects, desktop worklist (22 children)

OL can route nothing today: `OrderIngestionService` goes `persistOrder` → `syncOrder`, fanning every
order out to every destination. A seller with two locations, a 3PL, or a no-shop topology cannot say
which lines are fulfilled where, cannot dry-run that decision, and has no object to hang progress
on. Because `identifier_mappings` is a bijection per connection (ADR-044), the order itself can
never be split — the *work* must be. Wave 3a lands the router seam, the `routing_decisions` intent
row, the `FulfillmentWork` aggregate with its two orthogonal state axes, the executor handshake,
core-side progress ingress, the OL-OMS plugin at `libs/oms/`, and a **desktop** worklist with manual
mark-picked / mark-shipped. Per REVIEW D10 the cut sits *before* the floor UI — 3a lights the 3PL
story without it. A router-less install must run byte-identically to today, pinned by a
characterisation test.

**Gated on:** Wave 1b locations (with `countryIso2`/`postcode`/optional geo — the `country-served`
and `nearest` rules are unimplementable without them) and the availability seam; Wave 1a's leaves
and conformance checklist; Wave 2's holds, reservation ledger and authority surface; #2282. Only
`W3a-1` (package scaffold) is startable immediately.

## Wave 3b — the store-associate scan surface (8 children)

3a's desktop worklist is enough for a 3PL, not for a human on a floor with a scanner. REVIEW D10
sizes this honestly as its own wizard-scale FE epic (~30 files / ~10k lines) and refuses to hide it
inside 3a. Design §5.4's `short_picked` + `releaseShortfall` semantics are only exercisable once
something on the floor can report a shortfall, so the re-sourcing logic ships here too.

**Gated on:** Wave 3a merged — specifically `W3a-11` (progress ingress), `W3a-18` (OL executor) and
`W3a-19` (read model); and **#2080** (pack-station principal ADR) decided and merged. A shared floor
terminal is not an ordinary logged-in admin session; this epic consumes #2080's answer and does not
re-open it.

## Wave 4 — third-party OMS, posture B, port hardening (11 children)

The plugin-contracts panel's verdict was blunt: *"a competent third party cannot ship an adapter
against this contract as it stands"* — nine referenced I/O types undefined, no per-port error
taxonomy or timeout budget, a synchronous `route()` where a DOMS is not, no batch caps. `W4-1`…`W4-5`
close that and are **binding blockers**: no out-of-tree or vendor port-implementation issue may start
until all five are merged. The wave also lands the posture-B seam (an external OMS owning the order
and pushing it in — substantially just an `OrderSource`, blocked on the ADR-057 predicate), ADR-062
trust activation, one vendor-parameterized adapter, and the two scale features the design defers
here (location networks, returns disposition routing).

**Gated on:** Wave 3a merged; #2282; and, for `W4-9` alone, a named vendor. Waving and
`ReturnReceiver` are deferred by the design and not filed.

---

## Cross-wave critical paths

Three long chains run through the programme. They are largely independent, which is what makes
three streams worth staffing.

**1. Lifecycle / orders (S2).**
`#2286 → W1a-2 → W1a-3 (+#2284) → W1a-4 → W1a-5 → W1a-6` → Wave 2 holds
(`W2-1 → W2-2 → W2-3/W2-4 → W2-5`) → automation, which converges late:
`W2-23` (trigger emission) sits downstream of *both* the returns disposition writes (`W2-33`) and
the shortfall episode (`W2-12`), not parallel to them. It is the wave's real convergence point and
the piece most likely to slip; if S2 is one person, run returns before automation — returns has more
downstream FE and unblocks `W2-23` besides.

**2. Inventory / fulfilment (S1) — the longest chain in Wave 1.**
`#2285 → W1b-3 → W1b-4 → W1b-5 → W1b-6 → W1b-7 → W1b-8`, feeding the Wave-2 reservation ledger
(`W2-6 → W2-7 → W2-8/W2-9/W2-10 → W2-11/W2-12 → W2-13`), which in turn is a Wave-3a entry criterion.
From there:
`W3a-1 → W3a-2 → W3a-3 → W3a-6 → W3a-7 → (W3a-10 / W3a-11) → W3a-19 → W3a-20`, then into Wave 3b
(`W3b-1 → W3b-3 → W3b-4 → W3b-5/W3b-6/W3b-7 → W3b-8`) and Wave 4's blockers
(`W4-1 → W4-2 → W4-3 → W4-9`).

**3. Returns (S2 → S3).**
`#2289 → W1c-1 → W1c-2 → W1c-4A → W1c-6 → W1c-9`, continuing into Wave 2 custody and money
(`W2-30/W2-31 → W2-32/W2-33 → W2-34/W2-35/W2-38 → W2-37 → W2-39 → W2-42/W2-44`) and terminating in
Wave 4's returns disposition routing (`W4-11`), which additionally needs the Wave-2 reservation
ledger.

---

## Standing rules

Two directives bind every issue in the programme and are restated in each epic rather than assumed.

**UI naming (REVIEW P9).** The words *authority*, *posture* and *FulfillmentWork* never reach the
UI. Operator-facing copy uses "Who decides X?", "fulfilment task", and outcome-named presets. The
`W2-46a` vocabulary gate enforces this and must land before any Wave-2 copy is written.

**Boundary (ADR-053 no-injection invariant).** The `fulfillment` context injects **no** `orders` or
`inventory` service. Order data enters as arguments; type needs go through
`@openlinker/core/orders/types`. A boot integration test pins the one-way edge, following the
ADR-041 F3 precedent.

**Frontend (S3).** Every Zod schema mirroring a backend projection uses `.nullish()`, never
`.optional()` — OL serialises an absent optional as JSON `null`, and under `.optional()` one `null`
sub-field drops the whole section (#939). Each new feature folder ships its public `index.ts` barrel
and registers its slug in both `.eslintrc.js` `no-restricted-imports` pattern groups.
