# Epics proposal: bundles (G15, revised) and gifts (G20, new)

Basis: ports-v1.md (minimal port extension), ux-compare/0-synthesis.md (simple UI), rules-check/0-synthesis.md (rules). Prototype v1: https://claude.ai/artifact/Gb8o2EKfpDeEDYu39hipZR. Nothing is filed yet.

## F - shared foundation (child of #3520, both epics depend on it)

| # | Issue | Size |
|---|---|---|
| F1 | Rewrite #3606: spec + ADR-054/061 amendments + new ADR "commercial list vs physical list", optional line fields, `ZeroValueLineSupport`, `BundleReader`. Record that `role`/`parentLineId` are NOT added. | 1-2 d |
| F2 | Neutral optional fields `gift?` and `packQuantity?` on `IncomingOrderItem`/`OrderItem`; Allegro sets `packQuantity`; a multipack with no bundle definition is held as `awaiting_mapping` (fixes "1 unit shipped for the price of 3"). | 2 d |
| F3 | Document helper in `sales-documents`: totals always equal paid, gift form (default omit), grosz from a same-rate paid line, other-rate gift priced-in; optional `ZeroValueLineSupport` probe; KSeF/inFakt/eparagony/Subiekt mappers call the helper. | 2-3 d |

## G15 - Bundles (revised)

| # | Issue | Depends on | Size |
|---|---|---|---|
| B1 | Rewrite #3607: `BundleDefinition`, `expandBundleLines` frozen at ingestion (`lineExpansion`), `OrderRecord.physicalItems`; 5 one-line swaps (reserve, route, work, decrement, restock); order-edit follow-ups; invariant script "stock sites read physicalItems". | F1, F2 | 5-6 d |
| B2 | Bundle availability = min over components in `IAvailabilityService`; fan-out to bundles on component change; cancellation restore. | B1 | 2-3 d |
| B3 | Rewrite #3624: one-screen bundle form on the product ("Zrób z tego zestaw"), list filter, "Utwórz zestaw N x" on the multipack hold, bundle line in order detail, bench header "Zestaw X z Y". | B1, B2 | 4-5 d |
| B4 | Integrations: Shoper collapses bundle children; optional `BundleReader` for PrestaShop packs and Subiekt komplety + "Synchronizuj skład z PrestaShop". | F1 | 2-3 d |
| B5 | Returns of one component: price split computed at return time, Allegro-formula refund hint. | B1 | 2 d |
| B6 | #3625 E2E (re-baselined on the v1 mockup). | B3 | 2 d |

## G20 - Gifts (new epic)

| # | Issue | Depends on | Size |
|---|---|---|---|
| G1 | Spec: gift = line attribute; OL gift rules as a new action in the automation engine; document forms. | F1 | 1 d |
| G2 | Inbound gift recognition: PrestaShop cart-rule gift split into its own 0,00 line; Shoper gift-app lines; WooCommerce plugin lines (optional). IdoSell/Empik later. | F2 | 2-3 d |
| G3 | OL gift rules: automation action "add gift" evaluated at ingestion before reservation, writes `addedLines`; conditions product / amount / per N units; unit cap; auto-pause when out of stock; list order + "nie łącz"; "pomiń, jeśli już w zamówieniu"; dry run. | F2, G1 | 4-5 d |
| G4 | Stock path: OMS on reservation, work, bench scan, decrement with reason `gift`; OMS off 0,00 line to the destination shop; cancel gives stock back. Mostly free through the overlay; check + tests. | G3 | 2 d |
| G5 | UI: promotions list + composer (3 cards, 4 fields, "Więcej opcji"), gift line with "Klient płaci 0 zł, kosztuje Cię X", manual add gift (until parcel closed), attention reasons. | G3 | 4-5 d |
| G6 | Documents: wire F3 forms into connection settings ("Gratis na dokumencie: pomijany", "Zmień (dla księgowej)"). | F3 | 1-2 d |
| G7 | Report "Koszt gratisów" + CSV per customer; returns: kept gift decision (never auto-deducted). | G3 | 2-3 d |
| G8 | E2E gifts. | G5 | 2 d |
| G9 | Gifts with bundles: gift slot inside a bundle; "pomiń" also checks bundle components. | B1, G3 | 1-2 d |

## Order (decided 2026-11-04: the pilot seller sells Allegro sets with a gift)

1. F (5-7 d). F2 also fixes a live bug (Allegro multipack).
2. G15 B1-B3 (about 11-14 d): the pilot's real flow is an Allegro set with a gift inside.
3. G9 moved forward, right after B1 (1-2 d): gift slot inside a bundle, shown as a gift on the order, cost in "kosztuje Cię X". Needs only the G3 line attribute, not the rule engine, so G9 is split: G9a gift slot in bundle (after B1, F2) now, G9b "pomiń" over components later with G3.
4. G20 G1-G6 (about 12-15 d), in parallel with step 2 if a second developer is free.
5. B4/B5, G7, then E2E B6/G8.
