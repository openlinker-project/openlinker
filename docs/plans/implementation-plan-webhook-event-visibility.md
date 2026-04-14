# Implementation Plan — Webhook & Event Delivery Visibility (#78 + #76)

## Goal

Give operators visibility into inbound webhook processing: what arrived, whether signature/dedup passed, whether it was published, and which sync job (if any) resulted. Exposed via a REST API (#78) and an admin FE page (#76).

## Non-goals

- Replay/retry controls
- Outbound webhook tracking
- Retention/purging policy (MVP: keep indefinitely; follow-up issue if needed)
- Alerting/metrics

## Classification

- **#78 BE** — Infrastructure (persistence) + Interface (HTTP). No `libs/core` changes.
- **#76 FE** — Interface layer in `apps/web`.

### Module placement note

Webhooks already live as an API-app-local bounded context under `apps/api/src/webhooks/` with no `libs/core` counterpart. We follow that existing layout rather than introducing a parallel `libs/core/src/webhooks`. This is a deliberate deviation from the standard "persistence in core" pattern; rationale: the webhooks module is a thin HTTP-ingress adapter, not a domain. If a core webhooks domain is introduced later, this persistence will migrate with it.

The webhooks module has no `domain/` layer today. We add a minimal domain entity + repository port so the port–adapter boundary is respected. Repository port lives in `application/interfaces/` (matches existing `webhook.service.interface.ts` convention inside this module).

---

## Design

### Persistence

New ORM entity `webhook_deliveries` under `apps/api/src/webhooks/infrastructure/persistence/`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `eventId` | text | Provider's event id |
| `provider` | text | e.g. `prestashop` |
| `connectionId` | uuid NOT NULL | Always known from URL path |
| `eventType` | text | nullable (pre-parse rejections) |
| `objectType` | text | nullable |
| `externalId` | text | nullable |
| `receivedAt` | timestamptz | |
| `signatureValid` | boolean | null if not checked |
| `dedupResult` | text | `new` \| `duplicate` \| null |
| `status` | text | `rejected` \| `published` \| `failed` \| `deadlettered` \| `job_enqueued` |
| `rejectionReason` | text | e.g. `invalid_signature`, `stale_timestamp`, `missing_header` |
| `publishedMessageId` | text | Redis stream id |
| `downstreamJobId` | text | Soft link to `sync_jobs.id` (idempotency-key based) |
| `downstreamJobType` | text | |
| `dlqReason` | text | |
| `payload` | jsonb | |
| `createdAt`, `updatedAt` | timestamptz | |

Indexes:
- `(receivedAt DESC)`
- `(connectionId, receivedAt DESC)`
- `(provider, receivedAt DESC)`
- `(status, receivedAt DESC)`
- **Unique `(provider, connectionId, eventId)`** (plain, no partial) — enables upsert semantics

### Lifecycle & race handling

1. **`WebhookService`** performs a single `INSERT ... ON CONFLICT (provider, connectionId, eventId) DO UPDATE` at entry with known fields, then issues further `UPDATE` calls as it progresses through signature check → dedup → publish. On terminal outcome (rejected / published / failed) the row is in final state.
2. **`WebhookToJobHandler`** performs `INSERT ... ON CONFLICT DO UPDATE` keyed on the same tuple when it updates `downstreamJobId` / `dlqReason`. This closes the race where the handler might fire before the initial publisher write commits (the handler would otherwise update 0 rows).
3. All persistence is wrapped in try/catch and logged; failures must not break webhook processing.

### Domain layer

- `apps/api/src/webhooks/domain/entities/webhook-delivery.entity.ts` — plain TS class, no framework deps
- `apps/api/src/webhooks/application/interfaces/webhook-delivery-repository.port.ts` — methods: `upsert(record)`, `findMany(filters, pagination)`, `findById(id)`
- `apps/api/src/webhooks/infrastructure/persistence/repositories/webhook-delivery.repository.ts` implements the port with private `toDomain` / `toOrm` mappers

Application service and controller work with the domain entity; only DTOs cross the HTTP boundary.

### Query API

`GET /webhook-deliveries` — filters: `provider`, `connectionId`, `status`, `since`, `until`, `limit` (default 20, max 100), `offset`. Default sort: `receivedAt DESC`.

**List response excludes `payload`** (may contain PII). Includes all other columns.

`GET /webhook-deliveries/:id` — full record including `payload`.

Both guarded by `JwtAuthGuard`.

### Frontend

New route `/webhook-deliveries` mirroring sync-jobs. List page with filters + DataTable; detail drawer with JSON payload viewer and a link to the linked sync job detail page.

---

## Step-by-step

### Backend

1. **Domain entity** `apps/api/src/webhooks/domain/entities/webhook-delivery.entity.ts`
2. **Types** `apps/api/src/webhooks/domain/types/webhook-delivery.types.ts` (`WebhookDeliveryStatus` + values, `DedupResult`)
3. **Repository port** `apps/api/src/webhooks/application/interfaces/webhook-delivery-repository.port.ts`
4. **ORM entity** `apps/api/src/webhooks/infrastructure/persistence/entities/webhook-delivery.orm-entity.ts`
5. **Repository implementation** `apps/api/src/webhooks/infrastructure/persistence/repositories/webhook-delivery.repository.ts` — uses `upsert` / `save` with conflict target; private mappers; converts TypeORM errors to domain errors where relevant
6. **Wire module**: add TypeormModule.forFeature, Symbol token `WEBHOOK_DELIVERY_REPOSITORY_TOKEN`, `{ provide: TOKEN, useExisting: WebhookDeliveryRepository }`
7. **Generate migration** `pnpm --filter @openlinker/api migration:generate -- src/migrations/AddWebhookDeliveries` (runs after module wiring)
8. **Hook into WebhookService**: upsert at entry; update on signature validate / dedup / publish / fail; all writes best-effort
9. **Hook into WebhookToJobHandler**: upsert with `downstreamJobId` + `status=job_enqueued`, or `dlqReason` + `status=deadlettered`
10. **Query service** `apps/api/src/webhooks/application/services/webhook-delivery-query.service.ts` + interface
11. **Controller + DTOs**:
    - `webhook-delivery.controller.ts` (`@UseGuards(JwtAuthGuard)`)
    - `http/dto/list-webhook-deliveries-query.dto.ts` (class-validator; coerced numbers/dates)
    - `http/dto/webhook-delivery-summary-response.dto.ts` (list — no `payload`)
    - `http/dto/webhook-delivery-detail-response.dto.ts` (detail — includes `payload`)
12. **Unit tests** (all `*.spec.ts`):
    - `webhook-delivery.repository.spec.ts` (mapper round-trip)
    - `webhook-delivery-query.service.spec.ts`
    - `webhook-delivery.controller.spec.ts`
    - update `webhook.service.spec.ts` — assert upsert + lifecycle updates are attempted and that persistence failures are swallowed
    - update `webhook-to-job.handler.spec.ts` — assert linkage / DLQ upsert
13. **Integration test** `apps/api/test/integration/webhook-delivery.int-spec.ts` — POST a signed webhook, assert row persisted with `status=published` and later `downstreamJobId` populated after handler runs. Uses existing Testcontainers harness.

### Frontend

14. **API client** — add `webhookDeliveries.list(filters)` and `.get(id)` to the shared api client
15. **Types** `apps/web/src/pages/webhook-deliveries/types.ts`
16. **Query hooks** `use-webhook-deliveries-query.ts`, `use-webhook-delivery-query.ts`
17. **List page** `webhook-deliveries-page.tsx` — filters (provider, connection dropdown, status, date range); DataTable; offset pagination; URL-synced filters via `useSearchParams` (mirror `sync-jobs-page.tsx`)
18. **Detail drawer** `webhook-delivery-detail.tsx` — JSON viewer for payload, linked sync-job link (`/sync-jobs/:id`), status badge
19. **Route module** `apps/web/src/app/routes/webhook-deliveries.route.tsx` + register in router + sidebar nav entry (locate nav via existing sync-jobs / jobs-logs registration)
20. **Vitest tests** — hook tests + page smoke test

### Quality gate

21. `pnpm lint && pnpm type-check && pnpm test`
22. `pnpm --filter @openlinker/api migration:show` — no pending

---

## Risks / Open questions

- **Write amplification**: 2–4 DB writes per webhook. MVP-acceptable; retention follow-up later.
- **Payload size**: uncapped jsonb. Revisit if storage growth becomes problematic.
- **Soft FK to sync_jobs**: no DB constraint; if a job is later deleted, the `downstreamJobId` becomes dangling. Acceptable for a visibility feature.
- **Module placement divergence**: documented above; migrate with webhooks if they move to `libs/core` later.
