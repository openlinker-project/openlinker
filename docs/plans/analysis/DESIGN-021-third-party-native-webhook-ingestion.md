# Design session — ADR-021 third-party-native inbound webhook ingestion

Pressure-test of the ADR-021 decision against the *actual* ingress pipeline (`apps/api/src/webhooks/application/services/webhook.service.ts:47-209`, `webhook.controller.ts:56-97`, `webhook-auth.service.ts`). Eleven findings; several amend the ADR as first drafted.

## Grounding facts (current pipeline)

`processWebhook(provider, connectionId, request: WebhookRequestDto, rawBody, headers)`:
1. reads OL headers `x-openlinker-timestamp/signature` (hard-coded names);
2. **`validateTimestamp` (replay) runs BEFORE signature**, on the *untrusted* header timestamp;
3. `verifySignature(provider, connectionId, timestamp, rawBody, signature)` — keyed by **`(provider, connectionId)`**, resolves secret via `getSecret(provider, connectionId)`. **`adapterKey` is never used here** — it resolves downstream in `WebhookToJobHandler`;
4. dedup `insertIfNew` on `(provider, connectionId, eventId)`, `eventId` from the DTO;
5. builds `InboundWebhookEvent` from DTO fields + publishes.
The controller binds `@Body() WebhookRequestDto`, so the `ValidationPipe` rejects a non-OL body with **400 before the handler runs**.

## Findings & decisions

### F1 — Registry key: `provider`, not `adapterKey` (amends ADR)
The ADR said "keyed by `adapterKey`, mirroring the translator registry." But the decoder runs at the controller/service layer where **only `provider` + `connectionId` are known** — `adapterKey` requires connection-metadata resolution that today happens *downstream*. Signature + secret already key by `(provider, connectionId)`. **Decision: key the decoder registry by `provider`** (the URL path segment). Keying by `adapterKey` would drag connection-metadata resolution into the hot pre-dedup path for no benefit. (Caveat: if one provider ever ships two incompatible webhook formats across adapter versions, revisit — not a v1 concern.)

### F2 — Pipeline ordering: verify → replay → extract → dedup (amends ordering)
For a native provider the trusted timestamp comes *from* signature verification (InPost signs `{x-inpost-timestamp}.{body}`), so replay can't run first. Unify on: **`decoder.verify()` → replay-check(decoder-returned timestamp) → `decoder.extractEnvelope()` → dedup → publish.** `verify` returns a **normalized** timestamp: `{ ok: boolean; timestampMs?: number }`. The OL default decoder returns its header timestamp; replay logic stays shared and provider-agnostic. Bonus: replay now runs on a signature-covered timestamp (slightly stronger than today's replay-on-untrusted-header).

