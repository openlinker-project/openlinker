# Pre-Implement Analysis — RegulatoryTransmitter sub-capability port + guard (#1143)

**Plan:** `docs/plans/implementation-plan-regulatory-transmitter-capability.md`
**Gate date:** 2026-06-23
**Verdict:** ✅ **READY**

Pure additive domain change (capability interfaces + guards + one neutral type + barrel exports). No reuse collision, no contract-surface break, no token, no ORM/migration. The codebase already *anticipates* this interface in doc-comments (`InvoicingPort`, `InvoiceRecord`, the migration) — #1143 fills a pre-described gap.

---

## Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `RegulatoryStatusReader` interface + `isRegulatoryStatusReader` | **NEW (confirmed absent)** | grep across `libs`/`apps` finds the symbol nowhere. |
| `RegulatoryTransmitter` interface + `isRegulatoryTransmitter` | **NEW (confirmed absent)** | The only `RegulatoryTransmitter` hits are **doc-comment references** in `invoicing.port.ts:10,38`, `invoice-record.entity.ts:7`, `invoice-record.orm-entity.ts:6`, and `1808000000000-create-invoice-records.ts:8` — no actual interface declaration. The interface is genuinely new; the comments forward-reference exactly this issue. |
| `RegulatoryClearanceResult` type | **NEW (confirmed absent)** | grep finds no definition; goes into the existing `invoicing.types.ts` (additive). |
| `RegulatoryStatus` / `RegulatoryStatusValues` (the neutral CTC lifecycle) | **ALREADY EXISTS → reuse** | `libs/core/src/invoicing/domain/types/invoicing.types.ts:42-49` (from #751). The plan reuses, does not redefine. |
| `InvoiceRecord` entity (method param) | **ALREADY EXISTS → reuse** | `libs/core/src/invoicing/domain/entities/invoice-record.entity.ts` — carries `regulatoryStatus` + `clearanceReference`. |
| `capabilities/` directory under invoicing `domain/ports/` | **NEW (confirmed absent)** | Absent today; creating it mirrors `orders`/`listings`/`shipping` (`domain/ports/capabilities/`). |
| Barrel exports for the two capability modules | **NEW (additive)** | `index.ts` currently exports 9 lines; plan adds 2 `export *` lines. |
| DI token | **N/A — none introduced** | Plan explicitly: no token (capability-resolved per-connection via the guards). `invoicing.tokens.ts` holds only `INVOICE_RECORD_REPOSITORY_TOKEN`, untouched. |

**No port/service/token/ORM/helper is reinvented.** The neutral lifecycle, the record, and the columns the methods drive all already ship.

---

## Backward-compatibility findings

### 🟢 Top-level barrel — additive only (not Critical)
- `@openlinker/core/invoicing` gains two `export *` lines (the capability modules + `RegulatoryClearanceResult` rides the existing `invoicing.types` star export). **No symbol removed or renamed** → no break.

### 🟢 Port signatures — unchanged
- `InvoicingPort` is **not** modified. The sub-capabilities are optional, adapter-declared interfaces narrowed via guards — exactly the `OfferManagerPort` sub-capability idiom. No implementer breaks.

### 🟢 Symbol tokens — none added/changed
- No token (per plan). `invoicing.tokens.ts` untouched → token-convention invariant unaffected.

### 🟢 ORM schema / migration — none
- `regulatoryStatus` + `clearanceReference` already exist on `invoice-record.orm-entity.ts` (migration `1808000000000-create-invoice-records.ts`, from #751). ADR-026's "no later migration" guarantee holds. **No migration.**

### 🟢 `check:invariants` — no new violations
- **cross-context:** the new capability files import only same-context symbols (`InvoicingPort`, `InvoiceRecord`, `RegulatoryClearanceResult`/`RegulatoryStatus`) via relative paths ≤ `../..` — matching the existing `offer-creator.capability.ts` / `fulfillment-status-reader.capability.ts` style. No cross-context edge added.
- **check-service-interfaces:** no application service added → unaffected.
- **No automated neutral-vocabulary script exists** (the issue AC's "neutral-vocabulary checks" overstates `check:invariants`, which has cross-context but no `nip`/`ksef` litmus). The litmus is review-enforced; plan keeps the files neutral. Not introducing a new invariant script (out of scope) is the correct call.

---

## Open questions

1. **`extends` vs two independent flat capabilities** — *resolved in the plan* (§2 "Why `extends`"). Deep research (codebase + CTC domain) confirmed: OL's flat idiom holds because prior read/write pairs are *orthogonal*; the regulatory pair is a genuine `is-a` (submit logically entails read — the KSeF/SDI reference is knowable only by reading post-submit), so `extends` is the correct first capability-inheritance in the codebase, as a bounded documented exception. Not a blocker.
2. **#1121 coordination** — #1121 (collaborator, open/unclaimed) needs `RegulatoryStatusReader`; #1143 defines it here so #1121 only *consumes* it. The plan ships a coordination comment + a one-line ADR-026 amendment. If #1121's author later prefers a single fat interface, it is a one-file delta. Low risk, surfaced.

Neither blocks a clean implementation.

---

## Summary
The plan is purely additive within the `invoicing` context: two new ADR-002 sub-capability interfaces (`RegulatoryStatusReader` + `RegulatoryTransmitter extends` it), their `is{Capability}` guards, one neutral `RegulatoryClearanceResult` type folded into the existing `invoicing.types.ts`, and two additive barrel exports. Nothing is reinvented (the neutral `RegulatoryStatus` lifecycle, `InvoiceRecord`, and the persistence columns all already exist), nothing is removed or renamed, there is no token and no migration, and no `check:invariants` rule is tripped. The one design choice (`extends` for a genuine read⊂transmit subset) is research-backed and documented. **Verdict: READY** — proceed to implementation.
