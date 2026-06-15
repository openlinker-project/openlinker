# Implementation Plan — #965 DPD tracking via DPDInfoServices (SOAP) + worker registration

**Issue:** #965 · **Parent spec:** `docs/specs/product-spec-961-dpd-polska-shipping.md` (§4.9 OQ-B4, US-7 / AC-7) · **Branch:** `965-dpd-tracking`

---

## Phase 1 — Understand the task

**Goal.** Replace the coarse `getTracking` stub (shipped in #962, which rejects) with **real DPD tracking**, register the DPD plugin in the worker so status-sync runs, and propagate status + tracking to Allegro + PrestaShop (via the existing #838 sync pipeline).

**Layer.** **Integration** (DPD plugin) + **DX/Worker** (plugin registration + scheduled poll). No core changes — the #838 `ShipmentStatusSyncService`, the `marketplace.shipment.statusSync` poll handler, and the `marketplace.shipment.syncByExternalId` webhook-trigger handler all already exist (the latter two landed via #838 + #768).

**Transport decision (resolved — the crux of this issue).** The issue body assumes a SOAP `DPDInfoServices` WSDL; the shipped DPD adapter is **REST `DPDServices`** (ADR-018). Verified against ADR-018 (line 37: *"Tracking is a separate service (DPD InfoServices) regardless of transport — unchanged (#965)"*), the public DPD PHP wrapper (shipment-only — no tracking op), and DPD's own structure: **tracking lives only in the SOAP `DPDInfoServices` service (`getEventsForWaybillV*`); the REST API has no tracking op.** → The DPD plugin becomes **dual-transport**: REST `DPDServices` for shipment/labels (unchanged) + a **minimal SOAP `DPDInfoServices` client** for tracking.

**Non-goals.** Courier/COD/pickup/bulk (shipped in #962/#964/#966/#971). No new core ports/types. No webhook ingestion for DPD (DPD has no tracking webhook — poll-only, unlike InPost #768). No COD settlement/reconciliation.

---

## Phase 2 — Research (reuse map)

| Reuse | Path | Note |
|---|---|---|
| `getTracking` stub to replace | `libs/integrations/dpd-polska/src/infrastructure/adapters/dpd-shipping.adapter.ts` (rejects today) | implement here |
| Plugin descriptor / register(host) | `libs/integrations/dpd-polska/src/dpd-plugin.ts` | add scheduler-task registration |
| Factory + cred resolution (`login`/`password`/`masterFid`) | `libs/integrations/dpd-polska/src/application/dpd-adapter.factory.ts` | construct + inject the SOAP client |
| REST client (NOT reusable for SOAP) | `infrastructure/http/dpd-http-client.ts` | JSON/fetch only → new SOAP client needed |
| `getTracking` port + `TrackingSnapshot` + `ShipmentStatus` | `libs/core/src/shipping/domain/{ports,types}` | unchanged — adapter returns `TrackingSnapshot` |
| Status-sync engine (poll + webhook-trigger) | `libs/core/src/shipping/application/services/shipment-status-sync.service.ts` | unchanged — calls `getTracking` |
| Worker poll + webhook-trigger handlers | `apps/worker/src/sync/handlers/marketplace-shipment-status-sync.handler.ts`, `…-sync-by-external-id.handler.ts` | already registered (#838/#768) |
| Worker plugin list (DPD **absent**) | `apps/worker/src/plugins.ts` | add `DpdIntegrationModule` |
| Worker jest mapper (#917) | `apps/worker/test/jest-integration.cjs` | add 2 lines for `@openlinker/integrations-dpd-polska` |
| Scheduler-task pattern | `libs/integrations/inpost/src/infrastructure/scheduler/inpost-scheduler-tasks.ts` → registered via `host.schedulerTaskRegistry` | mirror for DPD |
| XML parsing | `fast-xml-parser@^5.3.3` (already a dep) | **no SOAP lib** — hand-build the envelope, parse with fast-xml-parser |

---

## Phase 3 — Design

**SOAP, no heavyweight lib.** DPDInfoServices is a single operation (`getEventsForWaybillV1`). Adding `soap`/`node-soap` (WSDL parsing, CVE history, large surface) is overkill. **Decision: hand-build the SOAP envelope as a template string and parse the response with the already-present `fast-xml-parser`** — MVP-appropriate, lean dependency surface. Captured as **ADR-022** (see § ADR below — it *completes* the tracking-transport thread ADR-018 deferred; it does not supersede ADR-018).

**Auth.** DPDInfoServices `getEventsForWaybillV1` carries auth in the SOAP body (`authDataV1 { login, password, masterFid }`) — the **same** credentials the factory already resolves (`login`/`password` from `credentialsRef`, `masterFid` from config). No new credential shape.

**Data flow (unchanged core; new adapter internals):**
```
worker poll (marketplace.shipment.statusSync, DPD cursor)  ─┐
worker webhook-trigger (marketplace.shipment.syncByExternalId) ─┤ (no DPD webhook; poll-only)
                                                            ▼
ShipmentStatusSyncService → carrierAdapter.getTracking({ providerShipmentId })   [#838, unchanged]
                                                            ▼
DpdShippingAdapter.getTracking  →  DpdInfoSoapClient.getEventsForWaybill(waybill)
                                 →  DpdTrackingMapper.toSnapshot(events)  →  TrackingSnapshot
                                                            ▼
                          #838 buildPatchAndMaybePush → propagate to Allegro + PrestaShop
```

**Event-code mapping.** `getEventsForWaybill` returns an event list (status code + timestamp). The mapper picks the latest event, maps its DPD code → `ShipmentStatus` (`generated | dispatched | in-transit | delivered | failed`), sets `deliveredAt`/`dispatchedAt` from event timestamps, records the raw code in `providerStatus`, and **degrades unknown codes to `in-transit` with a `logger.warn`** (AC-3). ⚠️ The exact DPD event-code catalogue lives in the gated `DPDInfoServices` spec (gryf portal `/Documentation/DPD-InfoServices`) — see Open Questions; the table is seeded conservatively and the unknown→`in-transit` fallback keeps the mapper correct-by-construction until verified.

---

## Phase 4 — Step-by-step plan

1. **ADR-022** `docs/architecture/adrs/022-dpd-tracking-soap-dpdinfoservices.md` (+ README row): scoped to **transport mechanics**, NOT REST-vs-SOAP (ADR-018 owns that). **Context** = ADR-018 deferred tracking transport; #965 finds it's SOAP-only → the DPD plugin is now dual-transport. **Decision** = (a) dual-transport DPD plugin (REST shipment + SOAP tracking); (b) the **ObjEvents** interface (uncoded) over **XmlEvents** (base64 + optional ZIP); (c) hand-built SOAP envelope + `fast-xml-parser` (no `soap` lib); (d) auth reuses the connection's `login`/`password` (channel-less waybill method). **Alternatives rejected** = `node-soap`/`strong-soap` (heavy, WSDL parsing we don't need, CVE surface); the **XmlEvents** interface (smaller payloads but adds base64/zip codec complexity for no real gain on per-waybill reads); a *separate* DPD-InfoServices connection/adapter (same account + same `ShippingProviderManager.getTracking` capability ⇒ one adapter, two transports is correct). **Consequences** = one extra transport to maintain in a single plugin; per-waybill poll fan-out (no batch on the per-shipment contract); XML-decoding robustness burden (single-element array coercion, offset-less timestamps); the redirect-stall limitation (Step 4). Status **Proposed**, **Related to ADR-018** (not superseding — add a one-line "tracking transport resolved by ADR-022" note to ADR-018's line 37). **AC:** ADR present + README index row; ADR-018 unchanged in status.

2. **Tracking types** `libs/integrations/dpd-polska/src/domain/types/dpd-tracking.types.ts`: `DpdWaybillEvent { code: string; description?: string; occurredAt?: string }`, the `DPD_EVENT_CODE_STATUS` map (`as const`, seeded + `// VERIFY against DPDInfoServices spec`), and `eventsSelectType` constant. **AC:** `as const` union pattern; no `any`; file header.

3. **SOAP client port + impl**
   - `infrastructure/http/dpd-info-soap-client.interface.ts` — `getEventsForWaybill(input: { waybill: string }): Promise<DpdWaybillEvent[]>`.
   - `infrastructure/http/dpd-info-soap-client.ts` — `fetch` POST `text/xml; charset=utf-8` to the **DPDInfoServicesObjEvents** endpoint, hand-built `getEventsForWaybillV1` envelope (namespace `http://events.dpdinfoservices.dpd.com.pl/`) embedding `waybill` + `langCode='EN'` + `eventsSelectType='ALL'` + `authDataV1 { login, password, channel: '' }` (**not** masterFid — channel is empty for the waybill method); parse with `fast-xml-parser` configured `removeNSPrefix: true` (response is `ns2:`-namespaced; don't depend on the server's prefix) **and `isArray: (name) => name === 'eventsList'`** — fast-xml-parser collapses a **single** `<eventsList>` to an object (not a 1-element array), so without this a one-event waybill breaks the mapper; belt-and-braces, the client also coerces `Array.isArray(x) ? x : [x]`. Extract `<eventsList>` items → `{ businessCode, eventTime, description, newWaybill: eventDataList/value }`.
     - **Never log the request body** — the SOAP envelope carries `login`/`password` in the body (unlike the REST client's header). Log only endpoint + waybill + HTTP status + latency. Reuse the REST client's retry/timeout shape (read-only → retryable on transient).
     - **SOAP Fault arrives as HTTP 200** (not 4xx/5xx): the client MUST inspect the parsed body for a `Fault` element regardless of HTTP status. Auth faults → `DpdUnauthorizedException`; other faults → a new `domain/exceptions/dpd-tracking.exception.ts` (`DpdTrackingException`); transport/timeout → `DpdNetworkException`. Relying on HTTP status alone would treat faults as success.
     - **XML-escape every interpolated value** (waybill + creds) via a small `escapeXml()` helper — the envelope is a hand-built template string, so the waybill (external input) is an injection vector. Helper gets its own unit test.
     **AC:** interface/impl split; no secrets logged; Fault-on-200 mapped to a domain exception; unknown-shape responses raise a domain exception, never `any`; `escapeXml` unit-tested.

4. **Tracking mapper** `infrastructure/mappers/dpd-tracking.mapper.ts` — `toSnapshot(events: DpdWaybillEvent[]): TrackingSnapshot`. **Event-selection semantics (define explicitly — this is the mapper's core contract + its test spec):** sort events by `eventTime` ascending; the **status** derives from the most-recent event, BUT a **terminal state wins if present anywhere in the history** — i.e. if any event maps to a terminal OL status (reuse core `TerminalShipmentStatusValues` = `delivered`/`failed`/`cancelled`), that is the snapshot status even if a later non-terminal event exists (DPD histories can be non-monotonic; a parcel doesn't "un-deliver"). Among multiple terminal events, the latest by timestamp wins (`failed` after `delivered` ⇒ `failed`). Missing/equal timestamps fall back to array order. Set `deliveredAt`/`dispatchedAt` from the matching events' timestamps; `providerStatus` = raw code of the selected event; empty list → `generated`; unknown code (not terminal) → `in-transit` + `logger.warn`.
   - **Timezone:** DPD `eventTime` is offset-less (`2021-01-08T11:18:52.122` = `Europe/Warsaw` wall-clock). Parse deliberately as Warsaw-local → UTC `Date` (don't pass the bare string to `new Date()`, which parses offset-less ISO as UTC in V8 → a 1–2 h error on `dispatchedAt`/`deliveredAt`). A small `parseDpdEventTime()` helper + a unit test asserting the resolved instant.
   - **Redirect/return limitation (`230402`):** map → `in-transit` + capture `newWaybill` from `eventDataList/value`, and `logger.warn` (`DPD redirected {old}→{new}; OL keeps polling {old} — auto-follow out of scope for #965`). The shipment's `providerShipmentId` stays the original waybill, so a redirected parcel's status **stalls at in-transit** (the old number stops getting events). Accepted v1 limitation — auto-follow (rewrite `providerShipmentId` to the new waybill) is a documented follow-up, not silent.
   **AC:** pure; covers delivered / in-transit / unknown / empty / `delivered-then-failed` / unordered-input / single-event / redirect-with-new-waybill / timezone-correct instant.

5. **Implement `getTracking`** in `dpd-shipping.adapter.ts` — replace the stub: call the SOAP client, map, return `TrackingSnapshot`. Adapter constructor now also takes the SOAP client. **AC:** stub + `ShippingProviderRejectionException` removed; no behaviour change to shipment/label methods.

6. **Factory wiring** `application/dpd-adapter.factory.ts` — construct `DpdInfoSoapClient` with the connection's `login`/`password` (channel `''`; **not** masterFid) + endpoint from a new `DPD_INFO_BASE_URLS[environment]` constant: prod `https://dpdinfoservices.dpd.com.pl/DPDInfoServicesObjEventsService/DPDInfoServicesObjEvents`, demo `https://dpdinfoservicesdemo.dpd.com.pl/DPDInfoServicesObjEventsService/DPDInfoServicesObjEvents`. Inject into the adapter. ⚠️ InfoServices is its **own host** (`dpdinfoservices.dpd.com.pl`) — distinct from the `dpdservices` shipment host AND the `gryf` doc portal. **AC:** demo vs prod resolved from `config.environment`; auth = `login`/`password` (no masterFid); demo host carries a `// TODO confirm demo WSDL` note (the one residual unknown).

7. **Scheduler poll** `infrastructure/scheduler/dpd-scheduler-tasks.ts` (mirror InPost) — `buildDpdSchedulerTasks(): SchedulerTaskConfig[]` → `taskId: 'dpd-shipment-status-sync'`, `platformType: 'dpd'`, `jobType: 'marketplace.shipment.statusSync'`, env-gated cron (default conservative, e.g. every 30 min), cursor `dpd.shipmentStatus.scanOffset`. Register in `dpd-plugin.ts` `register(host)` via `host.schedulerTaskRegistry.register(task)`.
   - **Fan-out is per-waybill** (a chosen trade-off, not a surprise): `getEventsForWaybillV1` is single-waybill, and `ShipmentStatusSyncService.sync(connectionId, {limit, offset})` iterates OL's DPD shipments calling `getTracking` once each → **N SOAP round-trips per poll batch**. Keep the default cron conservative + the page `limit` modest to stay under DPD rate limits. Check the WSDL for a **multi-waybill/batch op** — if one exists, note it as a **future optimization** (the core `getTracking({providerShipmentId})` contract is single-shipment, so a batch op can't be wired without a core change — out of scope for #965; record it, don't silently ignore it).
   **AC:** env-gated (off unless enabled); idempotency key per InPost precedent; conservative default cadence documented.

8. **Worker registration** — `apps/worker/src/plugins.ts`: add `DpdIntegrationModule`. `apps/worker/test/jest-integration.cjs`: add the two `@openlinker/integrations-dpd-polska` mapper lines (#917). **AC:** `pnpm --filter @openlinker/worker … check-jest-integration-mappers` passes; worker boots with DPD.

9. **Tests** — `dpd-info-soap-client.spec.ts` (envelope build + parse + fault/401 mapping, mocked fetch), `dpd-tracking.mapper.spec.ts` (each status + unknown fallback + empty), `dpd-shipping.adapter.spec.ts` (getTracking happy + SOAP-fault paths), `dpd-scheduler-tasks.spec.ts` (env-gate on/off). Update `testing/fake-dpd-shipping.adapter.ts` `getTracking` (currently throws) to return a seeded snapshot + `seedTracking()` helper. **AC:** ports mocked, not `fetch`; adapter coverage ≥70%.

10. **DPD tracking int-spec** (promoted from optional) — mirror the InPost #768 int-spec: seed a DPD shipment + connection → run the `marketplace.shipment.statusSync` poll path → mocked SOAP response → assert the shipment status is patched. De-risks the worker-registration + cursor wiring (adding a worker plugin ripples into worker int-specs — the manifest-capability lesson). **AC:** SOAP transport mocked (not real DPD); status patch asserted against the DB.

11. **Quality gate** — `pnpm lint && pnpm type-check && pnpm test`; full `pnpm test:integration` before PR.

---

## Phase 5 — Validate

- **Architecture:** Integration-only + worker wiring; no CORE↔Integration boundary crossing; SOAP client behind a port (interface/impl split); adapter implements the existing `ShippingProviderManagerPort.getTracking` contract unchanged.
- **Naming:** `*.interface.ts` / `*.ts` / `*.mapper.ts` / `*.types.ts` / `*.spec.ts`; `as const` unions; `UPPER_SNAKE_CASE` constants.
- **Security:** creds resolved via `CredentialsResolverPort` (never hardcoded); auth fields never logged; SOAP body built with explicit XML-escaping of the waybill (the only external input) to avoid envelope injection.
- **Testing:** unit-mock the SOAP transport; mapper + fallback fully covered.

### Resolved API facts (from DPD `INFO_Services_v2` spec + `Events`/`Ending statuses` xlsx, obtained 2026-06-11)

All four pre-implement open questions are now **RESOLVED**:

1. **Event-code catalogue** ✅ — full `businessCode → group/description` list (`DPD Infoservices Events_22-05-2026.xlsx`) + the 20 **terminal** codes (`Ending statuses.xlsx`). Mapping rule for `DPD_EVENT_CODE_STATUS`:
   - **Terminal-precedence** (any event `businessCode` ∈ ending-statuses): `1901xx`/`1902xx` (*Doręczona / delivered*) → **delivered**; `230403`/`230408` (*Zwrot / return to sender*) → **failed**; `230402` (*Przekierowana / redirect*) → **in-transit** + capture the new waybill from `eventDataList/value`; any other terminal code → **failed**.
   - **Non-terminal by group/prefix**: `030103` (registered) → **generated**; `040101/040102`, `500500` (collected by courier) → **dispatched**; `170xxx` (out for delivery), `0501xx/120xxx/160xxx/230101/320xxx/330xxx/450xxx` (hub/depot/customs/sort), `5001xx/5002xx` (transit abroad) → **in-transit**; `040200-040605` (failed pickup/reception) → **generated** (pre-dispatch); `200xxx` (undelivered *attempt*, non-terminal) → **in-transit**; unknown → **in-transit** + `logger.warn`.
2. **Operation + request** ✅ — `getEventsForWaybillV1` on the **DPDInfoServicesObjEvents** interface (object/uncoded — not the base64/zip XmlEvents). Params: `waybill`, two-letter `langCode` (`'EN'`), `eventsSelectType` = **`ALL`** (full history — needed for terminal-precedence + dispatched/delivered timestamps), `authDataV1`. Channel-less (§1.3) + idempotent on re-read ⇒ **no `markEventsAsProcessed`** (that's only the channel-based `getEventsForCustomer` pull — the future batch path). Response: `getEventsForWaybillV1Response` → `<return>` → repeated `<eventsList>` with `businessCode`, `eventTime`, `description`, `eventDataList/value`, `waybill`.
3. **Endpoint** ✅ — separate host `dpdinfoservices.dpd.com.pl` (NOT gryf — the doc portal — and NOT the `dpdservices` shipment host). **PROD**: `https://dpdinfoservices.dpd.com.pl/DPDInfoServicesObjEventsService/DPDInfoServicesObjEvents`. **Demo**: `https://dpdinfoservicesdemo.dpd.com.pl/…` (by the demo-host naming pattern — *the one residual unknown*; confirm against the demo WSDL before relying on the demo path). SOAP namespace `http://events.dpdinfoservices.dpd.com.pl/`.
4. **Auth** ✅ — `authDataV1 { login, password, channel }` in the SOAP body (NOT `masterFid`/`X-DPD-FID`; channel **empty** for the waybill method). The factory already resolves `login`/`password`; `masterFid` is irrelevant to InfoServices.
   - **Residual note (non-blocking):** InfoServices auth is LDAP-scoped and *may* be a distinct DPD account from the shipment creds. Default to reusing the connection's `login`/`password`; if DPD issues separate InfoServices creds, that's a future config addition. The `DeniedAccessWSException` SOAP Fault surfaces a mismatch clearly at runtime.
