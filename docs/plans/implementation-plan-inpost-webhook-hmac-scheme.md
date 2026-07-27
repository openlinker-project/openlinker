# Implementation Plan — InPost ShipX webhook HMAC signature scheme (#1556)

## 1. Understand the task

**Goal.** Confirm the InPost webhook HMAC signature scheme and align
`InpostInboundWebhookDecoderAdapter.verify()` so genuine deliveries authenticate.

**Layer.** Integration (`libs/integrations/inpost`) — plus a docs note. No CORE
port change, no ORM entity, no migration, no FE change.

**Why it matters.** `verify()` runs *before* `extractEnvelope()`, so a wrong
scheme rejects **100%** of real webhooks. The 30-minute reconciliation poll masks
it: status still converges, so the dead low-latency path is invisible in prod.

### What the research actually found (this inverts the issue's premise)

The issue hypothesised the scheme is **hex over the raw body**, citing the
openoms Go SDK, and proposed aligning `verify()` to that. That hypothesis is
**refuted** by InPost's authoritative documentation:

| Aspect | Issue's hypothesis | InPost official docs | OL today |
|---|---|---|---|
| Digest encoding | hex | **Base64** | Base64 ✅ |
| Algorithm | HMAC-SHA256 | HMAC-SHA256 | HMAC-SHA256 ✅ |
| Signature header | `x-inpost-signature` | `x-inpost-signature` | ✅ |
| Signed content | raw body only | **two variants, "configurable per client"** | only `{ts}.{body}` ❌ |

