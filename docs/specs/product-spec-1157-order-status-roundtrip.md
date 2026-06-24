# Product Spec — #1157 Order status & cancellation round-trip (Posture-A relay)

**Status:** phase D complete — **Gate D = YES (build)**. Carved out of the #1032 recheck (2026-06-22); #1032's heavy bet stays DEFERRED.
**Parent issue:** [#1157](https://github.com/openlinker-project/openlinker/issues/1157)
**Carved out of:** [#1032](https://github.com/openlinker-project/openlinker/issues/1032) (OL-owned order-status state machine — **deferred**; this is the narrow base-serving slice that does not require it)
**ADR:** [ADR-027 — Order status writeback capability & lifecycle relay](../architecture/adrs/027-order-status-writeback-capability-and-relay.md)
**Started:** 2026-06-22
**Workflow:** [`docs/contributors/refinement-workflow.md`](../contributors/refinement-workflow.md)

> **Relationship to #1032 — foundation for, not equal to.** This relay propagates lifecycle facts between systems that each stay authoritative; OL owns **no** canonical order status. It is the **Posture-A** branch the future #1032 authority model resolves to, and its writeback capability + guardrails are the seam #1032's state machine would later drive. Nothing built here is throwaway if #1032 un-defers.

---

## 1. Problem

OpenLinker ingests an order from a source (e.g. Allegro) and creates it in a destination shop (e.g. PrestaShop), but **does not keep the two systems' lifecycles in sync afterwards**:

- When the destination **shop** fulfils the order itself (branch-1, shop-managed shipment), OL reads the shop's status into a local `Shipment` row but **never propagates "shipped" + tracking back to the source marketplace** (`OrderDispatchNotifier.notifyDispatched` fires only when OL owns the shipment). So the marketplace — and its buyer — don't learn the order shipped.
- An inbound **marketplace cancellation** is a silent no-op: the ingest handler ignores `eventType`, so a cancel never transitions the already-created destination order (filed as bug #1132).
- There is **no source-side cancellation propagation at all** (a shop cancel never reaches the marketplace).

Net for the operator: **status and cancellations must be maintained in two systems by hand.**

The topology is not marketplace↔shop only. OL routes `OrderSource → OrderProcessorManager`, and either side may be a shop or a marketplace, so the same gap appears across:
- marketplace → OL → shop
- shop → OL → marketplace
- **shop → OL → shop**

## 2. Affected persona

The **shop-primary operator OpenLinker serves today** — one or a few destination shops that own the order/OMS, with orders sourced from a marketplace and/or another shop. They want OL to keep the participating systems' lifecycles consistent **without** OL becoming the authority for the order. This is OL's *confirmed current base*, not the hypothetical multi-shop/no-shop persona of the deferred #1032.

## 3. Evidence

- **Recheck demand signal (2026-06-22).** An external evaluator independently raised this exact gap, unprompted — status sync over an order's life + cancellation both directions (see [#1032 comment](https://github.com/openlinker-project/openlinker/issues/1032#issuecomment-4769064890)). It is the gap an evaluator hits *first*.
- **Codebase audit (2026-06-22).** Confirmed the three concrete gaps in §1 against `shipping/application/services/fulfillment-status-sync.service.ts` (branch-1 read-back writes a local `Shipment` row, no source writeback), the ingest handler (ignores `eventType` — #1132), and the absence of any source-side cancel capability.
- **#1032 recheck verdict.** The signal fires **none** of #1032's three un-defer triggers (evaluator interest not a deploying seller; single shop not 2+ destinations; has-a-shop not no-shop) → the heavy bet **holds at DEFER**. But it validates this narrower capability for the base. Full reasoning in the #1032 spec decision log (2026-06-22 entry).

## 4. Solution — a Posture-A lifecycle relay

OL propagates order-lifecycle facts (**dispatched** + tracking, **cancelled**) between participating systems that each stay authoritative. OL is a **best-effort relay**, not an authority — it forwards a fact authored by an authoritative system to the other participant(s), with the correctness guardrails bidirectional propagation requires. This is the same liability class OL already accepts everywhere (eventually-consistent sync with retry/reconcile), **not** the owned-canonical-status liability class #1032 defers.

Two architectural decisions carry the design (full rationale in **ADR-027**):

1. **One platform-neutral, role-agnostic writeback capability, event-as-data.** `OrderStatusWriteback.write(event)` where `event` is a discriminated union (`dispatched{trackingNumber?, carrier?} | cancelled{reason?} | …`), implemented by **every** participant adapter (shop *and* marketplace), each mapping the intent onto its own API. This mirrors the existing inbound `OrderFeedEventType` discriminator and collapses today's `OrderDispatchNotifier` (marketplace, event-specific) / `OrderFulfillmentUpdater` (shop, generic setter) split. The relay calls **one method per participant** — no platform branching, no capability-per-event proliferation. Unsupported transitions are reported via the **result**, not the type system.

2. **A core lifecycle-relay application service** owns all cross-system propagation, dispatching to each participant via the `isOrderStatusWriteback` guard regardless of source/destination role or platform type — so all three topologies (incl. shop→shop) are served by construction.

### Guardrails (non-optional once we propagate cross-system)

- **Idempotency** per (order, event, source-event-id) — reuse the existing `webhook_deliveries` dedup + the shipment at-most-once gate.
- **Self-echo suppression** — OL's own write returning as an inbound event must not re-propagate (loop prevention).
- **Monotonicity + authority precedence** — never relay a stale `processing` over `shipped`; never cancel an already-shipped order.
- **Explicit failure surfacing** — irrecoverable propagation = operator-visible exception, never a silent drop (the #1132 behaviour).

These are exactly the primitives #1032 would reuse — built here scoped to the relay, they are foundation, not throwaway.

## 5. User stories & acceptance criteria

- **S1 — Shop-fulfilled → source.** *As a shop-primary operator, when my shop marks an order shipped, I want the source marketplace to learn it shipped (with tracking), so I don't re-enter it on the marketplace.*
  - AC: when the destination shop transitions an order to shipped, the source marketplace reflects "sent" + tracking without operator action; if the source can't accept it, the operator sees why.
- **S2 — Inbound cancel → destination.** *As an operator, when an order is cancelled at the source, I want OL to cancel/transition it in my shop, so the two systems agree.* (Supersedes the bug-only framing of #1132.)
  - AC: a source cancellation transitions the destination order to cancelled; if the destination is already shipped, OL surfaces an exception instead of silently failing or forcing it.
- **S3 — Origin cancel → other participant.** *As an operator, when an order is cancelled in the originating system (shop or marketplace), I want the cancellation to reach the other side.*
  - AC: a cancellation observed at the origin propagates to the other participant where supported; unsupported targets surface a clear, actionable signal.
- **S4 — No double-acting / no loops.** *As an operator, I want OL to never duplicate a propagation or ping-pong a status, so my data stays clean.*
  - AC: re-delivered events, OL's own echoes, and out-of-order events do not produce duplicate or regressive writes.

## 6. Out of scope / non-goals

1. **OL-owned canonical order status / state machine / per-axis authority model** — that **is** the deferred #1032.
2. **Ship-by SLA enforcement** — the read-only signal is #1108; enforcement is #1032.
3. **Multi-destination reconciliation, returns/RMA, automation engine.**
4. **Marketplace-as-destination** (full order *creation* onto a marketplace) — a separate `OrderProcessorManager`-for-marketplace gap, not a writeback concern.
5. **Per-connection `orderAuthority` toggle (Posture B)** — Posture A is assumed; Posture B is #1032.

## 7. Definition of done (qualitative — Stage 1)

- A shop-primary operator running Allegro → shop sees the marketplace reflect shipped + tracking when the shop ships, with no manual marketplace entry.
- A marketplace cancellation reaches the destination shop (or surfaces a clear exception when it can't), and no cancel is silently dropped.
- No status flapping, duplicate writes, or echo loops observed in production.
- The writeback capability is implemented uniformly by Allegro and PrestaShop with **zero platform-type branching in the relay**.

## 8. Risks (product-direction)

1. **It crosses into cross-system writes the #1032 reviews gated.** *Mitigation:* it is a best-effort **relay** (no owned canonical status) — the accepted eventual-consistency liability class, not the owned-truth class the gate blocked. Stated explicitly so it isn't read as un-deferring #1032.
2. **Echo/loop risk is real for bidirectional propagation.** *Mitigation:* self-echo suppression + idempotency + monotonic guards are in-scope and non-optional (ADR-027), not deferred.
3. **Capability unification touches shipped code** (`OrderDispatchNotifier` / `OrderFulfillmentUpdater`). *Mitigation:* ADR-027 records the migration; the generic driver is retained for order provisioning.

## 9. Implementation slices

Spawned as children of #1157 (links below). Each goes through `/plan` (Tier 2).

- **Slice 1** — `OrderStatusWriteback` capability (event-as-data) + lifecycle-relay service + guardrails + inbound cancel → destination. **Closes #1132.** Implements ADR-027 (authored in this refinement PR).
- **Slice 2** — Shop-fulfilled (branch-1) → source writeback, via the relay (covers shop→shop fulfilment by construction).
- **Slice 3** — Allegro implements `OrderStatusWriteback` (dispatched + cancelled) + cancel → marketplace origin.
- **Slice 4** — Shop-as-source cancellation detection in the `OrderSource` feed (PrestaShop source adapter emits `cancelled`) — required for shop→shop / shop-origin cancel.

## Decision log

- **2026-06-22** — Carved out of the #1032 recheck. #1032 heavy bet held at DEFER (fires no un-defer trigger); this narrow Posture-A relay validated for the confirmed shop-primary base. Capability model decided: single event-as-data `OrderStatusWriteback` (no method/capability-per-event), platform-neutral, all participants implement it — mirrors the inbound `OrderFeedEventType` discriminator and collapses the `OrderDispatchNotifier`/`OrderFulfillmentUpdater` split. Relay dispatches by capability guard, topology-agnostic (incl. shop→shop). Gate D = YES for this slice. ADR-027 (authored in this refinement PR) records the architecture.
