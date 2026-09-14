# Product Spec — #2879 Shopify shop integration

> ⚠️ **Skeleton / work in progress.** This spec is being built incrementally alongside live sandbox
> verification. Sections below are populated only as far as the underlying research has progressed —
> see `docs/plans/analysis/SPIKE-2879-shopify-admin-api.md` for the live evidence this spec draws on.
> Do not treat unpopulated sections as "no risk found" — they are simply not yet researched.

## 1. Problem

Shopify is the only one of the four candidate platforms (#2878: Shopify, eBay, Amazon, TikTok Shop)
that can act as both a `ProductMaster`/`InventoryMaster` (source of truth) and a destination —
closest existing analogue is the shipped `libs/integrations/woocommerce` adapter. As a destination
this is a **shop**, not a marketplace: publish, sync-fields, and category/attribute browsing land on
`ShopProductManagerPort` (+ the advertised-without-dispatch `ShopCategoryBrowser` /
`ShopAttributeReader` sub-capabilities), per `docs/architecture-overview.md § Listings` — never
`OfferManagerPort`, which is reserved for marketplace offer/listing management. See issue #2879 for
the full framing and the three headline findings (per-line tax rate, `FulfillmentExecutor`-shaped
FulfillmentOrder model, native `#2368` idempotency).

## 2. Affected persona

*Not yet researched — carry over from #2879's own framing once onboarding-cost findings (custom
distribution app, Dev Dashboard/Partner org requirement) are fully verified. Preliminary note from
live testing: the onboarding flow (Dev Dashboard → custom-distribution app → OAuth) is materially
different from WooCommerce's self-serve key-pair model, and changes who can self-serve a connection —
see SPIKE §Verdict and Evidence E-C1/E-C6.*

## 3. Evidence & user research

Deferred to the SPIKE document's live-evidence table pending completion of the full story checklist.

## 4. Solution exploration

*Not yet started.*

## 5. Product specification

*Not yet started — depends on Acceptance Criteria AC0/AC3/AC6/AC8/AC9 from issue #2879 being
resolved first.*

## 6. Out of scope

Per issue #2879's own acceptance criteria, one explicit scoping decision is requested and not yet
made: **whether F6 (`FulfillmentExecutor`, ADR-054) is in scope for a first slice or a follow-up.**
It is simultaneously the single most differentiating capability found in desk research and the
largest single piece of work (fulfillment-service registration + `callbackUrl` + accept/reject
handshake + `assignedFulfillmentOrders` polling).

## 7. Definition of done

Mirrors issue #2879's own Acceptance Criteria list — see the issue body. Not reproduced here to avoid
drift between two copies; this spec should link to the issue rather than restate its checklist.

## 8. Risks

See `docs/plans/analysis/SPIKE-2879-shopify-admin-api.md § Open risks` for the live-verified list.
Headline items, in reconciled form:

1. `read_all_orders` requires manual, non-SLA'd Shopify review — BLOCKED, tracked in the SPIKE doc.
2. True concurrent-retry idempotency replay semantics for `inventoryAdjustQuantities` are unverified;
   the "honours #2368's idempotencyKey" claim needs qualification (see SPIKE E-M6).
3. Onboarding persona: custom-distribution app + Dev Dashboard/Partner org access is required, unlike
   WooCommerce's self-serve model — changes who can configure a Shopify connection without vendor
   involvement.
4. The issue's own Prerequisites scope list had **three confirmed gaps, all three now added and
   re-verified working**: `write_merchant_managed_fulfillment_orders` (blocked the entire write half
   of group F — `fulfillmentCreate`, `fulfillmentOrderMove`), `read_customers` (blocked resolving
   `order.customer`), and `write_third_party_fulfillment_orders`/`read_third_party_fulfillment_orders`
   (blocked the negotiation axis on fulfillment-service locations — see SPIKE E-F3/E-F4, E-O7,
   E-F8/E-F10). Treat this as the reconciled, final count.
5. `descriptionHtml` has zero server-side sanitization (confirmed live with a literal `<script>`
   payload round-tripping unchanged) — Shopify is not an XSS boundary on this platform, same as
   everywhere else; must not be assumed otherwise when designing the description-format seam.
