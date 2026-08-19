# ADR-046: Adapter-declared description format

- **Status**: Accepted
- **Date**: 2026-08-19
- **Authors**: @norbert-kulus-blockydevs

## Context

A product description is HTML at every stage of the pipeline. Each destination accepts a different, narrow subset of it, and OpenLinker records that subset nowhere.

**Allegro accepts seven tags** — `h1 h2 p ul ol li b` — attributes forbidden, and the allowed set depends on the parent element:

| Context | Allowed children |
|---|---|
| top level | `h1 h2 p ul ol` |
| inside `<p>` | `b` |
| inside `<ul>` / `<ol>` | `li` |
| inside `<li>` | `b p` |
| inside `<h1>` / `<h2>` | nothing — no formatting at all |

Rejected unconditionally: `strong em i u br div span`. Allegro publishes no tag list; the grammar is reconstructed from verbatim validator rejection messages in the `allegro/allegro-api` issue tracker — `Błędny tag "br", dozwolone są: {b}` (#11708, 2025-06-24), `Błędny tag "strong", dozwolone są: {b}` together with `Błędny tag "b", dozwolone są: {h1, h2, p, ul, ol}` in one payload (#9714, 2024-08-22), `Błędny tag "ul", dozwolone są: {b, p}` (#10656, 2025-01-13), and `Błędny tag "h2", dozwolone są: {b}` on `description.sections[0].items[0].content` (#3856). Two opposite allowed sets for one payload is what makes this a grammar rather than a list.

**Erli accepts nine**, published in its own API doc: `h1 h2 h3 p b br/ ol ul li`, attributes forbidden, headings unformatted, and `<br/>` **must** be self-closing. Erli additionally documents that a plain-text HTML string is accepted with no tag restriction and then *silently converted*, so a malformed payload there costs fidelity rather than availability.

**WooCommerce** trims server-side through `wp_kses`, whose allowlist varies with the API user's role and the store's configuration.

The only enforcement in the repo is `sanitizeAllegroDescription`, a regex pass private to the Allegro package whose allowlist admits `br strong i em u` beyond the valid set and which normalises every self-closing variant to `<br>` before passing it through. Every one of those is a guaranteed 422, so we have been constructing rejected payloads. Its own header comment anticipated the situation: *"If this utility ever ingests user-controlled HTML (e.g. an in-app description editor) swap to a real allowlist parser."* The in-app editor is now being built (#2193), which turns a latent defect into a blocking one — an editor must know what its destination accepts before it can offer a control.

## Decision

**A destination declares its own content contract; core owns the single implementation that enforces it; the frontend composes its editor from that declaration and holds no knowledge of its own.**

The contract is a neutral `DescriptionFormat` value type in `libs/core/src/listings/domain/types/`, carrying allowed tags, per-tag allowed attributes, a `parent → allowed children` content model, rewrites applied *before* the allowlist, block-opener and self-closing-void requirements, and a byte cap. It is declared through one pure synchronous method, `getDescriptionFormat()`, added to two **existing** sub-capabilities: `OfferFieldUpdater` (marketplace) and `ProductPublisher` (shop). No new capability is introduced. One pure helper, `applyDescriptionFormat`, is called from `OfferBuilderService` and `ProductPublishBuilderService`, and `sanitizeAllegroDescription` is deleted.

Three subordinate decisions are settled here:

1. **A destination declaring no format resolves to a conservative shared subset, plus a visible "this destination has not declared its format" state in the UI.** Never a permissive guess — a permissive guess yields a platform rejection the operator cannot explain to themselves.
2. **`i` / `em` are rewritten to `b`, not unwrapped**, with the lossy conversion stated on the editor's italic control. Renaming loses the semantic distinction but the operator sees it happen; unwrapping loses the emphasis silently.
3. **Rewrites run before the allowlist.** Ordering them the other way would delete the very emphasis the operator applied and call it sanitisation.

## Alternatives considered

- **A static `AdapterMetadata` manifest entry.** Cheaper: readable without constructing an adapter, already the designed seam for host-side tooling that inspects capabilities at boot. Rejected because a manifest entry is per *adapter* and cannot express WooCommerce's genuine per-*connection* variance; a capability method receives the `connectionId` its adapter was built with.
- **A table in the frontend.** Rejected because it puts the knowledge furthest from the system that enforces it, and a new integration would then need a frontend PR to become usable.
- **Status quo: a bespoke sanitiser per adapter.** Rejected because it is N implementations and N chances to guess the grammar wrong, which has already happened once and shipped.
- **A new `DescriptionFormatReader` sub-capability.** Rejected because the capability surface should not grow for a field that two existing sub-capabilities already carry; `OfferFieldUpdater`'s own contract names `description`.
- **The adapter applies its own declared format.** Rejected because two sources of truth drift, and a declaration describing an editor the adapter no longer honours is worse than no declaration at all. The adapter also keeps no defensive second pass, for the same reason.

## Consequences

**Pros:**

- A new integration ships one object. No core change, no frontend change, no migration.
- The editor cannot offer a control whose output the destination discards, because the schema and the toolbar are derived from the same declaration.
- The grammar becomes executable data instead of prose that drifts from the regex beside it.
- The compiler enforces the declaration: `getDescriptionFormat()` is a required member, so an adapter cannot silently omit it.

**Cons / trade-offs:**

- `DescriptionFormat` crosses to the frontend as an HTTP response shape, so a change to it is a coordinated change. Mitigated by it being a plain value type with no behaviour.
- The declaration is only as good as the evidence behind it. Allegro's is reconstructed from rejection messages, not documented, and can drift without notice. Each declaration therefore carries its evidence in a comment and a spec pinning its exact tag set, so widening it is a deliberate test change.
- `contentModel` expresses "these children are allowed" but not ordering or cardinality. Sufficient for both known grammars; a destination needing more would extend the type.
- Reading the format per publish adds an adapter resolution the builders already perform, so no new dispatch — but a future non-adapter caller would need one.

**Migration path:**

- `sanitizeAllegroDescription` and its four specs that pin the current wrong behaviour are deleted; the intent moves into `applyDescriptionFormat`'s tests.
- Sanitising description HTML at the inbound boundary (#2198) is a prerequisite for rendering any stored description as HTML, and is deliberately *wider* than any destination format: it removes script vectors, it does not enforce a marketplace's taste.

**Explicitly out of scope:**

Images inside descriptions (a question about the shape of `description.sections`, not about a tag allowlist), tables, Allegro's structured multi-section model, and ordering/cardinality in the content model. `sup` and `sub` appear in neither grammar and must not be declared — they surfaced only in a search-engine cache of a superseded revision of Erli's doc.

## References

- Related issues: #2193 (epic), #2194 (this ADR), #2195, #2196, #2197, #2198, #2199, #2200, #2201, #2202
- Related ADRs: [ADR-002](./002-capability-ports-with-sub-capabilities.md) (capability ports with composable sub-capabilities), [ADR-024](./024-destination-listing-capabilities.md) (destination listing capabilities)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Capability Abstractions, § 6. Listings (Offers)
- Frontend policy: [docs/frontend-architecture.md](../../frontend-architecture.md) § UI Library Policy
- Surface audit, the verbatim validator evidence, the editor-library evaluation and a working demo of this contract: <https://claude.ai/code/artifact/1ae8a4fd-b139-4857-8f3b-a665ab9545f5>
