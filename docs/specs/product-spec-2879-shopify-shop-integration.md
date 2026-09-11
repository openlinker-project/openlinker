# Product Spec — #2879 Shopify shop integration

> ⚠️ **Skeleton / work in progress.** This spec is being built incrementally alongside live sandbox
> verification. Sections below are populated only as far as the underlying research has progressed —
> see `docs/plans/analysis/SPIKE-2879-shopify-admin-api.md` for the live evidence this spec draws on.
> Do not treat unpopulated sections as "no risk found" — they are simply not yet researched.

## 1. Problem

Shopify is the only one of the four candidate platforms (#2878: Shopify, eBay, Amazon, TikTok Shop)
that can act as both a `ProductMaster`/`InventoryMaster` (source of truth) and a destination —
closest existing analogue is the shipped `libs/integrations/woocommerce` adapter. See issue #2879 for
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
   (blocked the negotiation axis on fulfillment-service locations, closing F to 8/8 once added — see
   SPIKE E-F3/E-F4, E-O7, E-F8/E-F10). Treat this as the reconciled, final count.
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

**F6 upgraded finding**: live introspection shows Shopify's `FulfillmentOrderRequestStatus` /
`FulfillmentOrderStatus` enums match OL's own ADR-054 vocabulary almost name-for-name (SPIKE E-F5),
and the negotiation axis was subsequently confirmed working end to end (SPIKE E-F10), closing group F
to 8/8. This strengthens (not weakens) the case for including F6 in a first slice.

## 9. Implementation breakdown

*Not yet started.*

## 10. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-09-04 | Sandbox built on a fresh development store (`{shop-domain}.myshopify.com`) rather than desk-research-only | Issue #2879 AC2 requires a real authenticated call with transcript, not just confirmation the API exists |
| 2026-09-04 | Access token obtained via full OAuth authorization-code grant rather than the Dev Dashboard "App automation token" shortcut | The automation token (`atkn_` prefix) is scoped for CI/CD app-config deployment, not Admin API calls — confirmed empirically to fail with `Invalid API key or access token` |

## 11. Coverage summary

**78 of the issue's 111 stories verified live** against a real development store sandbox
(`{shop-domain}.myshopify.com`) — see the SPIKE doc's `## Coverage tally` section for the exact
per-group arithmetic behind this number (9+13+6+6+6+13+8+5+8+4 = 78, against a denominator of
12+13+12+13+13+16+8+9+9+6 = 111 — a prior "~90" estimate in this epic undercounted the checklist and
is superseded); this is the single authoritative figure and denominator and supersedes any other
count appearing elsewhere in this spec or the PR description. Includes M group at 13/13 (bulk
operations confirmed end to end) and F group closed to 8/8 (negotiation axis, SPIKE E-F10).
**C7/O16 (429/retry) are deliberately EXCLUDED from the 78** — they are attempted but inconclusive,
not a confirmed negative result: the burst test used was insufficient to reach the platform's real
throttling threshold, so retry-classification behaviour stays genuinely UNVERIFIED (see SPIKE E-C8
and the corrected coverage tally note). All three headline findings from the issue confirmed; F6
confirmed stronger than claimed. Six corrections found that change what a downstream implementation
plan should assume — see SPIKE doc §Recommendation for the full list, plus P13 (`productSet` behaves
as PATCH, not PUT, despite its name — confirmed behaviourally, not just by schema description).
Remaining gaps are the ones genuinely outside API-testable scope (OL-side adapter/design code) or
still blocked (`read_all_orders` manual review) — listed explicitly in the SPIKE doc's coverage tally
rather than left implicit.
