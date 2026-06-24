# Implementation Plan — Erli/core variant-group populator (`erliVariantGroup` → neutral `variantGroup`) — #1065

> Closes the end-to-end gap left by #986 (PR #1062). #986 shipped the Erli
> adapter half: `buildCreateBody` emits `externalVariantGroup` + distinguishing
> `attributes` **when** the command carries grouping data — but **nothing in
> core populates it**, so `buildVariantGroup(cmd)` returns `null` in every real
> flow and multi-variant products still list **ungrouped** (#986 AC1 only
> structurally met). This story adds the CORE populator that threads the parent
> product id + flattened distinguishing variant attributes onto the
> offer-creation command so grouping happens end-to-end.
>
> Precedent: #824 Allegro multi-variant expansion. Allegro **auto-groups** off
> its Product Catalog (GTIN + a distinguishing parameter) — no explicit group
> ref needed, which is why #824 left "emit OL variant attributes as explicit
> distinguishing parameters" as a deferred follow-up. Erli has **no** auto-group;
> grouping is **explicit** via the group id, so Erli needs the populator #824
> never required.

## 1. Goal

Make a multi-variant OL product list as **one grouped** Erli buyer-facing
listing end-to-end (#1065 AC1), while single-variant / simple products pass
through **ungrouped** unchanged (#1065 AC2), with coverage for the core
populator threading the group ref + attributes (#1065 AC3).

The grouping inputs already exist in core on `ProductVariant`
(`productId` = the natural group anchor; `attributes: Record<string,string> | null`
= the distinguishing axes) and are already loaded by `OfferBuilderService`
(`variant`, `product = productMaster.getProduct(variant.productId)`). They are
simply **not threaded onto the command** today. This story threads them.

## 2. The hexagonal constraint — and the neutral design (centerpiece)

### 2.1 The boundary problem

The #986 adapter reads a **platform-named** key today:

```ts
// erli-offer-manager.adapter.ts (#986)
const candidate = cmd.overrides?.platformParams?.erliVariantGroup;   // ← "erli" name
```

`platformParams` is the documented opaque adapter-interpreted bag, so the
*adapter* reading an erli-named key out of it is fine — that's exactly what the
bag is for, and the neutral `CreateOfferCommand` stays platform-neutral.

The boundary violation would be **on the core side**: if the core populator
wrote `overrides.platformParams.erliVariantGroup = {...}`, then
`libs/core/src/listings/**` would hardcode the literal string `erliVariantGroup`
— a platform name baked into core. That:

- contradicts CLAUDE.md "CORE MUST NOT bleed platform knowledge" / "Do not blur
  the CORE ↔ Integration boundary";
- is exactly the shape the cross-context guard (`scripts/check-cross-context-imports.mjs`,
  `pnpm check:invariants`) and the engineering-standards "platform-neutral core"
  posture exist to prevent;
- doesn't generalise — eBay/Shopify/Woo would each need their own core-side
  platform-named key, turning the neutral builder into a platform switchboard.

### 2.2 Decision: a neutral top-level `variantGroup` field on `CreateOfferCommand`

Core populates a **platform-neutral** grouping field; the Erli adapter MAPS it
to Erli's `externalVariantGroup` + `attributes`. The neutral field is a
**top-level command field** (alongside the existing `variantBarcode` /
`productCardId` pre-resolved hints), NOT a `platformParams` key:

```ts
// libs/core/src/listings/domain/types/offer-create.types.ts (NEW neutral type)

/**
 * Cross-marketplace variant-grouping hint. Present only when the offer is one
 * sibling of a multi-variant product the platform should render as a single
 * grouped listing. Platform-neutral: each adapter maps it to its own grouping
 * mechanism (Erli `externalVariantGroup`; auto-grouping platforms like Allegro
 * ignore it). Absent ⇒ list standalone (single-variant / simple products).
 */
export interface OfferVariantGroup {
  /**
   * Opaque, stable grouping token shared by every sibling of the same product
   * (today the parent OL product id, `variant.productId`). Adapters MUST treat
   * it as an opaque grouping key and forward it to their own grouping mechanism
   * — never parse it, attribute meaning to it, or assume a particular id shape
   * (it is NOT necessarily the same shape as a variant id). The "= parent
   * product id" is a core-private convention, not part of the contract.
   */
  groupId: string;
  /** This variant's distinguishing axes, flattened from ProductVariant.attributes. */
  attributes: OfferVariantAttribute[];
}

/** One distinguishing axis, e.g. { name: 'Color', value: 'Red' }. */
export interface OfferVariantAttribute {
  name: string;
  value: string;
}
```

```ts
// on CreateOfferCommand:
  /**
   * Platform-neutral variant-grouping hint, populated by OfferBuilderService for
   * a sibling of a multi-variant product. Adapters that group explicitly (Erli)
   * map it to their wire shape; auto-grouping adapters (Allegro) ignore it.
   * Absent ⇒ standalone listing.
   */
  variantGroup?: OfferVariantGroup;
```

**Why top-level, not `platformParams`:**

- The two existing pre-resolved hints the builder lifts onto the command for the
  *exact same reason* — `variantBarcode` and `productCardId` — are **top-level**,
  not in `platformParams`. `variantGroup` is the same kind of thing: a builder
  pre-resolution every adapter may consume. It belongs in the same place, typed.
- `platformParams` is `Record<string, unknown>` — untyped by design (it carries
  per-platform opaque blobs). A neutral, well-known, every-adapter concept
  deserves a **typed** field so it's discoverable and type-checked, not stuffed
  into the opaque bag under a stringly-typed key.
- It keeps core free of any platform-named string. The only place a platform
  name appears is inside the Erli adapter (where it belongs).

**Why `groupId = parent product id` (not a new identity):** every sibling of the
same product already shares `variant.productId`; it's the natural, stable,
already-loaded anchor. No new identifier-mapping entry, no schema. The Erli
adapter wraps it as `externalVariantGroup: { id: groupId }` (the #986 wire shape
already models the group ref as a bare `{ id }`).

### 2.3 The adapter change #986 requires (read the neutral key)

The #986 adapter must stop reading `overrides.platformParams.erliVariantGroup`
and instead read the neutral top-level `cmd.variantGroup`. This is a small,
contained rewrite of the `buildVariantGroup` free function + its guards:

- `buildVariantGroup(cmd)` reads `cmd.variantGroup` (typed `OfferVariantGroup |
  undefined`) instead of narrowing the opaque `platformParams.erliVariantGroup`.
- Because `cmd.variantGroup` is now a **typed** core field, the defensive
  `unknown`-narrowing guards (`isErliVariantGroupShape`, `isVariantAttributeShape`)
  are **no longer needed for type-safety** — the field arrives typed. Keep a
  minimal guard only for the runtime invariant the adapter still owns: emit the
  group **only** when `groupId` is a non-empty string (so a defensively-built
  empty group never produces `externalVariantGroup: { id: '' }`), and copy
  `attributes` verbatim (already `{name,value}` strings from core).
- `ErliVariantAttribute` (erli wire type) and `OfferVariantAttribute` (neutral)
  are structurally identical `{ name; value }` — the adapter maps field-for-field;
  no transform.
- Header comments on the adapter + `erli-product.types.ts` update: the data now
  comes from the neutral `cmd.variantGroup` (populated by core), not the deferred
  `platformParams.erliVariantGroup` (which no longer exists).

This is the explicit reconciliation the task calls out: **#986's
`platformParams.erliVariantGroup` read is replaced by the neutral
`cmd.variantGroup` read.** No erli-named key survives anywhere in core; the
adapter reads a typed neutral field and maps it to its own wire shape.

**Security invariant — `groupId` is body-only, never path-validated.** The Erli
adapter forwards `cmd.variantGroup.groupId` exclusively into the request
**body** (`externalVariantGroup: { id: groupId }`). It MUST NOT be funnelled
through `productPath()` or any path-building helper: the request path is built
solely from the `internalVariantId` guarded by `ERLI_PRODUCT_ID_PATTERN` +
`encodeURIComponent`, and `groupId` is the **parent product id**
(`ol_product_*`) — a different shape from the variant id that pattern enforces,
so routing it into a path would both reject legitimate product ids and create a
path-injection surface. Record this body-only invariant as a one-line note in
the adapter header so the #992 reconciliation never accidentally promotes it to
a path component. (`groupId` is also internally sourced — the OL parent product
id — not external/untrusted input, so the empty-`groupId` guard in §2.3 is the
only runtime check the adapter owns.)

**No logging of attribute content.** Neither the core populator nor the
rewritten adapter mapping logs `attributes` names/values or the flattened pairs,
consistent with the existing adapter debug logging (which logs `connectionId` +
Erli frozen-name only, never field values). Explicit non-goal — do not add logs
that echo variant-attribute strings.

## 3. Where the populator lives — `OfferBuilderService` (single chokepoint)

`OfferBuilderService.buildCreateOfferCommand` is the **single** place every
create command is assembled — single-offer (`OfferCreationExecutionService`)
**and** bulk (#824 expansion enqueues per-variant jobs whose commands are built
here at run time). It already:

- loads the `variant` (`productsService.getVariant(input.internalVariantId)`) —
  so `variant.attributes` and `variant.productId` are in hand;
- loads the parent `product` via `ProductMasterPort`.

It is missing only one fact: **is this product multi-variant?** It must not emit
a group for a single-variant / simple product (AC2). To know sibling count it
needs the product's variant list. `IProductsService.getVariantsByProductId`
already exists (the #824 bulk expander uses it). The builder calls it once and:

- **multi-variant** (`siblings.length > 1`) ⇒ populate
  `command.variantGroup = { groupId: variant.productId, attributes: flatten(variant.attributes) }`;
- **single-variant / simple / unknown** ⇒ leave `variantGroup` absent.

`flatten(attributes)` maps `Record<string,string>` → `OfferVariantAttribute[]`
via `Object.entries(attrs ?? {})`, applying the **explicit drop predicate
`name.length > 0 && value.length > 0`** (no `trim()` — a deliberately-set single
space is preserved, avoiding surprising an operator who set a meaningful
whitespace value), then sorting by `name` so two runs of the same variant
produce a byte-identical command (idempotency-friendly). A variant with
`attributes: null` in a multi-variant product still gets `variantGroup` with an
**empty** `attributes` array — the group ref alone lets Erli group; the adapter
omits the empty `attributes` key (already its behaviour). The group is what
makes siblings ONE listing; the attributes only label the selectable axes.

**Attribute strings are externally-sourced and pass through verbatim.**
`ProductVariant.attributes` originates from external platform product data
(PrestaShop combinations, etc.), so names/values are not OL-controlled. After
the empty-drop they flow unaltered into the Erli request **body** (never a
path/query/SQL/log surface). v1 applies **no length/cardinality bound** — the
body-only destination contains the blast radius and Erli validates payload size
server-side; a conservative cap in `flattenAttributes` is a possible future
hardening, noted but not done now.

**Marketplace-neutral, including for Allegro:** the builder populates
`variantGroup` for *every* multi-variant offer regardless of target platform.
The Allegro adapter simply doesn't read it (it auto-groups), so Allegro
behaviour is unchanged — and #824's deferred "emit explicit distinguishing
parameters" follow-up could later consume the very same neutral field. One
neutral populator; each adapter decides what to do with it. This is the correct
hexagonal shape: core expresses intent ("these are grouped siblings, here are
the axes"), adapters realise it per platform.

**Cost:** one extra `getVariantsByProductId` per built command. Acceptable —
command building is already multi-await (variant + connection + product master +
category resolution); one more indexed-by-product read is in the noise and only
runs at create time, never on the hot inventory path. (If profiling ever flags
it, the #824 expander already computed sibling lists upstream and could pass a
`siblingCount` hint down — noted as a future optimisation, not done now; see
R3.)

**Sibling count (populate decision) ≠ actual fan-out (post-barcode-filter).**
The #824 bulk expander (`BulkListingSubmitService.expandVariantJobs`) drops
siblings without an EAN/GTIN, so the *number of offers actually created* can be
smaller than the builder's `getVariantsByProductId` sibling count. Consequence:
a product with 1 barcoded + 1 barcodeless variant produces ONE Erli offer that
the builder still stamps with `variantGroup` (raw sibling count = 2 > 1). This
is intentional and benign — Erli groups by the group ref, and a group-of-one
renders as one listing; master-stock-0 handling is unaffected. The builder owns
the multi-variant decision independently of the caller's fan-out (which is the
more hexagonally honest shape), so the two counts are decoupled by design. No
code change — flagged so reviewers don't expect them to match.

## 4. Changes

### 4.1 Core — `libs/core/src/listings/domain/types/offer-create.types.ts`

- Add `OfferVariantAttribute { name: string; value: string }`.
- Add `OfferVariantGroup { groupId: string; attributes: OfferVariantAttribute[] }`.
- Add optional `variantGroup?: OfferVariantGroup` to `CreateOfferCommand`, documented
  as a platform-neutral builder pre-resolution (mirrors `variantBarcode` /
  `productCardId` doc style).
- Types-in-separate-file rule satisfied (already a `*.types.ts`).

### 4.2 Core — `libs/core/src/listings/index.ts` (public barrel)

- Add `OfferVariantGroup` + `OfferVariantAttribute` to the **existing
  `export type { CreateOfferCommand, CreateOfferOverrides, ... } from
  './domain/types/offer-create.types'` block** at `index.ts:164-170` — they are
  pure object-shape interfaces (no runtime value), so they go in the `export
  type {}` group, NOT a plain `export {}` (matches the sibling
  `CreateOfferCommand` exports; keeps them type-only, avoids
  isolatedModules/verbatimModuleSyntax breakage, and keeps them off any
  value-import circular-require concern). The Erli adapter type-imports them from
  `@openlinker/core/listings` (cross-context contract: domain type aliases
  published in the barrel are allowed; #594 / cross-context rules). The `as
  const` + union-array standard does **not** apply — these are interfaces, not
  enumerated string unions, so no runtime values array is needed. **This is the
  one core public-surface change → run `pnpm check:invariants`** (the new
  symbols are an allowed cross-context shape and introduce no deny-pattern, so
  the guard passes).

### 4.3 Core — `libs/core/src/listings/application/services/offer-builder.service.ts`

- After loading `variant` + `product`, call
  `this.productsService.getVariantsByProductId(variant.productId)` and compute
  `siblings.length > 1`.
- A private pure helper `resolveVariantGroup(variant, siblingCount): OfferVariantGroup | undefined`
  returns `{ groupId: variant.productId, attributes: flattenAttributes(variant.attributes) }`
  when `siblingCount > 1`, else `undefined`. (Named `resolveVariantGroup`, not
  `buildVariantGroup`, to avoid confusion with the adapter's now-deleted
  `buildVariantGroup` — they live in different packages but the rename keeps the
  diff unambiguous.) `flattenAttributes` is a small pure function (no IO):
  `Object.entries(attrs ?? {})`, drop entries failing `name.length > 0 &&
  value.length > 0` (no `trim`, per §3), sort by name, map to `{ name, value }`.
- Set `command.variantGroup = group` only when defined (keep the command shape
  tidy, consistent with the existing `cleanedOverrides`/`?? null` posture).
- Update the service header to note the variant-group pre-resolution (#1065).
- Constructor/deps unchanged — `IProductsService` is already injected.

### 4.4 Erli adapter — `libs/integrations/erli/.../erli-offer-manager.adapter.ts`

**Concrete chosen shape (resolves the `group.id` vs `group.groupId` seam):**
delete the now-redundant local `ResolvedVariantGroup` interface AND the
`buildVariantGroup` free function entirely; read the typed neutral field
directly inside `buildCreateBody`. The neutral field is named `groupId`; the
Erli **wire** ref type `ErliVariantGroupRef` keeps its field name `id`. So the
mapping is explicitly **neutral `cmd.variantGroup.groupId` → wire
`ErliVariantGroupRef.id`**. The current `buildCreateBody` block reads `group.id`
(line 315); after the rewrite it reads `g.groupId`.

Replace the current `// #986:` block (lines 310-319) with an inline guard:

```ts
// #1065: explicit multi-variant grouping. Present only when core populated the
// neutral cmd.variantGroup (OfferBuilderService); single/simple products omit it
// and list ungrouped. externalVariantGroup.id is body-only — never path-validated.
const g = cmd.variantGroup;
if (g && g.groupId.length > 0) {
  body.externalVariantGroup = { id: g.groupId };
  if (g.attributes.length > 0) {
    body.attributes = g.attributes;
  }
}
```

- The neutral `OfferVariantAttribute` (`{ name; value }`) and the wire
  `ErliVariantAttribute` (`{ name; value }`) are structurally identical, so
  `g.attributes` assigns to `body.attributes` directly — no per-entry copy, no
  transform.
- Import `OfferVariantGroup` (type) from `@openlinker/core/listings`. Drop the
  local `unknown`-narrowing machinery that existed only because the value used
  to come from the opaque bag.
- **Remove only:** `ResolvedVariantGroup`, `ErliVariantGroupShape`,
  `isErliVariantGroupShape`, `isVariantAttributeShape`, and `buildVariantGroup`
  itself.
- **Keep:** the `ErliVariantAttribute` type import (line 83) — it is the wire
  body shape, still referenced by `ErliProductCreateBody.attributes`; and
  `ErliVariantGroupRef` / `ErliVariantAttribute` in `erli-product.types.ts`
  (wire types, unchanged, still PROVISIONAL #992). Do NOT over-prune
  `ErliVariantAttribute` just because it shares the `ErliVariant*` prefix with
  the removed shapes.
- **Confirm `toUnknownArray` stays** — still used by `buildExternalAttributes`
  (#985, line 426). Verified present; leave it.
- **Comment updates (catch all three stale references to
  `platformParams.erliVariantGroup`):**
  1. adapter header lines 41–48 ("when the command's
     `overrides.platformParams.erliVariantGroup` is populated" → neutral
     `cmd.variantGroup`, core-populated #1065; add the body-only/never-path
     invariant line);
  2. the inline `// #986:` emit-block comment at lines 310–312 (replaced by the
     `// #1065:` block above);
  3. the `erli-product.types.ts` header docblock for the grouping wire types.
- Run `pnpm exec eslint` after — `no-unused-vars`/`unused-import` will catch any
  stragglers left by the removals.

### 4.5 No changes

Factory, plugin, module, HTTP client, validators, tester, retry/auth
classifiers, `OfferCreationExecutionService`, the #824 bulk expander
(`BulkListingSubmitService`), the create-offer command's other fields. The bulk
path benefits automatically: its per-variant jobs flow through the same builder,
so each sibling job now gets `variantGroup` populated with no bulk-specific code.

## 5. Schema migration

**None.** No ORM entity changes. `variantGroup` is a transient command field
(built in memory, sent to the adapter, never persisted as a column). The group
anchor is the existing `variant.productId`; no new identifier-mapping rows, no
new tables, no new columns. (`docs/migrations.md` workflow not triggered — no
`*.orm-entity.ts` touched. `migration:show` not required.)

## 6. Tests

### 6.1 Core — `libs/core/src/listings/application/services/__tests__/offer-builder.service.spec.ts` (new `variant grouping (#1065)` describe)

> **Mandatory mock change (type-check trap):** the spec currently types the
> products mock as `jest.Mocked<Pick<IProductsService, 'getVariant'>>` and builds
> it as `{ getVariant: jest.fn()... }` (lines 25, 52). Once the builder calls
> `getVariantsByProductId`, this fails type-check AND throws at runtime in every
> pre-existing test unless **both** are updated:
> 1. **Widen the `Pick`** to `Pick<IProductsService, 'getVariant' |
>    'getVariantsByProductId'>`.
> 2. **Seed a default** in `beforeEach`:
>    `getVariantsByProductId: jest.fn().mockResolvedValue([defaultVariant])` —
>    a single-element list whose element shares `defaultVariant.productId`, so
>    all pre-existing single-offer cases resolve `siblings.length === 1` and keep
>    `variantGroup` absent (preserves AC2 behaviour in legacy tests).
>
> Test names stay in the `should [behaviour] when [condition]` form — the bullets
> below are assertion shorthand, not the `it()` string.

New cases (`getVariantsByProductId` mocked per-case):

1. **Multi-variant → `variantGroup` populated.** Product with 2 siblings, the
   built variant has `attributes: { Color: 'Red', Size: 'M' }` ⇒ command has
   `variantGroup = { groupId: <productId>, attributes: [{name:'Color',value:'Red'},
   {name:'Size',value:'M'}] }` (sorted by name, deterministic).
2. **Single-variant → no `variantGroup`.** `getVariantsByProductId` returns one
   variant ⇒ command has `variantGroup === undefined`.
3. **Multi-variant with `attributes: null` → group ref, empty attributes.**
   ⇒ `variantGroup = { groupId, attributes: [] }`.
4. **Attribute hygiene.** Empty-string keys/values dropped; ordering stable.
5. **Siblings share the same `groupId`.** Mock `getVariantsByProductId` to
   return >1 sibling for the product; build commands for two siblings (distinct
   `internalVariantId`, same product) and assert on the **built command's**
   `variantGroup.groupId === <productId>` for both. This is the case that most
   directly proves the core populator's contract — keep it a pure builder-output
   assertion, distinct from the adapter-emit assertion in §6.2 case 3 (which
   asserts the body, not the command).

### 6.2 Erli — `__tests__/erli-offer-manager.adapter.spec.ts` (rewrite the `variant grouping (#986)` describe to feed the neutral field)

The five existing #986 cases keep their assertions on the emitted body
(`externalVariantGroup` / `attributes`); only the **input** changes from
`overrides.platformParams.erliVariantGroup` to top-level `variantGroup`:

1. **Multi-variant → group + attributes present.** `variantGroup = { groupId:
   'ol_product_…', attributes: [{name:'Color',value:'Red'}] }` ⇒ body has
   `externalVariantGroup: { id: 'ol_product_…' }` + `attributes: [{name:'Color',
   value:'Red'}]`.
2. **Standalone → ungrouped.** No `variantGroup` (or empty `groupId`) ⇒ body has
   neither key.
3. **Siblings share group id** ⇒ both bodies carry the same
   `externalVariantGroup.id`, each POSTs to its own variant path.
4. **Attributes hygiene / empty** ⇒ `groupId` present, `attributes` absent ⇒
   `externalVariantGroup` set, no `attributes` key.
5. **Grouping is create-only** ⇒ a field/quantity PATCH never carries grouping
   (regression guard preserved).

Update the spec's `createCmd` helper to accept `variantGroup` at the top level.
Keep the existing `should …` test-name form (the bullets are assertion
shorthand). The five cases assert on the emitted body, distinct from §6.1 which
asserts on the built command — together they cover the populate→map seam.

## 7. Risks / deferrals

- **R1 (#992): Erli wire shapes still PROVISIONAL.** `externalVariantGroup` key,
  group-id semantics (parent product id vs dedicated key), and `attributes`
  shape are unconfirmed until the sandbox spike. **Contained to the Erli adapter
  + `erli-product.types.ts`** — the neutral core `OfferVariantGroup` is stable
  regardless of how Erli's wire shape lands; only the adapter's mapping changes
  if #992 reveals a different shape. The neutral/wire split is exactly what makes
  this safe.
- **R2: distinguishing-axis selection emits ALL of a variant's `attributes`,**
  not only the axes that actually distinguish siblings (e.g. a shared "Brand:
  Acme" attribute identical across every sibling would be emitted as a
  "distinguishing" axis). For Allegro this is moot (it ignores the field). For
  **Erli the buyer-facing symptom is real**: supplying a non-distinguishing
  (shared) axis as a selectable variant axis can render a degenerate
  single-option selector on the listing. Acceptable for v1 — Erli renders
  selectable options from whatever axes are supplied, and OL variant attributes
  are typically the distinguishing set already — but **#992 sandbox validation
  should confirm Erli tolerates non-distinguishing axes gracefully** before this
  is considered done end-to-end. Computing the true distinguishing subset
  (intersect/diff across siblings) is a pure core refinement that can live in
  `flattenAttributes` / the builder helper later without any contract change.
  Noted, deferred.
- **R3: extra `getVariantsByProductId` read per built command.** Quantified in
  §3 — acceptable (create-path only, already multi-await). Future optimisation:
  the #824 expander already computes `variantsByProduct` and could thread a
  count down as `siblingCount?: number` on `BuildCreateOfferCommandInput`, with
  the builder preferring it when present and falling back to the read. If
  adopted it MUST be a **neutral scalar perf hint** — never a platform-named
  field. The current "builder re-derives independently" design is the more
  hexagonally honest shape (the builder owns the multi-variant decision
  regardless of caller), so deferring is the right call, not just the lazy one.
  Not done now (keeps this story localised to the builder + adapter).
- **R4: Allegro parity.** Allegro now receives `variantGroup` on multi-variant
  commands and ignores it (auto-grouping) — no behaviour change, verified by the
  existing Allegro adapter specs (it reads neither `variantGroup` nor anything
  derived from it). The neutral field is the seam #824's deferred "explicit
  distinguishing parameters" follow-up can later adopt.

## 8. Gate (cross-context — cover BOTH core and erli)

Run from the worktree root
(`.claude/worktrees/1065-erli-variant-group-populator`):

```bash
# type-check both sides (core public type changed → erli imports it)
pnpm --filter @openlinker/core type-check
pnpm --filter @openlinker/core build              # rebuild dist BEFORE erli type-check
pnpm --filter @openlinker/integrations-erli type-check

# lint changed files + the cross-context import guard (core public surface changed)
pnpm exec eslint <changed files>
pnpm check:invariants

# tests, scoped (constrained machine)
pnpm --filter @openlinker/core test -- offer-builder
pnpm --filter @openlinker/integrations-erli test
```

No `any` (neutral field is typed end-to-end — the adapter's old `unknown`
narrowing is deleted, not relocated). Core types imported from the
`@openlinker/core/listings` barrel only. Erli wire shapes stay isolated in
`erli-product.types.ts`. No core→erli naming: the only platform string
(`externalVariantGroup` / erli-named keys) lives inside the Erli adapter.

## 9. Acceptance-criteria trace

| #1065 AC | Delivered by |
|---|---|
| Multi-variant lists as ONE grouped Erli listing end-to-end | §3 builder populates `variantGroup`; §4.4 adapter maps it to `externalVariantGroup` — the previously-`null` `buildVariantGroup(cmd)` is now fed real data. **Structurally delivered + unit-covered; observable buyer-facing grouping confirmed by the #992 sandbox spike** (see R1) — the unit tests prove the command carries `variantGroup` and the body carries `externalVariantGroup`, not that Erli renders one listing |
| Single/simple pass through ungrouped, unchanged | §3 emits `variantGroup` only when `siblings.length > 1`; §6.1 case 2, §6.2 case 2 |
| Coverage for the core populator threading group ref + attributes | §6.1 (5 core cases) + §6.2 (5 adapter cases) |
