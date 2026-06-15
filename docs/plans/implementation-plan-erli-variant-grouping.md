# Implementation Plan — Erli multi-variant grouping (`externalVariantGroup`) — #986

> Story #986 in the #978 Erli offers half. Depends on #984 (offer-manager) /
> #985 (category-param reuse) / #988 (frozen-field) — all already in this base.
> Sequential stack: this lands purely in the `// #986:` seam of
> `buildCreateBody` + additive wire types in `erli-product.types.ts`. It does
> NOT touch the `#985` taxonomy logic, the `#988` create/PATCH/frozen logic, the
> factory, the plugin, or any core contract.

## 1. Goal

Emit Erli's **explicit** variant grouping so a multi-variant OL product lists as
**one** buyer-facing Erli listing instead of N unrelated ones (spec §5 story 3).
Each variant is its own Erli product keyed by its own `externalId`
(`resolveErliProductId(cmd)` = the OL variant id, already the case);
`externalVariantGroup.id` (the parent/base OL product id) groups the siblings;
distinguishing axes are declared via a per-variant `attributes[]` array.

Unlike Allegro (Product-Catalog **auto**-grouping off GTIN + a distinguishing
parameter — no explicit group field), Erli grouping is explicit via the group
id. Single-variant / simple products pass through **ungrouped** — no
`externalVariantGroup`, no grouping `attributes`.

## 2. Key design question — resolved (data source for group id + attributes)

**Where do the group id (parent product id) and the variant's distinguishing
attributes come from, and does the factory change?**

Evidence gathered from the live repo:

| Source | Carries group id? | Carries variant attributes? |
|---|---|---|
| `CreateOfferCommand` (`@openlinker/core/listings`, `offer-create.types.ts`) | **No** — fields are `internalVariantId`, `connectionId`, `price`, `stock`, `publishImmediately`, `overrides` (`title`/`description`/`categoryId`/`productCardId`/`imageUrls`/`platformParams`), `idempotencyKey`, `variantBarcode`, `productCardId`. No parent-product id, no sibling/group info, no `attributes`. | **No** |
| `ProductVariant` entity (`libs/core/src/products`) | `productId` (the natural group anchor) | `attributes: Record<string,string> \| null` (the distinguishing axes) |
| `OfferBuilderService` | Fetches the variant + parent product internally (`variant.productId`, `productMaster.getProduct(...)`) but **does not thread either onto the command** | same |
| #824 multi-variant expansion (`BulkListingSubmitService.expandVariantJobs`) | Fans out one job **per sibling variant** keyed by `variantId`; siblings drop the FE `productCardId` so each self-links by barcode — but the emitted `CreateOfferCommand` stays the flat shape (no group id, no attributes) | same |

**Conclusion.** The grouping inputs exist in core (on `ProductVariant`) but are
**not** on the neutral `CreateOfferCommand` and never reach any adapter today.
Allegro doesn't need them (auto-grouping); Erli does (explicit). To populate the
group, the adapter would need **one** of:

1. a products-service / `IIntegrationsService` dependency → **new factory dep +
   new core wiring** (the adapter would fetch the variant + siblings itself), or
2. core threading `parentProductId` + `attributes` onto `CreateOfferCommand` via
   `OfferBuilderService` (which already loads both) → **a cross-cutting change to
   the neutral contract shared by Allegro/eBay/Woo/Shopify**.

