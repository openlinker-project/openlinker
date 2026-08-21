# ADR-046: Adapter-declared description format

- **Status**: Accepted
- **Date**: 2026-08-19
- **Authors**: @norbert-kulus-blockydevs

## Context

A product description is HTML at every stage of the pipeline. Each destination accepts a different, narrow subset of it, and OpenLinker records that subset nowhere.

**Allegro accepts seven tags** - `h1 h2 p ul ol li b` - attributes forbidden, and the allowed set depends on the parent element:

| Context | Allowed children |
|---|---|
| top level | `h1 h2 p ul ol` |
| inside `<p>` | `b` |
| inside `<ul>` / `<ol>` | `li` |
| inside `<li>` | `b p` |
| inside `<h1>` / `<h2>` | nothing - no formatting at all |

Rejected unconditionally: `strong em i u br div span`. Allegro publishes no tag list; the grammar is reconstructed from verbatim validator rejection messages in the `allegro/allegro-api` issue tracker - `Błędny tag "br", dozwolone są: {b}` (#11708, 2025-06-24), `Błędny tag "strong", dozwolone są: {b}` together with `Błędny tag "b", dozwolone są: {h1, h2, p, ul, ol}` in one payload (#9714, 2024-08-22), `Błędny tag "ul", dozwolone są: {b, p}` (#10656, 2025-01-13), and `Błędny tag "h2", dozwolone są: {b}` on `description.sections[0].items[0].content` (#3856). Two opposite allowed sets for one payload is what makes this a grammar rather than a list.

**Erli accepts nine**, published in its own API doc: `h1 h2 h3 p b br/ ol ul li`, attributes forbidden, headings unformatted, and `<br/>` **must** be self-closing. Erli additionally documents that a plain-text HTML string is accepted with no tag restriction and then *silently converted*, so a malformed payload there costs fidelity rather than availability.

**WooCommerce** trims server-side through `wp_kses`, whose allowlist varies with the API user's role and the store's configuration.

The only enforcement in the repo is `sanitizeAllegroDescription`, a regex pass private to the Allegro package: its allowlist admits `br strong i em u` beyond the valid set, and it normalises every self-closing variant to `<br>` before passing it through. Each of those is a guaranteed 422, so we have been constructing rejected payloads. Its own header comment anticipated this: *"If this utility ever ingests user-controlled HTML (e.g. an in-app description editor) swap to a real allowlist parser."* That editor is now being built (#2193) - and an editor must know what its destination accepts before it can offer a control.

## Decision

**A destination declares its own content contract; core owns the single implementation that enforces it; the frontend composes its editor from that declaration and holds no knowledge of its own.**

The contract is a neutral `DescriptionFormat` value type in `libs/core/src/listings/domain/types/`, carrying allowed tags, per-tag allowed attributes, a `parent → allowed children` content model, rewrites applied *before* the allowlist, block-opener and self-closing-void requirements, and a byte cap. It is declared through one pure synchronous method, `getDescriptionFormat()`, and **no new capability is registered** - but the two halves attach at different levels, which is a real asymmetry and not a wording detail:

- **Marketplace** - the method is added to the existing `OfferFieldUpdater` sub-capability (`listings/domain/ports/capabilities/offer-field-updater.capability.ts`), whose own contract already names `description`. Optional, opted into per adapter, reached through the existing `isOfferFieldUpdater` guard. This is the `TaxonomyBorrower.getBorrowedTaxonomy()` precedent exactly.
- **Shop** - `ProductPublisher` is a capability *value* in `CoreCapabilityValues`, not an interface; the interface behind it is `ShopProductManagerPort` (`listings/domain/ports/shop-product-manager.port.ts`), a base port carrying only `publishProduct`. The method is therefore added to that **base port**, making it required of every shop adapter. That deliberately widens a port this repo otherwise keeps minimal, and it is the right trade here: none of the three existing shop sub-capabilities (`ShopAttributeReader`, `ShopCategoryBrowser`, `ShopProductStatusReader`) is about content, so hanging content on one of them would be worse than admitting the base port grew - and unlike a marketplace offer field, a shop publish *always* carries a description, so there is nothing to opt out of.

One pure helper, `applyDescriptionFormat`, enforces it. **The rule is that every path publishing a description to a LISTING destination applies the format** - a marketplace offer or a shop product listing. Stated as a rule rather than a list, precisely because the list keeps being wrong. Today there are **four**:

1. `OfferBuilderService` - offer create.
2. `ProductPublishBuilderService` - shop publish.
3. `IntegrationsContentPublisherService` - the Content tab's channel publish. Narrows with `isOfferFieldUpdater` and calls `updateOfferFields` directly, passing through neither builder.
4. `MarketplaceOfferFieldUpdateHandler` (`apps/worker`) - the edit-offer drawer's `marketplace.offer.updateFields` job. Also calls the adapter directly.

The enumeration was wrong twice while this decision was being written: the first draft named only the two builders, review added the third, and implementing it found the fourth. That is the argument for the rule form, and for `resolveOfferDescriptionFormat` / `formatOfferFieldsForDestination` existing as one shared implementation rather than four copies. `sanitizeAllegroDescription` is deleted.

**Writing a description back to the MASTER is deliberately outside the rule.** `IntegrationsContentPublisherService`'s master path calls `ProductMasterPort.updateProduct` with the operator's draft and applies no format, and `ProductMasterPort` carries no declaration. That is not an oversight: the master is the catalogue of record rather than a listing destination, its own editor is the authority on what it accepts, and it is where the broad HTML originates - which is why the PrestaShop and WooCommerce declarations are permissive in the first place. Widening a third port to declare a near-permissive format would buy consistency of shape at the cost of implying the master constrains something it does not. A future master that genuinely restricts its description field would be the reason to revisit this, and would want its own declaration rather than a borrowed one.

Three subordinate decisions are settled here:

1. **A destination declaring no format resolves to a conservative shared subset, plus a visible "this destination has not declared its format" state in the UI.** Never a permissive guess - a permissive guess yields a platform rejection the operator cannot explain to themselves. Note which destinations that state is actually reachable for: the method is *required* on `ShopProductManagerPort`, so a shop can never be undeclared, and the only reachable case is a marketplace adapter that declares `OfferCreator` without `OfferFieldUpdater` (none exists today). **The fallback is resolved server-side**, so the HTTP response always carries a usable format plus a flag saying it is the fallback - the frontend never holds a default of its own, which is what makes the "holds no knowledge" claim above true rather than aspirational.
2. **`i` / `em` are rewritten to `b`, not unwrapped**, with the lossy conversion stated on the editor's italic control. Renaming loses the semantic distinction but the operator sees it happen; unwrapping loses the emphasis silently.
3. **Rewrites run before the allowlist.** Ordering them the other way would delete the very emphasis the operator applied and call it sanitisation.

## Alternatives considered

- **A static `AdapterMetadata` manifest entry.** Cheaper: readable without constructing an adapter, already the designed seam for host-side tooling that inspects capabilities at boot. Rejected because a manifest entry is per *adapter* and cannot express WooCommerce's genuine per-*connection* variance; a capability method receives the `connectionId` its adapter was built with.
- **A table in the frontend.** Rejected because it puts the knowledge furthest from the system that enforces it, and a new integration would then need a frontend PR to become usable.
- **Status quo: a bespoke sanitiser per adapter.** Rejected because it is N implementations and N chances to guess the grammar wrong, which has already happened once and shipped.
- **A new `DescriptionFormatReader` sub-capability.** Rejected because the registered capability surface should not grow for a field the existing contracts already carry - `OfferFieldUpdater` names `description` in its own doc comment, and a shop publish always carries one. A third capability would also have to be resolved separately at every call site, where today the format comes off the adapter the site already holds.
- **The adapter applies its own declared format.** Rejected because two sources of truth drift, and a declaration describing an editor the adapter no longer honours is worse than no declaration at all. The adapter also keeps no defensive second pass, for the same reason - which is what makes the *every path applies it* rule above load-bearing rather than advisory: with no backstop in the adapter, a missed call site is an unfiltered payload.

## Consequences

**Pros:**

- A new integration ships one object. No core change, no frontend change, no migration.
- The editor cannot offer a control whose output the destination discards, because the schema and the toolbar are derived from the same declaration.
- The grammar becomes executable data instead of prose that drifts from the regex beside it.
- The compiler enforces the declaration where it can: required on `ShopProductManagerPort`, so no shop adapter can omit it, and required of any adapter that declares `OfferFieldUpdater`. An adapter implementing `OfferCreator` *without* `OfferFieldUpdater` would declare nothing and fall back - no such adapter exists today (Allegro and Erli implement both), and the fallback is the conservative subset rather than a permissive guess, so the gap degrades safely.

**Cons / trade-offs:**

- `DescriptionFormat` crosses to the frontend as an HTTP response shape, so changing it is a coordinated change - mitigated by it being a plain value type with no behaviour.
- The declaration is only as good as its evidence. Allegro's is reconstructed from rejection messages and can drift without notice, so each declaration carries its evidence in a comment plus a spec pinning its exact tag set - widening it is then a deliberate test change.
- `contentModel` expresses which children are allowed, not ordering or cardinality. Sufficient for both known grammars; a destination needing more extends the type.
- Reading the format needs no new *dispatch mechanism*, but it is not free everywhere: of the four write paths, three already hold the adapter, while `ProductPublishBuilderService` now resolves a `ProductPublisher` it previously did not - so a shop build can fail on adapter resolution where it used to succeed. A future non-adapter caller would need a dispatch of its own.

**Migration path:**

- `sanitizeAllegroDescription` and the four specs pinning its current behaviour are deleted; the intent moves into `applyDescriptionFormat`'s tests.
- Inbound sanitisation (#2198) is a prerequisite for rendering any stored description as HTML, and is deliberately *wider* than any destination format: it removes script vectors, it does not enforce a marketplace's taste.

**Explicitly out of scope:**

Images inside descriptions (a question about the shape of `description.sections`, not about a tag allowlist), tables, Allegro's structured multi-section model, and ordering/cardinality in the content model. `sup` and `sub` appear in neither grammar and must not be declared - they surfaced only in a search-engine cache of a superseded revision of Erli's doc.

## Amendment - how the read resolves a connection (review of #2204)

Decision 1 said the fallback is resolved server-side; it did not say *which* capability answers, and the first implementation took the first one that did. That was wrong in a shipped configuration: a WooCommerce connection with #1498 stock write-back enabled resolves `OfferManager` to a base-port-only adapter that declares nothing, so the editor was handed the conservative subset - and the operator was told their destination had declared no format - for a shop whose own `ProductPublisher` declaration allows tables, links and `h3`, and whose publish path uses that real declaration. The read therefore prefers a **declaration** over a fallback regardless of which capability produced it: `OfferManager` is probed first, `ProductPublisher` second, and an undeclared first answer is kept only if the second does not declare either.

That also splits a case decision 1 collapsed. "This destination declared nothing" and "no adapter could be resolved for this connection" are different facts, and only the second is a configuration state an operator can act on (a disabled connection, a credential failure). So the response carries `resolvedVia: 'OfferManager' | 'ProductPublisher' | null`, with `null` meaning unresolved rather than undeclared, logged at `warn` on the way out. `declared: false` still means what it said.

Every submit surface that can send a description gates on the declared `maxBytes` (`exceedsDescriptionCap`), not just the Content tab: an offer-field update and a bulk publish both dispatch jobs, so an over-cap description would otherwise be accepted in the UI and rejected by the platform after the modal closed.

## References

- Related issues: #2193 (epic), #2194 (this ADR), #2195, #2196, #2197, #2198, #2199, #2200, #2201, #2202
- Related ADRs: [ADR-002](./002-capability-ports-with-sub-capabilities.md) (capability ports with composable sub-capabilities), [ADR-024](./024-destination-listing-capabilities.md) (destination listing capabilities)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Capability Abstractions, § 6. Listings (Offers)
- Frontend policy: [docs/frontend-architecture.md](../../frontend-architecture.md) § UI Library Policy
- Supplementary and **non-authoritative** (externally hosted, may not outlive this ADR - everything this decision depends on is restated above): the surface audit, the editor-library evaluation, and a working demo of this contract, linked from #2193.
