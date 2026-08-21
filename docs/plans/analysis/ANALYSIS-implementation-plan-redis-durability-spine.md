# Pre-implement gate — `implementation-plan-redis-durability-spine`

- **Plan**: `docs/plans/implementation-plan-redis-durability-spine.md`
- **Issues**: #2163 (retention), #2165 (ADR-049) — PR 1 scope. #2164 gated separately as PR 2.
- **Date**: 2026-08-20
- **Gate**: read-only. No source or plan file was edited.

## Verdict: `READY` (re-gated 2026-08-20)

**First pass: `NEEDS-REVISION`.** Both required amendments were applied to the plan and re-verified;
the findings below are retained as the record of what was fixed and why.

| Finding | Resolution |
|---|---|
| CRITICAL-1 | Plan §3.3 now labels the barrel removal as a Critical-class published-surface change and records the zero-external-consumer verification. Re-confirmed at re-gate: grep for `SYNC_JOBS_EVENT_STREAM` outside `libs/core/src/sync` returns nothing. |
| CRITICAL-2 | Plan §3.3 now covers the `EventsModule` removal from `sync.module.ts`; §4 gains steps **14a** (module) and **14b** (§ Cross-context dependencies + mermaid edge). Re-confirmed: `EVENT_PUBLISHER_TOKEN` appears in `libs/core/src/sync` only in the bulk-retry service and its spec. |
| WARNING-1 | Plan §3.1 records that the barrel is already Nest-coupled and plugin-facing, so no new coupling is added; the new file is written dependency-free with a header saying so. |
| WARNING-2 | Plan §3.5 now states the `check-repo-urls.mjs` constraint for ADR links. |
| Open question 1 | Answered: remove the dead `EventsModule` import (step 14a). |

## Original verdict: `NEEDS-REVISION`

No reuse collisions — every artifact the plan proposes to create is confirmed absent. But the plan
takes one **Critical** contract-surface action (removing an exported symbol from a top-level barrel)
without labelling it as such, and misses a **knock-on dependency-edge change** that the same removal
causes. Both are cheap to fix in the plan; neither invalidates the design.

---

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `libs/shared/src/redis/stream-retention.ts` | **NEW — confirmed absent** | Repo-wide grep for `stream-retention` / `streamTrim` / `resolveStreamMaxLen` returns only the local `STREAM_MAXLEN` map at `redis-streams-event-publisher.ts:25,58`. No shared retention module exists. |
| `REDIS_STREAM_NAMES` registry | **PARTIAL — consolidates two existing constants** | `MASTER_DELETION_EVENT_STREAM` (`products/domain/types/master-deletion-events.types.ts:29`) and `SYNC_JOBS_EVENT_STREAM` (`sync/domain/types/sync-job.types.ts:305`) already exist; six other names are private literals. Plan correctly leaves the first in place with a drift spec. |
| `resolveStreamMaxLen` / `streamTrimOptions` | **NEW — confirmed absent** | No hits. |
| `libs/shared/src/redis/stream-consumer.ts` (PR 2) | **NEW — confirmed absent** | No `resolveConsumerName` / `consumer-name` hits anywhere. |
| Retention policy home (`libs/shared/src/redis`) | **EXISTS — correct reuse** | Directory exists with `redis-config.module.ts`; `@openlinker/shared/redis` is already a declared package export. No packaging change needed. |
| ADR number 049 | **FREE** | `ls docs/architecture/adrs/` shows no `048`, `049`, or `05x` file. Consistent with the epic's reallocation comment. |
| `@openlinker/shared` dependency from `libs/core` | **ALREADY DECLARED** | `libs/core/package.json:205`. `check-workspace-dep-declarations.mjs` will pass with no manifest edit. Same for `apps/api` and `apps/worker`. |

**No reuse collision.** The plan does not reinvent anything.

---

## Backward-compatibility findings

### CRITICAL-1 — removing `SYNC_JOBS_EVENT_STREAM` deletes a symbol from a published top-level barrel

`libs/core/src/sync/index.ts:65` exports `SYNC_JOBS_EVENT_STREAM` from `@openlinker/core/sync`. Plan
step 9 removes it. By the gate's own table, *"is an exported symbol removed/renamed?"* on a top-level
barrel is **Critical** — that barrel is the contract surface plugins consume, and an out-of-tree
plugin could import it.

**Mitigating evidence (verified):** every in-repo consumer is inside the owning context —
`sync-job-bulk-retry.service.ts:20`, its spec at `:19`, and the definition itself. **Zero consumers
outside `libs/core/src/sync`.** No plugin, no app, no sibling context imports it.

**This is not a reason to keep the stream** — #2163's acceptance criterion explicitly requires
`events.sync.jobs` to be *"either consumed or removed"*, and removal is the right call for a
write-only stream. The finding is that the plan treats this as a routine deletion when it is a
deliberate public-surface removal.

