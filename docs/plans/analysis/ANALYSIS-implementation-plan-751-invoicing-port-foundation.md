# Pre-implement Analysis — #751 Invoicing port foundation

**Plan:** `docs/plans/implementation-plan-751-invoicing-port-foundation.md`
**Gated:** 2026-06-16 · against worktree `751-invoicing-port-foundation` @ `9a799af2`

## Verdict: ✅ READY

No Critical findings. Two Warnings, both already accounted for in the plan (a spec update that travels with the capability edit, and the migration the plan already specifies). Greenfield new context — zero reuse collisions, zero contract-surface breaks.

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `libs/core/src/invoicing/` context | **NEW** | directory absent |
| `InvoicingPort` | **NEW** | no hits in `libs/`/`apps/` |
| `InvoiceRecordRepositoryPort` | **NEW** | no hits |
| `RegulatoryTransmitter` capability (deferred) | **NEW** | no hits |
| `InvoiceRecord` entity | **NEW** | no hits |
| `BuyerProfile` entity | **NEW** | no hits |
| `TaxIdentifier` / `BuyerAddress` / `InvoiceLine` types | **NEW** | no hits |
| `DocumentType` / `*StatusValues` / `BuyerTypeValues` unions | **NEW** | `DocumentType` 0 occurrences in `libs/core/src` — no generic-name collision |
| `INVOICE_RECORD_REPOSITORY_TOKEN` | **NEW** | no hits |
| `InvoiceRecordNotFoundException` / `DuplicateInvoiceRecordException` | **NEW** | no hits |
| `invoice_records` table | **NEW** | no `invoice_records` references; migration prefix `1808…` free |
| `'Invoicing'` in `CoreCapabilityValues` | **PARTIAL (extend)** | absent today (`adapter.types.ts` holds 7 values); additive array entry |
| `./invoicing` package.json export | **NEW** | no `invoicing` in `libs/core/package.json` |
| `BuyerAddress` vs customers' `CustomerAddressProjection` | **NEW (deliberate non-reuse)** | plan documents the intentional local duplication; no coupling introduced |

## Backward-compat findings

**Critical:** none.

**Warnings:**
1. **`adapter.types.spec.ts` pins the `CoreCapabilityValues` array** (file confirmed present). Adding `'Invoicing'` requires updating that spec in the same change or `pnpm test` fails. *The plan already lists this as step 11.* — handled.
2. **New ORM entity ⇒ migration required.** `invoice_records` table + `1808000000000-create-invoice-records.ts`. Timestamp is unique and `> 1807000000000` (current max on `main`), satisfying the migration-ordering guard (#1013). *Plan step 13.* — handled.

**`check:invariants` surface:**
- `check-service-interfaces` — **does not fire**: #751 creates no `application/services/*.service.ts` (port + repo + entities only).
- `check-cross-context-imports` — **clean**: the new context introduces no cross-context barrel imports (command/record fields are plain `string` ids; the repository imports only its own ORM entity). The future adapter (#753) will add cross-context imports, out of scope here.
- `check-migration-timestamps` — satisfied (unique, ordered, class-suffix-matched as planned).
- `check-repo-urls` — ADR-026 uses bare `#NNN` + relative ADR links only; clean.
- Barrel/runtime-exports (#591/#594) — `./invoicing` added; `orm-entities` sub-barrel correctly **deferred** (entity is glob-discovered by the data-source, no cross-context TS consumer yet).

## Open questions

None blocking. The plan's prior open questions were resolved during tech-review + research (scheme-tagged `TaxIdentifier`, open-world `DocumentType`, neutral `taxRate`, deferred `RegulatoryTransmitter` sub-capability, fiscal-dedup partial-unique index, deferred `orm-entities` sub-barrel). ADR-026 is written and indexed. The agnosticism litmus (`grep -rin 'nip\|ksef\|vat\|jpk\|faktura' libs/core/src/invoicing` → 0) should be run as an implementation self-check.
