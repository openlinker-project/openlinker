# Implementation Plan: WooCommerce master-shop setup guide (rewrite, scoped to what works)

**Date**: 2026-06-09
**Status**: Ready for Review
**Estimated Effort**: ~3–4 hours (documentation only)

---

## 1. Task Summary

**Objective**: Replace the misleading `docs/integrations/woocommerce/bidirectional-setup-guide.md` with a **new** guide that documents only the WooCommerce integration behaviour that is actually implemented today — WooCommerce as a **master shop** at PrestaShop parity (read product catalog + inventory into OpenLinker; route marketplace orders into WooCommerce as a destination shop).

**Context**: A verification pass (2026-06-09) against branch `975-woocommerce-frontend-plugin` found the staged `bidirectional-setup-guide.md` (1021 lines) documents a happy path that does not exist:
- **§7 (products PrestaShop→WooCommerce)** — no core orchestration writes products to a destination shop. `grep '.createProduct(' / '.updateProduct('` across `libs/core/src` (excluding adapters) returns 0 callers.
- **§8 / §12 (inventory PrestaShop→WooCommerce)** — inventory propagation targets **marketplace offers** only (`inventory-sync.service.ts → marketplace.updateOfferQuantity`, handler `inventory-propagate-to-marketplaces.handler.ts`). WooCommerce implements no `OfferManager`, so it is never an inventory-propagation target.
- **§10 / §11 (orders WooCommerce→PrestaShop)** — broken. `OrderSource` is declared in the WooCommerce manifest but **not wired** in `createCapabilityAdapter` and there is **no** `woocommerce-order-source.adapter.ts`. WooCommerce orders cannot be ingested.
- The `bidirectional` framing in §13 / Summary is therefore fiction.

Spec `docs/specs/product-spec-872-woocommerce-shop-integration.md` is explicit that the intended role is "**WooCommerce as a master shop adapter at PrestaShop parity**" (capability ports `ProductMaster`, `InventoryMaster`, `OrderSource`, `OrderProcessorManager`). The guide should mirror the PrestaShop master-shop story, not invent a shop↔shop bridge.

**Classification**: Documentation.

---

## 2. Scope & Non-Goals