**Required plan amendment:** state explicitly that this removes a symbol from the
`@openlinker/core/sync` published barrel, record the zero-external-consumer verification, and call it
out in the PR body so a reviewer weighs it rather than skims it.

### CRITICAL-2 — the removal severs the last `sync → events` runtime edge, which the plan does not account for

`SyncJobBulkRetryService` is the **only** consumer of `EVENT_PUBLISHER_TOKEN` in the entire
`libs/core/src/sync` context (verified by grep). Removing its `publish` call means:

1. `sync.module.ts:12,59` imports and registers `EventsModule` **solely** to satisfy this one
   injection. After the change that import is dead weight — either remove it or document why it stays.
2. `docs/architecture-overview.md` § Cross-context dependencies carries a `sync --> events` edge in
   its mermaid map. That edge becomes **stale** (only a `*.module.ts` import would remain, and if
   that is also removed, the edge disappears entirely).

Plan step 14 only commits to updating **§ Data Flow**. The dependency map is a different section and
is explicitly listed in the epic's own acceptance criteria (*"§ Cross-context dependencies and
§ Data Flow updated"*).

**Required plan amendment:** extend step 9 to cover the `sync.module.ts` `EventsModule` import, and
extend step 14 to cover § Cross-context dependencies and its mermaid map.

### WARNING-1 — the retention module inherits the barrel's NestJS coupling

`libs/shared/src/redis/index.ts` currently exports only `RedisConfigModule`, which imports
`@nestjs/common`, `@nestjs/config`, and `redis` (`redis-config.module.ts:12-15`). Adding a pure
constants module to that barrel means every consumer of `streamTrimOptions` transitively loads a
NestJS module file.

**Assessed as acceptable, not a blocker.** The barrel is *already* plugin-facing and *already*
Nest-coupled — `libs/plugin-sdk/src/rate-limit.module.ts:51` and
`libs/integrations/prestashop/src/prestashop-integration.module.ts:74` both import it today. Adding a
leaf constants file introduces **no new coupling**. The alternative (a dedicated
`@openlinker/shared/redis-streams` subpath) would require a `package.json` `exports` entry and a
tsconfig edit for a benefit that does not currently exist.

Worth one sentence in the module header noting the file is intentionally dependency-free so it can be
split to its own subpath later without a consumer change.

### WARNING-2 — `check:invariants` surface

Reviewed the 20-script chain at `package.json:29`. Assessment:

- `check-cross-context-imports.mjs` — walks `@openlinker/core/<ctx>` imports only. `@openlinker/shared/redis` is out of scope. **No trip.**
- `check-workspace-dep-declarations.mjs` — all three importing packages already declare `@openlinker/shared`. **No trip.**
- `check-service-interfaces.mjs` — `SyncJobBulkRetryService implements ISyncJobBulkRetryService` (`:25`) is unaffected by removing a method body's publish call. **No trip.**
- `check-repo-urls.mjs` — ADR-049 must use bare `#NNN` and relative links, never full GitHub URLs. **Live risk for the ADR**; the template already states the rule.
- `check-nul-bytes.mjs` — no binary content planned. **No trip.**

### NOT-A-FINDING — the health-check write site

`apps/api/src/health/dev-stack-health.service.ts:154` already passes
`{TRIM:{strategy:'MAXLEN',strategyModifier:'~',threshold:1}}`. The plan correctly identifies this as
the existing precedent rather than a defect, and correctly leaves the literal `1` in place.

---

## Open questions

1. **Should `sync.module.ts` keep its `EventsModule` import?** Removing it is cleaner but is a
   module-graph change beyond the letter of #2163. Recommendation: remove it and say so in the PR
   body — a module import that satisfies no injection is exactly the kind of stale edge this epic
   exists to clean up.
2. **ADR-049's index row ordering.** The plan correctly adds only its own row and leaves the
   reserved-numbers note to the #2166 branch. If #2166 has **not** merged when this PR opens, the
   README will show a gap at 048 and a stale *"Allocate 048 for the next new ADR"* sentence
   contradicting a present 049 row. Decide whether to accept the transient inconsistency (fine — the
   note already documents that gaps are deliberate) or to wait on #2166.
3. **Retention values are unmeasured.** 50_000 / 100_000 / 10_000 are reasoned but not derived from
   observed throughput (#1134 does not exist). Acceptable for a bound whose purpose is to prevent
   unbounded growth, but the ADR should note them as revisable.

---

## Summary

The design is sound and collides with nothing. Two required plan amendments before coding: (1) label
the `SYNC_JOBS_EVENT_STREAM` barrel removal as the deliberate public-surface change it is, with the
zero-external-consumer verification recorded; (2) extend scope to the now-dead `EventsModule` import
in `sync.module.ts` and to § Cross-context dependencies in the architecture overview. Both are
plan-text changes, not design changes.