Verbatim, from [Webhook Signature Verification](https://developers.inpost-group.com/webhook-signature-verification):

> "The calculated signature will be transformed from byte[] to **Base64** and then placed in the `x-inpost-signature` header."

> "Payload to sign can be created in two ways **which also can be configurable per client**: concatenated request timestamp header (`x-inpost-timestamp`) and event payload ("." - dot sign will be a separator)."

> Example 1: "the raw content if only the body of the webhook message is signed" — `{"customerReference":...}`
> Example 2: "the raw content if the timestamp header is also included into the content" — `2025-01-08T14:03:55.387Z.{"customerReference":...}`

The Java sample confirms Base64: `return Base64.getEncoder().encodeToString((mac.doFinal(contentToSign)));`

**Conclusion:** the openoms Go SDK is a third-party OMS project, not an InPost
artifact — its hex read is not authoritative. **Switching to hex would have
broken a currently-correct half.** The encoding is right; the *defect* is that
OL hard-codes exactly one of two documented, per-client-configurable variants.

### The real defects

1. **Variant lock-in (root cause).** OL only accepts variant 2 (`{ts}.{body}`).
   If InPost's integration team configured the account for variant 1 (body-only)
   — a documented, equally-valid choice OL does not control — every delivery is
   rejected. This is precisely the silent-death mode the issue describes, just
   with a different root cause than hypothesised.
2. **Hard timestamp requirement.** `verify()` returns `ok:false` when
   `x-inpost-timestamp` is absent. Under variant-1 signing the header is not part
   of the signed content, so a delivery without it is still authentic — OL rejects
   it anyway. Second silent-death mode.
3. **Documented dedup id ignored.** InPost sends `x-inpost-event-id` ("Unique id
   of the event"). `deriveEventId` reads only *body* fields and otherwise hashes
   a synthetic id, so the Postgres dedup gate keys on a weaker basis than the
   provider's own event id.
4. **Non-ISO `occurredAt` (issue item 4, confirmed real).** ShipX documents
   `event_ts` as `"2020-03-20 15:08:42 +0100"` — not ISO-8601. The envelope
   contract and `webhook-event-publisher.service.ts` declare an ISO-8601 string;
   the plugin path has no validator to catch the divergence (the strict
   `@IsISO8601` on `WebhookRequestDto` gates only the *default* decoder).

### Non-goals

- **Switching to hex** — refuted above; would break verification.
- **A live sandbox capture** — externally blocked, see §5.
- **RSA digital-signature support** — the other per-client signing method. OL's
  runbook generates a shared secret (HMAC); adding asymmetric verification is a
  separate capability, not this fix.
- **Payload-shape changes** — `payload.shipment_id` extraction landed in #1544.

## 2. Research — established patterns reused

- `InboundWebhookDecoderPort` (`verify` / `extractEnvelope`), CORE-owned; the
  adapter is the only thing that changes. `WebhookVerifyResult.timestampMs` is
  already `| undefined`, and the host **already** skips the replay window when it
  is absent (`webhook.service.ts:95`) — no host change needed for defect 2.
- ADR-021 trigger semantics: the webhook is a low-latency nudge, never the source
  of truth; the routed refresh re-reads authoritative status.
- Durable dedup gate on `(provider, connectionId, eventId)` (#711).
- `timingSafeEqual` comparison already in place — preserved.

## 3. Design

`verify()` becomes **variant-tolerant over the two documented forms**, still
Base64/HMAC-SHA256, still timing-safe:

```
timestamp present → candidates = [ `{ts}.{body}`, `{body}` ]   ; return timestampMs (replay window enforced)
timestamp absent  → candidates = [ `{body}` ]                  ; return ok without timestampMs (dedup gate is the backstop)
accept iff ANY candidate's Base64 HMAC timing-safe-equals the header
```

**Why trying both is not a downgrade.** An attacker cannot forge a body-only
signature without the secret, so the fallback only succeeds when InPost genuinely
signed body-only. Replaying a captured variant-2 delivery under a *different*
timestamp fails both candidates. The one real consequence is inherent to variant 1
itself, not introduced here: when InPost signs body-only the timestamp is
unauthenticated, so a replay could slip the window — the durable `eventId` dedup
gate collapses it, and under ADR-021 the worst case is a redundant idempotent
re-read, never wrong state.

Both comparisons run unconditionally (no early exit between candidates) to keep
the check constant-work with respect to which variant matched.

**Dedup id.** Prefer the documented `x-inpost-event-id` header, then existing
body fields, then the current deterministic hash. Strictly additive.

**`occurredAt` normalisation.** Normalise the documented ShipX `event_ts` form
(`"2020-03-20 15:08:42 +0100"`) to ISO-8601 via a parse-and-reformat that emits
the original instant; pass through anything already ISO; reject (as today) when
absent. The header value stays preferred and is already ISO.

## 4. Steps

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `.../inpost-inbound-webhook-decoder.adapter.ts` | `verify()` accepts both documented signed-content variants; timestamp header optional (body-only path) | Variant-1 and variant-2 deliveries both verify; tampered signature still rejected |
| 2 | same | `deriveEventId` prefers `x-inpost-event-id` header | Header id wins over body id and over the hash |
| 3 | same | Normalise non-ISO `event_ts` → ISO-8601 | `"2020-03-20 15:08:42 +0100"` → valid ISO of the same instant |
| 4 | same | Rewrite the file header to state the *verified* scheme + doc citations | No stale "base64 over `{ts}.{body}`" claim |
| 5 | `.../__tests__/inpost-inbound-webhook-decoder.adapter.spec.ts` | `sign()` helper per variant; tests for both variants, missing-timestamp accept, tampered reject, wrong-secret reject, header event-id precedence, `event_ts` normalisation | All green; existing 17 still pass |
| 6 | `libs/integrations/inpost/docs/setup-guide.md` | Document the scheme, both variants, and what to request from InPost's integration team | Operator can state the requirement when registering |

## 5. Validation

- **Architecture**: adapter-local; no CORE/port/DTO/ORM change; no `platformType`
  leakage; no new dependency. Domain purity untouched.
- **Standards**: no `any`, no `console.log`, explicit return types, file header
  updated, types stay in the existing `*.types.ts`.
- **Security**: timing-safe comparison retained on every candidate; secret never
  logged; no weakening (see §3 rationale).
- **Testing**: unit-only — pure function of `(rawBody, headers, secret)`; no
  Testcontainers needed.
- **Migration**: none (no ORM entity in scope).

### Open risk — the live capture the issue asks for is externally blocked

InPost does **not** offer self-service webhook registration:

> "Please contact InPost Account Manager and/or Integration Team. Self-service portal is under development." — [InPost Webhooks](https://developers.inpost-group.com/webhooks)

OL's own runbook already encodes this (email `integration@inpost.pl`). So a live
sandbox capture cannot be produced unilaterally in this session — it needs InPost
to configure a webhook against our endpoint and tell us (or pick) the variant.

This plan's response is to **remove the capture from the critical path**: by
accepting both documented variants, OL is correct under either configuration, so
the empirical question stops being load-bearing. The capture is therefore not
tracked as a follow-up — it would only re-confirm a payload shape #1544 already
aligned and a scheme this change makes configuration-independent. If a real
delivery ever does fail to verify, the decoder's own rejection log is the signal
to revisit, and §3's rationale is the map.
