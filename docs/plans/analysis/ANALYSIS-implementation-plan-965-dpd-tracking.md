# Pre-implement gate — #965 DPD tracking (DPDInfoServices SOAP + worker registration)

**Plan:** `docs/plans/implementation-plan-965-dpd-tracking.md` · **Gate run:** 2026-06-11 · **Verdict: ✅ READY**

No Critical contract breaks; no reuse collisions. One Warning (declare a direct dep) and four external-API open questions that are already flagged in the plan and rendered non-blocking by the unknown→`in-transit` fallback. The plan is correctly scoped to plugin-local additions over an existing, unchanged core/worker contract.

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `ShippingProviderManagerPort.getTracking` | **EXISTS → implement (fill stub)** | `libs/core/src/shipping/domain/ports/shipping-provider-manager.port.ts:58`; current `dpd-shipping.adapter.ts` rejects with a `#965`-tagged stub. Signature unchanged. |
| `TrackingSnapshot`, `ShipmentStatus` | **EXISTS → reuse** | `libs/core/src/shipping/domain/types/{tracking-snapshot,shipment-status}.types.ts` (exported via `@openlinker/core/shipping`). |
| `ShipmentStatusSyncService` (+ `sync`, `syncOneByProviderShipmentId`) | **EXISTS → reuse unchanged** | `libs/core/src/shipping/application/services/shipment-status-sync.service.ts` (#838/#768). |
| `marketplace.shipment.statusSync` job + poll handler + `syncByExternalId` handler | **EXISTS → reuse** | `apps/worker/src/sync/handlers/*` already registered in `sync-worker.module.ts`. **No new core/worker handler.** |
| `SchedulerTaskConfig` + `host.schedulerTaskRegistry` | **EXISTS → reuse** | `@openlinker/core/sync`; InPost precedent `libs/integrations/inpost/src/infrastructure/scheduler/inpost-scheduler-tasks.ts`. |
| `fast-xml-parser` | **EXISTS (repo dep) → reuse** | root `package.json` + **`libs/integrations/prestashop/package.json`** already uses it for XML (precedent + config reference). |
| DPD SOAP client (`dpd-info-soap-client.{interface,}.ts`) | **NEW** | no SOAP client in `dpd-polska`; `DpdHttpClient` is REST/JSON-only (not reusable). |
| `dpd-tracking.mapper.ts`, `dpd-tracking.types.ts`, `DPD_EVENT_CODE_STATUS` | **NEW** | none present. |
| `DpdTrackingException` | **NEW** | existing exceptions are Config/Network/Unauthorized only. |
| `dpd-scheduler-tasks.ts` + DPD scheduler registration | **NEW** | DPD registers no scheduler task today. |
| DPD in `apps/worker/src/plugins.ts` + worker jest mapper | **NEW (additive)** | worker mapper DPD count = **0** (confirmed); plan adds both lines. |

## Backward-compatibility findings

- **No Critical.** No barrel symbol removed/renamed; `getTracking` port signature unchanged (stub→impl); no DTO change; no Symbol-token change.
- **No migration.** The plan touches no `*.orm-entity.ts` — the `shipments` table + #838 entity already exist; tracking only reads + patches via the existing repo. ✅
- **Warning — under-declared direct dependency.** The plan uses `fast-xml-parser` from inside `libs/integrations/dpd-polska`, but that package's `package.json` does **not** declare it (only root + prestashop do). It resolves today via hoisting, but per the monorepo under-declaration trap it should be added to `libs/integrations/dpd-polska/package.json` `dependencies` in this PR. **Migration path:** add `"fast-xml-parser": "^5.3.3"` (match the root pin).
- **`check:invariants` — clean / addressed.** `check-jest-integration-mappers`: api side already has DPD (plugins.ts + 2 mapper lines); the plan adds the matching 2 worker lines (guard satisfied). `check-cross-context-imports`: plugin imports from `@openlinker/core/shipping` + `@openlinker/core/sync` top-level barrels only (types, capability const, `SchedulerTaskConfig`) — allowed shapes. No deep-barrel or service-interface violations.
- **ADR number:** plan now targets **ADR-025** — confirmed the next free number (019/020/021 are taken: bulk-dispatch / delivery-intent / inbound-webhook). ✅

## Open questions (external-API — flagged in plan, non-blocking to start)

1. **Event-code catalogue** — exact DPD codes for `DPD_EVENT_CODE_STATUS` (from the gryf `/Documentation/DPD-InfoServices` spec). Mapper's unknown→`in-transit`+warn fallback makes the feature shippable; table must be verified before merge.
2. **Operation version + response XML shape** — `getEventsForWaybillV1` vs `V3`; element names for the parser.
3. **Service endpoint URL** — real DPDInfoServices SOAP host/path (NOT the gryf doc portal) for demo + prod.
4. **Auth placement** — confirm `authDataV1` in the SOAP body vs HTTP Basic.

> These shape the SOAP client's envelope + the mapper table but not the plan's structure. Recommended: implementation can scaffold all files now; fill (1)-(4) from the spec/WSDL before the PR merges. The mapper's fallback + the int-spec (mocked SOAP) keep the unverified table from being a correctness risk in the interim.

**Bottom line:** READY to implement. Add `fast-xml-parser` to the DPD package's deps as part of the work, and treat the four API unknowns as fill-before-merge (not start-blockers).

---

## Re-gate — 2026-06-11 (plan v2, after DPD spec obtained) → ✅ STILL READY

The plan was revised after the DPD `INFO_Services_v2` spec + event xlsx were obtained: all four open questions resolved, ADR renumbered **019 → 022** (confirmed next-free), auth refined to `authDataV1 { login, password, channel }` (not `masterFid`), endpoint pinned to the separate host `dpdinfoservices.dpd.com.pl` (ObjEvents / `getEventsForWaybillV1`). Re-verified the v2 assumptions against the live tree:

- **No new contract surface.** `getTracking(input:{providerShipmentId}): Promise<TrackingSnapshot>` signature **unchanged** (still implementing, not altering) — `shipping-provider-manager.port.ts:58`. Factory `resolveCredentials` already returns `{ login, password }` (the SOAP client needs exactly these + a constant empty `channel`; `masterFid` is irrelevant) — no credential-shape change.
- **No new `ShipmentStatus` value.** Mapping targets `generated|dispatched|in-transit|delivered|failed` all exist in `ShipmentStatusValues`. ✅
- **New reuse opportunity:** core already defines `TerminalShipmentStatusValues = ['delivered','failed','cancelled']` (`shipment-status.types.ts`). The mapper's terminal-precedence concept overlaps; **prefer reusing it** for the OL-side terminal check rather than hardcoding (note: the *DPD-side* terminal set still comes from `Ending statuses.xlsx` — the two are distinct axes, OL-status-terminality vs DPD-event-terminality).
- **Warning unchanged:** `fast-xml-parser` still absent from `libs/integrations/dpd-polska/package.json` (count = 0) — declare it during the work.

Verdict unchanged: **READY**. Plan v2 is strictly more precise than v1 (resolved its own open questions); no Critical, the one Warning persists, demo-host URL is the only residual unknown (provisional + `// TODO confirm`, non-blocking).