6. Return reasons are an OPEN catalog (`ReturnReasonDefinition`, ID-referenced), not a closed enum —
   design the reason-mapping seam open-world from day one (SPIKE E-R4).
7. Use `returnProcess` (never raw `refundCreate`) for a return-driven refund — confirmed live as the
   platform's required path since API 2025-07+, and it correctly populates `Return.refunds` with a
   real `Refund` id once called cleanly (SPIKE E-R9, closing the earlier open question left by E-R8).
   `RefundInput` having no native `returnId` is a red herring for this use case, not a gap to design
   around.
8. F4 (late-waybill relay, #1947) is untested — nothing in the SPIKE doc exercises it, even
   implicitly. An earlier revision of both this spec and the SPIKE doc claimed the F group closed to
   8/8; the group has 7 real story ids (there is no `F5`), and F4 specifically has no evidence behind
   it. Treat it as a real, named gap — see SPIKE `## Open risks` item 6.

**F6 upgraded finding**: live introspection shows Shopify's `FulfillmentOrderRequestStatus` /
`FulfillmentOrderStatus` enums match OL's own ADR-054 vocabulary almost name-for-name (SPIKE E-F5),
and the negotiation axis was subsequently confirmed working end to end (SPIKE E-F10). This strengthens
(not weakens) the case for including F6 in a first slice — F6 itself remains the most strongly
evidenced finding in this spike, independent of the F group's overall 6/7 tally (see item 8 above).

## 9. Implementation breakdown

*Not yet started.*

## 10. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-09-04 | Sandbox built on a fresh development store (`{shop-domain}.myshopify.com`) rather than desk-research-only | Issue #2879 AC2 requires a real authenticated call with transcript, not just confirmation the API exists |
| 2026-09-04 | Access token obtained via full OAuth authorization-code grant rather than the Dev Dashboard "App automation token" shortcut | The automation token (`atkn_` prefix) is scoped for CI/CD app-config deployment, not Admin API calls — confirmed empirically to fail with `Invalid API key or access token` |

## 11. Coverage summary

**74 of the issue's 88 stories verified live** against a real development store sandbox
(`{shop-domain}.myshopify.com`) — see the SPIKE doc's `## Coverage tally` section for the exact
per-group arithmetic behind this number (6+13+6+6+7+13+6+5+7+5 = 74, against a denominator of
11+13+6+6+7+16+7+7+9+6 = 88). **This 88/74 pair supersedes every earlier figure in this epic** — a
prior "~90" estimate undercounted the checklist; a later "111", then "110", derived T/P/S/F/D's
denominators from each group's highest-numbered story id rather than its real item count, which is
wrong wherever a group's numbering has gaps (true of five of the ten groups, not just C's missing
`C9`) — see the SPIKE doc's `## Coverage tally` for the full per-group reconciliation. This is the
single authoritative figure and denominator and supersedes any other count appearing elsewhere in this
spec or the PR description. Includes M group at 13/13 (bulk operations confirmed end to end) and F
group at 6/7 (negotiation axis fully confirmed via SPIKE E-F10; F4, late-waybill relay, remains an
open, untested gap — see §8 item 8 above).
**C7/O16 (429/retry) are deliberately EXCLUDED from the 74** — they are attempted but inconclusive,
not a confirmed negative result: the burst test used was insufficient to reach the platform's real
throttling threshold, so retry-classification behaviour stays genuinely UNVERIFIED (see SPIKE E-C8
and the corrected coverage tally note). **F4 and R4 are also excluded** — both were miscounted in an
earlier revision (each citation was an evidence-row id, e.g. `E-F10`/`E-R4`, mistaken for a real story
id; neither has any live test behind it) and are corrected in the SPIKE doc's coverage tally. All three
headline findings from the issue confirmed; F6 confirmed stronger than claimed. Seven corrections
found that change what a downstream implementation plan should assume — see SPIKE doc §Recommendation
for the full list, plus P13 (`productSet` behaves as PATCH, not PUT, despite its name — confirmed
behaviourally, not just by schema description).
Remaining gaps are the ones genuinely outside API-testable scope (OL-side adapter/design code) or
still blocked (`read_all_orders` manual review) — listed explicitly in the SPIKE doc's coverage tally
rather than left implicit.
