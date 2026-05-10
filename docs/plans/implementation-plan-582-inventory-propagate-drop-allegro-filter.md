# Implementation plan — #582 Drop `platformType === 'allegro'` filter from inventory-propagate handler

## 1. Understand

**Goal**: `InventoryPropagateToMarketplacesHandler` (`apps/worker/src/sync/handlers/inventory-propagate-to-marketplaces.handler.ts:108-117`) currently filters offer mappings to Allegro-only before enqueuing `marketplace.offerQuantity.update` jobs. Non-Allegro mappings (Amazon, Shopify, future plugins) are silently dropped. Drop the filter — the handler is a thin orchestrator and per-platform behavior belongs in the downstream adapter (`OfferManagerPort.updateOfferQuantity`), not here.

**Layer**: worker handler (sync orchestration). No CORE port change. No FE.

**Non-goals**:
- **No** connection-capability check inside the handler. Mappings are stored as `entityType='Offer'`, which is set by adapters that already implement `OfferManager`; if a stray non-OfferManager mapping somehow gets there, the downstream `marketplace.offerQuantity.update` runner's adapter resolution surfaces the failure cleanly. **Verified**: `MarketplaceOfferQuantityUpdateHandler.execute` → `InventorySyncService.updateOfferQuantity` calls `IntegrationsService.getCapabilityAdapter<OfferManagerPort>(connectionId, 'OfferManager')` (`libs/core/src/inventory/application/services/inventory-sync.service.ts:41-43`); a missing capability throws a clean domain error. Adding a defensive check at the handler would duplicate that policy.
- **No** broader refactor of inventory-propagation orchestration into a core application service. The arch doc (`architecture-overview.md §7`) says "sync orchestration policies live in core application services, not in worker handlers"; the issue itself acknowledges this ("the handler is supposed to be a thin shell"). This PR removes the platform discrimination but leaves the orchestration policy in the worker handler — the deeper handler-vs-service refactor is a thread-E follow-up, not this PR.
- **No** idempotency-key shape change.
- **No** error-handling change.
- **No** change to the no-inventory or no-mappings short-circuits.

## 2. Research

| Concern | Finding |
|---|---|
| Where the filter lives | Lines 108-117: `mappings.filter((m) => m.platformType === 'allegro')`. |
| Why it was added | `// MVP` comment on line 109. |
| Type currently used in filter | `ExternalIdMapping` from `@openlinker/core/identifier-mapping`. Becomes unused once filter goes. |
| Existing test that asserts the filter | `'should filter to only Allegro mappings'` at spec line 138-177 — explicitly asserts an `amazon` mapping gets dropped. Needs to invert. |
| Handler structure | Two pre-existing short-circuits (no inventory at line 79, no mappings at line 97) cover the legitimate "skip" cases. The filter's matching short-circuit at line 112-117 becomes dead code once the filter is removed. |

## 3. Design

- Replace `const allegroMappings = mappings.filter(...)` with using `mappings` directly.
- Delete the "No Allegro offer mappings found" warn + early-return — already covered by the upstream "no offer mappings" branch.
- Update the success log's count source from `allegroMappings.length` to `mappings.length` (variable rename only — the log copy itself is already platform-agnostic).
- Drop the now-unused `ExternalIdMapping` import.

No user-facing log copy changes needed — every existing log line is already platform-neutral; only the deleted `'No Allegro offer mappings found...'` warn at line 113 disappears with its dead-code branch.

## 4. Steps

| # | File | Change | AC |
|---|---|---|---|
| 1 | `apps/worker/src/sync/handlers/inventory-propagate-to-marketplaces.handler.ts` | Drop filter + dead-code branch + unused `ExternalIdMapping` import. Variable rename `allegroMappings` → `mappings` in the iteration site and success log. | `pnpm type-check` clean; logic flow preserved. |
| 2 | `apps/worker/src/sync/handlers/__tests__/inventory-propagate-to-marketplaces.handler.spec.ts` | (a) Invert `'should filter to only Allegro mappings'` → `'should enqueue jobs for every offer mapping regardless of platform'`; assert both Allegro and non-Allegro mappings enqueue. (b) Extend the existing `'should handle multiple mappings'` to mix platforms across connections so the multi-mapping path explicitly exercises the capability-agnostic loop. | All specs green; multi-platform branch covered without leaving an outdated test name. |
| 3 | Quality gate | `pnpm lint && pnpm type-check && pnpm test` | Zero errors / failures. |
| 4 | Self-review + commit + PR | Conventional commit `fix(worker)` or `refactor(worker)`. | PR with `Closes #582`. |

## 5. Validate

- ✅ Hexagonal: change stays in `apps/worker/src/sync/handlers/`. No CORE / Integration / Interface change.
- ✅ Naming: no new files, no naming-convention drift.
- ✅ Logging: structured log strings updated to drop the platform-specific noun.
- ✅ Tests: invert one spec, add one new case for multi-platform. Mocks the port `IIdentifierMappingService` (per `code-review-guide.md §Mocking Ports`).
- ✅ Security: no new input surface, no secret handling.
- ✅ Backwards compat: connections that today only have Allegro mappings see identical behavior. Connections with non-Allegro mappings (Amazon/Shopify/plugin) now also receive quantity-update jobs — this is the behavior the issue says they *should* have had all along. Allegro is currently the only `OfferManager` adapter (per `architecture-overview.md §6`), so non-Allegro `Offer` rows shouldn't exist on any production connection. **PR description should call this out** so reviewers can sanity-check their own dev/staging envs (a stray Shopify-prototype `Offer` row from an exploration branch would suddenly enqueue dead jobs that fail downstream when the Shopify adapter isn't registered).

## 6. AC mapping

| Issue AC | Met by |
|---|---|
| Drop the filter | Step 1 |
| Per-platform behaviour stays in the adapter | Already true downstream; handler now hands jobs to the adapter unconditionally. |
| Capability check handled by per-connection metadata or `OfferManagerPort` guard | Downstream `marketplace.offerQuantity.update` runner handles this; this PR doesn't add a redundant check. |