### F3 — The real refactor + risk is removing `@Body() WebhookRequestDto`
The service is built around the pre-validated DTO. Supporting native providers means the controller stops binding/validating it; the **default decoder reproduces** the validation. This is the single security-sensitive change. **Right-size the earlier "byte-for-byte" claim:** preserve the **400/401/202 status contract** (not necessarily the exact error-JSON body — nothing is known to depend on the body shape; PrestaShop's module only needs non-2xx to retry). Reuse `class-validator` in the default decoder so messages stay equivalent. **Guard: the existing PrestaShop webhook int-spec must assert 202-on-valid / 401-on-bad-sig / 400-on-malformed before and after the refactor.**

### F4 — Decode must be three-state: route / ignore / reject (new — important)
OL's own module only emits events OL handles, so today "unparseable" → 400 is fine. A third party emits a **broader stream**: unhandled topics (`x-inpost-topic !== 'Shipment.Tracking'`), setup test-pings, future event types. Returning 400 on those makes InPost **retry-storm** and pollutes logs. **Decision:** `extractEnvelope` returns a discriminated result —
```
{ action: 'route'; envelope: InboundWebhookEnvelope }
| { action: 'ignore'; reason: string }   // well-formed, not for us → 202, no publish, debug log
| { action: 'reject'; reason: string }    // malformed/unauthenticated-shape → 400
```
Controller maps route→publish+202, ignore→202 (no bus entry), reject→400. This is a genuine semantic the OL-enveloped path never needed.

### F5 — eventId determinism is de-risked by the idempotent pull (lowers stakes)
Dedup keys on `eventId` derived from the body. **But** routing terminates in an authoritative `getTracking` pull keyed by `(connectionId, externalId)` that is idempotent and tolerates duplicate/out-of-order delivery (ADR-015 invariant 6). So an imperfect `eventId` degrades to a **redundant re-read**, never incorrect state. **Decision:** derive `eventId` from immutable event-identifying fields (InPost event id if present; else `hash(parcelId + event-timestamp[+status])` using the event's *own* timestamp so retries collide and distinct events don't). Treat it as a best-effort efficiency key, not a correctness primitive.

### F6 — Secret injection assumes HMAC-shared-secret; RSA is a future divergence
`verify(input:{secret})` fits InPost's HMAC-shared-secret option (OL generates, hands to InPost — reuses `WebhookSecretProviderPort`). InPost *also* documents `SHA256withRSA` (its cert), which has **no shared secret**. **Decision (v1):** use HMAC-shared-secret; keep `secret` in the contract but document that a cert-based decoder would resolve its own material from connection config rather than the `secret` param (don't over-fit the port). **Open question:** confirm InPost sandbox offers the HMAC option (OQ-B3-adjacent).

### F7 — Fail-closed default (confirmed safe)
No registered decoder → the OL-HMAC default (strict). A provider cannot weaken verification by *not* registering — it falls to OL-HMAC and 401s (it didn't sign OL-style). The default is always present. No "unverified" path exists.

### F8 — Layering (confirmed)
Port + registry + `InboundWebhookEnvelope` type live in `libs/core/src/integrations` (plugins implement without an `apps/api` dependency; `InboundWebhookEvent` is already core). The **default decoder** uses `WebhookRequestDto` + OL-HMAC (both `apps/api`), so it lives in `apps/api/src/webhooks` and self-registers as the fallback. `InboundWebhookEnvelope = Omit<InboundWebhookEvent,'provider'|'connectionId'|'receivedAt'>`.

### F9 — Alternative weighed: dual-route vs unified default decoder
**Option A2 (dual-route):** keep `@Body() WebhookRequestDto` on the existing route untouched (zero PS risk); add a *second* raw-body route for native providers that runs the decoder pipeline. Pro: OL path literally unchanged. Con: URL space bifurcates (operators paste a different URL per provider type) and a permanent "OL-legacy vs native" split — arbitrary, since OL's module isn't conceptually special. **Recommendation: keep the unified default-decoder (ADR as written)** — it's the principled end state ("OL's module is just a provider whose decoder is the built-in default") and F3 right-sizes its only real risk. A2 stays the documented **fallback** if 400-preservation proves fragile in implementation.

### F10 — HostServices growth
One new registry handle (the combined port keeps it to one, vs two — the reason the ADR chose combined). Ninth well-known registry; additive, documented in the host bag.

### F11 — Observability (extends ADR-015 invariant 4)
New signals: `ignore`-count by reason (unhandled topic / ping) — expected noise, must be distinguishable from `reject`/401 (misconfiguration / attack). Surface a counter; don't let benign ignores look like failures.

## Net amendments to ADR-021
1. Decoder keyed by **`provider`**, not `adapterKey` (F1).
2. `verify` returns **`{ ok; timestampMs? }`**; pipeline order **verify → replay → extract → dedup** (F2).
3. `extractEnvelope` returns a **three-state result** (route/ignore/reject), not `Envelope | null` (F4).
4. Preserve the **status contract** (not byte-for-byte body); pin via the PS int-spec (F3).
5. eventId framed as a **best-effort efficiency key** given the idempotent pull (F5).
6. Note HMAC-shared-secret for v1; **RSA/cert is a future divergence** the port shouldn't over-fit (F6).
7. Record **dual-route (A2)** as the considered alternative + de-risk fallback (F9).
