# Implementation Plan — #2071 Column-scope `InventoryRepository.upsert`

**Issue:** #2071
**Branch:** `2071-inventory-upsert-column-scope`
**Layer:** CORE → Infrastructure (persistence). No migration, no contract change, no behaviour change.

---

## 1. The task

`InventoryRepository.upsert` (`inventory.repository.ts:208-242`) writes an existing `inventory_items`
row through `save(entity)` after `toOrmEntity` has populated **every** column. Which columns the
master sync is allowed to touch is therefore an emergent property of TypeORM's diffing, not a stated
rule — nothing declares it and nothing fails when it changes.

`inventory_items` is the row every published quantity derives from, so the failure mode is an
oversell or a mass unpublish, produced with **zero compile errors**.

### Audit result: nothing is wrongly written today

The issue's Assumptions section asks for this check. Current entity columns
(`inventory-item.orm-entity.ts`) and their writers:

| Column | Written by upsert | Owner |
|---|---|---|
| `id`, `productId`, `productVariantId`, `locationId` | yes (identity) | the lookup key itself |
| `availableQuantity` | yes | master sync |
| `reservedQuantity` | yes | master sync — **a mirror, not an OL counter** |
| `isStale` | yes, **unconditionally `false`** | master sync *and* the prune (`markStaleExcept`) |
| `updatedAt` | assigned, then **discarded** — see below | the DB (`@UpdateDateColumn`) |

**`isStale` is written `false` on every upsert, not conditionally.** The only construction of the
domain entity outside this repository is `master-inventory-sync.service.ts:309-317`, which passes
seven arguments and omits `isStale`, so the constructor default (`inventory-item.entity.ts:25`)
applies every time. `toOrmEntity:279-281` cites #1478 ("clears the flag when a variant reappears"),
but that comment states *intent* — it is not what makes this safe.

**What makes it safe is ordering, and that belongs in writing.**
`syncFromMasterByExternalId` loops `setInventory` per returned inventory (`:99-105`), accumulating
`currentVariantIds`, and only *afterwards* calls `pruneStaleVariants(..., currentVariantIds)`
(`:131`), which stales rows `WHERE productVariantId NOT IN keep` (`inventory.repository.ts:184`).
The upserted set and the staled set are therefore **disjoint by construction**, so an upsert cannot
un-stale a row the same run just flagged. (The location axis only *widens* the keep set — the prune
is per-variant, not per-location — so it cannot create an overlap either.)

> **Precondition, recorded because nothing else records it:** `isStale` may remain in the master
> sync's owned set only while every `upsert` caller is followed by a prune whose keep-set contains
> what it just wrote. A second `setInventory` caller outside the sync, or moving the prune before the
> loop, breaks this.

**`updatedAt` is the one column that was genuinely written wrong — so this is a fix, not only
hardening.** `toOrmEntity:282` assigns `item.updatedAt`, and on the `save()` path that value
**reached the database**: `SubjectChangedColumnsComputer.js:33-40` has `column.isUpdateDate`
explicitly *commented out* of its skip list, so an assigned update-date enters the change map and
suppresses `CURRENT_TIMESTAMP`. (The `SubjectExecutor.js:340-342` overwrite that appears to prevent
this sits inside the **MongoDB** branch at `:330` and never runs for Postgres — a trap worth naming,
because it reads like the general case.)

So an `@UpdateDateColumn` has been carrying a **master-supplied** value. It has never bitten only
because both shipped inventory-master adapters leave the field undefined
(`woocommerce-inventory-master.adapter.ts:455`; PrestaShop never sets it), and
`master-inventory-sync.service.ts:316` fills the gap with `?? new Date()` — app-clock now. An adapter
that starts reporting `updatedAt` would silently take over the column.

That matters because `UpdateQueryBuilder.js:401-403` appends the auto-timestamp *only if the column
is absent from the SET clause*, and `inventory.service.ts:64-65,79` derives the propagation job's
**dedupe key** from `upserted.updatedAt.toISOString()`. A master reporting a stable timestamp while
quantity moved would produce a colliding key and the propagation job would be dropped silently.
`updatedAt` is therefore classified **DB-managed** and left out of the SET clause, which hands the
column back to Postgres.

