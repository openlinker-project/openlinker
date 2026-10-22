# Pre-implement gate: #2729 auto-dispatch operator surface

- **Plan**: `docs/plans/implementation-plan-2729-auto-dispatch-operator-surface.md`
- **Run**: 2026-10-22, against the worktree at `origin/main` 1ccce2197 (0.16.0)
- **Verdict**: **READY**, with the two plan adjustments in "Corrections to fold into the plan" (neither is a contract break)

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `planAutoDispatch` | NEW | no symbol of that name anywhere in `apps` / `libs`. Its parts exist and are reused: `resolveAutoDispatchParcel`, `mergeAutoDispatchParcelOptions`, `findMissingParcelRequirement`, `resolveOrderDispatchTarget` (`libs/core/src/shipping/domain/auto-dispatch.ts`) |
| `AutoDispatchTriggerValues` / `trigger` | NEW | `auto-dispatch.types.ts` has `enabled`, `parcelTemplate`, `defaultWeightGrams`, box fields only |
| `AutoDispatchPreviewService`, `auto-dispatch/refusals`, `auto-dispatch/preview` | NEW | no matches |
| Refusal read repository query | **EXISTS, reuse** | `SyncJobRepositoryPort.findMany(filters, pagination)` already filters by `connectionId`, `jobType`, `status`, `outcome` (`SyncJobFilters`). No new port method is needed. The `(connectionId, jobType, status, updatedAt)` index already exists |
| Refusal classification | PARTIAL | `AutoDispatchRefusalReasonValues` exists in `auto-dispatch.ts`; the classifier over `outcomeReason` is new |
| "Recent works assigned to a connection" (preview) | EXISTS, reuse | `IFulfillmentWorklistService.list` + `FulfillmentWorkListFilter.assignedConnectionId` (#2416) |
| Bench label route | NEW, no path collision | bench routes today: `POST work/:workId/label/replace`, `GET work/:workId/documents/label`, `/parcel`, `/claim`, `/complete`, etc. `POST work/:workId/label` is free |
| Enqueue from the API notifier | EXISTS | `JOB_ENQUEUE_TOKEN` is provided to the API by `CoreSyncModule` (used in `orders.module.ts`); `FulfillmentApiModule` must import it |
| Dispatch path for the bench route | EXISTS | `IShipmentDispatchService` (`SHIPMENT_DISPATCH_SERVICE_TOKEN`); `ShippingModule` is already imported by `bench-api.module.ts` |

## Backward-compat findings

**Critical**: none.

**Warnings**
1. **`AutoDispatchConfig` gains `trigger`.** It is a published type consumed by `fulfillment-work-dispatch.handler.ts`, `fulfillment-work-auto-dispatch.handler.ts`, `bench-label.service.ts`, `connection.service.ts`. Add it as REQUIRED on the resolved config with the `DISABLED` constant carrying `'on-accept'`, and fix the spec fixtures that build the type literally; or make it optional. Prefer required: an optional field invites call sites that forget the default.
2. **Write-path validation.** `ConnectionService.validateAutoDispatchConfig` (`connection.service.ts:479`) bounds-checks `config.autoDispatch` on create/update. It must reject an unknown `trigger` there too, or the form (#3572) and curl can persist a value the read coerces away silently. Reading is lenient (coerce + log); writing must be strict.
3. **Packer route list.** `apps/api/src/auth/packer-exclusion.spec.ts` enumerates routes that name `packer`. The new `POST /bench/work/:workId/label` must be added there deliberately (that is the guard working, not a defect). `route-authorization-coverage.spec.ts` will also require `@Roles(...)`.
4. **`check:invariants`.** The plan stays clear of `check-cross-context-imports` and of the `shipping -> products` cycle by passing weights as arguments. A mirror guard for the `trigger` union will be needed when #3572 adds the frontend copy; not in this slice.
5. **Handler refactor risk.** Extracting `planAutoDispatch` changes the handler's internals while its observable contract is the `outcomeReason` strings (`auto_dispatch_no_weight`, `..._no_address`, `..._no_dimensions`, `..._work_not_eligible`, `..._no_delivery_method`, `..._shipment_claimed_by_sibling_work`, `..._not_enabled`, `..._payload_invalid`) and the retry/terminal split. The existing handler spec must pass unchanged.

**No ORM or migration change**: the refusal read reuses `sync_jobs`, `trigger` lives in `connections.config` (jsonb), nothing is persisted by the preview.

## Corrections to fold into the plan

- Step 4 says "repository query". Replace with: call `findMany` twice, once for `outcome: 'business_failure'`, once for the retry ladder (`status: 'queued'`/`'dead'` rows carrying an error), and merge in the service. No port signature changes.
- Step 5: name the data source for "recent orders": `IFulfillmentWorklistService.list({ assignedConnectionId: [holder] })`.

## Open questions

1. `findMany` takes a single `status`; the retry-ladder read needs `queued` and `dead` separately (two calls) or an array filter. Prefer two calls (no port change).
2. Whether `dead` auto-dispatch jobs belong under "retrying automatically" or under "needs your input" (the ladder is exhausted, so an operator must act). Recommendation: `dead` is "needs your input", `queued`-with-attempts is "retrying".