### In Scope
- Create a **new** guide file documenting only the implemented WooCommerce flow.
- Cover: Docker bring-up of WooCommerce + OpenLinker; generating WC REST API credentials; adding a WooCommerce connection via the new frontend setup wizard (PR #1002 / #975); verifying that OpenLinker reads WC products + inventory into its catalog; the real "full flow" (list WC catalog on a marketplace such as Allegro + propagate WC inventory to those offers); routing a marketplace order into WooCommerce via `OrderProcessorManager`.
- An explicit **Known Limitations / Not Yet Supported** section naming: WC `OrderSource` not implemented; no shop→shop product/inventory propagation; ADR-014 (cross-platform category/attribute mapping) only *Proposed*.
- Document the disposition of the three pre-existing WooCommerce guide docs (which is canonical, which are superseded).

### Out of Scope
- **Any code change.** This plan writes documentation only. Implementing `WooCommerceOrderSourceAdapter`, shop→shop propagation, or ADR-014 are separate tracked efforts (see §7 references) — the guide *names* them as gaps, it does not build them.
- Mutating the existing staged `bidirectional-setup-guide.md` in place (the user explicitly prefers a new file).
- Screenshots — keep the `[Screenshot Placeholder]` convention only for steps that actually work; do not carry placeholders for removed flows.

### Constraints
- The guide content/edits belong on the **`main`** worktree (`/home/nor/projekty/blocky/openlinker-pnpm-10`), where `bidirectional-setup-guide.md` is currently staged-uncommitted — **not** on branch `975` (owned by the merge-conflict orchestration in another session).
- The WooCommerce integration code is only present on branch `975` today; the guide describes runtime behaviour that ships once that work lands on `main`. Note this assumption in the guide's preamble.

---

## 3. Architecture Mapping

**Target Layer**: Documentation only (`docs/integrations/woocommerce/`). No CORE / Integration / Interface code touched.

**Capabilities referenced (for accuracy of the prose)**:
- `ProductMasterPort` (read) — `WooCommerceProductMasterAdapter` — **works**.
- `InventoryMasterPort` (read) — `WooCommerceInventoryMasterAdapter.listInventory` (per-variant) — **works**.
- `OrderProcessorManagerPort` + `OfferFulfillmentUpdater` — `WooCommerceOrderProcessorAdapter` — **works** (tracking number accepted but not persisted; note it).
- `OfferManagerPort` (Allegro) — the marketplace destination for the real inventory-propagation flow — **works**.
- `OrderSourcePort` — **declared, not wired** for WooCommerce — documented as a limitation.

**Core vs Integration Justification**: N/A — documentation. The guide must not imply any CORE behaviour that the ports/services don't provide.

**Reference**: [Architecture Overview — Capability Abstractions](../architecture-overview.md#capability-abstractions-business-roles); [Data Flow §2 Inventory Synchronization](../architecture-overview.md#data-flow).

---

## 4. External / Domain Research

### Source of truth used for this plan
- **Capability inventory** of `libs/integrations/woocommerce/src/` on branch `975` (manifest `supportedCapabilities`, adapter method coverage).
- **Orchestration check**: `libs/core/src/inventory/application/services/{inventory-sync,master-inventory-sync}.service.ts`; `apps/worker/src/sync/handlers/` (`master-product-sync*`, `inventory-propagate-to-marketplaces`, `orders-poll`).
- **Spec**: `docs/specs/product-spec-872-woocommerce-shop-integration.md` (intended role = master shop at PS parity).
- **ADR-014** `docs/architecture/adrs/014-product-sync-with-cross-platform-mapping.md` — status **Proposed**, "Related PRs: none yet".

### Existing WooCommerce guide docs (disposition decision)
| File | Lines | Disposition |
|---|---|---|
| `docs/integrations/woocommerce/bidirectional-setup-guide.md` | 1021 | **Superseded** by the new guide. Recommend deletion *or* replacement in the same change (decision recorded in §5). |
| `docs/integrations/woocommerce/setup-guide.md` | 101 | Short quickstart, a subset of the new guide. **Fold in then remove**, or keep as a "quick reference" pointer to the new guide. |
| `docs/guides/woocommerce-developer-guide.md` (branch `975` only) | 1546 | Developer-oriented; out of scope here. Lives on `975`. Flag for separate reconciliation when `975` lands. |

---

## 5. Questions & Assumptions

### Open Questions
1. **Canonical filename.** Proposed: `docs/integrations/woocommerce/master-shop-setup-guide.md`. Alternative: overwrite the short `setup-guide.md` as the single canonical file. *Assumption (safe default): create `master-shop-setup-guide.md` as new, leave others for the disposition step.*
2. **Delete vs keep the bidirectional guide.** The user said "keep only what is true" and "prefer a new file." *Assumption: the new guide is canonical; the bidirectional guide is removed in the same PR so two contradictory guides don't coexist. Final go/no-go on the delete is confirmed with the user at `/work` time since deletion is irreversible-ish for uncommitted staged work.*
3. **Include the Allegro "real full flow" section now?** It depends on an Allegro connection. *Assumption: include it as an clearly-marked optional section, since it is the only genuinely end-to-end multi-platform flow that works.*

### Assumptions
- The WooCommerce frontend setup wizard (PR #1002) is the connection-creation path the guide should screenshot/describe.
- WooCommerce capability pills shown in the UI come from `manifest.supportedCapabilities`, so the UI may *display* `OrderSource` even though it is not wired — the guide must not tell the reader to rely on it.

### Documentation Gaps
- ADR-014 numbering collision exists (`014` is `product-sync-with-cross-platform-mapping` on `main` but `source-authoritative-order-pricing` on `975`). Out of scope for this guide, but reference ADR-014 by **title**, not number, to avoid ambiguity.

---

## 6. Proposed Implementation Plan

### Phase 1: Author the new guide
**Goal**: A single accurate guide covering only implemented behaviour.

1. **Create the guide skeleton**
   - **File**: `docs/integrations/woocommerce/master-shop-setup-guide.md`
   - **Action**: Title "WooCommerce Master-Shop Setup Guide"; preamble stating scope (WooCommerce as a master shop at PrestaShop parity) and the assumption that it describes behaviour shipping with the WooCommerce adapter (#872 line).
   - **Acceptance**: File exists; preamble names the role and does not use the word "bidirectional".

2. **Port the sections that already work** (adapt from `bidirectional-setup-guide.md` §0–§3, §6)
   - **Action**: Prerequisites & ports; Docker bring-up (`docker compose --profile woocommerce up -d`); env + migrations + boot 3 services; generate WC REST API credentials (Settings → Advanced → REST API, Read/Write); add the WooCommerce connection via the setup wizard; test + create.
   - **Acceptance**: Every step is reproducible against the dev stack; no step depends on an unimplemented capability.

3. **Add "OpenLinker reads WC catalog + inventory" verification**
   - **Action**: Describe the WC-as-master read path (products + per-variant inventory appear in OpenLinker's Products/Inventory views after a `master.product.sync` / `master.inventory.sync`). Mirror PrestaShop's master-read framing.
   - **Acceptance**: Prose matches `WooCommerceProductMasterAdapter` / `WooCommerceInventoryMasterAdapter.listInventory` behaviour (per-variant stock; synthetic variant for simple products).

4. **Add the optional "real full flow" section (marketplace destination)**
   - **Action**: Mark clearly as *optional, requires an Allegro connection*. Flow: WC catalog → create offers on Allegro → propagate WC inventory to those offers (`inventory-propagate-to-marketplaces`). Then: a marketplace order routed into WooCommerce via `OrderProcessorManager` (`WooCommerceOrderProcessorAdapter.createOrder` + `updateFulfillment`; note tracking number is accepted but not persisted).
   - **Acceptance**: The section never claims WC→OpenLinker order ingestion.

5. **Add "Known Limitations / Not Yet Supported"**
   - **Action**: Bullet list with one line each: (a) WooCommerce `OrderSource` not implemented — WC orders cannot be ingested; (b) no shop→shop product/inventory propagation (PrestaShop→WooCommerce sync is not a feature); (c) cross-platform category/attribute mapping (ADR-014, *Proposed*) not implemented — offers use raw product data; (d) inventory reservation not supported by the WC adapter.
   - **Acceptance**: Each limitation is traceable to the verification evidence in §1.

### Phase 2: Reconcile the other guide docs
**Goal**: No two contradictory WooCommerce guides coexist.

6. **Decide + apply disposition of `bidirectional-setup-guide.md` and `setup-guide.md`**
   - **Action** (pending Q2 confirmation at `/work`): remove `bidirectional-setup-guide.md` and `implementation-plan-woocommerce-bidirectional-guide.md` (its plan), or replace the former's content with a one-line pointer to the new guide. Fold any unique useful steps from `setup-guide.md` into the new guide, then remove or stub it.
   - **Acceptance**: Exactly one canonical operator guide for WooCommerce under `docs/integrations/woocommerce/`.

7. **Wire cross-links**
   - **Action**: Link the new guide from `docs/getting-started.md` (and from `docs/integrations/woocommerce/` index if present); ensure the architecture-overview Products/Inventory sections aren't contradicted.
   - **Acceptance**: No dangling links to the removed guide; `grep -rl bidirectional-setup-guide docs/` returns nothing after the change.

### Implementation Details
- **New Components**: one Markdown file (Phase 1). No code.
- **Configuration Changes**: none.
- **Database Migrations**: none.
- **Events**: none.
- **Error Handling**: N/A (docs).

**Reference**: [Engineering Standards — File/Doc conventions](../engineering-standards.md).

---

## 7. Alternatives Considered

### Alternative 1: Edit `bidirectional-setup-guide.md` in place
- **Description**: Strip §7/§8/§10/§11/§12 and the bidirectional framing from the existing staged file.
- **Why Rejected**: User explicitly prefers a new file to avoid mutating current work; also a heavy in-place edit obscures the diff between "what was claimed" and "what is true". A clean new file is clearer.
- **Trade-off**: Risk of leaving two files — mitigated by Phase 2.

### Alternative 2: Keep `bidirectional-setup-guide.md`, add a "Status" banner per section
- **Description**: Annotate non-working sections with "⚠️ Not yet implemented".
- **Why Rejected**: A setup guide riddled with not-implemented banners is worse UX than a short accurate guide; readers skim and miss banners.

### Alternative 3: Don't write a guide until `OrderSource` + shop-sync ship
- **Description**: Defer documentation.
- **Why Rejected**: The implemented master-shop flow is already useful and shippable with PR #1002; documenting it now has value, provided limitations are explicit.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Documentation only; describes capability behaviour exactly as implemented (verified against adapters + core orchestration).

### Naming Conventions
- ✅ New file under `docs/integrations/woocommerce/`, kebab-case filename.

### Existing Patterns
- ✅ Mirrors the PrestaShop master-shop narrative and the architecture's master→marketplace-offer inventory model.

### Risks
- **Drift if `OrderSource` lands later**: the "Known Limitations" list will go stale. *Mitigation*: phrase each limitation with "as of <date> / not yet implemented" and link the tracking issue so it's an obvious update target.
- **Branch confusion**: editing on `main` while WC code lives on `975`. *Mitigation*: preamble states the guide describes behaviour shipping with the WooCommerce adapter; reviewers reconcile when `975` merges.
- **Deleting staged work**: removing `bidirectional-setup-guide.md` (Q2). *Mitigation*: confirm with user at `/work` before `git rm`; it's recoverable from the staged blob / git history if needed.

### Edge Cases
- **UI shows an `OrderSource` pill**: explicitly tell the reader this capability is not active yet.
- **Simple vs variable WC products**: inventory read uses a synthetic variant for simple products — keep the prose accurate.

### Backward Compatibility
- ✅ No runtime impact. Only docs.

---

## 9. Testing Strategy & Acceptance Criteria

### Validation (docs)
- Manual walk-through of every numbered step against the dev stack (`docker compose --profile woocommerce up -d` + connection wizard + a `master.product.sync`).
- `pnpm lint` (only relevant for markdown link / repo-invariant checks, if any) — docs change shouldn't trip code invariants.
- `grep -rn "bidirectional" docs/integrations/woocommerce/` returns nothing after Phase 2.
- `grep -rl "bidirectional-setup-guide" docs/` returns nothing (no dangling links).

### Acceptance Criteria
- [ ] New guide describes only ProductMaster-read, InventoryMaster-read, OrderProcessor (destination), and the optional Allegro full flow.
- [ ] No section instructs the reader to sync products/inventory PrestaShop→WooCommerce, or to ingest WooCommerce orders.
- [ ] "Known Limitations" names: WC `OrderSource` unimplemented, no shop→shop propagation, ADR-014 not implemented, no inventory reservation.
- [ ] Exactly one canonical WooCommerce operator guide remains.
- [ ] No dangling links to removed docs.

**Reference**: [Testing Guide](../testing-guide.md) (validation discipline; no automated suite applies to prose).

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (N/A — docs; describes ports accurately)
- [x] Respects CORE vs Integration boundaries (no code change)
- [x] Uses existing patterns (mirrors PrestaShop master-shop guide framing)
- [x] Idempotency considered (N/A)
- [x] Event-driven patterns used where applicable (N/A)
- [x] Rate limits & retries addressed (N/A)
- [x] Error handling comprehensive (N/A)
- [x] Testing strategy complete (manual doc validation defined)
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation
- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- `docs/specs/product-spec-872-woocommerce-shop-integration.md` (intended WooCommerce role)
- `docs/architecture/adrs/014-product-sync-with-cross-platform-mapping.md` (Proposed — cross-platform mapping gap)
- Superseded: `docs/integrations/woocommerce/bidirectional-setup-guide.md`