> **Clock source moves app → DB.** The persisted value becomes `CURRENT_TIMESTAMP` (transaction start
> time) rather than the app clock. Harmless and arguably more correct. One tripwire: if a future
> caller wraps a multi-row `setInventory` loop in a single explicit transaction, every row would get
> an *identical* `updatedAt`. Safe today because the dedupe key also includes `productId` and
> `productVariantId` (`inventory.service.ts:126-129`) — recorded here so it stays deliberate.

**This is mostly hardening, plus one real fix.** The hardening removes a prospective risk: a column
added to the entity later — an OL-owned counter, a reservation field — silently joining the master
sync's write set and being overwritten on every sync. The fix is `updatedAt`, which the old path
genuinely persisted from the master (see below).

### Non-goals

- Changing any written value. A normal master sync must produce a byte-identical row.
- **The insert branch**, and not as a compromise: an INSERT necessarily writes every column, so there
  is no other writer's column to avoid clobbering. Column-scoping it would be ceremony.
- Touching `markStaleExcept` / `pruneStaleVariants`.
- Making the `isStale = false` default explicit at the construction site
  (`master-inventory-sync.service.ts:317` relies on a positional constructor default for a field with
  real semantics). A genuine readability wart, but a different change — noted so it is not mistaken
  for an oversight here.

---

## 2. Design

**Name the write set; write exactly it.**

Three column groups, declared as `as const` arrays beside the repository:

- **Identity** — `id`, `productId`, `productVariantId`, `locationId`. These *are* the lookup key
  (`findByProductAndVariant` matches on the last three), so writing them back is a no-op at best and
  a row-identity change at worst. Excluded from the update.
- **Master-owned payload** — `availableQuantity`, `reservedQuantity`, `isStale`. What the master sync
  is entitled to write.
- **DB-managed** — `updatedAt`, left out of the SET clause so `@UpdateDateColumn` keeps stamping it
  (see § 1). Its own group rather than "identity", because it is neither: it is written, just not by
  us.

The existing-row branch becomes a column-scoped update over the master-owned set.

**Query builder, not `repository.update(id, …)`** — and this is a deliberate departure from the
dominant repo idiom (`user.repository.ts:67`, `sync-job.repository.ts:181`, `shipment.repository.ts:119`,
`order-record.repository.ts:599`). Because `updatedAt` is now DB-stamped, the returned domain entity
cannot reconstruct it from the input item, and `inventory.service.ts:64` reads exactly that field for
the dedupe key. `.returning(['updatedAt'])` gets the persisted value in the same round-trip; the
query-builder form is the one that supports it, and this file already uses both the builder
(`:171`) and `.returning()` (`:195`).

Every other returned field is safe from the input item: `id` is `existing.id` (what `save()` returned
too — the branch already assigned it at `:220`), the identity columns were the lookup key, and
`availableQuantity` / `reservedQuantity` / `isStale` are written from `item`.

### Relationship to #2107 / #2141

Those fixed the sibling `order-record.repository.ts` by *excluding* columns so another writer stayed
sole owner. Inventory has no column owned by someone else that the upsert is stealing, so there is
nothing to exclude. Note also that neither of those introduced a reusable artifact — that file
contains no column-set constant, only narrow `update()` calls — so there is no existing shape to
mirror. The enumerated-set protection here is genuinely new.

### The testability problem, stated

The issue's AC asks for a test that "a column outside the owned set is **not** modified". No such
column exists today — every column is either identity or owned. A test asserting that would have to
invent a fake column, and would prove nothing about the real risk.

The real risk is a *future* column. So the guard is a **contract test over the entity's declared
columns**: read TypeORM's `getMetadataArgsStorage()` (no DataSource needed) and assert the entity's
column set equals `IDENTITY ∪ OWNED`. Adding a column to the entity then fails the build until it is
deliberately classified — the same "must be updated on purpose" shape as
`route-lazy.test.ts`'s `EXPECTED_LAZY_ROUTE_COUNT` (`docs/frontend-architecture.md`).

That is the test the AC is reaching for; the literal wording is not satisfiable.

