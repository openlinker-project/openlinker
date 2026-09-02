# Readiness gate — #2382 (`W2-44`) refund confirmation + proposal review

**Plan**: `docs/plans/implementation-plan-return-refund-and-proposal-review.md`
**Date**: 2026-08-27
**Scope**: reuse + contract-surface audit against the live tree on `2367-returns-custody` at `e841b5e6c`.

---

## Verdict — **NEEDS-REVISION**

No Critical break. Two plan claims are wrong and one gap is worth closing while the file is open.
The plan's central finding — T7 served, T6 not — is **confirmed exactly**.

---

## Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `RefundRecordRepositoryPort` | **ALREADY EXISTS → extend** | `libs/core/src/orders/domain/ports/refund-record-repository.port.ts` — declares exactly `create` (22) and `findByOrderId` (28) |
| `findByReturnId` | **NEW (confirmed absent)** | not on the port, not on the repository |
| `IDX_refund_records_return_id` | **ALREADY EXISTS → reuse** | `refund-record.orm-entity.ts:40`, partial: `WHERE "returnId" IS NOT NULL` — built for this read, consumed by nothing |
| `IOrderRefundService` / its token | **ALREADY EXISTS → reuse** | `ORDER_REFUND_SERVICE_TOKEN` at `orders.tokens.ts:25` |
| `refundRecordWritten` on the refund response | **ALREADY EXISTS** | `return-write.dto.ts:207` + `refundRecordId:210` — the plan's § 8 assertion is **correct** |
| `GET /returns/:id/correction-proposal` | **ALREADY EXISTS → reuse** | `return-writes.controller.ts:483`, returning `outcome` + per-line `status`/`candidates`/`noMatchReason` |
| `refund-confirmation-form.tsx` | **NEW** | absent |
| `refund-reason.ts` (FE) | **NEW** | absent — no `RefundReason` anywhere in `apps/web` |
| `use-confirm-return-refund-mutation.ts` | **NEW** | absent |
| `return-correction-proposal-panel.tsx` | **NEW** | absent |

---

## Findings against the plan

### 1. IMPORTANT — the plan claims "no new cross-context edge". For the READ module that is wrong.

`apps/api/src/returns/return-actions.module.ts:32` already imports `OrdersModule`, and
`return-writes.controller.ts:50` already imports from `@openlinker/core/orders` — so the WRITE side
needs nothing. But the detail `GET` lives on `ReturnsController`, in **`ReturnsReadApiModule`**, whose
`imports` are **`[ReturnsModule]` and nothing else**.

Projecting `refunds` onto the detail read therefore adds `OrdersModule` to a module that has never
had it. The edge is acyclic and interface-layer (the write module's own docblock already argues the
case: `OrdersModule` does not import `ReturnsModule`, and eight other `apps/api` modules import it),
but it is a **new module edge in a module deliberately kept narrow** — that module's docblock says
the two halves exist separately because they "inject different services". The plan must say so
rather than describe the change as "one projection".

### 2. IMPORTANT — the detail response envelope has NO exact-key allowlist, and the plan assumed one.

The gate was asked to check the allowlist impact. The two `Object.keys(...).sort()` assertions in
`returns.controller.spec.ts` cover the **list row** (`result.items[0]`, line 213) and the **line**
(`result.lines[0]`, line 301). There is **no assertion over `Object.keys(result)`** — the detail
envelope itself is unguarded.

So adding `refunds` breaks nothing, which is the opposite of #2381's experience (where the list-row
allowlist caught `restockBlocked` and the guard did its job). The consequence is the finding: three
fields have now landed on that envelope with no guard at all — `restockTarget` (#2380),
`restockBlocks` and `restockAttestations` (#2381) — and the detail read is precisely where
money-adjacent and buyer-adjacent data would land. T6 puts refund amounts there.

**Add the envelope allowlist in this issue**, while the file is open and the reason is live. It is
the same guard the row already has, and it is cheap now and awkward later.

### 3. Confirmed, no action — the plan's premise holds where it matters.

- The by-order read genuinely cannot substitute: `findByOrderId` is the only read, and an orphan
  return has no `internalOrderId`.
- `refundRecordWritten` really is on the response, so § 8's risk note is accurate rather than
  assumed.
- All four proposed FE files are absent; `RefundReason` genuinely does not exist in `apps/web`.

---

## Backward-compatibility findings

**Critical**: none. `findByReturnId` is an additive port method; `refunds` is an additive response
field; the FE additions are new files.

**Warning — `RefundRecordRepositoryPort` is an implemented port.** Adding a method is a breaking
change for any out-of-tree implementer. There is exactly one implementation in-tree
(`refund-record.repository.ts`); the port is not re-exported for plugin authors the way capability
ports are, so the risk is nominal — but it is a port, not an interface, and that distinction is why
it is listed.

**Migration**: none. The column and its partial index both already exist.

---

## Open questions

None blocking. Items 1 and 2 are plan edits, not decisions.
