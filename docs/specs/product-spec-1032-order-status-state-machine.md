# Product Spec — #1032 OL-owned order status state machine

**Status:** phase D complete — **Gate D = DEFER** (2026-06-18). North-star documented; heavy build deferred pending the un-defer trigger (§ Gate D). No heavy implementation issues spawned. A small standalone subset (enrich order-health with shipment + SLA-overdue) is tracked separately, not as a #1032 child. **Rechecked 2026-06-22 (external demand signal): DEFER held — fires no un-defer trigger; a narrow, base-serving Posture-A status/cancellation round-trip was carved out as a separate refinement (#1157), which is a *foundation for*, not an un-deferral of, this bet.**
**Parent issue:** [#1032](https://github.com/openlinker-project/openlinker/issues/1032)
**Started:** 2026-06-18
**Last updated:** 2026-06-22
**Workflow:** [`docs/contributors/refinement-workflow.md`](../contributors/refinement-workflow.md)

> **Demand-gated discovery.** This is a Tier-1 "thinking" refinement of a foundational OMS primitive. Its sibling [#827](https://github.com/openlinker-project/openlinker/issues/827) (operator fulfillment-workflow statuses) was **deferred** at Gate D for lack of demand. The same gate applies here: the central question is not "can we build it" (we can — the persistence already exists) but "**is there an identified seller in pain now, or is this platform-completeness reasoning?**"

---

## 1. Problem

> **Phase A complete — confirmed by maintainer at Gate A on 2026-06-18**

### Gate A resolutions (2026-06-18)

1. **Demand posture: STRATEGIC BET.** No named seller is in pain today. The maintainer is making the OMS-positioning bet deliberately and accepts the demand risk. This is *not* a "we found a customer asking" build — it is a "we are choosing to become an orchestration OMS" build. Phase B must therefore stress-test the bet against competitor/market signal rather than validate a single user's pain, and Gate D must be an explicit go/no-go on the bet itself.
2. **Persona: multi-shop, multi-marketplace seller** (a sharpened P-C). The target runs **several marketplaces as order sources AND several shops/destinations**, where a single OL-owned canonical status that reconciles a fan-out of divergent source + destination + shipment statuses is the value. Not the current single-shop base (P-A), not the pure no-shop topology (P-B).
3. **Scope: full write/orchestration state machine.** OL owns explicit transitions and **emits transition events that drive outbound actions** (e.g. propagating a cancel, firing on SLA breach), not a derive-only read-model. This is the larger of the two cuts.



### Current state (verified against the codebase, 2026-06-18)

OpenLinker already persists a **full canonical order** — it is not a stateless router:

- `order_records` carries the resolved order snapshot (line items mapped to internal IDs, totals, addresses), a per-destination `syncStatus[]` array (`pending | syncing | synced | failed`), a `recordStatus` gate (`ready | awaiting_mapping`), and a derived `dispatchByAt` SLA column.
- A canonical order-status vocabulary already exists: `OrderStatusValues = [pending, processing, shipped, delivered, cancelled, refunded]` (`libs/core/src/orders/domain/types/order.types.ts`).
- An owned shipment lifecycle exists (`shipments`: `draft → generated → dispatched → in-transit → delivered`, ADR-012 branches 2/3) plus a branch-1 `FulfillmentStatusSnapshot` read-back.

### The actual gap

**OL owns no order-status transitions of its own.** The lifecycle status is a **pass-through string**: it is copied from the source marketplace into the order snapshot (optionally translated by `StatusMapping` on the way *out* to a destination), and OL never derives, advances, reconciles, or guards it. Verified in `order-sync.service.ts` / `order-record.service.ts`: `orderSnapshot.status = order.status` — a straight copy, validated against the vocab and defaulted to `pending` if unrecognised, but **never transitioned**. There is also **no transition event emitted** anywhere in the orders context (no `EventPublisherPort` usage in `orders/`).

So the vocabulary exists; the **ownership** does not. Concretely, three classes of event have **nowhere to land** today:

1. **Marketplace-native lifecycle** — an Allegro cancellation or return arrives, but OL has no owned status axis to record "this order is cancelled per source" distinct from the destination's status.
2. **SLA enforcement** — `dispatchByAt` is persisted but inert: nothing transitions an order to an "overdue / at-risk" state or fires when the window elapses.
3. **Partial fulfillment** — one order → N shipments is modelled, but there's no order-level status reconciling "2 of 3 lines shipped".

### Why this is the boundary between "router" and "orchestration OMS"

With ~70% of an OMS already built (canonical snapshot, multi-destination idempotent create, owned shipment lifecycle, carrier status read-back), the **missing 30% starts with an OL-owned status axis**. Without it, OL cannot serve a seller who has **no destination shop at all** (order lands from Allegro → OL manages lifecycle → WMS/carrier fulfills) — in that topology there is no shop to own status, so OL must.

### The honest tension (why this might be DON'T BUILD)

The pain above is **latent, not reported**. As of this refinement, no specific seller has been cited asking for OL-owned order status. The adjacent manual-workflow primitive (#827) was deferred for exactly this reason — its payoff (multi-picker coordination) had no demand in OL's solo-operator base. The strongest justification here — the no-shop seller — describes a **topology OpenLinker does not serve today** (it is positioned as an Allegro + PrestaShop/WooCommerce hub, i.e. shop-owning). For the *current* core user, the destination shop already owns order status, which makes an OL-owned axis arguably redundant.

Phase A's job is therefore to resolve one question before any further work: **is there an identified persona in pain now, or is this completeness reasoning that should defer (like #827) until a concrete seller need surfaces?**

### Why now (open question for Gate A)

Unclear — and this is itself an ambiguity to resolve. Nothing observable changed since #827 deferred that obviously promotes this from "defer" to "build". Candidate triggers to confirm or deny with the maintainer: a real no-shop / WMS-fulfilled seller on the horizon; multi-destination reconciliation pain; or a strategic decision to position OL as an OMS independent of demand timing.

---

## 2. Affected persona

> **Phase A complete — confirmed at Gate A on 2026-06-18.**

**The multi-shop, multi-marketplace seller.** Runs **several marketplaces as order sources** (e.g. Allegro + Erli + others) and **several shops/destinations** (e.g. two PrestaShop stores + a WooCommerce store), routing orders across that grid. For this seller, no single external system holds the truth about an order's lifecycle: each marketplace reports its own status, each destination shop reports its own, and shipments report a third axis. They need **one OL-owned canonical status** that reconciles the fan-out — and, because scope is the full state machine, **OL-initiated transitions** (cancel propagation, SLA enforcement, partial-fulfillment rollup) that the divergent external systems can't coordinate among themselves.

- Company size: SMB → lower mid-market (multi-channel implies more operational surface than OL's current solo base).
- Sophistication: non-technical operator running the OL admin, but managing real channel breadth.
- Volume: mid (the value compounds with order count × channel count).
- Geography: PL-first, but the multi-marketplace shape generalises beyond PL.

**Demand caveat (carried from Gate A):** this persona is the *target of a strategic bet*, not a presently-cited user. Whether any current OL deployment already runs 2+ destinations per order is an open question for Phase B. If Phase B finds the multi-destination topology is purely hypothetical, that materially weakens the bet and should resurface at Gate D.

---

## 3. Evidence & user research

> **Phase B — DRAFT, pending Gate B.** Three streams: competitor/market signal, architecture patterns for split-authority status, and OL-internal current-state grounding. The OL-internal stream **reframes the problem** — see §3.4.

### 3.1 Competitor / market signal

Every OMS-class competitor researched — **BaseLinker** (OL's direct PL competitor), **Linnworks, ChannelEngine, Pipe17, Sellbrite, Veeqo** — maintains its **own canonical order status distinct from the channel**. None is pure pass-through. So "OL owns a canonical status" is **table stakes, not differentiation** — the price of being in the category, not a reason to buy.

- **The sellable layer is the *orchestration on* the status, never the status itself.** Pipe17 headlines "order orchestration"; BaseLinker monetises status-driven *automation*; nobody markets "we own a state machine" — it reads as plumbing to a buyer. Positioning lesson: sell cancel-propagation / SLA-enforcement / partial-rollup, never "canonical state machine."
- **Guarded-vs-flexible is a real fork — and it cuts against OL's positioning.** BaseLinker's model is *unlimited seller-defined statuses + rules* (the operator owns transitions; the platform imposes almost none). Linnworks/ChannelEngine/Veeqo are *fixed, guarded* vocabularies. An opinionated guarded OL state machine is the philosophical *opposite* of the tool OL targets migrants from — a BaseLinker migrant may read "guarded" as "less flexible." You can't be both unbounded-custom and guarded-canonical without reproducing BaseLinker's complexity problem (it needs "Status Groups" + "action groups" just to stay manageable).
- **SLA enforcement is the most defensible sub-bet.** Only BaseLinker exposes even a generic "order in status N days" primitive; the market need is concretely documented via marketplace late-shipment penalties (e.g. eBay "Late Shipment" defects). Under-served + documented need = plausible differentiation.
- **Multi-destination partial-fulfillment rollup is the riskiest sub-bet.** Nobody headlines it; Veeqo's allocation-ID hard edges suggest it's *intrinsically messy*, so the gap may be low willingness-to-pay rather than open white space. Demand-test before investing.
- **Anti-signal:** ShipStation (a large, successful tool) deliberately stays **near pass-through** — uses the store's status, keeps the marketplace authoritative. Evidence that a thin posture is commercially viable for the ship-focused segment, i.e. owning a heavy status engine is *not* obligatory.

_Sources: BaseLinker help/API, Linnworks, ChannelEngine, Pipe17, Sellbrite, Veeqo, ShipStation docs; eBay late-shipment penalty refs. Full citations in the Phase B research log (subagent report, 2026-06-18). One evidence gap remains: no primary-voice corroboration of "custom-status engines are over-engineered" — would need idea.baselinker.com + PL seller-group reading._

### 3.2 Architecture patterns for split-authority status

Researched how multi-system stacks handle status ownership when authority is **split** — the core of your three follow-up questions.

- **OMS-of-record vs. orchestrator is an explicit, named stance.** The industry default for a platform in OL's position (a sync layer over pre-existing shops) is **orchestrator, not system-of-record** — Pipe17's explicit "bring your own source of truth"; ChannelEngine/Patchworks/Alumio/Celigo all defer canonical truth to the ERP/shop and only propagate. Full OMS-of-record is the NetSuite/Sterling/commercetools posture and pays off only if OL becomes the *primary* commerce backbone.
- **Shopify is the canonical reference for split authority** (the directly-applicable model):
  - **Orthogonal axes:** an order has *separate* `financial_status` ⊥ `fulfillment_status` ⊥ `return_status`; the order-level status is a **derived rollup** (`OrderDisplayFulfillmentStatus`), not a stored scalar. No single writer owns "the order status" → conflicts are structurally impossible.
  - **Fulfillment Orders:** one order splits into N fulfillment units, each owned by exactly one party (merchant location / 3PL / fulfillment-service app); each party writes only its unit; a **request/accept handshake** transfers exclusive edit authority so two parties never write the same unit.
  - **Per-order owner is a first-class field** (assigned location / fulfillment service) — NetSuite, commercetools, Sterling all do per-order/per-line routing to a "fulfillment owner."
- **The split-label problem (shop is OMS, OL does labels for a subset) has a clean standard answer: "register as a fulfillment provider."** OL owns a **fulfillment sub-object** and writes tracking + fulfillment status into *that* only — never the shop's order status. Shopify Fulfillment Orders (`fulfillmentCreateV2`) and **WooCommerce Order Fulfillments** (`/wc/v3/orders/{id}/fulfillments`, shipped Sept 2025) both expose exactly this writable-by-non-owner sub-resource. Structurally prevents the two systems fighting because they write **different objects**.
- **Guardrails for distributed status (mandatory):** idempotency keys + INSERT-on-conflict dedup, **absolute-state writes**, **monotonic lifecycle** (reject regressions — a late `processing` can't overwrite `shipped`), **authority precedence** (last-writer-*by-authority*, not last-write-wins), **self-echo suppression** (recognise your own write coming back as a webhook), reconciliation poll as backstop.

_Sources: Shopify dev docs (Fulfillment Orders, OrderDisplayFulfillmentStatus, fulfillmentCreateV2, build-for-fulfillment-services); WooCommerce Order Fulfillments blog (23 Sep 2025); Pipe17/ChannelEngine/Patchworks/Alumio/Celigo; NetSuite AOM; Microsoft/AWS event-sourcing; Hookdeck webhook-idempotency. Full citations in the Phase B research log._

### 3.3 OL-internal current state (the grounding that reframes the bet)

The codebase audit found OL is **substantially further along than #1032's premise** ("order status is pass-through; OL owns no transitions"). What actually exists today:

- **Outbound status write-back is already wired and active.** OL pushes `{status:'shipped', trackingNumber}` to every synced destination OMP (`OrderFulfillmentUpdater.updateFulfillment`) and marks the order sent on the source (`OrderDispatchNotifier.notifyDispatched`), driven by OL's *own* shipment lifecycle — not copied from the source. OL is **not** pass-through on the fulfillment axis.
- **Per-order fulfillment authority already exists as a stored field.** `FulfillmentRoutingRule.processorKind` (`omp_fulfilled | ol_managed_carrier | source_brokered`) + `processorConnectionId` is an operator-chosen, persisted per-(source, delivery-method) routing decision (ADR-012), with a dispatch orchestrator switching on it. This is exactly the industry "per-order fulfillment owner" pattern — already built.
- **A canonical OL status axis + outbound mapping already exist.** `OrderStatusValues = [pending, processing, shipped, delivered, cancelled, refunded]` plus an **outbound** `OrderStateMapping` (canonical `olStatus → destination state id`) and an **inbound** `StatusMapping` (source → destination). The vocabulary AND both translation directions are present.
- **Branch-1 fulfillment read-back exists.** `FulfillmentStatusReader.getFulfillmentStatus` projects an OMP's status back into an OL `Shipment` row.
- **Half the guardrails already exist:** Postgres-authoritative `webhook_deliveries` idempotency gate ✓ and webhook+poll reconciliation convergence ✓.

### 3.4 What this changes — the reframe

The issue's premise is **partly outdated**. OL is not a router at zero; it already sits near Shopify's **middle path** — it owns a fulfillment/shipment axis, drives outbound status off it, and records per-order fulfillment authority. The *genuine* remaining gaps are narrower and more specific:

1. **No canonical order-level status that OL *derives and owns*.** `olStatus` exists as a vocabulary and an outbound mapping, but it is still *copied from the source*, never **derived/transitioned by OL** by reconciling source + destination(s) + shipment. There is no Shopify-style **derived rollup** and no **order-level transition** OL initiates.
2. **No transition events, no monotonic enforcement, no self-echo suppression.** The guardrails the architecture stream flagged as mandatory for an owned axis are the specific missing pieces.
3. **Multi-destination is blind fan-out, not reconciled.** One order → all OMP destinations, with a per-destination `syncStatus[]`, but **no single reconciled order-level status** across the fan-out — which is precisely the multi-shop persona's value.
4. **Split authority isn't formalised as a status-ownership partition.** The fulfillment-routing branches are a strong substrate, but there's no explicit axis-partition (à la Shopify financial ⊥ fulfillment ⊥ return) declaring *which system owns which status field for this order*.

**Net:** the bet is better framed not as "build OL a state machine from scratch" but as **"close the canonical-order-status axis on top of OL's existing fulfillment plumbing"** — derive + own + reconcile the order-level status, add the monotonic/event/echo guardrails, and formalise per-order axis authority. This is a smaller, sharper, lower-risk build than the issue implied — and it directly answers your three architecture questions (see Decision log).

## 4. Solution exploration

> **Phase C — DRAFT, pending Gate C.** Five candidate shapes, each explained with its mechanics, OL-architecture impact, positioning impact, effort, risk, and exclusions. No external research added — the Phase B evidence base is sufficient; this is synthesis. The two deferred forks (authority model, guard model) are *expressed as* the shapes below rather than decided in the abstract.

### The decision space (why these five)

Two independent axes from Gate B define the space:

- **Authority axis** — how much order truth does OL own? `thin/read-only` → `own one canonical axis (Shopify middle path)` → `full OMS-of-record`.
- **Guard axis** — `guarded` (fixed vocabulary, OL-enforced transitions) vs `flexible` (seller-defined statuses + automation rules, BaseLinker-style).

The five shapes are the *coherent* points in that space (not every cell — some combinations are incoherent or strictly dominated).

---

### Shape 1 — Reconciled read-model (thin / no owned transitions)

**What it is.** OL computes a single **derived, read-only** canonical "display status" per order by reconciling the axes it already has — source status + per-destination `syncStatus[]` + `Shipment` status + `dispatchByAt` SLA — into one operator-facing rollup. No new outbound writes beyond today's. No OL-initiated transitions. Pure projection (Shopify's `OrderDisplayFulfillmentStatus` idea, minus owned writes).

**For the user.** The multi-shop, multi-marketplace operator finally sees **one status per order** instead of mentally reconciling N destination statuses + shipment state. "Is this order done?" becomes answerable at a glance.

**Architecture impact.** Additive and low-blast-radius: a derive function over existing fields + a read column/projection. No authority partition, no transition engine, no echo-suppression needed (nothing new is written). Fits OL's anemic-entity + derive-on-read conventions cleanly.

**Positioning impact.** Modest. It's "plumbing" by the Phase B finding — but it's the *visible* plumbing the operator stares at daily, so it has UX value even if it's not a banner feature.

**Effort.** ~S. **Risk.** Low. **Excludes.** Cancel propagation, SLA *enforcement* (it can *show* "overdue" but not *act*), partial-fulfillment orchestration, any OL-initiated outbound transition.

---

### Shape 2 — Axis-owning orchestrator, guarded canonical *(the evidence-recommended shape)*

**What it is.** OL owns a canonical order-level status as a **derived rollup over orthogonal axes** (fulfillment ⊥ return ⊥ — with financial left to the shop), with **OL-enforced monotonic transitions** and **transition events** that drive orchestration: cancel propagation (source cancel → OL transition → push to destinations), **SLA enforcement** (`dispatchByAt` elapses → OL fires an "at-risk/overdue" transition + event), and **partial-fulfillment rollup** (N shipments → reconciled order-level status). Status authority is **partitioned per axis with a single authoritative writer**, an explicit **precedence rule** (last-writer-*by-authority*), **self-echo suppression**, and per-order axis-ownership formalised on top of the existing `processorKind`. Leaves the shop's native order status + financial axis to the shop.

**For the user.** Beyond seeing one status, the operator gets OL to *act*: an Allegro cancellation propagates to the shop automatically; an order about to breach its ship-by SLA is surfaced and escalated before the marketplace penalty; a partially-shipped multi-line order rolls up correctly instead of looking "unshipped."

**Architecture impact.** The real build. Net-new: a monotonic transition guard, a transition-event emission path in `orders` (today there's *none*), an authority-precedence/axis-ownership model, self-echo suppression on inbound webhooks. **Leverages** what exists: `updateFulfillment` write-back, `FulfillmentRoutingRule` authority, both status-mapping tables, the idempotency gate, the reconciliation poll. This is "close the axis on existing plumbing," not greenfield.

**Positioning impact.** Strong **if marketed as the orchestration** (cancel/SLA/rollup), weak if marketed as "a state machine." Conforms to the validated category pattern (Shopify/ChannelEngine/Pipe17). Guarded model is philosophically *opposite* to BaseLinker — a deliberate "opinionated, not a rule-engine" stance.

**Effort.** ~L. **Risk.** Medium — the bet's demand is unvalidated (no named user); mitigated by the fact that the heaviest sub-piece (multi-destination rollup) can be sequenced last. **Excludes.** Seller-defined custom statuses, payments/refund/accounting (hard non-goal), RMA/returns restock (demand-gated, depends on #1030).

---

### Shape 3 — Axis-owning orchestrator, flexible seller-defined *(BaseLinker-style)*

**What it is.** Shape 2's axes + outbound orchestration, but the status **vocabulary and transitions are operator-defined** — custom statuses + an automation-rule engine ("when status = X for N days, do Y").

**For the user.** Maximum flexibility; familiar to BaseLinker migrants who already think in custom statuses + rules.

**Architecture impact.** Largest. A rule/automation engine is a new subsystem; monotonic-lifecycle guards and authority precedence are **much harder** to enforce over an open vocabulary (you can't guarantee a seller-defined graph is acyclic/monotonic). Reproduces BaseLinker's complexity tax (it needs "status groups" + "action groups" just to stay manageable).

**Positioning impact.** Familiar to migrants — but it makes OL *compete on BaseLinker's home turf* (flexibility) rather than differentiate, and the Phase B anti-signal warns custom-status engines trend toward operator overwhelm.

**Effort.** ~XL. **Risk.** High (scope creep + abandonment). **Excludes.** A clean guaranteed-monotonic canonical axis (you trade the guardrails for flexibility).

---

### Shape 4 — Full OMS-of-record

**What it is.** OL becomes authoritative for the **whole** order across all axes; shops/marketplaces become downstream sinks OL dictates to. The maximalist "OL is the OMS" reading of #1032.

**For the user.** Enables the pure **no-shop** topology (Allegro → OL → WMS, no destination shop at all) — OL *is* the order book of record.

**Architecture impact.** Heaviest by far, and **against the industry grain** for OL's position (Pipe17/ChannelEngine/Celigo all explicitly *decline* to be the system of record over pre-existing shops). OL would own conflict resolution, monotonic enforcement, and reconciliation for *every* axis including ones the shop is better at. Contradicts OL's "OSS Allegro+shop hub" identity.

**Positioning impact.** Largest moat *if* the no-shop persona materialises — but that persona is explicitly aspirational (Gate A), and the current persona (multi-shop) has shops that already own order truth, making full-OMS redundant for them.

**Effort.** ~XL+. **Risk.** Very high (building for an unconfirmed topology). **Excludes.** Staying a lightweight orchestrator; this is a different product.

---

### Shape 5 — Phased: Shape 1 now → Shape 2 when demand confirms *(de-risked bet)*

**What it is.** Ship **Shape 1 (reconciled read-model)** first as the cheap, always-useful base. Then, gated on a concrete demonstrated need (a real cancel-propagation / SLA / partial-fulfillment pain from an actual deployment), layer **Shape 2's** owned transitions + orchestration on top — starting with the **most defensible sub-bet (SLA enforcement)** and ending with the **riskiest (multi-destination partial rollup)**.

**For the user.** Immediate value (one status to look at) without waiting for the heavy build; the orchestration arrives when it's proven wanted.

**Architecture impact.** Shape 1's projection is a *foundation* Shape 2 builds on (the derived rollup is the same surface), so no throwaway work. Each later increment is independently shippable.

**Positioning impact.** Same end-state as Shape 2, reached incrementally. Honours "default to don't build [the heavy part] until demand is shown" — which directly addresses the Gate A reality that this is an *unvalidated strategic bet*.

**Effort.** ~S now, ~L spread later. **Risk.** Lowest path to the Shape-2 end-state. **Excludes.** A big-bang state-machine launch.

---

### Comparison

| Shape | Authority | Guard | Problem fit | Persona fit (multi-shop) | Strategic/positioning | Effort | Risk |
|---|---|---|---|---|---|---|---|
| **1 — Read-model** | thin | n/a | partial (sees, can't act) | good (one status) | low | **S** | **low** |
| **2 — Axis-owning, guarded** | one axis | guarded | **full** | **strong** | strong *if sold as orchestration* | L | med |
| **3 — Axis-owning, flexible** | one axis | flexible | full | strong | competes on BL's turf | XL | high |
| **4 — Full OMS-of-record** | all axes | either | full + no-shop | redundant for multi-shop | maximal moat / against grain | XL+ | very high |
| **5 — Phased 1→2** | thin→one axis | guarded | grows to full | grows to strong | strong, de-risked | S→L | **lowest to end-state** |

### Recommendation (not a decision — Gate C is yours)

**Shape 5 (phased), targeting Shape 2 as the end-state, guarded.** Reasoning:

1. This is an **unvalidated strategic bet** (Gate A). Phasing lets you *make* the bet while validating cheaply — the read-model is useful on day one and is the exact foundation the owned-transition layer needs, so nothing is throwaway.
2. **Shape 2 over 3:** the architecture's mandatory guardrails (monotonic lifecycle, authority precedence) are *incompatible* with an open seller-defined vocabulary; guarded is both cheaper and the only model where the guarantees hold. Going flexible makes OL compete with BaseLinker on flexibility instead of differentiating.
3. **Shape 2 over 4:** full OMS-of-record is against the industry grain for OL's position and is redundant for the *confirmed* persona (multi-shop sellers whose shops already own order truth). Keep #4's no-shop topology as a *future* door Shape 2 doesn't close — Shape 2's owned axis is a prerequisite for #4 anyway, so phasing toward it loses nothing.
4. **Sequence the increments by evidence:** reconciled status (always useful) → cancel propagation + **SLA enforcement** (most defensible per Phase B) → **multi-destination partial rollup** (riskiest; demand-test first).
5. **Market it as orchestration, never as "a state machine"** (Phase B positioning finding).

### Success criteria for the chosen direction (qualitative — Stage 1)

- The multi-shop operator can answer "what's the real state of this order?" from one field without opening each destination.
- An Allegro cancellation reaches the destination shop without manual operator action.
- An order at risk of breaching its ship-by SLA is surfaced before the marketplace penalty fires.
- No status-flapping / write-back loops in production (the guardrails hold).

---

### Phase C conclusion — the end-state (effort-independent analysis)

Maintainer asked: *what should the end-state be, no matter the effort?* Removing effort removes the argument **against** the heavy shapes — but it does **not** make "own everything" (Shape 4) correct, because the binding constraint on the end-state isn't cost, it's **authority correctness**:

> **The authority principle:** own the truth for exactly the facts that **no other system is authoritative for** — never for facts a connected system already owns. Owning a fact a shop owns is a *permanent* coupling + conflict-resolution liability, not a one-time build cost. (This is why Pipe17/ChannelEngine/Celigo decline OMS-of-record over pre-existing shops — not difficulty, but correctness.)

Applying the principle axis-by-axis:

| Fact / axis | When a destination **shop exists** | When there is **no shop** (Allegro → OL → WMS) |
|---|---|---|
| Payment / financial / accounting | **Shop owns** (hard non-goal — "let the shop own money", recommend *never* for OL) | **External payment provider owns** — still *not* OL. OL is never the money book of record. |
| Shop's native order record / its internal status | **Shop owns** | n/a (no shop) |
| **Cross-channel reconciled order lifecycle** (the single answer to "what's the real state across source + N destinations + shipment?") | **OL owns** — *no external system is authoritative for this; it spans systems by definition* | **OL owns** |
| Fulfillment / shipment axis | **OL owns** (already drives it today) | **OL owns** |
| Returns axis | shared/owned per topology; demand-gated (#1030) | OL owns |

Two conclusions fall out:

1. **The cross-channel lifecycle axis is the one thing OL is *uniquely* positioned to own in every topology** — because it is the only axis no single external system can be authoritative for. That axis is exactly Shape 2's owned canonical status. So Shape 2 is correct **independent of effort and independent of topology**.

2. **Shape 4 is not a separate end-state — it is Shape 2 with the per-order authority dial turned fully to OL for no-shop orders.** "Full OMS-of-record" done *correctly* is not "OL hard-coded as sole authority" (that breaks the shop-owning topology, which is OL's confirmed base). It is the **same axis-partitioned model**, where the authority partition simply assigns *all lifecycle axes* to OL when no other system is authoritative. And even then OL is the **order-lifecycle** record, never the **financial/accounting** record.

**Therefore the end-state to commit to is a single architecture, not a choice between two:**

> **An axis-partitioned, per-order-authority-adaptive canonical order-*lifecycle* model.** OL derives, owns, and (guarded/monotonically) transitions a canonical order status over orthogonal axes; a **per-order authority partition** (generalising today's `FulfillmentRoutingRule.processorKind`) declares which system owns which axis for that order. Transition events drive orchestration (cancel propagation, SLA enforcement, partial-fulfillment rollup); outbound writes go through the **fulfillment-provider** pattern (OL writes the sub-objects it owns, never a status a shop owns). Defaults: shop-owning topology → shop owns financial + native order status, OL owns the cross-channel lifecycle + fulfillment; no-shop topology → OL owns all lifecycle axes. **Payments/accounting stay external in every topology** (hard non-goal). Guard model = **guarded canonical core**; a flexible rule/automation layer, if ever wanted, sits *on top* as derived convenience and must not replace the guarded core (the monotonic + authority-precedence guarantees only hold over a fixed vocabulary).

This subsumes Shapes 1, 2, and 4: Shape 1 (read-model) is the first slice of it; Shape 4 (no-shop) is a per-order authority configuration of it; Shape 3 (flexible) is explicitly *rejected as the core* and allowed only as an optional top layer. The end-state is therefore **Shape 2's architecture, generalised to be authority-adaptive** — and the only remaining decision is *sequencing* (which slice ships first), which is an implementation-plan concern (Tier 2), not an end-state concern.

**What this explicitly is NOT, even with infinite effort:** OL as the financial/accounting system of record; OL hard-coded as sole order authority regardless of topology (would break the shop-owning base); a seller-defined rule engine as the *canonical* mechanism.

---

### Phase C review — adversarial stress-test (2026-06-18)

The end-state above was put through two adversarial reviews (architecture + product/strategy). Both returned serious findings. Summarised honestly:

**Architecture review — the spine survives, three load-bearing words are wrong:**

1. **"Orthogonal axes / single-writer-per-axis / no conflict" — REFUTED at the cancel/return/partial junctions, which are the *same* junctions the design says drive orchestration.** Cancellation crosses financial + fulfillment (Shopify rejects cancel once partially fulfilled; Magento removes cancel after invoice/shipment); returns cross financial + returns + inventory (gated on physical receipt). The axes carry spanning invariants, so "no conflict" is an illusion — conflict is *deferred* to an unnamed reconciliation layer. **Fix:** drop "orthogonal"; restate axes as **eventually-consistent projections coordinated by domain events, with a single named cross-axis reconciliation owner** for spanning invariants. (That is the OMS-orchestrator pattern — one coordinating writer — i.e. the *opposite* of independent per-axis writers.)
2. **"Guarded-monotonic canonical status" — REFUTED; self-contradictory with cancel/return.** Cancellations and returns are *retractions* (non-monotonic by the CALM theorem); a single forward-only value must drop them. **Fix:** per-axis monotonic *where the source enforces it* + a **distinct non-monotonic return/cancel axis** + a **lossy derived display status** + **reconciliation-by-refetch** for out-of-order events (which OL already does, ADR-015 — webhooks don't guarantee ordering).
3. **"Shape 4 is Shape 2 with the dial turned up" — REFUTED.** Becoming system-of-record for a fact is a **discrete commitment** (write origination + durability + conflict resolution + being-synced-*from*), not a continuous knob. And the distinctive **"cross-channel reconciled lifecycle across N destinations" matches no incumbent** — orders are single-origin everywhere surveyed. **Fix:** scope the owned lifecycle to **single-origin owned + pushed to destinations** (the market-validated 80%); mark N-destination reconciliation as a **deferred hypothesis requiring a concrete failing operator scenario**; state explicitly that SOR-ness is gated behind a deliberate boundary crossing, not reached by accretion.
4. Per-order/per-axis authority is **tractable only** via sub-aggregate split + orthogonal *regions* + a coarse topology-level role resolved *before* per-order refinement (Shopify Fulfillment Orders runs this, but constrains authority by install-time role first). A per-order routing *string* (`processorKind`) is **not** the same as per-order per-axis write authority — the "generalising an existing field" claim was doing unexamined work.

**Net architecture verdict:** stripped of those three words, what remains — *OL owns a derived/normalized lifecycle + the facts it uniquely produces, eventually-consistent axes with a named reconciliation owner, SOR-ness gated behind an explicit boundary crossing, single-origin scope* — is **exactly** the architecture BaseLinker / ChannelEngine / Veeqo / Linnworks / Shopify-FO converge on. The instinct is right; the vocabulary was dangerous. The fixes are re-wording + explicit scoping, not redesign.

**Product / strategy review — verdict: DEFER (a fortiori on the #827 precedent).** The blunt findings:

- **Scope creep dressed as strategy.** The justification is an *architectural completeness* metric ("≈70% of an OMS; the missing 30% is the state machine"), not a user outcome. No customer measures OL's OMS-completeness.
- **No named need; the analogue is operator-owned, not vendor-owned.** Real multi-channel sellers want a single panel + reliable status/tracking *push-back* — both largely solved by OL's existing read-model + outbound sync. The "owned canonical reconciled status" is the part nobody requested; BaseLinker's analogue (custom statuses + rules) is *seller-configured*, the opposite of an OL-owned machine.
- **Wrong priority pre-revenue / invisible in the buying decision.** Status is plumbing; orchestration is the headline. Breadth (integrations) + onboarding + finishing the in-flight invoicing/shipping slices convert users; an owned state machine converts nobody.
- **The "no matter the effort" trap.** For a 1–2-person pre-revenue OSS team, effort *is* the binding constraint; "ignore effort" is the documented path by which solo projects half-ship and rot (and a half-built authoritative state machine is *worse* than none — users depend on transitions OL can't guarantee).
- **#827 consistency:** its sibling was deferred (Gate D = DEFER) for thin demand; #1032's demand is *thinner* (requires an even rarer topology), so deferring #827 while building #1032 is internally inconsistent.
- **The kernel that survives:** the no-shop topology (Allegro → OL → WMS) is a genuine gap — but for a persona OL has **zero instances of today**, gated behind #1030/#1031 which also don't exist. *A reason to keep the seam, not build the machine.*

**Reconciled recommendation (Product Lead view):** the corrected end-state is a sound **north-star to document**, but both reviews + the workflow's "default to don't build" point to **deferring the heavy build now**. The honest move is to *adopt the corrected end-state as documented direction* and *gate implementation*, shipping at most the cheapest standalone-valuable slice (the reconciled read-model) — explicitly **not** owned transitions / cancel-propagation / SLA / N-destination rollup — until a real seller articulates the pain.

### Phase C — "Shape 4 + BaseLinker-style automations": can it still serve shop-owning sellers? (research, 2026-06-18)

Maintainer asked specifically about the maximalist combo (full OMS-of-record + flexible seller-defined statuses/automation rules) and whether it can coexist with a destination shop. Findings (all market-evidenced):

- **Co-equal authority is not a thing anywhere.** Every production OMS-over-storefront (NetSuite, Brightpearl, Linnworks, Cin7, Shopify enterprise-OMS) resolves dual authority by **demoting the storefront to capture + customer-facing visibility** and making the hub the single source of truth, with fulfillment write-back down for display. Two systems both owning order status produces documented failure: echo loops, status flapping, **duplicate customer emails, conflicting invoices**.
- **BaseLinker itself is hub-primary + one-directional.** It pulls orders into its Order Manager (where the seller works day-to-day) and syncs status **BaseLinker → shop only**; it *deliberately refuses to read shop status back*. So "the BaseLinker model" already means the shop is a downstream channel and the seller operates in the hub — not a co-equal shop.
- **Therefore the combo CAN serve shop-owning sellers — only via per-connection authority, never co-equal.** A per-connection `orderAuthority: 'shop' | 'openlinker'` flag: shop-primary connections stay **Posture A** (OL orchestrates around the shop, reads status, never fights it); OL-primary connections become **Posture B** (OL owns the lifecycle + automations, writes status down, shop demoted). This per-connection toggle is **production-proven** — Cin7 ("Load data from Shopify" XOR Cin7-master) and Linnworks ("follow Shopify's fulfillment structure") both ship it. This is **the same authority-adaptive model the corrected end-state already names** — independently re-derived from a third angle.
- **The gnarly part of Posture B (a real, named risk):** when OL pushes status down, the shop fires its *own* side-effects (customer emails, invoice generation, stock moves) off that change. To avoid duplicate emails / conflicting invoices, OL must either **own notifications and suppress the shop's**, or **restrict which shop statuses it writes** — and on some platforms (e.g. Shopify standard plans) the order-confirmation email **cannot be fully suppressed**. Plus the seller must **stop managing those orders in the shop admin**. This is a non-trivial, platform-specific product surface, not a flag.
- **The genuine differentiator — and it resolves the guard fork as "have both":** a **guarded canonical core *under* a flexible seller-defined label/automation layer** is real and shipping (**commercetools** validates seller-defined transitions against a configured graph). BaseLinker is "flexible all the way down" (no guarded core — its custom statuses *are* the only graph, structured solely by the seller's rules). OL could offer guarded-core + flexible-labels — *more robust* than BaseLinker — **provided the automation engine's status-change actions are themselves validated against the canonical transition graph** (else seller rules break monotonicity). So "guarded vs flexible" is not either/or; it's *guarded core + flexible presentation/automation on top*.

**Net:** the combo neither forces abandoning shop sellers nor collapses incoherently — but "support a destination shop" resolves to *"choose authority per connection,"* which **is** the authority-adaptive end-state (now market-confirmed + the guard fork resolved as "both"). It does **not** soften the strategic verdict: this makes the build *larger* (per-connection authority modes + the notification-ownership surface + an automation engine + a guarded core), reinforcing the DEFER for a pre-revenue/solo team. It *enriches the documented north-star*.

### Phase C — authority-model refinement: per-(source, axis) ownership + implementation seam (2026-06-18)

A sharper articulation than "per-connection authority": ownership genuinely varies **per (order source, status axis)**, not per destination alone.

- **The owner of a status axis depends on the order's source as much as its destination.** For an **Allegro** order, Allegro itself is authoritative for the *commercial/buyer* axis (paid, buyer-cancel, return-request) — the buyer transacts there. For a **PrestaShop-direct** order, the shop owns nearly everything. So authority is a **`(source, axis) → owner` matrix**: source marketplace owns the buyer/commercial axis; destination shop (or OL) owns the fulfillment axis; **OL uniquely owns the *reconciled cross-system lifecycle* axis** — the one axis no single external system can own. The long-standing ambiguity "who owns `cancelled` for an Allegro→PrestaShop order?" *is* the #1032 gap, now named precisely.
- **Conflict-free by construction:** OL never claims an axis a source or shop genuinely owns; it owns the reconciliation + the axes nobody else owns, and *defers/requests* on the rest. This is the strongest framing of the whole refinement and should be the spine of the north-star.
- **Tractable only if resolved from coarse roles + precedence, never hand-assigned per order** (the architecture review's combinatorial-explosion warning applies hardest here). Precedent exists: `FulfillmentRoutingRule.processorKind` is already a per-(source, delivery-method) *policy* resolved at runtime — the authority resolver generalises it.
- **Automation under this model:** rules fire on OL's owned canonical status (always valid); a rule *action* that mutates an axis OL doesn't own for that order must be an **outbound request to the owner** (propagate cancel) or a **reaction** (notify/flag) — never a forced write. Rule validity = *(legal transition on the guarded graph)* AND *(OL owns the axis OR the action is a request to the owner)*. = commercetools transition guard + an authority guard.

**Implementation seam (how it maps to OL's hexagonal grain — reuse, don't invent):**
- **Canonical status + transition guard + reconciliation** → a **core application service** (state-machine owner over `order_records`); domain orchestration, *not* a pluggable port.
- **Authority resolver** (`(source, axis) → owner`) → a **core policy service** generalising the existing `FulfillmentRoutingService`; resolved, not per-order-assigned.
- **OL-as-order-owner** (Posture B / no-shop) → an **OL implementation of the *existing* `OrderProcessorManagerPort`** — the `OpenLinkerOrderProcessorAdapter` the architecture overview already anticipates ("OpenLinker's own order system"). "OL owns the order" = "the order's processor connection is OL's own adapter." **No new capability port; reuse the seam**, same routing/dispatch machinery pointed at OL itself.
- **Flexible labels + automation engine** → a separate concern on top, plausibly its own small bounded context later — not a capability port.

## 5. Product specification — user stories & process flows

> **Phase D — DRAFT (pending Gate D).** These describe the *end-state north-star* (what the authority-adaptive model would support once fully built). Build status is gated separately at Gate D; documenting the flows does not commit them. Persona throughout = the multi-shop, multi-marketplace operator. Acceptance criteria are in user-visible terms (Stage 1 calibration — engineering AC lives in Tier-2 plans).

### Core concept the flows assume

A per-connection **`orderAuthority`** setting decides who's boss for that connection's orders:
- **Posture A — shop-primary** (today's behaviour, kept): the shop is the OMS; OL orchestrates *around* it, reads/reflects status, never overwrites it.
- **Posture B — OL-primary**: OL owns the canonical order lifecycle; the shop is a downstream executor (capture + customer-facing visibility); status flows OL → shop.

OL derives one **canonical order status** per order over a **guarded transition graph** (fixed core states + enforced monotonic-where-applicable transitions), with an optional **flexible seller-label/automation layer** mapped onto that graph.

---

### Group A — Reconciled visibility (Posture-agnostic; the foundation slice)

- **A1.** *As an operator, I want one canonical status per order that reconciles the source marketplace status + each destination's sync state + shipment state, so I can answer "what's the real state of this order?" from one field without opening every system.*
  - AC: the order list and order detail show a single canonical status; hovering/expanding reveals the per-system contributing states.
- **A2.** *As an operator, I want a derived "needs attention" signal (sync failed, SLA at risk, partially shipped), so I can triage the exceptions instead of scanning everything.*
  - AC: orders needing action are visually distinct and filterable.
- **A3.** *As a multi-marketplace operator, I want one order list spanning all my sources with a single status column, so I stop tab-switching between Allegro, Erli, and each shop.*

### Group B — Per-connection authority

- **B1.** *As an operator whose PrestaShop store should stay the boss, I want OL to orchestrate around it without ever fighting its status, so my existing shop workflows keep working (Posture A).*
  - AC: on a shop-primary connection OL never writes the shop's order status except via the fulfillment-provider sub-object (Group E); the shop's own status changes are read, not overwritten.
- **B2.** *As an operator who wants OL to be my order console, I want to set a connection to OL-primary, so OL owns the lifecycle and the shop becomes a downstream executor (Posture B).*
  - AC: setting a connection to OL-primary is an explicit, reversible operator choice with a clear warning that the shop admin becomes read-only-for-orders for that connection.
- **B3.** *As an operator with several shops, I want to choose authority per connection, so I can keep store A shop-primary while running store B OL-primary.*

### Group C — Owned transitions & orchestration (OL-primary / OL-owned axis)

- **C1 — Cancel propagation.** *As an operator, when a marketplace cancels an order at source, I want OL to transition the canonical status to cancelled and propagate the cancel to the destination(s), so I don't manually cancel in each shop.*
  - AC: a source cancel reaches the destination without manual action; if the destination can't be cancelled (already shipped), OL surfaces it as an exception rather than silently failing.
- **C2 — Ship-by SLA enforcement.** *As an operator, I want OL to flag and transition an order to "at-risk / overdue" before its dispatch SLA elapses, so I act before the marketplace's late-shipment penalty fires.*
  - AC: orders approaching/breaching `dispatchByAt` surface proactively; the signal clears when the order ships.
- **C3 — Dispatch write-back.** *As an operator, when OL generates a label / dispatches, I want the canonical status to advance to shipped and OL to push shipped + tracking to the destination shop and mark the order sent on the source, so the buyer and the shop see truth without my retyping.* (Largely exists today via `updateFulfillment` / `notifyDispatched`; this folds it into the owned lifecycle.)
- **C4 — Partial-fulfillment rollup (single-origin).** *As an operator, when an order ships in parts, I want the canonical status to read "partially shipped" rather than flip prematurely to shipped, so the rollup reflects reality.*

### Group D — Flexible labels & automation (guarded core + seller layer)

- **D1.** *As an operator, I want to define my own sub-status labels mapped onto OL's canonical lifecycle, so the vocabulary fits my business without weakening the guarantees.*
- **D2.** *As an operator, I want automation rules ("when status = X for N days → do Y"), so routine actions fire automatically — and I want OL to reject any rule whose status change would violate the canonical transition graph, so my automations can't corrupt the lifecycle.*
  - AC: a rule that would drive an illegal transition is refused at configuration time with a clear reason (the commercetools-style guard).

### Group E — Fulfillment-provider mode (the split-label case)

- **E1.** *As an operator whose shop is the OMS but who uses OL to make labels for a subset of orders, I want OL to write tracking + a fulfillment sub-object into the shop without overwriting the shop's order status, so the two systems never fight.*
  - AC: on a shop-primary connection, OL's dispatch writes land in the shop's fulfillment sub-resource (Shopify Fulfillment Order / WooCommerce Order Fulfillment / PS order_carriers+order_histories), not the order-status field the shop owns.

### Group F — No-shop topology (future / gated behind #1030/#1031)

- **F1.** *As a seller with no destination shop (marketplace → OL → WMS/carrier), I want OL to own the entire order lifecycle, because no other system exists to own it.*
  - This is Posture B with the authority dial at full OL for all lifecycle axes (still not payments). Gated — no current OL user runs this topology.

---

### Process flows (end-to-end narratives)

**PF-1 — Allegro order into a shop-primary PrestaShop (Posture A, today + reconciled view):**
ingest → resolve identifiers → create in PS (PS owns order status) → OL derives canonical status by *reading* PS + source + shipment → operator sees one reconciled status; OL orchestrates shipping but never overwrites PS's status (writes only the fulfillment sub-object). Cancels/edits the operator makes in PS are read up, not fought.

**PF-2 — Allegro order into an OL-primary Woo connection (Posture B):**
ingest → OL creates the canonical order and owns its lifecycle → OL drives transitions (ready → fulfilling → shipped …) on its guarded graph → pushes status + tracking *down* to Woo for buyer visibility → owns customer notifications (Woo's suppressed where possible) → operator manages this order *in OL*, not in Woo admin.

**PF-3 — Cancel at source (C1):**
Allegro cancels → OL ingests the cancel event → canonical status transitions to cancelled (non-monotonic cancel axis) → OL propagates cancel to destination(s); if a destination already shipped, OL raises an exception for the operator instead of forcing it.

**PF-4 — Split-label (E1): shop is OMS, OL labels a subset:**
order lives in PS (shop-primary) → operator picks "fulfill via OL" for this order → OL generates the label → writes tracking into PS's fulfillment sub-object + marks sent on the source → PS derives its own order status from the sub-object; OL never writes PS's order-status field.

## 6. Out of scope / NOT supported

> **Phase D — DRAFT (pending Gate D).** Split into hard non-goals (never), gated-deferred (build when a dependency/demand arrives), and explicitly-unsupported topologies.

### Hard non-goals — recommend *never*

1. **Payments / capture / refund / accounting of record.** OL is never the money book of record, in *any* topology (incl. no-shop — a PSP owns money there). "Let the shop/PSP own money."
2. **Customer master of record.** Stays lightweight projections (Model A/C). OL does not become the authoritative customer system.
3. **Co-equal simultaneous dual authority.** OL and a shop both owning/writing the *same* order's status at the same time. No production system supports this; it produces echo loops, status flapping, duplicate customer emails, conflicting invoices. Authority is always per-connection single-primary.
4. **Seller automations that override the guarded core.** Flexible labels/rules sit *on top* of the canonical transition graph and are validated against it; they can never drive an illegal/non-monotonic-where-forbidden transition. (No "flexible all the way down" BaseLinker-style core.)

### Gated — deferred until a dependency or demand arrives

5. **Returns / RMA + restock.** Depends on the inventory-reservation surface in #1030; demand-gated. The canonical model reserves a returns axis but does not implement restock.
6. **N-destination simultaneous-fulfillment reconciliation** (one logical order fulfilled in parts from *multiple destinations* rolled into a single reconciled status). Matches no incumbent; deferred as a hypothesis pending a concrete operator scenario OL's topology actually produces. **Scope is single-origin** owned lifecycle + push to destinations.
7. **Full customer-notification ownership on platforms that can't suppress native emails** (e.g. Shopify standard plans). OL-primary notification ownership is best-effort and platform-limited; where the shop's confirmation email can't be suppressed, OL restricts which statuses it writes rather than producing duplicates.

### Explicitly unsupported workflows

8. **Managing OL-primary orders in the shop admin.** On an OL-primary connection the shop admin is read-only-for-orders in practice; a seller who insists on editing those orders in the shop should use Posture A (shop-primary) instead. You cannot have OL-primary *and* keep editing in the shop.
9. **Promoting OL to OMS-of-record globally** (all connections forced OL-primary). Authority is always a per-connection choice; there is no "OL owns everything everywhere" switch that abandons shop-primary sellers.

## 7. Definition of done (qualitative — Stage 1)

For the **read-model slice** (the only piece authorized to build now):
- The multi-shop operator answers "what's the real state of this order?" from one field across all sources, without opening each system.
- The "needs attention" signal correctly surfaces sync-failed / SLA-at-risk / partially-shipped, and operators use it to triage.
- Zero new outbound writes, zero echo/flapping risk introduced (it only reads + derives).
- 2–3 real deployments use the unified view in production for ≥30 days without reverting to per-channel checking.

For the **deferred end-state** (when un-deferred): an Allegro cancellation reaches destinations without manual action; an order is flagged before its ship-by SLA penalty fires; no status-flapping / duplicate-email / write-back loops in production; seller automations cannot drive an illegal transition.

## 8. Risks (product-direction; engineering risks live in Tier-2 plans)

1. **No named user (demand risk).** The bet is deliberate, not demand-pulled; sibling #827 was deferred for thinner-than-this demand. *Mitigation:* gate the heavy build behind the un-defer trigger; ship only the read-model (which is valuable regardless).
2. **Over-build for a topology that may not exist.** It's unconfirmed whether any current deployment runs 2+ destinations per order or the no-shop topology. Building a reconciliation/authority engine for a fan-out that doesn't occur is the core risk. *Mitigation:* un-defer trigger requires an observed live instance.
3. **A half-built authoritative state machine is worse than none.** Once OL claims a status is canonical, every missed transition is OL's data-integrity bug — a 24/7 correctness surface a 1–2-person pre-revenue team can't underwrite. *Mitigation:* don't own a status until the team/usage justifies owning the bug.
4. **Positioning trap.** Owned status is invisible plumbing; the real differentiator (guarded-core-under-flexible-labels) only exists after the XL build and isn't a buying-decision factor. *Mitigation:* treat it as a future messaging asset, not a build justification; never market "a state machine."
5. **Notification-ownership hazard (Posture B).** Pushing status down fires the shop's native emails/invoices; duplicates are user-visible and platform-limited (Shopify standard can't suppress confirmation email). *Mitigation:* Posture B requires a per-platform notification-ownership design before it's allowed to start.

## 9. Stakeholder review (CTO + CPO) & impact summary

Two senior-seat reviews (Head of Engineering/CTO + CPO) read the full spec. **Both converged on READ-MODEL-ONLY, hard-gate the rest.** Key corrections they forced into the spec:

- **CTO — the "reuse `OrderProcessorManagerPort`, no new port" seam is mostly fictional for this feature.** That port is `createOrder` only; update/cancel/fulfillment/dispatch are *separate optional capabilities* (`OrderFulfillmentUpdater`, `OrderDispatchNotifier`, `FulfillmentStatusReader`). An OL-primary order doesn't need *creating* — it needs *transitioning + reconciling*, a surface the port lacks. The real new surface is a **core state-machine service + a transition-event path that does not exist in `orders/` today** (zero `EventPublisher` usage there). `OpenLinkerOrderProcessorAdapter` is a clean home only for the no-shop *create* case (Group F), not the state machine.
- **CTO — "half the guardrails exist" counts the *easy* half.** Delivery-dedup (`webhook_deliveries`) + poll-reconciliation exist (real). The *new, hard, stateful/concurrent* half — **monotonic enforcement, self-echo suppression, and transition-idempotency keyed by `(order, axis, source-event-id)`** — does not, and is non-optional the instant OL owns a status. (Self-echo suppression is a special case of transition-idempotency; add the general primitive.)
- **CTO — credit:** `shipments` already carries `failed`/`cancelled` terminal states + branch-1 read-back, so *all four* read-model input axes (source status, per-destination sync, shipment lifecycle, SLA) already exist and are derivable today → the read-model is **cheaper** than credited and throwaway-free.
- **CPO — reframe the read-model as its own product:** a **unified multi-channel order view** ("one order list across all your channels"), not "state-machine slice 1." It solves the persona's *actual articulated* pain (tab-switching), is cheap + demoable, and should be authorized on its own merits, decoupled from the heavy bet's demand validation.
- **CPO — the differentiator is a roadmap risk, not a build justification:** guarded-core-under-flexible-labels only exists after nearly the whole XL combo ships and is invisible in the buying decision. North-star messaging asset for when OL has revenue + a team.
- **CPO — roadmap rank:** in-flight work (Erli, WooCommerce, InPost, invoicing) *converts users*; the owned status engine converts no one. Keep them first; slot the read-model in opportunistically; gate everything above it.

### Impact summary — how #1032 affects OpenLinker

**Functionality (what it adds):**
- *Now (read-model):* one canonical, reconciled order status across every source + destination + shipment; a "needs attention" triage signal; a single cross-source order list. A visibility/UX win, no behavioural change to sync.
- *Deferred (end-state):* OL-owned lifecycle transitions + orchestration — auto cancel-propagation, ship-by-SLA enforcement, partial-fulfillment rollup; per-connection authority (shop-primary vs OL-primary); a guarded-core + flexible seller-label/automation layer; an `OpenLinkerOrderProcessorAdapter` enabling the no-shop topology.

**Limitations (what it will never / not-yet do):**
- Never: payments/accounting of record; customer master of record; co-equal dual authority; seller automations overriding the guarded core.
- Not yet (gated): returns/RMA+restock (needs #1030); N-destination simultaneous-fulfillment rollup (matches no incumbent — single-origin only); full notification ownership where the platform can't suppress native emails; editing OL-primary orders in the shop admin; any global "OL owns everything" switch.

**Architecture (where it lands):**
- A new **core application service** owns the canonical state machine over `order_records` (domain orchestration, not a port) — and introduces the **first transition-event emission path** in the orders context.
- A **core authority-resolver policy service** generalises `FulfillmentRoutingService` to `(source, axis) → owner`, resolved from coarse roles + precedence (never per-order hand-assignment).
- **Reuses** `OrderProcessorManagerPort` only for the no-shop *create* case via `OpenLinkerOrderProcessorAdapter`; the lifecycle surface is net-new core, not a port reuse.
- New guardrails required: monotonic-where-applicable per axis, a distinct non-monotonic cancel/return axis, transition-idempotency by `(order, axis, source-event-id)`, self-echo suppression; **reuses** the existing Postgres dedup + webhook/poll reconciliation.
- Additive `order_records` schema: a derived-status column now; a per-axis status/authority sub-structure + transition log/outbox only when un-deferred (do **not** front-load these).
- Blast radius now (read-model): low/additive. Blast radius of the end-state: a coordinating-writer subsystem + a 24/7 cross-marketplace correctness surface.

**Strategic:** documented north-star is sound and now well-formed; the heavy build is **deferred** on demand + capacity + #827-consistency grounds; the read-model may proceed as a standalone unified-order-view product.

## Gate D decision (2026-06-18) — DEFER

**Decision: DEFER the heavy build; adopt the corrected end-state (§4) as a documented north-star.** Rationale: unvalidated strategic bet (no named user), demand thinner than the already-deferred sibling #827, conditional wins gated on topology/adjacent-capabilities (#1030/#1031) that don't exist, a permanent 24/7 correctness liability a pre-revenue/solo team can't underwrite, and unanimous READ-MODEL-ONLY from two adversarial reviews + the CTO and CPO seats. #1032 stays **OPEN** (deferred, not closed); **no heavy implementation issues are spawned**.

**Un-defer trigger — revisit the heavy build when *any one* holds:**
1. A live deployment runs **2+ destinations for the same logical order** and an operator reports cross-system reconciliation pain (validates the multi-shop value claim that is currently hypothetical).
2. A seller incurs **actual marketplace late-shipment penalties** and asks OL to enforce dispatch SLAs (validates the most-defensible sub-bet; the penalty mechanism is documented, the OL user is not).
3. A concrete **no-shop / WMS-fulfilled** seller appears (the only topology where OL *must* own the lifecycle) — and even then gated behind #1030 (native inventory) / #1031 (WMS).

**Carved out as a separate, standalone item (not a #1032 child):** enrich the existing derived order-health (#929) to fold in shipment lifecycle + an SLA "overdue/at-risk" signal — a read-only visibility slice useful regardless of the bet, which also organically instruments un-defer trigger #2.

## Decision log

- **2026-06-18** — Refinement opened. Grounded Phase A against the codebase: confirmed order *lifecycle* status is pass-through. Framed the central demand-gate question, mirroring #827's DEFER.
- **2026-06-18 (Gate A)** — Maintainer: STRATEGIC BET (no named user, deliberate); persona = multi-shop, multi-marketplace seller; scope = full write/orchestration state machine + events.
- **2026-06-18 (Phase B)** — Three research streams completed. Maintainer expanded scope to include architecture patterns (should OL be the OMS-of-record? how to handle split authority / split-label write-back?). Answers grounded in evidence:
  - **(a) Should OL be the OMP / OMS-of-record?** Industry default for OL's position = **orchestrator, not system-of-record** (Pipe17 "bring your own source of truth"). The validated middle path (Shopify) is to own a **derived order-level status + the cross-channel fulfillment axis** while leaving financial + the shop's native order status to the shop. Recommendation surfaced for Gate C: own a canonical *axis*, not the whole OMS.
  - **(b) OL owns the order but a shop integration handles some functions →** partition status by **orthogonal axes with a single authoritative writer per axis** + an explicit **authority-precedence** rule + **monotonic lifecycle**; the order-level status is a *derived rollup*, never a contested scalar (Shopify template).
  - **(c) Shop is the OMS but OL does labels for a few orders →** model OL as a **fulfillment provider** that writes a **fulfillment sub-object only** (tracking + fulfillment status), never the shop's order status (Shopify Fulfillment Orders / WooCommerce Order Fulfillments). **OL already does a version of this** via `updateFulfillment` write-back + per-order `processorKind` authority — so (c) is largely a *formalisation*, not a greenfield build.
  - **Reframe:** OL is already near Shopify's middle path (owns fulfillment axis, drives outbound status, records per-order authority). The real gap is a *derived/owned canonical order-level status + reconciliation + monotonic/event/echo guardrails + formalised per-order axis authority* — smaller and sharper than #1032's "build a state machine" framing.
- **2026-06-18 (Phase C/D)** — Drafted full user-story / process-flow set (§5) and the not-supported list (§6). Refined the authority model to **per-(source, axis) ownership** (source marketplace owns buyer/commercial axis; shop/OL owns fulfillment; OL owns the reconciled cross-system lifecycle — conflict-free by construction; tractable only via coarse-role resolution). Implementation seam: a core state-machine service + an authority-resolver policy service generalising `FulfillmentRoutingService`; automation = guarded transition graph + authority guard.
- **2026-06-18 (Gate D)** — Maintainer decision: **DEFER**. North-star documented; heavy build deferred behind a 3-condition un-defer trigger (§ Gate D); #1032 stays open; no heavy impl issues spawned; small order-health+SLA subset carved out as a standalone issue.
- **2026-06-18 (Phase D review — CTO + CPO)** — Both seats: **READ-MODEL-ONLY, hard-gate the rest** (§9). CTO corrections: the `OrderProcessorManagerPort` reuse is mostly fictional (it's `createOrder`-only; the lifecycle surface is net-new core + a transition-event path that doesn't exist in `orders/`); "half the guardrails exist" counts the easy half (monotonic enforcement + self-echo + transition-idempotency by `(order,axis,source-event-id)` are the hard, missing, non-optional part); credit — all read-model input axes already exist, so the slice is cheaper + throwaway-free. CPO: reframe the read-model as a standalone **unified multi-channel order view** product; the guarded-core differentiator is a future messaging asset not a build justification; in-flight work outranks this. Spec corrected accordingly.
- **2026-06-18 (Phase C)** — Maintainer asked for the effort-independent end-state. Concluded via the *authority principle* that the correct end-state is a single **axis-partitioned, per-order-authority-adaptive canonical order-lifecycle model** (Shape 2 generalised; Shape 4 = a per-order config of it; payments external always; guarded core).
- **2026-06-18 (Phase C adversarial review)** — Two reviews. **Architecture:** spine sound, but "orthogonal axes / no conflict", "guarded-monotonic single value", and "Shape 4 = dial turned up" are each refuted; N-destination reconciliation matches no incumbent. Corrected end-state = eventually-consistent axes + named cross-axis reconciliation owner + per-axis monotonic + distinct non-monotonic cancel/return axis + lossy derived display + single-origin scope + SOR-ness as a discrete gated commitment. **Product/strategy: DEFER** — scope creep justified by architectural completeness not user need; no named user; wrong pre-revenue priority; status is invisible plumbing; "no matter the effort" is the solo-OSS stall trap; #827-consistency demands a fortiori defer. **Product Lead reconciliation:** adopt corrected end-state as documented north-star; gate the heavy build; ship at most the reconciled read-model slice until demand surfaces.
- **2026-06-22 (recheck)** — Re-ran `/refine-product` on the back of an external demand signal (an evaluator independently raised the status-sync + cancellation gap; see #1032 comment). **Verdict: DEFER held** — the signal fires none of the three un-defer triggers (evaluator interest, not a deploying seller; single shop, not 2+ destinations; has-a-shop, not no-shop). The recheck did, however, validate a **narrower, base-serving capability** the heavy spec under-credited: a **Posture-A status & cancellation round-trip** for the shop-primary base OL already serves (shop-fulfilled → source mark-sent/tracking; inbound cancel → destination; origin cancel → other participant; topology-agnostic incl. shop→shop). Carved out as a **separate** refinement — **#1157** + spec [`product-spec-1157-order-status-roundtrip.md`](./product-spec-1157-order-status-roundtrip.md) + [ADR-027](../architecture/adrs/027-order-status-writeback-capability-and-relay.md) — explicitly *not* written into this deferred spec (it owns no canonical status; folding it in would mislabel a deferred bet as in-build). It is a **foundation for** this bet: its `OrderStatusWriteback` capability (event-as-data) and relay guardrails (idempotency / self-echo / monotonic) are exactly the seam + primitives this issue's state machine would later drive. The inbound-cancel correctness bug #1132 folds into #1157's Slice 1.