---

## 3. Steps

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `inventory.repository.ts` | Declare `INVENTORY_IDENTITY_COLUMNS`, `INVENTORY_MASTER_OWNED_COLUMNS`, `INVENTORY_DB_MANAGED_COLUMNS` as `as const`, with comments stating that the master sync owns the payload set, that `reservedQuantity` is a **mirror** rewritten every sync (it has been misread before), and why `updatedAt` is excluded | All three sets exported for the contract test |
| 2 | `inventory.repository.ts` | Existing-row branch: query-builder update over the owned set, `.returning(['updatedAt'])`; return built from the item + `existing.id` + the returned `updatedAt` | `save` is not called on that branch |
| 3 | `inventory.repository.spec.ts` | Behavioural test: the SET payload has exactly the three owned keys **and** each value `===` the corresponding `item` field; the update is keyed on `existing.id` | Fails if a key is added, dropped, or mis-sourced |
| 4 | `inventory.repository.spec.ts` | Contract test: entity columns == identity ∪ owned ∪ db-managed | Fails when a column is added to the entity |

The spec's mock repository (`spec.ts:59-66`) has no `createQueryBuilder` update path wired for this;
it needs one, or the new test throws on `undefined`.

---

## 4. Validation

- **Architecture:** infrastructure persistence only. No port signature change
  (`InventoryRepositoryPort.upsert` keeps `(item) => Promise<InventoryItem>`), and `InventoryRepository`
  is its only implementer — no in-memory fake, no `testing` sub-barrel — so no consumer moves.
- **Standards:** the three column lists are `UPPER_SNAKE_CASE` `as const` value constants, matching the
  documented union-type pattern; they live beside the repository that enforces them rather than in a
  `*.types.ts`, because they are an implementation invariant of this one write, not a shared type.
- **Security:** none — no user input, no raw SQL interpolation (the builder binds parameters).
- **Testing:** unit, **plus an existing integration test that already covers this exact branch** —
  `apps/api/test/integration/inventory-stale-prune.int-spec.ts:150` ("clears isStale when a variant
  reappears via setInventory, reusing the same row") drives `setInventory` → `upsert` → the
  existing-row path and asserts row identity, `isStale === false` and the quantity. It must be run,
  and it is the best available proof of the "no behaviour change" AC.

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| Naming `updatedAt` in the SET clause would suppress `@UpdateDateColumn` | It is deliberately excluded and classified DB-managed (§ 1). The contract test keeps that classification honest. |
| The returned entity's `updatedAt` can no longer come from the input item | `.returning(['updatedAt'])` reads the persisted value in the same round-trip. This is why the query-builder form is used instead of `repository.update`. |
| `save()` emits no UPDATE for an unchanged row; a builder update always writes one | Negligible in practice: `toOrmEntity` assigns a fresh `item.updatedAt` (defaulted to `new Date()` at `master-inventory-sync.service.ts:316`) on every call, so `save()`'s change map is non-empty essentially every sync already. Worth knowing rather than worth avoiding. |
| A future column is added and silently joins the write set | Exactly what step 4's contract test prevents — it fails until the column is classified into one of the three groups. |
| The `isStale` ordering precondition is broken by a later change | Recorded explicitly in § 1 and in a code comment beside the owned set. |
| **A scoped UPDATE cannot resurrect a deleted row, where `save()` would have re-INSERTed it** | Zero affected rows now raises `InventoryRowVanishedError` rather than returning an item for a row that does not exist (which would enqueue a propagation for absent stock). Unreachable today — the port has no delete, the staleness sweep is a soft update, and both FKs are `ON DELETE NO ACTION` — so this is a guard for a future delete path, not a live case. |
| A driver silently ignores `.returning()` | TypeORM makes `.returning()` a no-op where unsupported, which would leave `raw` empty on every successful update. Falling back to `item.updatedAt` there would reintroduce exactly the master-supplied timestamp this change removes, so an affected row with no returned value throws instead. |
| Two concurrent syncs of the same variant race between the read and the update | Last-write-wins, unchanged from the previous `save()` behaviour and acceptable for a single-writer master sync. Noted rather than fixed. |
