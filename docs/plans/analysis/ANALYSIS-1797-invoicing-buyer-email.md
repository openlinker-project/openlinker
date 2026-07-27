# Pre-Implementation Analysis: implementation-plan-1797-invoicing-buyer-email.md

**Issue**: #1797
**Plan**: `docs/plans/implementation-plan-1797-invoicing-buyer-email.md`
**Verdict**: **READY**

---

## Reuse Findings

| Plan artifact | Classification | File / evidence |
|---|---|---|
| `BuyerProfile.email` field | NEW (confirmed absent) | `libs/core/src/invoicing/domain/entities/buyer-profile.entity.ts` — constructor is `(name, taxId, address, type)`, no 5th param today. |
| `order.customerEmail` source field | ALREADY EXISTS → reuse | `libs/core/src/orders/domain/types/order.types.ts:96` (`Order.customerEmail?: string`, populated since #948). Plan correctly reuses it, adds no new field here. |
| `InvocingIssueBuyerV1.email` | NEW (confirmed absent) | `libs/core/src/sync/domain/types/invoicing-job-payloads.types.ts` — current shape is `{ name, taxId, address, type }`. |
| Additive-payload-field precedent | ALREADY EXISTS → pattern to follow | Same file, `saleDate` field + its doc comment establish the exact "optional additive field, no schemaVersion bump" convention the plan proposes reusing. |
| `AutoIssueTriggerService` buyer-flatten site | ALREADY EXISTS → extend | `libs/core/src/invoicing/application/services/auto-issue-trigger.service.ts:266-271`. |
| `InvoicingIssueHandler.toCommand` reconstruction site | ALREADY EXISTS → extend | `apps/worker/src/sync/handlers/invoicing-issue.handler.ts:169-176`. |
| `InfaktInvoicingAdapter.upsertCustomer` payload site | ALREADY EXISTS → extend | `libs/integrations/infakt/src/infrastructure/adapters/infakt-invoicing.adapter.ts:364-373`; `nip: nip ?? undefined` is the exact drop-key-when-null precedent the plan proposes mirroring for `email`. |
| `InfaktClient.email` (provider response shape) | ALREADY EXISTS (unused on write) | `libs/integrations/infakt/src/domain/types/infakt.types.ts:107` — confirms Infakt's own API already models this field; nothing new needed on the read/response-type side. |

No port, service, DI token, or ORM entity is being reinvented. This is a pure additive-field extension across 4 already-identified files plus their tests — no new abstraction is proposed, matching the plan's own "No new components required" claim.

## Backward-Compatibility Findings

### Constructor call-site blast radius (broader than the plan's file list — verified safe)

A repo-wide grep for `new BuyerProfile(` surfaces **16 call sites**, not just the ~5 the plan explicitly names as touched:

```
libs/core/src/sync/domain/types/invoicing-job-payloads.types.ts        (doc comment only, not a call)
libs/core/src/invoicing/application/services/invoice.service.spec.ts
libs/core/src/invoicing/application/mappers/order-to-issue-invoice-command.mapper.ts   ← plan touches
libs/core/src/invoicing/domain/entities/buyer-profile.entity.spec.ts   ← plan touches
libs/integrations/infakt/scripts/poc-sandbox-test.ts                  ← plan touches (Phase 5)
libs/integrations/infakt/src/application/__tests__/infakt-adapter.factory.spec.ts
libs/integrations/infakt/src/infrastructure/adapters/__tests__/infakt-invoicing.adapter.spec.ts   ← plan touches
libs/integrations/subiekt/src/infrastructure/adapters/__tests__/subiekt-invoicing.adapter.spec.ts
libs/integrations/subiekt/src/infrastructure/mappers/__tests__/subiekt-document-type.mapper.spec.ts
libs/integrations/subiekt/src/infrastructure/mappers/__tests__/subiekt-buyer.mapper.spec.ts
libs/integrations/ksef/src/infrastructure/fa3/domain/fa3-builder-input.mapper.spec.ts
libs/integrations/ksef/src/infrastructure/adapters/__tests__/ksef-invoicing.adapter.spec.ts
apps/worker/src/sync/handlers/invoicing-issue.handler.ts               ← plan touches
apps/api/test/integration/invoicing/invoice-record-repository.int-spec.ts
apps/api/src/invoicing/http/invoicing.controller.ts                   (correction-snapshot rebuild — explicitly out of scope per plan §2)
apps/api/src/invoicing/http/invoicing.controller.spec.ts
```

**Severity: none (Warning-level check, cleared).** Every one of the untouched call sites passes exactly 4 positional arguments (`name, taxId, address, type`). The plan's design decision — add `email` as a **5th, defaulted** (`= null`) constructor parameter — means all 11 untouched call sites (Subiekt's two test files, KSeF's two test files, `invoice.service.spec.ts`, the factory spec, the two integration/controller specs not in scope) keep compiling with zero changes required. This was the plan's explicit assumption (§5, "Assumptions") and it is confirmed correct against the live tree, not just asserted.

One nuance not spelled out in the plan: **Subiekt and KSeF both already construct `BuyerProfile` in their own adapter tests** (`subiekt-invoicing.adapter.spec.ts`, `subiekt-buyer.mapper.spec.ts`, `ksef-invoicing.adapter.spec.ts`, `fa3-builder-input.mapper.spec.ts`). This reinforces the plan's own §3 justification (the field belongs in CORE, not Infakt-only) — Subiekt and KSeF both already receive a `BuyerProfile` and would see `.email` for free once this ships, with zero action required on their side today.

### Contract-surface checklist

| Surface | Check | Result |
|---|---|---|
| Top-level barrel `@openlinker/core/invoicing` | `BuyerProfile` already exported; no export removed/renamed, only the class's shape gains an optional field. | Clear |
| Port method signatures (`InvoicingPort.upsertCustomer`, `InvoiceEmailSender.sendByEmail`) | Neither signature changes — only the *data* flowing through `UpsertCustomerCommand.buyer` gains a field. | Clear |
| DTO shapes (`SendInvoiceEmailRequestDto`, `SendInvoiceEmailResponseDto`) | Untouched by this plan — confirmed no DTO file is in the plan's file list. | Clear |
| Symbol tokens (`*.tokens.ts`) | None touched — no new/renamed DI binding. | Clear |
| ORM schema / migration | No `*.orm-entity.ts` touched; `email` lives only in an in-memory domain object and inside the existing untyped jsonb sync-job payload column. Plan explicitly calls this out (§2, §6 Implementation Details) — confirmed correct, no migration required. | Clear |
| `check:invariants` (`check-cross-context-imports`, `check-service-interfaces`) | No new cross-context import — `email` stays inside `invoicing`/`sync` (already-adjacent core contexts) and the Infakt adapter (already depends on `@openlinker/core/invoicing`). No new/changed service `implements` clause. | Clear |
| `InvocingIssuePayloadV1` schema-version discipline | Plan proposes an additive field, no `schemaVersion` bump, explicitly modeled on the file's own `saleDate` precedent (verified present in the live file). Correct application of the existing convention. | Clear |

No Critical or Warning items found.

## Open Questions

- The plan itself already flags one open question (§5): whether the Infakt "existing client found by NIP" branch should `PUT`-backfill an e-mail onto a pre-existing e-mail-less client. Confirmed still open, correctly deferred to implementation-time sandbox testing, and correctly excluded from the acceptance criteria. No action needed before implementation starts.
- None of this gate's own research surfaces a new open question — the plan's file-level scope, defaulted-constructor-parameter design, and additive-payload-field approach are all confirmed safe against the live tree.

---

**Post-gate correction (found during implementation)**: this gate did not check for a handler spec under a `__tests__/` subdirectory convention — `apps/worker/src/sync/handlers/__tests__/invoicing-issue.handler.spec.ts` already existed (191 lines) even though a sibling-flat check (`apps/worker/src/sync/handlers/invoicing-issue.handler.spec.ts`, no `__tests__/`) correctly reported nothing there. The plan's Phase 3 step 8 originally said to *create* the spec; it was corrected to *extend* the existing one instead, avoiding a duplicate test file. No other artifact in this analysis was affected by this gap — every other reuse/backward-compat finding above still holds.

**Summary**: The plan is READY. Every artifact it proposes extending (the `BuyerProfile` constructor, the mapper, the async job payload + its flatten/reconstruction sites, and the Infakt adapter's `clients.json` payload) exists exactly where the plan says, and no new port/service/token/ORM entity is being reinvented. A repo-wide search for every `new BuyerProfile(...)` call site turned up 16 locations rather than the ~5 the plan names explicitly, including two other adapters (Subiekt, KSeF) that already construct this entity in their own tests — but because the plan adds `email` as a 5th, defaulted constructor parameter, all untouched call sites keep compiling with no required changes, and Subiekt/KSeF gain the field for free without any action. No Critical or Warning contract-surface breaks were found; the plan's own additive-payload-field and no-migration-needed claims both check out against the live schema files. Implementation may proceed as written.
