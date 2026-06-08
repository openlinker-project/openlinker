# Implementation Plan: WooCommerce PR Conflict Resolution

**Date:** 2026-06-08  
**Author:** Claude (Orchestrator)  
**Scope:** Fix merge conflicts and prepare all 8 WooCommerce feature PRs for merge  
**Status:** PLANNING

---

## 1. Understand the Task

### Goal
Resolve merge conflicts in 2 frontend/integration PRs, verify status of 6 remaining PRs, and prepare all 8 WooCommerce feature branches for merge into `main`.

### PRs Involved (Dependency Order)

```
Phase 1: Foundational (no conflicts expected)
├─ #947  [873] Plugin scaffold (UNKNOWN)
├─ #958  [874] ProductMasterPort read (UNKNOWN)
├─ #969  [875] InventoryMasterPort (UNKNOWN)
└─ #959  [876] OrderSourcePort (MERGEABLE)

Phase 2: Built on Phase 1
├─ #970  [877] OrderProcessorManagerPort (MERGEABLE)
└─ #960  [879] ProductMasterPort write (MERGEABLE)

Phase 3: Integration + Frontend
├─ #972  [878] E2E tests + Docker (CONFLICTING) ← Must rebase after Phase 1/2
└─ #1002 [975] Frontend plugin (CONFLICTING) ← Must rebase after Phase 1/2
```

### Classification
- **Layer:** CORE (integrations), Interface (Frontend)
- **Type:** Feature completions (WooCommerce adapter implementation)
- **Risk:** Medium — conflicts likely due to schema/core changes in Phase 1/2

### Non-Goals
- Implement new features
- Refactor existing code beyond conflict resolution
- Change PR scope or commits

---

## 2. Conflict Resolution Strategy

### Analysis
- **#1002 (Frontend):** Likely conflicts in component imports, state management, or API contract changes
- **#972 (E2E + Docker):** Likely conflicts in fixture data, test configuration, or docker-compose changes

### Root Cause
Both conflicting PRs depend on Phase 1/2 foundational changes (schema, ports, adapters). Conflicts arise because:
1. Phase 1/2 PRs already merged or are ahead in `main`
2. #1002 and #972 branches were created before Phase 1/2 completed
3. Both need rebase + manual conflict resolution

### Resolution Path
1. **Rebase** #1002 and #972 onto `origin/main` (after Phase 1/2 are merged)
2. **Resolve conflicts** manually by examining the diff and understanding the breaking changes
3. **Test** that resolution maintains functionality
4. **Force-push** (safe, because these are feature branches pre-merge)

---

## 3. Parallel Execution Plan

### Agent 1: Verify & Triage UNKNOWN PRs
- Check mergeable status of #969, #958, #947
- Inspect each for soft conflicts (indirect dependencies)
- Report: which can merge as-is, which need rebase

### Agent 2: Prepare #959, #960, #970 for Merge
- Verify they still pass tests post-rebase (if any rebase needed)
- Flag if any need rebase due to drift from `main`
- List in order for merge

### Agent 3: Rebase & Conflict-Resolve #972
- Fetch latest `main`
- Rebase `878-woocommerce-e2e-docker` onto `origin/main`
- Resolve merge conflicts (examine changes, keep/discard hunks)
- Re-run tests: `pnpm test:integration` to verify

### Agent 4: Rebase & Conflict-Resolve #1002
- Fetch latest `main`
- Rebase `975-woocommerce-frontend-plugin` onto `origin/main`
- Resolve merge conflicts (review API changes, component updates)
- Re-run tests: `pnpm test` to verify

### Merge Order (After Conflicts Fixed)
1. **#947** (scaffold, lowest risk) — no dependencies
2. **#958, #969** (product/inventory read, no other deps)
3. **#959, #876** (OrderSourcePort, foundational for downstream)
4. **#970, #877** (OrderProcessorManagerPort, builds on #959)
5. **#960, #879** (ProductMasterPort write, builds on #958)
6. **#972, #878** (E2E + Docker, builds on all above)
7. **#1002, #975** (Frontend plugin, final integration)

---

## 4. Implementation Steps

### Step 1: Inspect Remote & Local State
**File:** Git state inspection  
**Acceptance Criteria:**
- All branch tracking verified
- Latest `main` fetched
- Conflict types identified (schema, import, logic)

```bash
git fetch origin
git log --oneline -10 origin/main
for pr in 947 958 969 959 970 960 972 1002; do
  echo "=== PR #$pr ==="
  gh pr view $pr --json state,mergeable,mergeStateStatus
done
```

### Step 2: Agent-Based Parallel Processing

**Agent 1 — Triage** (`scope: #947, #958, #969`)
- Rebase each onto origin/main
- Check for soft conflicts (mismatched imports, API changes)
- Report mergeable status

**Agent 2 — Clean PRs** (`scope: #959, #960, #970`)
- Verify still mergeable post-fetch
- If drift detected, rebase and re-test
- Prepare merge checklist

**Agent 3 — #972 Conflict Resolution** (`scope: #878`)
- Rebase onto origin/main
- List conflict files
- Resolve each conflict (examine context, apply changes)
- Run `pnpm test:integration` to verify

**Agent 4 — #1002 Conflict Resolution** (`scope: #975`)
- Rebase onto origin/main
- List conflict files
- Resolve each conflict (check API compatibility)
- Run `pnpm test` to verify

### Step 3: Validation
**File:** Quality gate  
**Acceptance Criteria:**
- All conflicts resolved
- All tests pass in resolved branches
- No `<<<<<<` markers remain
- Force-push safe (branches not yet merged)

---

## 5. Validation & Risk

### Risks
- **Force-push complexity:** Ensure no accidental loss of commits
- **Test flakiness:** Integration tests may fail for environmental reasons
- **Hidden conflicts:** Indirect dependencies on modified imports

### Mitigation
- Verify each conflict resolution with `git diff origin/main..HEAD`
- Run full test suite (`pnpm test` + `pnpm test:integration`)
- Keep Agent 3/4 logs for manual review before final force-push

### Validation Checklist
- [ ] All 8 PRs have mergeable status
- [ ] No unresolved conflicts (`git status`)
- [ ] All tests pass
- [ ] Conventional commit message used
- [ ] No `any` types introduced
- [ ] No `console.log` left in code

---

## 6. Timeline & Deliverables

### Execution (Parallel, ~30 min)
1. **Triage phase** (5 min) — Agent 1 inspects unknown PRs
2. **Clean PRs phase** (5 min) — Agent 2 checks mergeable ones
3. **Conflict resolution phase** (15 min) — Agents 3 & 4 rebase/resolve in parallel
4. **Validation phase** (5 min) — All tests, report status

### Deliverable
- Merge-ready branches for all 8 PRs
- Conflict resolution summary (files changed, hunks resolved)
- Test results confirming functionality
- Ready to merge once CI passes

---

## Questions & Open Items

1. **Should we merge immediately after CI green, or wait for code review?**
   - Recommend: Merge in order after Norbert approves the conflict resolutions
2. **Any manual overrides or special handling for #1002 or #972?**
   - Will inspect and ask if unclear
3. **Test environment:** Are integration tests isolated (Testcontainers), or do they need the dev stack?
   - Will use Testcontainers; dev stack not required

