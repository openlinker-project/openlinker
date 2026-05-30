# Implementation Plan — #884 Shipment label-document download endpoint + panel CTA

> Status: reviewed (2× tech-review applied) · Branch `884-shipping-label-pdf-download` · Author: OpenLinker Senior Engineer

## 0. Resolved decisions (post tech-review)

- **O1 — capability name:** `LabelDocumentReader` (capability), `fetchLabel` (method), `LabelDocument` (type), `isLabelDocumentReader` (guard). The capability names the **business verb**, never the wire format — the bytes can be PDF *or* ZPL/EPL (Allegro per seller "Ship with Allegro" setting) *or* PNG (InPost), and `LabelDocument.contentType` carries the actual format dynamically. A `*Pdf` name would be a lying contract on a published, plugin-facing port. Matches the in-repo #833 forward-reference (`allegro-shipment.mapper.ts`) and the agent-noun sibling style (`ShipmentCanceller`, `PickupPointFinder`). NOT the issue's `OrderFulfillmentLabelPdfReader` (wrong port family + wrong format-in-name).
- **Scope boundary (no `documentType` discriminator):** deliberately NOT generalized to `ShipmentDocumentReader` + `documentType: 'label' | 'protocol'`. The dispatch **protocol** (handover manifest, #831) is per-batch not per-parcel, has a different input shape, and #831 is an uncommitted spike — YAGNI. When it ships it's a sibling sub-capability `DispatchProtocolReader`, composed via `implements LabelDocumentReader, DispatchProtocolReader`.
- **O2 — FE transport:** extend the shared api-client with a `requestBlob` path (keeps auth-header + 401-refresh + timeout). Raw `fetch` in a hook is banned by `no-restricted-globals` in `features/`.
- **O3 — Allegro response framing:** pass the response `Content-Type` through unchanged; default to `application/pdf` ONLY when the header is entirely absent (never overwrite a real header). Adapter specs must exercise the uncertainty (pdf / non-pdf / JSON-error). Still flagged as the one residual external unknown — see §6.
- **Filename extension (review IMPORTANT):** the controller download filename's extension derives from `contentType` (`application/pdf→pdf`, `image/png→png`, `application/zpl`/`x-zpl→zpl`, else `bin`) — NOT a hardcoded `.pdf`. A `.pdf` file containing ZPL is worse than no download.
- **Error-body ordering (both HTTP clients):** check `response.ok` FIRST; on failure stay on the existing `.text()` → error-envelope path; read `.arrayBuffer()` ONLY on the success branch. Binary mode must never feed bytes to the error parser.
- **Auto-download trigger:** imperative, inside the `mutateAsync()` success block in `onSubmit` — guarded on `result.kind === 'dispatched' && result.shipment?.labelPdfRef`. NOT a `useEffect` watching query state (would re-fire on every panel refetch after the `onSuccess` invalidation).
- **`@Res()` contract:** service call first, `res.setHeader`/`res.send` last (so a thrown error still routes through Nest before any byte is written); annotate `@ApiProduces('application/pdf')` + `@ApiResponse({ status: 200 })` so Swagger doesn't advertise a JSON body.
- **Exception messages:** `LabelDocumentNotSupportedException` ("this shipping provider can't return labels") and `LabelNotAvailableException` ("generate the label first") carry distinct, operator-actionable messages — both map to 422.

## 1. Understand the task

**Goal.** Give operators a UI path to retrieve the shipping-label document for a shipment. PR #881 shipped the order-detail Shipment panel and `Shipment.labelPdfRef` is already persisted by the dispatch seam (#835/#843), but there is no endpoint or button to actually fetch the bytes.

> Note on the `labelPdfRef` field name: it is the existing persisted column (#835) and is out of scope to rename here. It's an opaque "a label exists" marker; the new capability is format-neutral regardless of the field's legacy name.

**Layers touched:** CORE (new sub-capability port), Integration (Allegro + InPost adapter impls + binary HTTP transport), Interface (new controller endpoint + binary response), Frontend (download hook + button + auto-download on first issuance).

**Non-goals (explicit, from the issue):**
- Bulk-label download (PDF stitching across N shipments).
- Carrier-specific re-print metadata (ShipX "first print" flag).
- Re-issuing a label without cancel+re-create (governed by the existing AC-7 flow).
- The dispatch protocol / handover manifest (#831 — separate future `DispatchProtocolReader`).

## 2. Research findings (corrections to the issue body)

1. **Allegro endpoint is NOT `GET /shipment-management/shipments/{id}/protocol`.** That path is the *protocol* (courier handover manifest) — #831 v2 scope — and the verb is wrong. The **label** download is **`POST /shipment-management/label`** with body `{ shipmentIds: string[], pageSize: 'A4' | 'A6' }`, returning the label bytes. Corroborated by developer.allegro.pl docs and the in-repo `allegro-shipment.mapper.ts` comment written during #833 (which says "a future label-download endpoint resolves it via `POST /shipment-management/label`" and anticipates capability name `LabelDocumentReader`).
   - `pageSize` is page **geometry**, NOT a format selector — the returned format (PDF vs ZPL/EPL) is governed by the seller's "Ship with Allegro" account setting. This is exactly why the design reads format from the response `Content-Type` rather than assuming it from the request.
   - Residual risk: exact response framing (raw bytes vs JSON wrapper) is best confirmed by a sandbox probe (§6). The adapter reads the response `Content-Type` and passes it through (default `application/pdf` only if absent), so a non-PDF format still flows correctly to the browser.
2. **InPost label:** `GET /v1/shipments/{id}/label?format=pdf` → PDF bytes (ShipX). The shipment must be `confirmed` first; pre-confirmation ShipX returns a retryable/202 — out of scope here (operator triggers download once the label exists, i.e. status ≥ `generated`).
3. **Both HTTP clients are JSON-only on the response side.** `AllegroHttpClient.executeRequest` always does `response.text()` → `JSON.parse`; `IInpostHttpClient.request<T>` parses JSON. A binary-**response** transport method must be added to each (Allegro already has `postBinary`/`postMultipart` for binary request *bodies* only — not the same thing).
4. **`labelPdfRef` is an opaque, provider-prefixed ref** (`allegro-delivery:label:{shipmentId}`, `shipx:label:{id}`). The adapter does NOT need to parse it — `fetchLabel` receives `providerShipmentId` directly from the controller (same shape as `cancelShipment`/`getTracking`). `labelPdfRef`'s presence is just the "a label exists" signal for the FE button.

## 3. Design

### 3.1 CORE — new sub-capability `LabelDocumentReader`

`libs/core/src/shipping/domain/ports/capabilities/label-document-reader.capability.ts`
```ts
export interface LabelDocumentReader {
  fetchLabel(input: { providerShipmentId: string }): Promise<LabelDocument>;
}
export function isLabelDocumentReader(
  adapter: ShippingProviderManagerPort,
): adapter is ShippingProviderManagerPort & LabelDocumentReader { ... }
```
- `LabelDocument { contentType: string; body: Uint8Array }` type lives in `domain/types/label-document.types.ts`. **Doc-comment `contentType` as the canonical, provider-reported format signal** — consumers (controller filename, FE) must read it, never assume PDF. Keeps the capability file interface+guard only (mirrors how `PickupPointFinder` keeps `FindPickupPointsQuery` in `pickup-point.types.ts`).
- `Uint8Array` not Node `Buffer` in the port — domain stays framework/runtime-neutral (Allegro client already speaks `Uint8Array`). Controller wraps to `Buffer` at the boundary.
- **Naming (O1 resolved):** capability names the verb, not the format — see §0. `fetchLabel` reads cleanly since the return type already says `LabelDocument`.
- Barrel: export type+guard from `libs/core/src/shipping/index.ts` (sub-capabilities block).

### 3.2 CORE — application service `ShipmentLabelService`

`application/services/shipment-label.service.ts` + `application/interfaces/shipment-label.service.interface.ts`, token `SHIPMENT_LABEL_SERVICE_TOKEN`.
```ts
interface IShipmentLabelService { fetchLabel(shipmentId: string): Promise<LabelDocument>; }
```
- Mirrors `ShipmentCancellationService` exactly: load shipment via `ShipmentRepositoryPort.findById` → 404 `ShipmentNotFoundException`; resolve adapter via `IIntegrationsService.getCapabilityAdapter<ShippingProviderManagerPort>(connectionId, 'ShippingProviderManager')`; narrow `isLabelDocumentReader` → else new `LabelDocumentNotSupportedException`; guard `providerShipmentId` present → else `LabelNotAvailableException` (no provider shipment ⇒ no label); call `adapter.fetchLabel({providerShipmentId})`; provider errors propagate as `ShippingProviderRejectionException` (→ 502).
- New domain exceptions: `LabelDocumentNotSupportedException`, `LabelNotAvailableException` (in `domain/exceptions/`, exported from barrel). **Distinct operator-actionable messages** (both → 422): not-supported = "this shipping provider can't return labels"; not-available = "no label has been generated for this shipment yet — generate the label first".
- Why a service (not controller-direct): apps/** is banned from `ShipmentRepositoryPort` (cross-context); the read+resolve+narrow belongs behind an `I*Service` seam, consistent with every other shipment command.

### 3.3 Integration — binary transport + adapter impls

**Allegro** — add to `IAllegroHttpClient` + `AllegroHttpClient`:
```ts
postExpectingBinary(path, body, options?): Promise<{ data: Uint8Array; contentType: string; status: number; headers }>
```
Refactor `executeRequest` to branch on an `expectBinary` flag. **Ordering is load-bearing:** check `response.ok` FIRST. On `!response.ok` keep the existing `await response.text()` → `handleError(status, body, …)` path verbatim (so `parseAllegroErrorBody` still gets the JSON error envelope + `userMessage`). ONLY on the success branch read `response.arrayBuffer()`, skip `JSON.parse`, and surface the lowercased `content-type`. Never feed bytes to the error parser.
`AllegroDeliveryShippingAdapter implements … LabelDocumentReader`:
```ts
fetchLabel({providerShipmentId}) =>
  postExpectingBinary('/shipment-management/label',
    { shipmentIds: [providerShipmentId], pageSize: 'A6' }) // A6 = thermal-label page geometry (NOT a format selector)
  // O3: pass the REAL content-type through; default to application/pdf only when
  // the header is entirely absent — never overwrite a present non-pdf header.
  → { contentType: res.contentType || 'application/pdf', body: res.data }
  (wrap failures via this.toRejected → ShippingProviderRejectionException)
```

**InPost** — add to `IInpostHttpClient`:
```ts
requestBinary(options): Promise<{ body: Uint8Array; contentType: string }>
```
Implement in `InpostHttpClient` reusing the retry loop. Same ordering rule: the existing `safeParseError`/`RetryableHttpError` path stays on the text branch for non-ok; read `arrayBuffer()` + content-type ONLY on `response.ok`. `InpostShippingAdapter implements … LabelDocumentReader`:
```ts
fetchLabel({providerShipmentId}) =>
  requestBinary({ method:'GET', path:`/v1/shipments/${providerShipmentId}/label`, query:{ format:'pdf' } })
```
Update `fake-inpost-shipping.adapter.ts` (testing barrel) to implement the new method (returns canned bytes).

### 3.4 Interface — `GET /shipments/:id/label`

In `ShipmentController`: inject `SHIPMENT_LABEL_SERVICE_TOKEN`. New endpoint streams bytes:
```ts
@Get(':id/label')
@ApiProduces('application/pdf')
@ApiResponse({ status: 200, description: 'Label document bytes' })
@ApiResponse({ status: 404, description: 'Shipment not found' })
@ApiResponse({ status: 422, description: 'Provider has no label / cannot return one' })
@ApiResponse({ status: 502, description: 'Shipping provider rejected the label fetch' })
async downloadLabel(@Param('id') id, @Res() res): Promise<void> {
  // Service call FIRST — a thrown error routes through Nest before any
  // byte/header is written; res.* only ever runs on the happy path.
  try {
    const { contentType, body } = await this.label.fetchLabel(id);
    const ext = extensionForContentType(contentType); // pdf | png | zpl | bin
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="ol-shipment-${id}.${ext}"`);
    res.send(Buffer.from(body));
  } catch (e) { throw this.toHttpException(e); }
}
```
- `extensionForContentType(ct: string): string` — tiny pure helper co-located with the controller, unit-tested (`application/pdf→pdf`, `image/png→png`, `application/zpl`|`application/x-zpl`→`zpl`, else `bin`). The download's only filename — it must not hardcode `.pdf` when the design allows non-PDF bytes through.
- Extend `toHttpException`: `LabelDocumentNotSupportedException` / `LabelNotAvailableException` → 422 (`UnprocessableEntityException`); 404 + 502 already covered.
- `@Res()` disables the global serializer for this handler — intended for a binary endpoint. `@ApiProduces('application/pdf')` keeps Swagger from advertising a JSON body. Document the `@Res()` choice inline.
- Route ordering: `:id/label` is a distinct sub-path, no conflict with the `active` literal guard.

### 3.5 Frontend

- **api-client `requestBlob` (O2 resolved):** add a `requestBlob(path): Promise<Blob>` path to `createApiClient` that reuses the existing `request` wrapper (auth-header injection + 401-refresh + timeout) but reads `response.blob()` on success instead of `readResponseBody`'s JSON/text branch. Raw `fetch` in a hook is banned by `no-restricted-globals` in `features/` and would skip the refresh-retry.
- `features/shipments/api/shipments.api.ts`: `downloadLabelBlob(id): Promise<Blob>` → `requestBlob('/shipments/{id}/label')`.
- `features/shipments/hooks/use-label-pdf-download.ts` — one-shot action (NOT a TanStack mutation). Calls `apiClient.shipments.downloadLabelBlob(id)`, then `URL.createObjectURL` → programmatic `<a download>` click → `URL.revokeObjectURL` (in a `finally`). Exposes `{ download(shipmentId), isDownloading, error }` via local `useState`. (Browser infers the saved filename from the `Content-Disposition` header the controller sets.)
- `ShipmentActionButtons`: add **Download label** button (placed AFTER the existing `shippingMethod === 'omp'` early-return, so projection-only rows never show it). Enabled when `status ∈ {generated, dispatched, in-transit, delivered}` AND `shipment.labelPdfRef !== null`. Disabled while downloading; surfaces error via the existing toast.
- `GenerateLabelForm` auto-download (imperative, not effect-based): inside `onSubmit`, capture `const result = await mutation.mutateAsync(input)` and, on the existing success block, trigger the download iff `result.kind === 'dispatched' && result.shipment?.labelPdfRef`, passing `result.shipment.id`. Do NOT watch `labelPdfRef` in a `useEffect` — `useGenerateLabelMutation.onSuccess` invalidates `shipmentsQueryKeys.all`, so an effect would re-fire on every refetch.
- Mobile/tablet parity: button inherits the existing `button--sm` action-row styling (no new layout). Tap-target ≥ 44 px on touch is already handled by the shared `.button--sm` touch rule.

## 4. Step-by-step (each step → files + acceptance)

| # | Step | Files | Acceptance |
|---|------|-------|-----------|
| 1 | `LabelDocument` type + `LabelDocumentReader` capability + guard | `domain/types/label-document.types.ts`, `domain/ports/capabilities/label-document-reader.capability.ts` (+ `__tests__`) | guard returns true only when `fetchLabel` present; barrel exports type+guard; `contentType` doc-commented as format source-of-truth |
| 2 | Domain exceptions | `domain/exceptions/label-document-not-supported.exception.ts`, `label-not-available.exception.ts` | exported from barrel; distinct operator-actionable messages |
| 3 | Service + interface + token | `application/services/shipment-label.service.ts` (+ `.spec.ts`), `application/interfaces/shipment-label.service.interface.ts`, `shipping.tokens.ts` | unit spec: 404 / not-supported / not-available / happy / provider-rejection paths |
| 4 | Wire service in `ShippingModule` | `shipping.module.ts` | provider bound to token, exported |
| 5 | Allegro binary transport + adapter impl | `allegro-http-client.interface.ts`, `allegro-http-client.ts`, `allegro-delivery-shipping.adapter.ts` (+ specs) | adapter spec asserts `POST /shipment-management/label` body shape; **ok-before-arrayBuffer ordering**; O3 cases: pdf passthrough / non-pdf content-type passthrough / JSON-error → `ShippingProviderRejectionException` |
| 6 | InPost binary transport + adapter impl + fake | `inpost-http-client.interface.ts`, `inpost-http-client.ts`, `inpost-shipping.adapter.ts`, `testing/fake-inpost-shipping.adapter.ts` (+ specs) | adapter spec asserts `GET /v1/shipments/{id}/label?format=pdf`; ok-before-arrayBuffer ordering; error stays on text path |
| 7 | Controller endpoint + `extensionForContentType` + exception mapping | `apps/api/src/shipping/http/shipment.controller.ts` (+ `.spec.ts`) | unit: content-type + disposition headers, extension-per-content-type, 404/422/502 mapping; `@ApiProduces` set |
| 8 | Controller int-spec against stubbed provider | `apps/api/test/integration/...shipment-label...int-spec.ts` | canned bytes round-trip end-to-end |
| 9 | FE api-client `requestBlob` + api method + hook | `app/api/api-client.ts`, `features/shipments/api/shipments.api.ts`, `features/shipments/hooks/use-label-pdf-download.ts`, barrel | `requestBlob` reuses auth/refresh wrapper; hook triggers `<a download>`; error surfaces; `revokeObjectURL` in `finally` |
| 10 | FE button + auto-download | `shipment-action-buttons.tsx` (+ test), `generate-label-form.tsx` (+ test) | button enablement matrix; **`omp` row shows NO Download button** (test asserts); imperative auto-download fires once per fresh ref, gated on `kind==='dispatched'` |

## 5. Validation

- **Architecture:** capability in CORE domain; adapters in integrations implement it; controller depends on `I*Service` seam not the repo. No CORE→integration leak. ✔
- **Naming:** `*.capability.ts`, `*.service.ts`+`.interface.ts`, `*.types.ts`, Symbol token `SHIPMENT_LABEL_SERVICE_TOKEN`. Capability names the verb (`LabelDocumentReader`), not the format. ✔
- **No migration** — no schema change (reads existing `labelPdfRef`/`providerShipmentId`). ✔
- **Security:** endpoint inherits class-level `@Roles('admin')` + JWT; no secrets in bytes; filename derived from internal id. ✔
- **Testing:** adapter unit specs (request shape), service unit spec (branch matrix), controller spec + one int-spec, FE component tests. ✔
- **Quality gate:** `pnpm lint && pnpm type-check && pnpm test`; `LabelDocumentReader` is a sub-capability discovered by duck-typing guard, NOT registered in adapter-manifest `supportedCapabilities`, so it does not ripple into the capability-routing int-specs — run the shipping int-specs (and the full integration suite before shipping per standing practice).

## 6. Residual risk (the one open external unknown)

**Allegro `POST /shipment-management/label` response framing (O3).** Create+poll for create/cancel is confirmed; the label endpoint's exact success-response framing is corroborated by docs + the in-repo #833 comment but not yet sandbox-verified. The two shapes that would change the adapter:
- **(a) raw bytes** (assumed) — design works as drafted.
- **(b) JSON wrapper** (e.g. `{ contents: "<base64>" }` or a resource href requiring a second GET) — would need a small adapter parse/second-fetch step.

**Mitigations already in the design:** content-type passthrough (never assume PDF), ok-before-arrayBuffer ordering (error envelopes still parse), and adapter specs that exercise pdf / non-pdf / JSON-error. If the sandbox probe reveals shape (b), the change is localized to `AllegroDeliveryShippingAdapter.fetchLabel` + its spec — no contract, controller, or FE change. **Not a blocker to start**: InPost (`GET …/label?format=pdf` → bytes) is unambiguous, the CORE/Interface/FE layers are provider-agnostic, and the Allegro adapter is the last/most-isolated step.

All open questions are resolved in §0; no decisions remain open for the user.