**Decision: do neither structural change now. Factory is UNCHANGED.** Both
options are out of proportion to a single sequential-stack story and contradict
the established posture (#984/#985/#988 deliberately avoided factory churn; the
factory comment explicitly says #985/#986/#988 should "extend behaviour without
churning this signature"). Instead:

- **Wire shape + `buildCreateBody` seam land now** (the additive, isolated,
  low-risk part the issue scopes): `ErliProductCreateBody` gains optional
  `externalVariantGroup?: { id: string }` and a variant `attributes?: {
  name: string; value: string }[]`; `buildCreateBody`'s `// #986:` seam reads
  the grouping inputs from a forward-compatible, **adapter-neutral** location on
  the command — `overrides.platformParams` (the documented opaque
  adapter-interpreted bag) — under an Erli-scoped key, and emits
  `externalVariantGroup` + `attributes` **only** when a group id is present AND
  the product is genuinely multi-variant.
- **Core plumbing that POPULATES that location is explicitly DEFERRED.** Until a
  follow-up threads `parentProductId` + sibling-distinguishing `attributes`
  through `OfferBuilderService`/the bulk expansion into
  `overrides.platformParams.erliVariantGroup`, the key is absent → the adapter
  emits **ungrouped** — which is exactly the required single/simple passthrough
  behaviour, so the adapter is *correct today* and *grouped automatically* the
  moment the data arrives. No dead code: the seam is exercised by unit tests
  feeding the command shape directly, the same way #985 tests feed
  `platformParams.parameters`.

This is the smallest correct approach: zero core-contract change, zero factory
change, wire shapes isolated to `erli-product.types.ts`, and a single documented
deferral for the core data-population follow-up.

### 2a. The Erli-scoped `platformParams` contract (this story's micro-contract)

`overrides.platformParams.erliVariantGroup` (read defensively, narrowed — no
`any`):

```ts
// Provisional, read-only on the command; populated by a deferred core follow-up.
{ groupId: string; attributes?: { name: string; value: string }[] }
```

- `groupId` — the parent/base OL product id; becomes `externalVariantGroup.id`.
  Present ⇒ the product is multi-variant (the populator sets it only then).
  Absent / empty ⇒ ungrouped.
- `attributes` — the variant's distinguishing axes (`{name,value}`), already
  flattened from `ProductVariant.attributes` (`Record<string,string>`) by the
  populator. Emitted verbatim onto the create body. Absent ⇒ no `attributes`.

Reading from `platformParams` mirrors the #985 precedent
(`platformParams.parameters`/`.productParameters`) — Erli reads only the keys it
knows; the neutral command stays platform-neutral; no new top-level command
field is invented for one platform.

## 3. Changes

### 3.1 `erli-product.types.ts` (additive wire shapes, PROVISIONAL #992)

- New interface `ErliVariantGroupRef { id: string }`.
- New interface `ErliVariantAttribute { name: string; value: string }`.
- On `ErliProductCreateBody`: add `externalVariantGroup?: ErliVariantGroupRef`
  and `attributes?: ErliVariantAttribute[]` (both optional; omitted ⇒ ungrouped).
- Update the file header: replace "Variant grouping (#986) remains absent." with
  a one-line note that #986 adds the provisional group/attribute shapes (still
  PROVISIONAL until the #992 sandbox spike — single reconciliation point).
- `ErliProductPatchBody = ErliProductCreateBody` is unchanged structurally;
  grouping is create-only (the adapter never emits group/attributes on PATCH —
  `buildPatchFromFields` is untouched), matching the #985 create-only posture.

### 3.2 `erli-offer-manager.adapter.ts` — the `// #986:` seam

- Replace the `// #986: externalVariantGroup is assembled here.` placeholder with
  a call that reads `cmd.overrides?.platformParams?.erliVariantGroup`, narrows it
  with a local type-guard (`isErliVariantGroupInput`), and when a non-empty
  `groupId` is present sets `body.externalVariantGroup = { id: groupId }` and,
  if `attributes` is a non-empty well-formed `{name,value}[]`, sets
  `body.attributes`.
- A free function `buildVariantGroup(cmd)` + guard, co-located with the existing
  `buildExternalCategories` / `buildExternalAttributes` free functions and their
  `isAllegroParameterShape` guard, for symmetry and testability. No `any` — narrow
  `unknown` via the guard exactly like `isAllegroParameterShape`.
- `resolveErliProductId(cmd)` is REUSED unchanged for the per-variant external id
  (already `cmd.internalVariantId`). No path/security change — grouping touches
  only the body.
- Update the adapter header's "Out of scope … variant grouping #986" line to
  note #986 now emits create-time grouping from `platformParams.erliVariantGroup`
  (data population deferred to core follow-up).

### 3.3 No changes

Factory, plugin, module, HTTP client, validators, tester, retry/auth
classifiers, core contracts — all untouched.

## 4. Tests (`erli-offer-manager.adapter.spec.ts`, new `variant grouping (#986)` describe)

Feed the command shape directly (mirrors the #985 `platformParams` tests):

1. **Multi-variant → group + attributes present**: `platformParams.erliVariantGroup
   = { groupId: 'ol_product_…', attributes: [{name:'Color',value:'Red'}] }` ⇒ body
   has `externalVariantGroup: { id: 'ol_product_…' }` and `attributes:
   [{name:'Color',value:'Red'}]`.
2. **Single/simple → ungrouped**: no `erliVariantGroup` key (or empty `groupId`)
   ⇒ body has neither `externalVariantGroup` nor grouping `attributes`.
3. **Sibling variants share the same group id**: two commands with different
   `internalVariantId` but the same `groupId` ⇒ both bodies carry the same
   `externalVariantGroup.id` (and each still POSTs to its own variant path).
4. **Attributes mapping / hygiene**: `groupId` present but `attributes` absent ⇒
   `externalVariantGroup` set, no `attributes` key; malformed attribute entries
   (missing `name`/`value`, non-string) are dropped; empty `attributes` ⇒ key
   omitted.
5. **Grouping is create-only**: a field-update / quantity-update PATCH never
   carries `externalVariantGroup` or grouping `attributes` (regression guard on
   the create-only posture).

Update the spec header issue list to `(#984, #985, #986, #988)`.

## 5. Risks / deferrals

- **R1 (primary, documented above): core does not yet populate
  `platformParams.erliVariantGroup`.** Consequence: Erli offers list ungrouped
  until the follow-up lands — identical to today's behaviour, no regression. The
  follow-up (thread `parentProductId` + flattened sibling-distinguishing
  `attributes` through `OfferBuilderService` / the #824 expansion) is the
  natural home because both inputs are already loaded there; it is intentionally
  **out of this story's scope** (it changes the core contract + the bulk path,
  which deserves its own issue). Flagged in the leftover-concerns of the report.
- **R2 (#992): wire shapes provisional.** `externalVariantGroup`/`attributes`
  field names + the group-id semantics (parent id vs a dedicated group key) are
  unconfirmed until the sandbox spike. Contained to `erli-product.types.ts`
  (single reconciliation point) per the existing PROVISIONAL convention.
- **R3: attribute axis selection.** Emitting *all* of a variant's `attributes`
  vs only the axes that actually distinguish siblings is a populator concern
  (core), not the adapter's — the adapter emits what it's given. Noted so the
  follow-up decides the distinguishing-axis policy.

## 6. Gate

`pnpm --filter "@openlinker/integrations-erli^..." build`, then type-check +
lint + test on `@openlinker/integrations-erli`. No `any`; types from the
`@openlinker/core/listings` barrel; wire shapes isolated in
`erli-product.types.ts`.
