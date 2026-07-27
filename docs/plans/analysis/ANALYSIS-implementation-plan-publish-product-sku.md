# Pre-Implement Analysis: implementation-plan-publish-product-sku.md

**Gate date**: 2026-07-12
**Plan**: [docs/plans/implementation-plan-publish-product-sku.md](../implementation-plan-publish-product-sku.md)
**Issue**: #1485 (BUG — shop product publish drops the SKU)
**Reviewer**: OpenLinker Tech Lead (read-only readiness gate)

---

## Verdict: **READY** (one scope note to record, not a blocker)

The plan is a purely additive, optional-field change. Every assumption verified against `origin/main`: the field is genuinely new, the neutral command has exactly one construction site, and no published contract surface is broken. **The one thing the plan/issue under-stated — a *second* `ShopProductManagerPort` implementor (PrestaShop) exists — turns out to *reinforce* the plan rather than break it**, but the reason is subtle enough to record before coding.

---

## Reuse findings (does it already exist?)

| Plan artifact | Class | Evidence |
|---|---|---|
| `PublishProductCommand.sku?` | **NEW** | `git show origin/main:…/product-publish.types.ts` → no `sku` (grep exit 1). Confirmed absent. |
| Variant SKU source | **REUSE** | `ProductVariant.sku: string \| null` (`libs/core/src/products/domain/entities/product-variant.entity.ts:20`); already fetched at builder line 70 via `IProductsService.getVariant`. |
| Command construction site | **REUSE (single)** | `git grep "PublishProductCommand = {"` on `origin/main` → only `product-publish-builder.service.ts:108`. `ProductPublishExecutionService` (single + bulk) calls the builder — no other literal. Fixing the builder covers all publish paths. |
| `WooCommerceProductPublishRequest.sku?` | **NEW** | Wire type had no `sku`; WC `products` resource natively supports it. |
| WC adapter mapping | **PARTIAL (extend)** | `buildProductBody` exists; add one `if (cmd.sku != null) …` line. |

## Backward-compatibility findings

| Surface | Assessment |
|---|---|
| Top-level barrel `@openlinker/core/listings` | **No break** — `PublishProductCommand` is exported (`index.ts:303` block); adding an **optional** field is additive. No consumer constructs it except the builder. |
| Port signatures | **No change** — `ShopProductManagerPort.publishProduct(cmd)` unchanged; `cmd` shape widened additively. |
| DTO shapes | **N/A** — no HTTP request/response DTO touched. |
| Symbol tokens | **No change.** |
| ORM schema | **No change → no migration.** SKU is read from the existing `ProductVariant`; nothing persisted. |
| `check:invariants` | **No expected trip** — no cross-context deep import (WC already imports the type from the barrel), builder still `implements IProductPublishBuilderService`, no repo-URL change. |

## Open questions (record before/at implementation)

1. **A second `ShopProductManagerPort` implementor exists — PrestaShop — and must be left untouched, deliberately.** `PrestashopProductPublisherAdapter.buildProductBody` (`…/prestashop-product-publisher.adapter.ts:191`) already sets **`reference: cmd.internalVariantId`** and uses that same `reference` as its **idempotency / orphan-recovery key** (`findExistingByReference`, lines 96/101/234, #1107). So:
   - PrestaShop's `reference` is intentionally the **internal variant id**, *not* the human SKU. Naively mapping the new `cmd.sku → reference` would **break** #1107 idempotent upsert.
   - The plan's "optional field; publishers that don't map it are unaffected" is therefore **correct and important** — PrestaShop correctly ignores `cmd.sku` and keeps its reference-as-idempotency-key contract.
   - Net effect: the "publish drops the SKU" symptom is **WooCommerce-specific**; PrestaShop already carries a stable identifier (just not the human SKU). **Whether PrestaShop should *additionally* surface the human SKU (e.g. in a different PS field) is a separate design question — out of scope for #1485, worth a follow-up issue.**

2. **Bulk publish** rides the same builder via `ProductPublishExecutionService`, so it inherits the fix with no extra work — confirmed, not an open risk.

## Recommendation

Proceed as planned. **Do not** extend the change to the PrestaShop publisher in this issue — its `reference` field is a deliberate idempotency key, not the SKU. Add a one-line note in the PR body that PrestaShop is intentionally out of scope for the reason above, and (optionally) file a follow-up for "PrestaShop publish: surface the human SKU alongside the reference-as-idempotency-key" if that's wanted.
