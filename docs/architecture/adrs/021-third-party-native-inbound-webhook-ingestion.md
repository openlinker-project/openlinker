# ADR-021: Third-party-native inbound webhook ingestion via a per-provider decoder

- **Status**: Proposed
- **Date**: 2026-06-08
- **Authors**: @piotrswierzy

## Context

[ADR-015](./015-inbound-event-routing-capability-translated.md) made inbound webhook *routing* provider-agnostic (native event → `CanonicalInboundEvent` → capability-gated `InboundRoutingPolicy`). But the step *before* that — getting in the door — is still hard-coded to OpenLinker's own conventions in two ways:

1. **Signature scheme.** `WebhookAuthService` verifies OL's HMAC only: `HMAC-SHA256(secret, "{ts}.{rawBody}") → sha256=<hex>`, headers `X-OpenLinker-Timestamp/Signature`.
2. **Body envelope.** The controller validates `@Body() WebhookRequestDto` (required `eventId`, `eventType` `^[a-z]+\.[a-z_]+$`, `object.{type,externalId}`, `occurredAt`) — so the NestJS `ValidationPipe` rejects any non-OL body **before** the handler runs. The `eventId` it extracts is the Postgres dedup key, so it must be derived *before* publish.

This held because the controller's only client is **OL's own PrestaShop module** — first-party code emitting OL-enveloped, OL-signed events. **InPost (#768) is the first third-party-native inbound webhook:** it signs with `x-inpost-signature`/`x-inpost-timestamp` (base64 HMAC-SHA256) and posts its *own* body shape, satisfying neither axis. DPD (#965) and future carriers are next. The translator (ADR-015) runs too late and too narrow to help — it's a pure transform on the worker side, post-publish, with no access to the raw bytes or the per-connection secret.

## Decision

Introduce one combined **`InboundWebhookDecoderPort`** — a per-provider host-bag capability resolved by **`provider`** (the `/webhooks/:provider/:connectionId` path segment), mirroring the `WebhookEventTranslator` registry mechanics:

```
verify(input: { rawBody: Buffer; headers; secret: string }): { ok: boolean; timestampMs?: number }
extractEnvelope(rawBody: Buffer, headers): DecodeResult

type DecodeResult =
  | { action: 'route';  envelope: InboundWebhookEnvelope }   // → publish + 202
  | { action: 'ignore'; reason: string }                     // well-formed, not ours → 202, no publish
  | { action: 'reject'; reason: string }                     // malformed / untrusted shape → 400
```

`InboundWebhookEnvelope` = `Omit<InboundWebhookEvent, 'provider' | 'connectionId' | 'receivedAt'>` (the host completes those). OL's HMAC + `WebhookRequestDto` become the **registered default decoder** for providers with no explicit registration — not hard-coded.

**Key design points (from the design session, [DESIGN-021](../../plans/analysis/DESIGN-021-third-party-native-webhook-ingestion.md)):**

- **Keyed by `provider`, not `adapterKey`.** Signature + secret already resolve by `(provider, connectionId)`; `adapterKey` resolves only *downstream* in `WebhookToJobHandler`. Keying the decoder by `adapterKey` would drag connection-metadata resolution into the hot pre-dedup path for no benefit.
- **Pipeline order: `verify → replay → extractEnvelope → dedup → publish`.** A native provider's trusted timestamp comes *from* `verify` (InPost signs `{x-inpost-timestamp}.{body}`), so replay can't precede it — hence `verify` returns a normalized `timestampMs`, and the shared replay-window check runs on it. The OL default returns its header timestamp; replay logic stays provider-agnostic (and now runs on a signature-covered timestamp).
- **Three-state decode.** A third party emits a broader stream than OL's own module (unhandled topics, setup pings, future event types). `ignore` (→ 202, no bus entry) vs `reject` (→ 400) prevents retry-storms and log noise on benign unhandled events — a semantic the OL-enveloped path never needed.
- **Fail-closed.** No registered decoder → the strict OL-HMAC default; a provider cannot weaken verification by *not* registering. Only signature-verified payloads reach `extractEnvelope`.
- **`eventId` is a best-effort efficiency key, not a correctness primitive.** It seeds Postgres dedup, but routing terminates in an idempotent `getTracking` pull keyed by `(connectionId, externalId)` (ADR-015 invariant 6), so an imperfect `eventId` degrades to a redundant re-read, never wrong state. Decoders derive it from immutable event-identifying fields (provider event id if present, else a hash of parcel-id + the event's own timestamp).

## Alternatives considered

- **Two single-purpose registries** (signature-verifier + envelope-extractor). Rejected: both are keyed by the same `provider`, run at the same pipeline point, and are always co-registered (a provider needing custom verification needs custom decoding) — two lookups make a half-configured provider *representable* and grow the host bag by two handles for one concern.
- **Dual-route (A2)** — leave the existing `@Body() WebhookRequestDto` route untouched for OL-module providers; add a *second* raw-body route running the decoder pipeline for native providers. Pro: the OL path is literally unchanged (zero regression risk). Rejected as the primary: the URL space bifurcates (operators paste a different URL per provider type) and it bakes in a permanent "OL-legacy vs native" split — arbitrary, since OL's own module isn't conceptually privileged. **Retained as the de-risk fallback** if preserving the default path's status contract proves fragile in implementation.
- **Dedicated InPost webhook controller** in the InPost API surface. Rejected: reintroduces per-platform host ingress — the exact coupling ADR-015 / #900 removed — and still must expose a shared post-verify ingest entrypoint for dedup/replay/DLQ; the N-th carrier becomes the N-th controller.
- **Fold decode into the existing `WebhookEventTranslator`.** Rejected: the translator is a pure transform that runs post-publish on the worker side; signature verification needs the secret + raw bytes at the controller, and `eventId` is needed pre-dedup (before publish) — wrong layer and wrong time.
- **Per-provider body seam only, keep OL-HMAC hard-coded.** Rejected: InPost differs on *both* axes — half a seam leaves it 401-ing.

## Consequences

**Pros:**
- A new carrier's webhooks need no host PR — one decoder + one `register(host)` line; DPD #965 reuses it. Aligns with ADR-015, open-world capability (#576), and the plugin trust model ([ADR-003](./003-plugin-sdk-trust-model.md)).
- Single ingress = one security, dedup, and DLQ surface; atomic per-provider registration (no half-configured state).
- The ADR-015 invariants (trigger-not-truth, unified dedup, DLQ observability, signature-verified-before-translate) carry over unchanged — this ADR only changes *who authenticates and decodes the body*.

**Cons / trade-offs:**
- One more host-bag registry capability to maintain.
- The default decoder must reproduce the current `ValidationPipe` behaviour. The preserved contract is the **HTTP status** (202 valid / 401 bad-signature-or-replay / 400 malformed), **not** the exact error-JSON body — nothing is known to depend on the body shape (the PrestaShop module only needs non-2xx to retry). Reusing `class-validator` in the default decoder keeps messages equivalent. Still a security-sensitive shared path — pinned by an int-spec, not assumed.
- `verify(input: { secret })` fits InPost's **HMAC-shared-secret** option (OL-generated, handed to InPost — reuses `WebhookSecretProviderPort`). InPost also documents `SHA256withRSA` (its public cert, no shared secret); v1 uses HMAC, and the port deliberately doesn't over-fit — a future cert-based decoder resolves its own material from connection config rather than the `secret` param.

**Migration path:**
- OL-HMAC + `WebhookRequestDto` ship as the registered default decoder; PrestaShop/Allegro stay unchanged on the **status contract**, pinned by the existing webhook integration spec asserting 202/401/400 before and after the refactor.
- InPost registers its decoder for the `inpost` provider. No schema change — dedup reuses `webhook_deliveries`; the secret reuses `WebhookSecretProviderPort` (OL-generated, handed to InPost). **Open:** confirm InPost sandbox offers the HMAC option (OQ-B3-adjacent).

## References

- Related issues: #768, #727 (parent spec), #965 (DPD — next consumer)
- Related ADRs: [ADR-015](./015-inbound-event-routing-capability-translated.md) (downstream complement), [ADR-005](./005-postgres-authoritative-job-dedup.md) (dedup), [ADR-003](./003-plugin-sdk-trust-model.md), [ADR-013](./013-neutral-oauth-completion-port.md) (host-bag registry sibling)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Webhook Ingestion Flow
