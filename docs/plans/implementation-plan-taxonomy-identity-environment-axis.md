# Implementation Plan — taxonomy identity must account for environment (#2063)

- **Issue**: #2063 (blocks Wave 2 of #1937)
- **ADR**: [ADR-037](../architecture/adrs/037-destination-taxonomy-read-model.md) — the "one value per distinct tree" rule this restores
- **Type**: CORE (+ one Integration adapter)
- **Migration**: **no** — see § 5

---

## 1. Goal

`resolveTaxonomyOwner` currently infers a marketplace's taxonomy identity from `platformType`. Every Allegro connection carries a required `environment: 'sandbox' | 'production'` resolving to a different API host, so a sandbox and a production connection collapse to one `taxonomyOwner: 'allegro'` scope — they overwrite each other's rows and the watermark sweep **deletes** the loser's tree on every completing run.

Fix the identity, not the symptom: **stop inferring identity from `platformType` at all**, and require the adapter to declare it.

### Non-goals

- Mapping provenance (`destinationTaxonomyProvenance`, #1045) — untouched; see § 4 for why that boundary is deliberate.
- The frontier/cursor rework (#2061) and locale-aware sync (#2059).
- Erli's own catalogue-credential environment (ADR-031) — Erli borrows and does not declare identity; noted as a residual in § 6.
- Any Wave 2 consumer work.

---

## 2. The fix shape changed during research

The issue proposed *generalising `TaxonomyBorrower`* so an owning adapter also implements it. **That is wrong and would ship a silent behaviour change.**

`TaxonomyBorrower` has a second, older consumer: `OfferBuilderService:141` reads `getBorrowedTaxonomy()` to thread `borrowedTaxonomy` into `CategoryResolutionService` and `AttributeProjectionService` for **provenance-matched mapping lookup** (#1045, covered by `erli-provenance-reuse.int-spec.ts`). If Allegro started implementing `TaxonomyBorrower`, every Allegro offer build would suddenly take the borrower branch — changing mapping resolution on a shipped, tested path, as an incidental side effect of a taxonomy bug fix.

**The two concepts are genuinely different:**

| Capability | Question it answers | Who implements |
|---|---|---|
| `TaxonomyBorrower` (existing) | "Whose *mappings* do I reuse?" | a borrower (Erli) |
| `TaxonomyIdentityProvider` (new) | "Which *tree* do I read and write?" | an owner (Allegro) |

So: a **new, separate capability**, and `TaxonomyBorrower` is left exactly as it is.

---

## 3. Design

### 3.1 New capability — `domain/ports/capabilities/taxonomy-identity-provider.capability.ts`

> Filename matches the interface verbatim, as every sibling does
> (`taxonomy-borrower.capability.ts` → `TaxonomyBorrower`,
> `offer-creator.capability.ts` → `OfferCreator`).

```ts
export interface TaxonomyIdentityProvider {
  /** The distinct tree this connection reads and writes (ADR-037). */
  getTaxonomyIdentity(): TaxonomyOwner;
}

export function isTaxonomyIdentityProvider(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & TaxonomyIdentityProvider { … }
```

Same shape as every sibling in that folder: interface + co-located `is*` guard, `*.capability.ts`.

### 3.2 `TaxonomyOwnerValues` gains `'allegro:sandbox'`

```ts
export const TaxonomyOwnerValues = ['allegro', 'allegro:sandbox'] as const;
```

Qualified form matches the rule ADR-037 already sets for eBay/Amazon (`'ebay:EBAY_US'`). Additive to a closed union — nothing narrows.

### 3.3 `resolveTaxonomyOwner` — declaration only, no inference

New precedence, and the signature loses `platformType`:

```ts
export function resolveTaxonomyOwner(adapter: OfferManagerPort): TaxonomyOwner | null
```

1. `isTaxonomyBorrower(adapter)` ⇒ `getBorrowedTaxonomy()` (Erli reads the owner's rows).
2. `isTaxonomyIdentityProvider(adapter)` ⇒ `getTaxonomyIdentity()`.
3. Otherwise `null`.

Borrower stays **first**, exactly as today: a hypothetical adapter implementing
both must read the owner's tree, not mint its own.

**The `isCategoryBrowser` conjunct is deliberately not carried over.** Today it
gates the `platformType` branch; under declaration it would be redundant at best
and wrong at worst — an owner that declares its identity still *reads* that tree
(the borrower branch has never required browsing either, ADR-031). Browsing is a
separate question, answered lazily and correctly by `marketplaceBrowseFn`. Its
guard message is therefore generalised from the borrower-specific
"connection borrows a taxonomy but cannot browse it" to name either case, since
a non-borrower can now reach it.

**The `platformType` membership fallback is deleted.** It is the actual defect: it answers "which tree?" with a value that cannot express environment. Removing it is fail-safe — an adapter that does not declare identity resolves to `null`, so the sync skips it rather than writing rows under a guessed owner. Only Allegro is in `TaxonomyOwnerValues` today and it will declare, so nothing shipped regresses.

Consequence: `resolveTaxonomyOwner` no longer needs a `Connection`, so `SchedulerService.resolveOwnerForElection` drops its `getAdapter` call, and `DestinationTaxonomyService.resolveDestination` drops its `getAdapter` call on the marketplace branch — one less registry read per election and per scope resolution.

### 3.4 Allegro adapter declares its identity

`AllegroOfferManagerAdapter implements … TaxonomyIdentityProvider`:

```ts
getTaxonomyIdentity(): TaxonomyOwner {
  return this.environment === 'sandbox' ? 'allegro:sandbox' : 'allegro';
}
```

`environment` arrives as a new **optional trailing constructor param**, mirroring how `storefrontBaseUrl` (also environment-derived) was added; `AllegroAdapterFactory` already has `config.environment` at the call site. Defaulting to `'production'` when absent keeps every existing test construction valid.

> The adapter already receives `_connection: Connection` (currently `void`-ed). Deliberately **not** used: parsing `config.environment` inside the adapter would duplicate the factory's existing resolution and put config-shape knowledge in two places.

### 3.5 Manifest

`TaxonomyIdentityProvider` is **advertised-without-dispatch** — resolved only by narrowing an already-dispatched `OfferManager` adapter, never via `getCapabilityAdapter`. Follows `TaxonomyBorrower`'s precedent; no `CoreCapabilityValues` entry.

### 3.6 `TaxonomyOwnerValues` changes role — say so in both files

Today's `resolve-taxonomy-owner.ts` header states that validating `platformType`
against the closed set **is** "the guard that keeps ADR-037's one-value-per-tree
rule enforceable". After this change that runtime gate does not exist: the union
becomes a *compile-time vocabulary* that adapters are typed against, and the
enforcement moves to review of what `getTaxonomyIdentity()` returns.

That inversion must be written into both the function header and the
`TaxonomyOwnerValues` doc comment. Leaving the old wording would tell the next
reader a runtime allowlist still protects them — the most expensive kind of
stale comment, since the failure it guards against is a data migration.

---

## 4. Boundary held deliberately

`TaxonomyOwner` values are *also* the vocabulary of `destinationTaxonomyProvenance` on `category_mappings` / `attribute_mappings` (#1045), where the column is a plain `string` defaulting to `'allegro'` and matched by exact equality.

This change does **not** reach that path: mapping provenance is written by mapping authoring and read via `isTaxonomyBorrower` in `OfferBuilderService`, neither of which calls `resolveTaxonomyOwner`. A sandbox Allegro connection therefore keeps resolving its *mappings* under `'allegro'` while its *taxonomy rows* live under `'allegro:sandbox'`.

That asymmetry is correct for this issue (taxonomy trees differ per environment; an operator's authored mappings are theirs regardless) but it is a shared vocabulary with two meanings — recorded here so the next reader does not "unify" them by reflex.

---

## 5. No migration

`destination_categories` is a **projection**, and `taxonomyOwner` is a plain `text` column — no enum type, no constraint enumerating values. Rows a sandbox connection already wrote under `'allegro'` are simply re-synced under `'allegro:sandbox'`, and the watermark sweep removes the stragglers on the first completing run per scope. Wave 1 shipped hours ago with **no readers**, so there is nothing to preserve.

---

## 6. Steps

1. `taxonomy-identity-provider.capability.ts` + barrel export.
2. `TaxonomyOwnerValues` += `'allegro:sandbox'`, with the environment-axis evidence recorded next to the existing country-axis comment — **and** the note that the set is now a compile-time vocabulary, not a runtime allowlist (§ 3.6).
3. `resolveTaxonomyOwner` — new precedence, drop the `platformType` param, the inference fallback and the `isCategoryBrowser` conjunct; rewrite its header per § 3.6.
4. Update the two call sites (`DestinationTaxonomyService.resolveDestination`, `SchedulerService.resolveOwnerForElection`), removing the now-unneeded `getAdapter` reads, narrowing the scheduler's return type from `string | null` to `TaxonomyOwner | null`, generalising `marketplaceBrowseFn`'s guard message, and rewording the final `TaxonomySourceUnavailableException` to "declares no taxonomy identity" (the old "not a known taxonomy owner" names a cause that no longer exists).
5. Allegro adapter: implement the capability; factory passes `config.environment` (already required + validated at `allegro-adapter.factory.ts:198-207`, so it is always present at the call site even though the constructor param is optional).
6. Specs:
   - `resolveTaxonomyOwner` — borrower wins over identity; identity resolves; declaring nothing ⇒ `null` (the fail-safe replacing the deleted fallback); a browsing-but-undeclared adapter ⇒ `null`.
   - `AllegroOfferManagerAdapter` — `'sandbox'` ⇒ `'allegro:sandbox'`, `'production'` ⇒ `'allegro'`, omitted ⇒ `'allegro'`. Without these the new branch ships untested: the trailing-optional param keeps all **13** existing construction sites in `allegro-offer-manager.adapter.spec.ts` compiling untouched, which is the design goal but also means nothing exercises it.
   - `AllegroAdapterFactory` — actually threads `config.environment` through (an omitted optional argument type-checks).
   - Service/scheduler — sandbox vs production resolve to **different** scopes and cannot delete each other's rows.
7. ADR-037 amendment: record that the original `'allegro'` evidence covered the country axis only.
8. `architecture-overview.md` § Listings: correct the "owner = validated platformType" sentence Wave 1 added.
9. Gate: `pnpm lint`, `type-check`, `test`, `check:invariants`, plus the taxonomy int-spec.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Touching `TaxonomyBorrower` would alter #1045 mapping resolution | Not touched — separate capability (§ 2) |
| Removing the `platformType` fallback silently disables a future marketplace's sync | Fail-safe by design (no rows under a guessed owner) and asserted by a spec; the `null` path already logs + throws `TaxonomySourceUnavailableException` with an actionable message |
| Long positional constructor grows again | Trailing optional param with a default, matching the `storefrontBaseUrl` precedent |
| Erli borrowing a *sandbox* Allegro catalogue still resolves to `'allegro'` | Out of scope, recorded as a residual on #2063 — Erli's catalogue client has its own credentials (ADR-031) |
