# Product Spec — #827 Operator fulfillment-workflow statuses

**Status:** **DEFERRED** (Gate D = DEFER, decided at the evidence gate 2026-05-25) — Phases A–B complete; C–E not produced. **Revisit trigger:** a design-partner shop with multi-person / parallel-picker fulfillment explicitly asks. Issue #827 stays OPEN.
**Parent issue:** [#827](https://github.com/openlinker-project/openlinker/issues/827)
**Started:** 2026-05-25
**Last updated:** 2026-05-25
**Workflow:** [`docs/contributors/refinement-workflow.md`](../contributors/refinement-workflow.md)
**Origin:** deferred cut from [#732](https://github.com/openlinker-project/openlinker/issues/732) Allegro Delivery refinement (Phase A)

> ⚠️ **Build-skeptical refinement.** By the issue's own strategic-alignment, this is **not wedge-relevant** and **not a differentiator** (BaseLinker parity). The headline open question is whether real demand exists at all. Per the workflow's "default to don't build" principle, Phase B must surface concrete demand signal; absent it, the likely Gate D outcome is **DEFER** (until a design partner asks) or **NO** — not a foregone "build."

---

## 1. Problem

> **Phase A — DRAFT, pending Gate A confirmation**

### Problem statement

When a shop physically prepares orders for dispatch, staff need to know **where each order is in the prep workflow** — picked? packed? staged and waiting for the courier? — **independent of whether a shipping label exists yet.**

OL today has **two** status axes, and neither captures this:

| Axis | Values | What it represents |
|---|---|---|
| **Order status** | `pending · processing · shipped · delivered · cancelled · refunded` | coarse order lifecycle |
| **Shipment status** | `draft · generated · dispatched · in-transit · delivered · failed · cancelled` | the shipment/label lifecycle |

The shipment status `generated` ("label made, awaiting dispatch") is the closest proxy for "packed/ready," but (a) it's **auto-derived, not operator-set**, and (b) it doesn't cover **pre-label** states like "picking" or "packed-but-not-yet-labelled." So an operator can't express "I've picked these 8 but not packed them" or "these are packed and staged, waiting for the InPost pickup."

### How painful, and for whom (honest read)

The pain is **volume- and headcount-gated**:
- **Solo / low-volume (10–30 orders/day):** minimal — the operator holds it in their head, or reads the shipment `generated` proxy. Little value.
- **Multi-person teams at higher volume (≈80–200 orders/day, 2+ people picking/packing in parallel):** real coordination pain — "who's done what," what's still on the bench, what's staged for which courier. This is where the value concentrates.

There is **no external pressure** (no marketplace/regulatory driver) and **no wedge dependency** — this is a quality-of-life OMS feature. "Why now" is weak; it surfaced only as a deferred cut from #732.

### Why this is a real concept (not just order status)

It's conceptually a **third axis**: an *operator-set, physical-prep workflow state*, distinct from the order lifecycle (where the order is commercially) and the shipment lifecycle (where the label/parcel is). Whether that third axis earns its keep depends entirely on demand (Phase B).

---

## 2. Affected persona

> **Phase A — DRAFT, pending Gate A confirmation**

Same base persona as #726/#727/#728/#732 (PL shop operator), but value concentrates on a **sub-segment**:

- **Who:** warehouse/fulfillment staff at a shop with **a multi-person prep team**
- **Company size:** the larger end of the band (still SMB, but 2+ people physically packing)
- **Volume:** **≈80–200 orders/day** is where it matters; below ~30/day the value is marginal
- **Sophistication:** operator-level; lives in the OL order list or a dedicated fulfillment board
- **Geography:** PL today, but the feature is **platform- and geography-neutral** (unlike #732) — it's pure internal OMS workflow

**Explicitly low-value for:** solo operators / low-volume shops (the shipment `generated` proxy + order status already suffice).

---

## 3. Evidence & user research

> **Phase B — 2026-05-25.** OL-tracker search (me) + competitor/demand scan (`product-researcher` subagent). Confidence flags preserved.

### 3.1 OL-internal demand — none (beyond this issue)

A scoped search of the OL issue tracker (`pick pack` / `fulfillment board` / `order status workflow`; plus a broad `fulfillment / packed / picking / ready-for-shipment` sweep) returned **#827 itself and the shipping/Allegro family only** (#732, #832–#837, #455, #458). **No user or contributor has independently requested operator pick/pack/fulfillment-workflow statuses** — #827 exists solely as a deferred cut I filed from #732. Confidence: `confirmed` (absence in-tracker).

### 3.2 Competitor implementations — universal table-stakes (A2/A3)

The feature exists across the PL multichannel field, almost always as **configurable custom statuses** (not a fixed pick/pack pipeline):

- **BaseLinker** — unlimited configurable custom statuses ("divided by employees, shipping methods, sources, warehouse locations"), set manually + via automatic-actions on events; **plus** a separate **Pick&Pack Assistant** (barcode-verified picking/packing). Two distinct features.
- **Apilo** — same configurable model ("Manager Zamówień 3.0": any number of custom groups/statuses, colors, drag-reorder) + a separate packing assistant.
- **Sellasist** — configurable statuses tied to a WMS pick/pack flow (auto-changes to "Zebrane" on pick completion).
- **Linnworks** — closest to a **fixed** Open→Processed pipeline (less free-form intermediate states).

Confidence: `confirmed`. Sources: [BaseLinker statuses](https://help.baselinker.com/knowledgebase/order-statuses/), [BaseLinker workflow](https://base.com/en-US/functions/workflow-automation/), [BaseLinker Pick&Pack](https://baselinker.com/pl-PL/blog/rozbudowane-zbieranie-zamowien-nowosc-w-asystencie-zbierania-i-pakowania/), [Apilo MZ 3.0](https://apilo.com/pl/funkcje-apilo/manager-zamowien-3-0/), [Sellasist WMS statuses](https://sellasist.pl/pomoc/jak-dodac-i-skonfigurowac-wlasne-statusy-zamowien-w-sellasist-wms), [Linnworks](https://help.linnworks.com/support/solutions/articles/7000035513-open-orders-working-with-open-orders).

### 3.3 Real demand signal — weak-or-absent (A1 — the load-bearing question)

**No organic user-articulated demand found.** Searches surfaced only supply-side content (vendor how-to docs; PL blog walkthroughs of the canonical `Realizowane → Pakowane → Gotowe` vocabulary) — **no forum threads, suggestion-portal entries, or community posts where a small/mid shop asks for or complains about the absence of** pick/pack workflow statuses in their tool. The absence cuts two ways (honest):
1. The feature may be **so commoditized it's invisible** (nobody requests "custom statuses," like nobody requests "a search box").
2. OL's actual early-adopter profile (**0 production users, likely solo/small**) simply doesn't generate the need at low volume — the need concentrates at the *higher* end of 10–200 orders/day, which OL doesn't have.

The strongest demand-adjacent fact is pure **switcher-expectation parity** (a shop migrating from BaseLinker would expect it) — not articulated unmet need. **Caveat:** public web search isn't exhaustive (gated forums / suggestion portals / FB groups not readable); **the highest-leverage resolution is one direct question to a design-partner shop** — which the maintainer can reach and the researcher cannot. Confidence: `weak-or-absent`.

### 3.4 What the competitor versions actually solve

Predominantly **multi-person, higher-volume coordination**, not solo visibility: dividing/tracking work across staff (per-packer accountability, daily throughput), and **gating handoffs** between batch-picking and packing stages. Plain "what's packed vs on the bench" visibility is the *thinnest* motivation — and it's the only one OL's solo/small base would hit, already served by the shipment `generated` proxy. So the feature's real payoff is **a problem OL's likely early adopters do not yet have**. Confidence: `partial` (positioning well-evidenced; "OL adopters won't use it" is inference).

### 3.4a Carrier status already covers handover-onward — narrows the residual gap

For an OL-managed carrier (branch 2, InPost) the carrier reports status via **webhook** (#768) or **polling fallback** (#772); Allegro Delivery (branch 3) is poll-only (#838). Critically, the carrier only reports from the **first network scan** onward — and OL's `generated` shipment status already means "label made, **packed, awaiting carrier**." So the carrier + `generated` proxy auto-cover the lifecycle from packed onward. The **only** slivers #827 could add: (a) **pre-label** operator-prep (`picking`, packed-before-labelling), and (b) the lag between `generated` and the first carrier scan, where an operator might *manually* mark "handed over" (self-resolves when the scan lands). Both are thin — this **reinforces DEFER** unless an operator explicitly wants to drive the pre-scan window by hand. Confidence: `confirmed` (mechanism per #727 §3.2 / #732 §3.6).

### 3.5 Phase B impact + verdict

| Phase A point | Phase B impact |
|---|---|
| Problem concept real? | ✅ Yes — standard, universal competitor parity |
| **A1 demand** | ⚠️ **Weak-or-absent.** No OL-specific or organic demand; only switcher-parity |
| Persona | **Narrows** — real value is multi-picker teams at volume (accountability + batch handoffs), not OL's solo/small 0-user base |
| Existing proxy | Shipment `generated` already covers the low-end "packed/awaiting dispatch" case |

**Verdict: DEFER.** Nothing in the evidence overturns the build-skeptical framing or justifies building now. The single highest-leverage next step is **not more research** — it's one direct question to a design-partner shop with parallel pickers, once OL has one. Recommend leaving #827 open with a "deferred — revisit when a design partner with multi-person fulfillment actually asks" note.

## 4–8. Solution / spec / scope / DoD / risks — NOT PRODUCED (deferred)

> **Deferred at Gate B (2026-05-25).** Refinement stopped before solution exploration: the evidence (§3) showed **no demand justifying a build now**, so designing a solution (Phases C–E) would be premature theatre — exactly the "default to don't build" case in the workflow.
>
> **If revisited:** resume from Phase C. The single highest-leverage step to resolve the open `weak-or-absent` demand rating is **one direct question to a design-partner shop** with multi-person / parallel-picker fulfillment (or one that wants to drive the pre-first-scan "handed-over" window by hand) — not more web research.
>
> **What already covers the low end** (so the bar to revisit is high): the carrier reports status from first scan onward (webhook #768 / poll #772 / #838), and the shipment `generated` status already proxies "packed, awaiting carrier" (§3.4a).

---

## Decision log

| Date | Phase | Decision | Reasoning | Decider |
|---|---|---|---|---|
| 2026-05-25 | Setup | Refinement opened in worktree `827-fulfillment-workflow-statuses-refinement`; Phase A drafted. **Framed build-skeptical** given non-wedge / parity / unproven-demand. `pnpm install` skipped (doc-only). | #827 confirmed `product-design`; no prior spec/comments. | @piotrswierzy (assisted) |
| 2026-05-25 | Gate A | **Gate A PASSED — Phase A locked.** Problem, persona, A1–A5 confirmed. Build-skeptical framing accepted: Phase B hunts for demand evidence; weak signal → DEFER/NO. | Maintainer: "yes". | @piotrswierzy |
| 2026-05-25 | Gate B/D | **DEFER (Gate D = DEFER), decided at the evidence gate.** Maintainer's "where does carrier status come from?" probe confirmed the carrier (webhook/poll) + `generated` proxy auto-cover packed-onward, leaving only a thin pre-scan/pre-label sliver (§3.4a). No demand → no Phase C/D. #827 left **OPEN** with revisit note; spec merged as the record. No impl issues. | Maintainer: "defer". | @piotrswierzy |
| 2026-05-25 | B | **Phase B complete — verdict DEFER.** OL tracker: zero independent demand (only #827). Competitors: universal parity (BaseLinker/Apilo/Sellasist configurable statuses + pick/pack assistants). Demand signal: **weak-or-absent** (only switcher-parity; no organic requests). Real value = multi-picker-at-volume, a problem OL's 0-user/solo base lacks; `generated` proxy covers low-end. Highest-leverage resolver = one design-partner question, not more research. | `product-researcher` subagent + tracker search. | @piotrswierzy + subagent |
