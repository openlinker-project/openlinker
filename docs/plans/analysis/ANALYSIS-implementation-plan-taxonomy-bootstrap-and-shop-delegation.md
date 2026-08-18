# Pre-implement gate — #2084 + #2085

**Verdict: NEEDS-REVISION** — no contract break and no reuse collision, but the plan rests on a
premise the handler does not support (F1). One decision needs restating before code.

## Reuse audit

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `enqueueTaxonomyBootstrap` on `ConnectionService` | **NEW** | Only `enqueueInitialCatalogSync` exists (connection.service.ts:390); called once, from `create()` at :369. |
| Idempotency namespace `bootstrap:*:taxonomy:sync` | **NEW** | The only `bootstrap:` key in the tree is `bootstrap:${id}:product:syncAll` (:401). No collision. |
| Second enqueue point for `destination.taxonomy.sync` | **NEW** | Today the scheduler task (scheduler.service.ts:522) is the sole enqueuer. |
| `IDestinationTaxonomyService` / its token | **EXISTS → reuse** | Interface exported from the listings barrel (index.ts:57); token at listings.tokens.ts:70. |
| `ShopCategoryBrowseService` delegation | **PARTIAL (rewrite body)** | Service + interface + token + module wiring all exist; only the method body and constructor change. |
| Per-scope lock | **EXISTS → reuse** | `taxonomySyncLockKey` (taxonomy-sync-lock.ts:70), already applied inside `syncTaxonomy`. |

## Backward-compatibility

| Surface | Finding | Severity |
|---|---|---|
| Barrels / tokens / port signatures | Nothing removed or renamed. `IShopCategoryBrowseService` keeps its signature. | none |
| ORM schema | No entity change ⇒ **no migration**. | none |
| 422 response **body** on `/shop-publish/categories` | `error` field changes from `'Unprocessable Entity'` to `'TaxonomySourceUnavailableException'`; status stays 422. No `apps/web` consumer reads it. | Warning (accepted, D4) |
| `check:invariants` | `ShopCategoryBrowseService` keeps an `implements` clause; no deep-barrel import; no new cross-context repository-port import. | none |

## F1 — CRITICAL to the plan's premise: one job ≠ one full tree

The plan says the bootstrap makes a new connection's picker populated. **It does not, in general.**

`destination-taxonomy-sync.handler.ts:121-138` calls `syncTaxonomy` **once**, persists the cursor, and
returns `outcome: 'ok'`. It does **not** self-reschedule. Continuation comes from the next hourly tick.
One run expands at most `SYNC_PAGE_LIMIT_DEFAULT = 500` parent nodes
(destination-taxonomy.service.ts:45, :183).

Consequences, split by destination kind because they differ sharply:

- **Shop (the #2085 case)** — a WooCommerce category tree is tens to low hundreds of nodes, so 500
  parent-expansions per run means the walk almost always **completes in the single bootstrap job**.
  The plan's premise holds here, which is the case that matters for the delegation.
- **Marketplace** — an Allegro tree needs many runs, i.e. several hourly ticks. The bootstrap makes
  the walk **start** immediately rather than up to an hour later; it does not make it *finish*. That
  is unchanged from today's behaviour and #2084 does not regress it, but the plan must not claim
  otherwise.

**Does a partially-populated projection reintroduce the #2075 asymmetry?** No — and this is the crux
worth stating, because it is the reason collapsing `'indeterminate'` is safe. Mid-walk, *both* halves
of the shop picker read the same partial projection, so they degrade **together**: a category absent
from search is equally absent from browse. The operator can never see a node by drilling that search
then denies. The asymmetry #2075 papered over came from two *different stores*, not from
incompleteness — so `isTaxonomyUnsynced`'s premise is restored by delegation regardless of walk
progress.

**Required plan revision**: restate D5's justification in those terms, and drop any claim that the
bootstrap guarantees a complete tree.

## F2 — Module edge is safe, but it is a real (small) architectural cost

No cycle. `apps/api` `IntegrationsModule` (integrations.module.ts:94) importing core `ListingsModule`
yields `apps/api IntegrationsModule → core ListingsModule → core IntegrationsModule →
IdentifierMappingModule`. The two `IntegrationsModule` classes are distinct (host vs core), and
`libs/core` cannot import `apps/` at all. Six `apps/api` modules already import `CoreListingsModule`,
one of them (`mappings.module.ts:40`) specifically for this token. `forwardRef` is **not** used
anywhere in the repo and is explicitly avoided — none is needed.

The cost is layering: connection lifecycle management gains its first edge into the listings context,
and `CoreListingsModule` drags Products/Inventory/Orders/Mappings/Sync behind it. Runtime weight is
nil (`app.module.ts:66` already loads that subtree), so this is graph tidiness, not memory.

**Judgement: take the edge.** The alternative is dropping D3's already-synced check, which is what
prevents a *second Allegro connection* from triggering a full redundant re-walk of a shared owner —
thousands of platform calls. The lock only prevents a *concurrent* walk, not a sequential one. Paying
one import to avoid that is the right trade, and `ConnectionService` is where the shipped bootstrap
precedent already lives; inventing a second home for the same lifecycle moment would be worse.

## F3 — AC-3 is not literally achievable (plan already says so; gate confirms)

The scheduler's key is `taxonomy:owner:<owner>:sync:<timestamp>` — timestamped per tick, owner-scoped
(scheduler.service.ts, inline; **there is no shared builder function** to reuse, contrary to the AC's
wording). A bootstrap needs run-once semantics, so the two cannot share a key without one of them
losing its property. The double-walk protection comes from the per-scope lock instead. The plan's
statement of this is accurate.

## Open questions for implementation

1. **Does the bootstrap fire for a marketplace connection at all?** D3 skips when the scope already
   has rows, so the *second* Allegro connection is skipped — correct. The *first* one starts a
   multi-hour walk immediately instead of at the next tick, which is the intended win.
2. **Pre-existing connections are not retro-filled** (the trigger is a transition). Already listed as
   Risk 1; keep it in the PR description, since it is the one case where an operator sees the
   regression #2085 otherwise avoids.
