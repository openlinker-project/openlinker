# Pre-Implementation Analysis: pnpm 11 Compatibility (#867)

**Plan**: `docs/plans/implementation-plan-pnpm-11-compatibility.md`
**Gate run**: 2026-06-10
**Verdict**: **NEEDS-REVISION**

---

## Reuse Audit

This plan makes no new TypeScript artifacts (no ports, services, tokens, ORM entities, DTOs, or capabilities). All changes are to `package.json` and `tsconfig.build.json` files.

| Plan artifact | Status | Notes |
|---|---|---|
| `@openlinker/integrations-ai` dep in worker | NEW (confirmed absent) | Correct: not in `apps/worker/package.json` |
| `@openlinker/integrations-allegro` dep in worker | NEW (confirmed absent) | Correct: not in `apps/worker/package.json` |
| peerDeps in `libs/core`, `libs/integrations/ai`, `libs/integrations/allegro` | NEW (confirmed absent) | Correct |
| `cron` dep in `apps/api` | NEW (confirmed absent) | Correct |
| tsconfig.build.json path alias changes | CHANGE | See Critical-1 and Critical-2 below |

No reuse collision: nothing is being reinvented.

---

## Backward-Compatibility Findings

### CRITICAL-1 — Missing direct dep: `@openlinker/integrations-inpost`

**Surface**: `apps/worker/package.json` — direct dependencies  
**Finding**: `apps/worker/src/plugins.ts` imports **four** integration packages:

```
import { PrestashopIntegrationModule } from '@openlinker/integrations-prestashop'; // ✅ declared
import { AllegroIntegrationModule }    from '@openlinker/integrations-allegro';    // ❌ missing (plan fixes)
import { AiIntegrationModule }         from '@openlinker/integrations-ai';         // ❌ missing (plan fixes)
import { InpostIntegrationModule }     from '@openlinker/integrations-inpost';     // ❌ MISSING FROM PLAN
```

`@openlinker/integrations-inpost` is not declared in `apps/worker/package.json` and the plan does not add it. Under pnpm 11's strict resolution this produces the same TS2307 class of failure. The omission is silent — the plan's acceptance criteria (`pnpm --filter @openlinker/worker build` zero TS2307 errors) would still fail after applying the plan as written.

**Required fix**: Add `"@openlinker/integrations-inpost": "workspace:*"` to `apps/worker/package.json` dependencies alongside the two packages already in the plan.

---

### CRITICAL-2 — False premise: `apps/api/tsconfig.build.json` does NOT use `libs/*/dist`

**Surface**: `apps/worker/tsconfig.build.json` — Phase 2 rationale  
**Finding**: The plan states:

> `apps/api/tsconfig.build.json` already follows this pattern (pre-existing); `apps/worker/tsconfig.build.json` does not — it is the only one that needs the fix.

This is **incorrect**. `apps/api/tsconfig.build.json` currently uses **`libs/*/src` paths**, identical to `apps/worker/tsconfig.build.json`:

```json
"@openlinker/core": ["../../libs/core/src/index.ts"],
"@openlinker/core/*": ["../../libs/core/src/*"],
"@openlinker/integrations-allegro": ["../../libs/integrations/allegro/src/index.ts"],
"@openlinker/integrations-ai": ["../../libs/integrations/ai/src/index.ts"],
"@openlinker/integrations-inpost": ["../../libs/integrations/inpost/src/index.ts"],
...
```

Applying Phase 2 as described would **diverge** the worker from the established api pattern rather than align it. The premise that the api already uses `dist` is empirically false.

**Implication for Phase 2**: Sub-issue 3 (TS2307 cascade in the worker) is caused by *missing direct deps*, not by the `src`-alias pattern itself — the api builds fine with the same `src` pattern because it declares all integration packages as direct deps. Once Phase 1 (missing deps in `apps/worker/package.json`) and Phase 3 (lib peerDeps) are applied, sub-issue 3 should resolve without any tsconfig.build.json change.

**Required fix**: Either:
- **(Recommended)** Drop Phase 2 entirely. The `src` alias pattern is the established norm for both apps; switching only the worker creates an inconsistency. Sub-issue 3 is resolved by Phase 1 + Phase 3.
- **OR** apply Phase 2 to *both* `apps/worker/tsconfig.build.json` AND `apps/api/tsconfig.build.json` together as a separate, explicitly-scoped improvement (not required to close #867). If kept, Phase 2 must also add aliases for `@openlinker/integrations-inpost` (and `@openlinker/integrations-prestashop`) — the current plan only adds `integrations-ai`.

---

## Warnings

### WARNING-1 — `apps/worker/tsconfig.build.json` missing alias for `@openlinker/integrations-inpost`

If Phase 2 is retained, the plan's updated tsconfig.build.json adds aliases for `integrations-ai` (new) and changes existing `integrations-allegro` aliases, but does not add an alias for `@openlinker/integrations-inpost`. Any build that resolves the inpost module through tsc path-alias would fail.

---

### WARNING-2 — `libs/integrations/inpost` peerDeps hygiene not assessed

The plan audits four packages for missing peerDeps (`libs/core`, `libs/integrations/ai`, `libs/integrations/allegro`, `apps/api`). `libs/integrations/inpost` was not assessed. Confirmed it does not directly import `@nestjs/config`, `redis`, or `typeorm`, and its only peerDep is `@nestjs/common` — so no gap exists there today. Noting for completeness.

---

## Open Questions

None that block closing the revision. After the two Critical items are addressed, the plan is ready to implement.

---

## Summary

| Finding | Severity | Action |
|---|---|---|
| `@openlinker/integrations-inpost` missing from worker package.json | **Critical** | Add to plan Phase 1 |
| Phase 2 based on false "api uses dist" premise; would create divergence | **Critical** | Drop Phase 2, OR scope it as explicit dual-app improvement with all aliases complete |
| Worker tsconfig.build.json missing inpost alias (if Phase 2 retained) | Warning | Add alias in Phase 2 |
| `libs/integrations/inpost` peerDeps — no gap found | Info | No action |
