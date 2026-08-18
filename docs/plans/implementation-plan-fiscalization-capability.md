# Implementation Plan - Fiscalization capability (neutral half, #1908)

**Issue:** #1908 · **Design:** [ADR-042](../architecture/adrs/042-fiscalization-capability.md) (binding) ·
**Epic:** #1902

## 1. Goal

Ship the **neutral half** of the fiscalization capability: a new `libs/core/src/fiscalization/`
bounded context with one base port, one sub-capability, a durable registration record with an
exactly-once guarantee owned by core, and the HTTP endpoint an operator-triggered registration calls.

**Layer:** CORE (+ a thin Interface slice in `apps/api`, + two one-line capability-list edits).

### Explicit non-goals

- **No provider adapter.** The vendor API documentation for adapter #1 is not in this checkout, so a
  faithful adapter cannot be written. ADR-042 § Migration path says #1907 gates only the adapter half.
- No device / peripheral sub-capability (#1910 closed `not_planned`).
- No degraded / offline mode (ADR-042 dec. 10 - a decision, not an omission).
- No journal / audit export (`FiscalJournalExporter`, ADR-042 dec. 11 - a named extension point).
- No fiscal corrections, voids or returns.
- No automatic routing / document selection (ADR-041 / #2051).
- No FE surfaces (#1909, #1911); no doc updates (#2010).

## 2. Design (fixed by ADR-042 - not re-derived)

| ADR-042 | How this plan honours it |
|---|---|
| dec. 1 - own capability port | `libs/core/src/fiscalization/`, `'Fiscalization'` joins the **closed** `CoreCapabilityValues` |
| dec. 2 - one transaction operation | `FiscalizationPort.registerTransaction(cmd)` and nothing else |
| dec. 2 - possibly-empty artefact list | `RegisterTransactionResult.artefacts: FiscalArtefact[]`; `[]` is a **success** |
| dec. 3 - trust anchor in the adapter | flat `signingIdentity: string \| null`; no anchor-class union |
| dec. 4 - no vendor/country vocabulary | litmus grep in § 6 |
| dec. 5 - device sub-capability | not shipped |
| dec. 6 - exactly-once owned by core | mandatory `idempotencyKey`, **plain** unique index on `(connectionId, idempotencyKey)`, row written **before** the outbound call, status-aware resume + atomic CAS lease |
| dec. 7 - indeterminate outcome first-class | own `FiscalRegistrationFailureModeValues = ['rejected', 'in-doubt']`; `in-doubt` never auto-retried; `FiscalRegistrationLocator` + `isFiscalRegistrationLocator` |
| dec. 8 - never compute a tax rate | `FiscalTransactionLine.taxRate` is a pass-through string; core neither computes nor defaults one (see § 5 gap) |
| dec. 9 - neutral identity set | `providerReference`, `documentReference`, `signingIdentity`, `registeredAt`, jsonb `regimeExtras` (no key indexed) |
| dec. 10 / 11 | not shipped, deliberately |

## 3. Files

### CORE - `libs/core/src/fiscalization/`

```
domain/types/fiscalization.types.ts                 status/failure-mode/medium/disposition unions,
                                                    command, result, locator criteria/result,
                                                    repository input + outcome patch
domain/entities/fiscal-registration-record.entity.ts  anemic + pure derivations
domain/ports/fiscalization.port.ts                  base port (one method)
domain/ports/capabilities/fiscal-registration-locator.capability.ts
                                                    sub-capability + co-located guard
domain/ports/fiscal-registration-record-repository.port.ts
domain/exceptions/*.ts                              not-found / duplicate / not-in-doubt
application/mappers/order-to-register-transaction-command.mapper.ts (+ errors/)
application/services/fiscal-registration.service.interface.ts
application/services/fiscal-registration.service.ts
infrastructure/persistence/entities/fiscal-registration-record.orm-entity.ts
infrastructure/persistence/repositories/fiscal-registration-record.repository.ts
fiscalization.tokens.ts | fiscalization.module.ts | index.ts | orm-entities.ts
```

### Capability-value edits (both required, or the strict DTO rejects the capability)

- `libs/core/src/integrations/domain/types/adapter.types.ts` - `CoreCapabilityValues`
- `libs/core/src/integrations/domain/types/__tests__/adapter.types.spec.ts` - the pinned assertion
- `apps/web/src/features/connections/api/connections.types.ts` - `CORE_CAPABILITY_VALUES`

### Interface - `apps/api/src/fiscalization/`

- `http/fiscalization.controller.ts` - `POST /fiscal-registrations` (the manual trigger),
  `GET /fiscal-registrations?orderId=`, `POST /fiscal-registrations/:id/reconcile`
- `http/dto/*.ts`
- `fiscalization.module.ts` (`FiscalizationApiModule`) + registration in `apps/api/src/app.module.ts`

### Persistence

- `apps/api/src/migrations/1835000000000-create-fiscal-registration-records.ts`
- `libs/core/package.json` - `./fiscalization` + `./fiscalization/orm-entities` exports

## 4. Exactly-once lifecycle (the highest-severity AC)

```
register(cmd)
 ├ (1) read gate      findByIdempotencyKey(connectionId, key)  -> resumeExisting
 ├ (2) persist intent create({status:'pending'})  BEFORE any outbound call
 │      └ duplicate  -> re-read by key -> resumeExisting        (create-race)
 └ (3) claim + call   claimForRegistration(id, lease)  CAS
        ├ null       -> back off WITHOUT crossing the provider boundary
        └ won        -> adapter.registerTransaction  -> updateOutcome
```

`resumeExisting`:

| existing state | action |
|---|---|
| `registered` | return verbatim (idempotent replay) |
| live lease (`registering`, lease in the future) | return as-is, **no** second outbound call |
| `failed` + `in-doubt` (or an unreadable mode) | return as-is for manual reconciliation |
| `pending` / expired lease / `failed` + `rejected` | re-attemptable - CAS claim, then call |

The CAS predicate is enforced **at the persistence boundary**, not only in the service, so no caller
can weaken it. ADR-005's delete-the-row-on-failure step is **not** adopted: the row is the `in-doubt`
evidence.

## 5. Known gap, named rather than papered over

ADR-042 dec. 8's **positive** half ("the VAT rate arrives from the ProductMaster ... a missing rate
blocks registration as a business failure") rests on #2054, which rests on the ADR-014 reversal
proposed in **#2058 - open, and it may be refused**. `OrderItem` carries no per-line tax rate today,
so a blocking gate here would block *every* registration. `FiscalTransactionLine.taxRate` therefore
mirrors `InvoiceLine.taxRate` exactly: a pass-through string where `''` means "OL resolved none; the
adapter's regime mapping applies". The **negative** half of dec. 8 - fiscalization never computes or
defaults a rate - holds unconditionally and is honoured. The blocking behaviour lands with #2054.

## 6. Validation

- Litmus (ADR-042 dec. 4): `grep -riE 'paragon|kasa|printer|eparagony|ksef' libs/core/src/fiscalization`
  must return nothing.
- Unit specs for the service (resume matrix, lease, failure classification), the entity derivations,
  the guard, the types and the mapper.
- One integration spec for the new persistence path, mirroring
  `apps/api/test/integration/invoicing/invoice-record-repository.int-spec.ts`: the plain unique index
  really rejects a duplicate, and exactly one of two parallel CAS claims wins on real Postgres.
- `pnpm lint` + `pnpm type-check`.
