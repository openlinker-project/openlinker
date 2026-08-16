# Implementation Plan - eparagony.pl fiscalization adapter (#1908, adapter half)

## 1. Goal

Ship `@openlinker/integrations-eparagony` - the first `FiscalizationPort` adapter (ADR-042),
fronting eparagony.pl's Documents REST API v3. The neutral capability (`libs/core/src/fiscalization/`)
already exists on the epic branch and is **not** modified by this change.

**Layer**: Integration (plugin package) + host enablement.

**Non-goals**

- No change to `libs/core/src/fiscalization/**` (ADR-042 decision 4 litmus: zero
  `paragon`/`kasa`/`printer`/`eparagony` strings in core).
- No `FiscalDeviceOperator` sub-capability (#1910 is closed `not_planned`; the printer sits below the
  vendor's own middleware boundary).
- No JWS document retrieval (`GET /documents/{t}/jws`) and no daily fiscal report
  (`GET|POST /printers/{n}/reports/daily`) - the `document_get_jws` and `report_fiscal_get` scopes are
  **refused at token issuance** for OL, so both would 400 before the endpoint is reached.
- No document-actions read (`GET /documents/{t}/actions/status`) - the `document_action_get` scope is
  not granted and the neutral contract has no counterpart.
- No invoice/KSeF path through this vendor - that regime is `InvoicingPort`'s (ADR-042 decision 1).
- No webhook ingress (see §6).

## 2. Endpoint -> method mapping

| Neutral surface | Vendor endpoint |
|---|---|
| `FiscalizationPort.registerTransaction` | `POST /documents` (`eReceipt`, `Idempotency-Key` header) then a bounded poll of `GET /documents/{documentToken}/status` until a terminal status |
| `FiscalRegistrationLocator.locateByQuery` | `GET /documents/{documentToken}/status`, keyed on a `documentToken` **re-derived deterministically** from `criteria.idempotencyKey` |
| `ConnectionTesterPort.test` | `POST /auth/token` (+ an optional, non-failing `GET /printers/{nr}/status` diagnostic) |
| internal - bearer acquisition | `POST /auth/token` on `login[.sandbox].eparagony.pl`, cached for `expires_in` minus a refresh margin |

## 3. Package layout

```
libs/integrations/eparagony/src/
  eparagony-plugin.ts                     descriptor + static manifest (#575)
  eparagony-integration.module.ts         createNestAdapterModule bridge
  eparagony.constants.ts                  hosts, scopes, provider type, api version, user agent
  index.ts                                barrel
  application/
    eparagony-adapter.factory.ts          per-connection construction
    interfaces/eparagony-adapter.factory.interface.ts
  domain/
    exceptions/  eparagony-api.error.ts | eparagony-config.exception.ts | eparagony-network.error.ts
    policies/    eparagony-hosts.policy.ts | document-token.policy.ts | money.policy.ts | tax-rate.policy.ts
    types/       eparagony-config.types.ts | eparagony-credentials.types.ts | eparagony-api.types.ts
  infrastructure/
    http/        eparagony-http-client.{interface,types}.ts | eparagony-http-client.ts
    adapters/    eparagony-fiscalization.adapter.ts | eparagony-document.mapper.ts
                 eparagony-connection-tester.adapter.ts
                 eparagony-connection-config-shape-validator.adapter.ts
                 eparagony-connection-credentials-shape-validator.adapter.ts
                 eparagony-retry-classifier.adapter.ts
                 eparagony-auth-failure-classifier.adapter.ts
```

## 4. Key design decisions

1. **Deterministic `documentToken`.** The vendor's status read is keyed on a path `documentToken` and
   offers no search-by-order/by-key surface. `CreateDocumentPayload.documentToken` is an optional
   caller-supplied UUIDv4, so the adapter derives both `documentToken` and `transactionToken` from
   `(connectionId, idempotencyKey)` with a namespaced SHA-256 -> UUID-shaped digest. That single choice
   is what makes `FiscalRegistrationLocator` implementable at all.
2. **`registerTransaction` blocks on a bounded status poll**, exactly like `InfaktInvoicingAdapter`'s
   async-task poll (#1763). A `202` alone does not mean the sale was registered - the printer may still
   `ERROR`. The whole call is budgeted under core's documented 120 s provider ceiling.
3. **`CONFIRMED` gates the link.** `documentUrl` becomes a `link` artefact only at `status: CONFIRMED`
   (the vendor states this explicitly). A `CONFIRMED` response that carried no `documentUrl` still
   registers successfully with an empty artefact list - empty is a success (ADR-042 decision 2).
4. **Failure classification is asymmetric towards `in-doubt`.** See §5.
5. **Tolerant parsing.** Every wire shape is read field-by-field through narrowing helpers; unknown
   fields are ignored, an undocumented `errorCode` never throws a parse error, and a missing optional
   never fails the mapping.
6. **Regime-specific values go to `regimeExtras`** - `fiscalDocumentId`, `fiscalDocumentNumber`,
   `transactionToken`, `posId`, `printed`, `processingMode`, `merchantDocumentId`. Nothing Polish
   reaches a neutral field except through `documentReference` / `signingIdentity`.

## 5. Failure classification

| Outcome | Mode | Why |
|---|---|---|
| `POST /documents` -> 400 / 401 / 403 / 404 | `rejected` | Refused at the API boundary; no document, no fiscal registration. Safe to re-attempt under the same key. |
| `POST /documents` -> 400 with `errorCode: 118` (DOCUMENT_ALREADY_EXISTS) | *neither* - resolved | The document **does** exist under our deterministic token. The adapter falls through to the status read instead of reporting a failure. |
| `POST /documents` -> 422 (idempotency-key reuse with different data) | `in-doubt` | A document was created earlier under this key. It may be registered. |
| `POST /documents` -> 429 | `in-doubt` | Gateway-level refusal with no documented create semantics (mirrors `InfaktApiError`). |
| `POST /documents` -> 5xx | `in-doubt` | The vendor documents 502/503/504 as retry-worthy; the document may exist. |
| network failure / timeout on the create | `in-doubt` | Classic indeterminate. |
| poll deadline exhausted at `PENDING` / `READY` | `in-doubt` | Fiscalization may still complete on the device. |
| any failure of the status read after a successful create | `in-doubt` | We hold a token but no confirmation. |
| terminal status `ERROR` | `rejected` | The provider explicitly reports the fiscalization failed. Re-crossing the boundary under the same `Idempotency-Key` cannot mint a second registration - the vendor's own header guarantees it. |

Everything not enumerated defaults to `in-doubt` (core also defaults that way structurally).

## 6. Webhook - deliberately not wired

The vendor pushes fiscalization status to a `statusUrl` with an `X-Signature`
`hash_hmac('sha256', rawBody, webhookSecret)` header. It does **not** fit the repo's ingress seams
today: `CanonicalInboundEvent.domain` is a **closed** core union with no `fiscalization` member, there is
no `fiscalization.*` `JobType`, no worker handler, and no core reconcile job to nudge. Registering a
decoder without a translator makes every delivery dead-letter, which is worse than not registering one.
Reported as a named gap; the status-read path covers the same ground synchronously.

## 7. Tests (unit, mocked transport - never the live sandbox)

- happy path: create `202` -> poll `PENDING` -> `CONFIRMED`, full neutral result mapping
- link gating: `CONFIRMED` yields the `link` artefact; `READY` never does; a `CONFIRMED` without
  `documentUrl` still succeeds with `artefacts: []`
- classification: 400 -> `rejected`; 5xx / 429 / network / poll-timeout -> `in-doubt`; `ERROR` -> `rejected`
- `errorCode: 118` falls through to the status read
- tolerant parsing: unknown top-level fields ignored; undocumented `errorCode: 92` handled
- token cache: one `/auth/token` for two calls; refresh after expiry; 401 invalidates and retries once
- locator: derived token; `CONFIRMED` -> identity set; unknown token (`92`) -> `null`; `PENDING` -> `null`
- deterministic token derivation is stable and UUID-shaped
- tax-rate and money policies, including the block on an unresolvable rate
- shape validators, retry classifier, auth-failure classifier, manifest/plugin wiring

## 8. Host enablement

`apps/api/src/plugins.ts` + `apps/worker/src/plugins.ts` (registration may be driven from either
process), `tsconfig.base.json` path aliases, and the `@openlinker/integrations-eparagony` workspace
dependency in both host manifests (`check-workspace-dep-declarations.mjs` enforces both directions).
