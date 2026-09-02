# REVIEW — OMS authority model: five-panel design review

**Date**: 2026-08-21. **Targets**: `DESIGN-oms-authority-model.md` + draft ADRs 052–060.
**Method**: five specialized parallel reviewers (hexagonal/DDD conformance; distributed-systems
correctness; product/operator value; plugin-ecosystem contracts & security; delivery feasibility),
each with a distinct lens and instructions not to re-litigate the first adversarial pass; findings
adjudicated by the orchestrating reviewer. This file is the adjudication record; the design doc and
ADRs have been amended per the ACCEPT verdicts below (Revision R1), with the larger restructurings
recorded as directives in §6.

**Post-merge verification (2026-08-23, #2298).** This record was produced while #2161 was an open
PR. Every code claim in it was re-checked against the merged tree and stands: H8b's count is
verified again (`CoreCapabilityValues` in `libs/core/src/integrations/domain/types/adapter.types.ts`
has **9** members, so the design's 9→13 holds), and the #2047 precedent both the hexagonal and
correctness panels lean on survives — `selectPrimaryInvoicingConnection` still exists in
`invoicing`, and the shipped `resolveSalesDocumentRouting` mirrors its single-candidate and
operator-primary rules rather than replacing them. This record carries no `file:line` citations by
construction (symbol and path references only), so nothing here needed re-pointing. One panel
finding gains shipped precedent rather than changing verdict: **P1**'s closed trigger×action
automation layer now has a house pattern to copy in the `sales-documents` rule engine (#2170) —
recorded in the design at §5.3(c) and §10, not re-adjudicated here.

---

## 1. Panel verdicts, and the synthesis

- **Hexagonal/DDD**: "the strongest large design in this repo … weakest exactly where new
  inter-context edges are asserted rather than specified." Two threatened cycles found and fixed.
- **Distributed correctness**: strong on mechanism (reuses shipped guards), systematically weak on
  **ordering** — three blockers are the same error (persisted evidence written *after* the boundary
  it protects), the exact property the cited #2047 precedent gets right.
- **Product value**: "the most intellectually honest OMS decomposition reviewed in this repo — but
  it answers an architecture question no user asked." Center of gravity is routing (a Linnworks
  primitive) while OL's verifiable audience is BaseLinker-shaped single-location self-shipping
  sellers; the one demand-backed ask on record (`packedAt`) was absent; Gate D's un-defer triggers
  never fired and the design dropped that discipline.
- **Plugin contracts**: "a competent third party cannot ship an adapter against this contract as it
  stands" — one port points in the wrong direction, the inbound transport for fulfillment progress
  does not exist in the closed `InboundEventDomain` union, nine referenced types are undefined, and
  the ADR-003 trust question this design *is* goes unanswered.
- **Delivery**: "yes — this can ship incrementally without a big-bang, and that is not a small
  compliment" — but Wave 1 bundled an inert vocabulary change with the riskiest migration in the
  repo's history under a "zero behaviour change" label, and routing Wave 2 was unrunnable (no
  location attributes, no bootstrap).

**Chief-reviewer synthesis.** The architecture survives review; the *roadmap authorization* does
not. The authority matrix, the plugin packaging, the degenerate-default discipline, and the
dual-posture verdict all held up under five independent attacks — several reviewers verified the
load-bearing claims against code and reported them clean. What changes: (1) a set of correctness
mechanics (intent-before-boundary ordering, resume-not-reject idempotency, state-dependent expiry,
the fulfillment-progress ingress); (2) the **roadmap inverts around the actual majority** —
single-location self-shipping sellers get `packedAt`, dispatch-SLA risk, returns with commission
refunds, holds, oversell protection, and a small closed automation layer *first*, while routing,
`FulfillmentWork` execution, and the OL-OMS plugin move behind an explicit demand gate (restoring
Gate D's discipline); (3) the ADR block grows to 052–062 (058 splits; a trust ADR is added).

---

## 2. Convergent findings (independent multi-panel hits — highest confidence)

| Finding | Panels | Resolution |
|---|---|---|
| Fulfillment progress has a contract but no transport: port direction inverted AND `InboundEventDomainValues` closed with no fulfillment member (the documented eparagony trap) | hex + correctness + plugin | Add `'fulfillment'` (+`'return'`) domain members, routing-policy arms with capability gates, `fulfillment.work.statusSync` job (webhook-as-trigger, authoritative pull), inbound idempotency key; `report()` restated as the core-side ingestion seam `IFulfillmentProgressService.record()`; pull-shaped `getFulfillmentStatus(workRef)` kept on the executor for polling vendors |
| Guards whose persisted evidence lands after the boundary they protect (route, refund, dispatch-consume) | correctness (3 findings) + the #2047 precedent both hex and correctness cite | Intent/claim rows persisted BEFORE every boundary crossing (routing intent row; refund attempted-predicate before the provider call + `in_doubt` money state; `reservationConsumedAt` claim driven by sweep) |
| A5 boot-time failure contradicts the design's own inert-ambiguity rule | hex + product | A5 obeys the matrix: `ambiguous` → no automated disposition, reason persisted on the return, surfaced — never a boot failure |
| `persistOrder` source-attribution immutability is a Wave-0 item, not Wave 4 | correctness + delivery | Moved to Wave 0 (closes the live #940 clobber independently of any OMS work) |
| The `inventory_items` NOT NULL + index recreation is the wrong Wave-1 risk | delivery (+ hex's split of ADR-058) | Migration ladder: nullable column + sentinel written by sync; #1904 guard retained as fallback; `SET NOT NULL` + index recreation deferred behind a cleanliness check; duplicate-position detection precedes any recreation (the *existing* NULL-`locationId` dup hazard is a latent defect found in passing) |

---

## 3. Adjudication table

Verdicts: **A** = accept as found · **AM** = accept modified · **R** = reject · **D** = accept as
directive (applied to the design's next revision / plan phase, not inline today).

### Hexagonal/DDD panel
| # | Finding | Verdict | Action |
|---|---|---|---|
| H1 | `inventory ↔ fulfillment` cycle on the ATP hot path | **A** | `atpEffect: 'published' \| 'diagnostic'` stamped on the reservation row at creation by the ingestion caller (which holds the routing outcome); ATP query becomes a local column test |
| H2 | `orders ↔ fulfillment` edge unmitigated | **A** | Stated invariant: `fulfillment` injects no `orders`/`inventory` service — order data enters as arguments; `@openlinker/core/orders/types` sub-barrel for type needs; boot int-test pins the one-way edge (the ADR-041 F3 precedent) |
| H3 | `FulfillmentProgressReporter` direction inverted | **A** | Merged into the convergent ingress fix (§2) |
| H4 | `getRefundTriggerOwner()` advertises a right ADR-056 denies | **A** | Deleted from `ReturnsAuthorityPort` |
| H5 | "amends, does not supersede" is not a defined ADR operation | **A** | ADR-057 gains `## Supersedes` → ADR-017 (status flip at merge); arm (2) preserves 017's protection verbatim |
| H6 | A5 boot failure contradicts ADR-052 | **A** | See §2 |
| H7 | Closed filter/sort vocabulary is plugin config, not core | **A** | Names + coercer move to `@openlinker/oms`; core keeps `RoutingInput`/`RoutingPlan`/`RoutingExplanationStep` with opaque display-labeled rule names |
| H8a | `AuthorityKind` never enumerated (ADR-043's own kill reason) | **A** | Enumerated in ADR-052 with a per-row mapping: capability name (or "config-only"), config key, owning context; `RefundExecutor` added to §9's inventory; mirror-check script mandated |
| H8b | `CoreCapabilityValues` "is 10 today" | **R** | Verified against `adapter.types.ts`: **9 members**. The design's 9→13 stands |
| H9 | Repository seams for reservation/hold writes unnamed | **A** | `ReservationRepositoryPort.claimHeld/releaseHeld`, `OrderHoldRepositoryPort.placeIfNoneOpen`, each with its named domain error |
| H10 | `supportsHold` duplicates the `isAvailabilityHolder` guard | **A** | Deleted; absence of the guard is the declaration |
| H11 | ADR-059 needs `## Supersedes` ADR-043 | **A** | Added; 043 → `Superseded by ADR-059` at merge |
| H12 | ADR-058 packs four decisions | **A** | Split: 058 = multi-location positions + provenance (Wave 1); new **061** = reservations + `AvailabilityAuthority` (Waves 2–3) |
| H13 | Conformance artefacts unlisted (barrel-purity generalization, standards-doc exemption list, package exports, overview map) | **A** | Wave-1a checklist item in the roadmap |
| H14 | Vocabulary drift (`operator_forced` not in any union; `OrderHoldReason` at work grain; fulfilment/fulfillment spelling) | **A** | `FulfillmentCancellationReasonValues` declared; hold union renamed `HoldReason` within its leaf; identifiers standardize on `fulfillment`, prose may use either |

### Distributed-correctness panel
| # | Finding | Verdict | Action |
|---|---|---|---|
| C1 | Expiry vs holds: silent oversell on held orders | **A** | State-dependent expiry: the sweep *extends* (never releases) a reservation whose order has an open hold or accepted/in-progress work; release only with no live OL-executed obligation; expiry against accepted work emits a fact + needs-attention entry |
| C2 | Router gate: no intent before the committing `route()`; guard defends the wrong race | **A** | `routing_decisions` intent row (partial-unique on live) persisted before `route()`; guard reads the intent row regardless of router identity; mandatory route idempotency key derived from the decision row; declared timeout below lock TTL; N work rows + terminalisation in one transaction |
| C3 | Reserve rejects a retry instead of resuming | **A** | Insert-then-recover (`ON CONFLICT DO NOTHING` + re-select = granted); differing-quantity match = explicit delta-adjust under the guarded UPDATE |
| C4 | `'unknown'` = hold-last-published is unimplementable; no ceiling | **A** | Restated: **suppress the publish write + alert**; bounded by `OL_AVAILABILITY_UNKNOWN_MAX_HOLD_MS`, then a conservative floor with a distinct provenance value |
| C5 | Progress webhook dead-letters (closed domain union) | **A** | See §2 |
| C6 | A4 has no selection function; ADR-057 arm (1) undecidable | **A** | `lifecycleAuthority: { mode: 'external', connectionId }`; resolved via `selectAuthorityHolder`; ambiguity inert; fact producer bound per order at ingestion (prospective-only thereafter) |
| C7 | `work:{workId}:{attempt}` re-mints on job retry | **A** | `FulfillmentWork.assignmentAttempt`: persisted, monotonic, incremented only by router-driven re-request, written before the outbound call |
| C8 | Consume lost on dispatch retry (early-return short-circuit) | **A** | `Shipment.reservationConsumedAt` conditional claim + sweep over dispatched shipments with null claim |
| C9 | Relay has no idempotency gate; progress events replayable | **A** | Mandatory vendor-scoped `FulfillmentProgressEvent.idempotencyKey`; `(workId, key)` dedup row claimed before relay; `dispatchRelayedAt` claim on the work row; router-filtered destinations' relay invisibility stated as deliberate |
| C10 | `FulfillmentWork`: no per-column writer discipline, no counter CHECK, stale `supportedActions` | **A** | Owner per column + conditional UPDATE per axis transition; `CHECK (fulfilled + cancelled ≤ total)`; optimistic-concurrency token required on actions (409 + refreshed actions); re-route gated on no `cancelledAt` under the routing lock |
| C11 | Refund guard lacks the ordering that makes the invoicing guard safe; no in-doubt member | **A** | Attempted-predicate persisted before the provider call; `ReturnMoneyState` gains `in_doubt`; only terminal `denied` clears the block (ADR-042 discipline by name) |
| C12 | Provenance in the index but not in the row lookup ⇒ cross-source clobber; column classification spec | **A** | `sourceConnectionId` added to `findByProductAndVariant`/`getInventory`; third (OL-owned) column group declared for `olReservedQuantity` |
| C13–15 | Vendor-clock/tie-break; re-point ordering; orphaned reservations on the throw path | **D** | Recorded as binding directives for the plan phase (re-point: single transaction, id-ordered, new-hold-then-release; line-diff shrink ⇒ reservation adjust/release; reconciler gains ledger-vs-order-lines pass) |

### Product-value panel
| # | Finding | Verdict | Action |
|---|---|---|---|
| P1 | Missing sellable layer: closed trigger×action automation | **AM** | Added as a first-class Wave-2 deliverable (N closed triggers OL owns × M actions OL ships); does not reopen the closed phase; the authority layer remains the substrate, not the product |
| P2 | `packedAt` absent — the only demand-backed ask | **A** | Wave-0 story: `order_records.packedAt` + `packedByUserId`, one endpoint, one list column — works for 100% of orders including `omp_fulfilled` |
| P3 | Gate D discipline dropped; no fired un-defer trigger | **A** | Demand-status statement added; Waves 0–2 authorized as independently valuable; Wave 3 (routing/execution/plugin) and Wave 4 (third-party OMS/posture B) each behind an explicit demand gate |
| P4 | Presets ship two waves after the flags they mitigate | **A** | Presets ship with the first operator-settable authority flag; **no per-authority override in v1** (a needed override = a missing third preset) |
| P5 | "Inert and reported" needs an operator surface (the #2100 cost, ×5 paths) | **A** | Authority-status page (who holds what; what is currently inert and why) ships alongside the first authority flags, reusing #2100's attention-worthy/routine split |
| P6 | Missing table-stakes stories; unexplained silences | **A** | Added: Allegro commission-refund automation (with returns), exchange/resend; explicit reasoned non-goals recorded for order merge (bijection), backorder-selling (deferred with date-qualified ATP), scan-driven flows (Wave 3b) |
| P7 | EDD/preorder/BOPIS omissions correct; `supportedActions` undersold | noted | No action; §5.2 keeps the pattern |
| P8 | "omp_fulfilled majority" framing wrong — the majority ships from one location and self-picks | **AM** | Roadmap inverted (see §5): majority features first; routing gated. Reservations/holds stay authorized — oversell protection and holds serve single-location sellers too (the delivery panel's minimal-V1 concurs) |
| P9 | `Authority`/`posture`/`FulfillmentWork` must not reach the UI | **A** | UI-naming rules recorded ("Who decides X?" / "fulfilment task" / outcome-named presets) |
| Pcut | Cut I9, I8+P5-story, P4, P7, T8 | **AM** | I9 deferred (field stays on the scope type); I8/P5 stories deferred until a named vendor (ports stay); P4/P7 reclassified as invariants, not stories; T8 deferred with `ReturnReceiver` (which also resolves the plugin panel's narrowing-base question) |

### Plugin-contracts panel
| # | Finding | Verdict | Action |
|---|---|---|---|
| G1 | Progress transport missing end-to-end | **A** | See §2 |
| G2 | `credentialsRef = null` breaks four named paths; Subiekt `''` precedent | **A** | ADR-055 amended: `credentialsRef: ''` + advertised `AdapterMetadata.requiresCredentials?: boolean` relaxing the create guard — no migration, no type change, no privileged platformType check |
| G3 | ADR-003's own text demands a trust ADR this design doesn't write | **A** | New **ADR-062**: v1 trust posture (in-tree/first-party is the *trust* target; third-party is the *contract* target), PII allowlist projection for `RoutingInput` (`OL_STORE_PII`-aware), and a **plausibility envelope** — an authority answer moving published ATP beyond a configured factor resolves `'unknown'` |
| G4 | No error taxonomy / timeout budgets / retry classification per port | **A/D** | Contract statements added (neutral core-owned error unions per port; wall-clock ceilings with named on-breach behavior — `'unknown'` for availability, `indeterminate`+reason for routing; classification via the existing `retryClassifierRegistry`); full per-method spec is a plan-phase directive |
| G5 | Nine undefined types; sync `route()` vs async DOMS; no batch caps | **A/D** | `RoutingPlan` gains a third `pending {decisionId}` arm; declared `maxBatchSize` (advertised) with OL-side chunking; freshness declared-and-respected (OL never awaits recomputation); the nine type definitions are a named plan-phase deliverable |
| G6 | `getAuthorityScopes()` breaks the pure-selection property | **A** | Scope claims move to `Connection.config.availabilityAuthority.scopes` via `parseAuthorityConfig` (pure, lazy-compatible); `getFreshness()` stays on the port, cacheable |
| G7 | Capability-change mirrors unlisted (pinned spec, FE union, `CAPABILITY_HELP`, docs) | **A** | Listed in §9 |
| G8 | `ReturnReceiver` has no dispatched base to narrow from | **AM** | Deferred entirely with T8 (see Pcut) — the question is recorded and must be answered before it ships |
| G9 | No forward-compat rule for older out-of-tree adapters | **A** | ADR-055 rule: new input fields optional + ignorable; union growth requires `default:` arms across the port boundary (never `never`-exhaustive there); guards narrow by runtime method probe (ADR-046) |

### Delivery panel
| # | Finding | Verdict | Action |
|---|---|---|---|
| D1 | Wave 1 is four epics under a false "zero behaviour" label | **A** | Split 1a/1b/1c(/1d); only 1a is zero-behaviour |
| D2 | `inventory_items` migration undeliverable (`CONCURRENTLY` unavailable; ACCESS EXCLUSIVE) | **A** | The ladder in §2; posture stated in ADR-058 |
| D3 | Routing needs location attributes + a bootstrap that don't exist | **A** | `countryIso2`/`postcode`/geo on `inventory_locations` from day one; router refuses to enable until ≥1 location exists, first-run wizard offers minting from the sentinel pool |
| D4 | `persistOrder` immutability is Wave 0 | **A** | Moved (see §2) |
| D5 | Allegro returns spike unscheduled | **A** | Wave-0 issue with an explicit kill condition |
| D6 | Propagation-skip retirement is breaking for out-of-tree `InventoryMaster` plugins | **A** | Declared breaking (the #2163 precedent); zero-config claim verified for all in-tree adapters |
| D7 | Existing indexes already NULL-dup on `locationId`; recreation fails on dirty installs | **A** | Duplicate-position detection pass precedes recreation; `locationId` sentinel/COALESCE decision recorded in ADR-058 |
| D8 | `shipments.direction` repriced (4 predicates + partial-index blocker + default trap) | **A** | §7.2 amended with the `UQ_shipments_branch_one_per_order_conn` predicate change |
| D9 | Key-swap deploy semantics + `observedAt` must be row `updatedAt` | **A** | Stated (disjoint keyspaces; never wall-clock) |
| D10 | Store-associate surface is an unsized wizard-scale epic; cut line before it | **A** | Wave 3a = desktop worklist with manual mark-picked/shipped (lights the 3PL story with no floor UI); 3b = the scan surface, sized ~wizard-scale |
| D11–14 | Double-listed key swap; column-budget statement; ADR-numbering re-verify; line-diff cost note | **A** | Applied |

---

## 4. Panel conflicts resolved

1. **Product ("routing waits for a trigger") vs Delivery ("holds + reservations are minimal V1")**
   — resolved by splitting what "OMS" means: holds, the reservation ledger, returns, `packedAt`,
   SLA risk, and automation serve the single-location majority and are authorized (Waves 0–2);
   routing, `FulfillmentWork` execution, and the OL-OMS plugin are the multi-location minority's
   features and sit behind the demand gate (Wave 3). Both panels' verdicts survive intact.
2. **Hexagonal ("10 capabilities") vs the design ("9")** — resolved by direct verification: 9.
3. **Hexagonal's two options on ADR-057** — supersession chosen over in-place amendment because
   057's predicate *replaces* 017's; 017's protection survives as arm (2), which the `## Supersedes`
   section states.
4. **Plugin panel's `ReturnReceiver` base options vs product's T8 cut** — the cut wins; the base
   question is recorded as a precondition of un-deferring.

## 5. The revised (gated) roadmap — replaces the design's §10

- **Wave 0 — live-defect fixes + demand-backed quick wins** (no OMS dependency): `cancelledAt`
  provisioning predicate · ingestion line-diff + `amended` fact · `never`-defaults ×5 ·
  `inv:{hash}` key swap (`observedAt` = row `updatedAt`) · **`persistOrder` source-attribution
  immutability** · **`packedAt`/`packedByUserId`** · **Allegro returns-feed spike** (kill
  condition attached).
- **Wave 1a — vocabulary + lifecycle phase** (the only zero-behaviour wave): the two leaves ·
  Phase A derivation + SQL/FE mirrors + mirror-check · **dispatch-SLA risk list** (FE over the
  existing `dispatchByAt`) · conformance checklist (H13).
- **Wave 1b — inventory foundations**: `inventory_locations` (with country/postcode/geo) ·
  `sourceConnectionId` nullable + sentinel (#1904 guard retained) · provenance-scoped lookup +
  third column group · `IAvailabilityService` computed seam · propagation-skip retirement
  (**declared breaking for out-of-tree plugins**) · duplicate-position detection.
- **Wave 1c — returns observe** (scope set by the Wave-0 spike): aggregate + orphan bucket +
  `return.decline`. *(1d, optional, later: `SET NOT NULL` + index recreation behind a cleanliness
  check.)*
- **Wave 2 — the majority's OMS value** (authorized): order holds + `activeHoldReason` +
  **authority-status surface** + **presets** (shipping with the first flag) · reservation ledger
  (resume semantics, state-dependent expiry, consume claim, shortfall) · returns custody +
  `adjustInventory` amendment + refund trigger (`in_doubt`) + **Allegro commission-refund
  automation** · **automation layer v1** (closed triggers × actions).
- **Wave 3 — routing + execution + OL-OMS plugin** — **GATED on a fired demand trigger** (a live
  2+-location deployment in pain; a no-shop/WMS seller; a late-penalty case): 3a router + intent
  row + `FulfillmentWork` + desktop worklist (manual mark-picked/shipped); 3b the scan/pick
  surface + short-pick → re-source.
- **Wave 4 — third-party OMS + posture B** — **GATED on a named vendor/prospect**: port hardening
  (the nine types, error taxonomy, `pending` arm, batch caps), `OrderSource` +
  `LifecycleAuthorityProvider` + the ADR-057 predicate, trust envelope (ADR-062) activation,
  networks, disposition routing.

Sizing (delivery panel): ≈70–85 eng-weeks across all waves; minimal coherent V1 = Wave 0 + 1a +
1b + Wave 2's holds and reservation ledger.

## 6. Revised ADR block: 052–062

052 (matrix, +`AuthorityKindValues` enumeration) · 053 (leaf + resolution placement, +no-injection
invariant) · 054 (`FulfillmentWork`, +intent row, +progress ingress, +writer discipline) · 055
(plugin packaging, `credentialsRef: ''` + `requiresCredentials?`, +forward-compat rules) · 056
(refund/fiscal, +persist-before-boundary ordering + `in_doubt`) · 057 (ADR-017 **supersession**,
+A4 selection with connection id) · 058 (**narrowed**: multi-location positions + provenance +
migration ladder) · 059 (lifecycle phase, +`## Supersedes` ADR-043) · 060 (returns, A5 inert, no
`getRefundTriggerOwner`) · **061** (new: reservations + `AvailabilityAuthority`, split from 058) ·
**062** (new: trust posture for authority-holding capabilities — first-party trust target, PII
allowlist, plausibility envelope).

## 7. Standing directives not applied inline (bind the plan phase)

Define the nine port I/O types before any Wave-3 issue is filed · per-method error unions +
wall-clock budgets per port · vendor-clock + tie-break rule for `vendorLifecycleObservedAt` ·
re-point transaction ordering · line-diff ⇒ reservation adjust/release + the reconciler's
ledger-vs-order-lines pass · `FulfillmentCancellationReasonValues` · the `HoldReason` rename ·
UI naming rules (P9) · product-spec before Wave 2 (presets UX, automation triggers/actions,
authority-status page) and before Wave 3 (worklist).
