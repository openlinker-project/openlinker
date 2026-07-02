# Implementation Plan — Infakt plugin registration + webhook routing (#1281)

## 1. Goal / non-goals

Wire the already-hardened Infakt plugin (#1280, PR #1292, not yet merged — this
branch is stacked on `1280-infakt-plugin-hardening-tests`) into the running API,
and connect Infakt's inbound webhooks (KSeF clearance notifications relayed by
Infakt) to OL's webhook ingestion pipeline.

Non-goals: `WebhookProvisioningPort` (Infakt webhook setup is UI-only, per
issue scope), FE plugin (#1282), docs/ADR (#1283).

## 2. Layer classification

Integration (`libs/integrations/infakt`) + thin core extension
(`libs/core/src/integrations`, `libs/core/src/sync` — additive domain value +
routing case) + host wiring (`apps/api`).

## 3. Key finding from research

- `libs/integrations/infakt` only exists on `1280-infakt-plugin-hardening-tests`
  (unmerged). This branch is based on it per user instruction; PR opens
  against `main` as **draft** and will show #1280's diff until #1292 merges.
- Registering a `WebhookEventTranslatorPort` alone is not enough: Infakt's
  webhook is **not** OL-enveloped and uses its own HMAC scheme + a
  verification handshake (`{"verification_code":...}` echo) — this is exactly
  the third-party-native case ADR-021's `InboundWebhookDecoderPort` exists for
  (see InPost as the precedent).
- The existing `InboundEventDomainValues` closed union
  (`order | inventory | product | shipment`) has no `invoicing` value, and
  `InboundRoutingPolicyService` has no case for it. Reconciling clearance
  status already has a job: `invoicing.regulatoryStatus.reconcile`
  (page-scan over non-terminal invoices, no target-id payload) — a webhook
  is a **trigger, not the source of truth** (matches the InPost/webhook
  philosophy already documented in `architecture-overview.md`), so routing
  the Infakt event to this existing reconcile job (rather than inventing a
  by-id job) is the smallest correct change.
- No existing mechanism lets a decoder produce a custom response body
  (needed for the verification-code echo). Adding one optional method to
  `InboundWebhookDecoderPort` is the minimal extension; it's additive so
  `DefaultWebhookDecoder` / InPost's decoder need no change (default to
  no-op via `?.()`).

## 4. Steps

1. **Dependency wiring**
   - `apps/api/package.json`, `apps/worker/package.json`: add
     `"@openlinker/integrations-infakt": "workspace:*"`.
   - `apps/api/src/plugins.ts`: import + append `InfaktIntegrationModule`.
   - `apps/api/test/jest-integration.cjs`: add the two moduleNameMapper
     entries (mirrors the ksef block).

2. **Handshake extension (core, additive)**
   - `libs/core/src/integrations/domain/ports/inbound-webhook-decoder.port.ts`:
     add optional `detectHandshake?(rawBody: Buffer, headers: Record<string,
     string>): Record<string, unknown> | null` — runs before signature
     verification (a subscription-verification ping predates any real
     traffic and isn't itself required to be signed by Infakt's documented
     flow).
   - `apps/api/src/webhooks/application/services/webhook.service.ts`: after
     the connection gate, call `decoder.detectHandshake?.(rawBody, headers)`;
     if it returns non-null, return it immediately (no verify/dedup/publish).
   - `IWebhookService.processWebhook` return type: `Promise<Record<string,
     unknown> | void>`.
   - `WebhookController.receiveWebhook`: return type updated to match;
     NestJS serializes the returned object as the JSON body under the
     existing `@HttpCode(ACCEPTED)`.

3. **`invoicing` inbound domain (core, additive)**
   - `libs/core/src/integrations/domain/types/canonical-inbound-event.types.ts`:
     add `'invoicing'` to `InboundEventDomainValues`.
   - `libs/core/src/sync/application/services/inbound-routing-policy.service.ts`:
     add a `case 'invoicing':` → `{ jobType: 'invoicing.regulatoryStatus.reconcile',
     requiredCapability: 'Invoicing', payload: { schemaVersion: 1, limit: 50 }
     satisfies RegulatoryStatusReconcilePayloadV1 }`.

4. **Infakt decoder + translator** (`libs/integrations/infakt/src/infrastructure/adapters/`)
   - `infakt-inbound-webhook-decoder.adapter.ts` —
     `InfaktInboundWebhookDecoderAdapter implements InboundWebhookDecoderPort`:
     wraps the existing `InfaktWebhookTranslator` (verify via HMAC-SHA256 hex
     over raw body per its `verifySignature`; `detectHandshake` via its
     `getVerificationEcho`; `extractEnvelope` via its `parse`, mapping to
     `{eventId: event.uuid, eventType: event.name, occurredAt:
     event.created_at, objectType: 'invoice', externalId:
     resource.invoice_uuid ?? event.uuid, payload: resource}`).
   - `infakt-webhook-event-translator.adapter.ts` —
     `InfaktWebhookEventTranslatorAdapter implements WebhookEventTranslatorPort`:
     `translate` returns `{domain: 'invoicing', externalId, eventType,
     occurredAt, payload}` for `objectType === 'invoice'`, else `null`.
   - Register both in `infakt-plugin.ts`'s `register(host)`:
     `host.inboundWebhookDecoderRegistry.register(platformType, decoder)`,
     `host.webhookEventTranslatorRegistry.register(adapterKey, translator)`.

5. **Tests**
   - Unit specs for the two new adapters (happy path + malformed/unsigned
     rejection + handshake echo).
   - Extend `inbound-routing-policy.service.spec.ts` with the new
     `'invoicing'` case.
   - Extend `webhook.service.spec.ts` with a handshake-short-circuit case.

6. **Quality gate**: `pnpm lint && pnpm type-check && pnpm test`
   (scoped to affected packages given resource constraints; full run before
   PR).

## 5. Risks / open questions

- Exact HTTP status Infakt expects for the verification echo is unconfirmed
  (POC never shipped a controller for it) — using the existing `202` path.
  Flagged in the PR description as a manual-verification item, consistent
  with #1292's own test-plan checkboxes.
- `invoicing.regulatoryStatus.reconcile`'s `limit: 50` on webhook-triggered
  runs is a nudge, not a guarantee the specific invoice is within that page —
  acceptable because the scheduled reconcile already drains the full
  frontier; the webhook only shortens latency.
