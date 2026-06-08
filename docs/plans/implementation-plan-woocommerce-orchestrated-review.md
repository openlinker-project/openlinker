# Implementation Plan: WooCommerce — Orchestrated Review + Fix + Rebase Session

**Date**: 2026-06-05  
**Status**: Ready for Execution  
**Estimated Effort**: 3–5 hours across 5 sequential phases

---

## 1. Task Summary

**Objective**: Run a comprehensive, multi-agent orchestrated session over all 7 open WooCommerce PRs — tech-review, security-review, fix all findings, rebase onto up-to-date parent branches, and force-push — so every PR is green, rebased, and conflict-free before merge review.

**PRs in scope:**

| Branch | PR | Description | Base |
|---|---|---|---|
| `873-woocommerce-plugin-scaffold` | #947 | Plugin scaffold, connection, credentials, tester | main |
| `874-woocommerce-product-master-read` | #958 | ProductMasterPort read capability | main |
| `878-woocommerce-e2e-docker` | #972 | E2E integration tests + Dockerized dev stack | main |
| `879-woocommerce-product-master-write` | #959 | ProductMasterPort write capability | 874 |
| `876-woocommerce-order-source-port` | #960 | OrderSourcePort | 874 |
| `875-woocommerce-inventory-master-port` | #969 | InventoryMasterPort | 879 |
| `877-woocommerce-order-processor` | #970 | OrderProcessorManagerPort + auth failure classifier | 875 |

**Dependency chain** (rebase order):

```
main ← 873
main ← 874 ← 879 ← 875 ← 877
         ↑
        876
main ← 878
```

---

## 2. Operational Constraints (Non-Negotiable)

| Constraint | Detail |
|---|---|
| **No full test suite** | `pnpm test` causes BSOD. Only run `pnpm --filter @openlinker/integrations-woocommerce test --passWithNoTests` |
| **No hooks on commit** | `git commit -s --no-verify` on all commits |
| **Force push** | `git push --force-with-lease` (never `--force`) |
| **SSH key** | `~/.ssh/blocky` with passphrase `123123123` — must be loaded before push wave |
| **No full lint** | Do not run `pnpm lint` or `pnpm type-check` across the full monorepo |
| **Worktrees** | All 7 already exist at `.claude/worktrees/{name}/` — do not `git worktree add` |
| **Commits** | All use `-s` (DCO sign-off) + `--no-verify` |

**SSH load command** (run before Phase 5):
```bash
eval $(ssh-agent -s)
cat > /tmp/askpass.sh << 'EOF'
#!/bin/bash
echo '123123123'
EOF
chmod +x /tmp/askpass.sh
SSH_ASKPASS=/tmp/askpass.sh SSH_ASKPASS_REQUIRE=force ssh-add ~/.ssh/blocky
```

---

## 3. Worktree & Branch Reference

| Worktree dir | Branch name | Remote branch |
|---|---|---|
| `.claude/worktrees/873-woocommerce-plugin-scaffold` | `873-woocommerce-plugin-scaffold` | `origin/873-woocommerce-plugin-scaffold` |
| `.claude/worktrees/874-woocommerce-product-master-read` | `874-woocommerce-product-master-read` | `origin/874-woocommerce-product-master-read` |
| `.claude/worktrees/875-woocommerce-inventory-master` | `875-woocommerce-inventory-master-port` | `origin/875-woocommerce-inventory-master-port` |
| `.claude/worktrees/876-woocommerce-order-source` | `876-woocommerce-order-source-port` | `origin/876-woocommerce-order-source-port` |
| `.claude/worktrees/877-woocommerce-order-processor` | `877-woocommerce-order-processor` | `origin/877-woocommerce-order-processor` |
| `.claude/worktrees/878-woocommerce-e2e-docker` | `878-woocommerce-e2e-docker` | `origin/878-woocommerce-e2e-docker` |
| `.claude/worktrees/879-woocommerce-product-master-write` | `879-woocommerce-product-master-write` | `origin/879-woocommerce-product-master-write` |

**Getting the diff for a branch** (base-aware, filters to WC package):
```bash
# For 874 (base = main):
git diff origin/main...origin/874-woocommerce-product-master-read -- libs/integrations/woocommerce/

# For 879 (base = 874):
git diff origin/874-woocommerce-product-master-read...origin/879-woocommerce-product-master-write -- libs/integrations/woocommerce/

# For 876 (base = 874):
git diff origin/874-woocommerce-product-master-read...origin/876-woocommerce-order-source-port -- libs/integrations/woocommerce/

# For 875 (base = 879):
git diff origin/879-woocommerce-product-master-write...origin/875-woocommerce-inventory-master-port -- libs/integrations/woocommerce/

# For 877 (base = 875):
git diff origin/875-woocommerce-inventory-master-port...origin/877-woocommerce-order-processor -- libs/integrations/woocommerce/

# For 873 (base = main):
git diff origin/main...origin/873-woocommerce-plugin-scaffold -- libs/integrations/woocommerce/

# For 878 (base = main):
git diff origin/main...origin/878-woocommerce-e2e-docker -- libs/integrations/woocommerce/
```

---

## 4. Pre-flight Checks

Before starting any phase, confirm state:

```bash
# Confirm all worktrees are clean (no uncommitted changes)
for wt in 873-woocommerce-plugin-scaffold 874-woocommerce-product-master-read \
           875-woocommerce-inventory-master 876-woocommerce-order-source \
           877-woocommerce-order-processor 878-woocommerce-e2e-docker \
           879-woocommerce-product-master-write; do
  STATUS=$(git -C .claude/worktrees/$wt status --short 2>/dev/null)
  echo "$wt: ${STATUS:-CLEAN}"
done
```

Known state (2026-06-05):
- **875** — clean; SSRF fix `fce9f492` already pushed
- **877** — clean; auth classifier spec `a3bb2c5c` already pushed
- **All others** — assumed clean (verify before starting)

---

## 5. Phase 1 — Tech-Review Wave (7 parallel agents)

Spawn 7 independent `tech-review` agents, one per PR. Each agent:
1. Gets the branch diff against its base (command above)
2. Reviews against `docs/code-review-guide.md` + architecture standards
3. Outputs a structured report: **BLOCKING** / **IMPORTANT** / **SUGGESTION** / **PASS**

### Agent prompts

**Agent 873:**
```
Tech-review for PR #947 (branch 873-woocommerce-plugin-scaffold, base main).

Diff command: git diff origin/main...origin/873-woocommerce-plugin-scaffold -- libs/integrations/woocommerce/

Review criteria (from docs/code-review-guide.md and docs/engineering-standards.md):
- Plugin SDK contract: AdapterPlugin, manifest, createCapabilityAdapter, register(host) — correct shape?
- WooCommerce credentials DTO: field names, class-validator decorators, no sensitive fields exposed
- Connection config validator: SSRF guard (IsSsrfSafeUrlConstraint), HTTPS enforcement
- Connection tester: timeout handling, error classification, correct exception types
- Naming conventions: adapter files, port files, class names match {Platform}{Capability}Adapter pattern
- No any types, no console.log, Logger from @openlinker/shared/logging
- Barrel exports: woocommerce/index.ts exports correct symbols (manifest, plugin factory, no runtime leaks)
- File headers on all source files

Rate each finding BLOCKING / IMPORTANT / SUGGESTION. List file:line for each.
```

**Agent 874:**
```
Tech-review for PR #958 (branch 874-woocommerce-product-master-read, base main).

Diff command: git diff origin/main...origin/874-woocommerce-product-master-read -- libs/integrations/woocommerce/

Review criteria:
- ProductMasterPort compliance: getProduct, getProducts, getProductVariants, searchProducts — correct signatures?
- WooCommerce API mapping: product fields → OL Product entity (id, name, sku, variants)
- IdentifierMappingService usage: getOrCreateInternalId called with connectionId (not platformType)
- Variant mapping: WC variations → ProductVariant, synthetic variant for simple products
- Error handling: WooCommerce HTTP errors → domain exceptions, no TypeORM/axios leaks
- HTTP client: uses WooCommerceHttpClient (Axios-based), not raw fetch
- No any types, proper null handling
- Unit tests: mock WooCommerceHttpClient + IdentifierMappingPort, cover happy path + not-found

Rate each finding BLOCKING / IMPORTANT / SUGGESTION. List file:line for each.
```

**Agent 878:**
```
Tech-review for PR #972 (branch 878-woocommerce-e2e-docker, base main).

Diff command: git diff origin/main...origin/878-woocommerce-e2e-docker -- libs/integrations/woocommerce/ docker-compose.yml

Review criteria:
- docker-compose additions: WooCommerce + MySQL services, health checks, correct env vars
- E2E seed script: uses bitnami/wordpress:latest (not pinned), jq replaced with python3 (fragile?)
- Integration test (*.int-spec.ts): uses Testcontainers or the dev-stack? Must not mock the WC API
- Test harness: resetTestHarness() between tests, uses real containers
- No secrets or credentials committed
- Any hardcoded timeouts that will be flaky in CI?
- Does the docker-compose addition conflict with the existing stack (port collisions)?

Rate each finding BLOCKING / IMPORTANT / SUGGESTION. List file:line for each.
```

**Agent 879:**
```
Tech-review for PR #959 (branch 879-woocommerce-product-master-write, base 874-woocommerce-product-master-read).

Diff command: git diff origin/874-woocommerce-product-master-read...origin/879-woocommerce-product-master-write -- libs/integrations/woocommerce/

Review criteria:
- ProductMasterPort write: createProduct, updateProduct, deleteProduct, upsertProductVariant — correct signatures?
- Upsert logic: update path uses existing.id (confirmed fixed in e540e158), variation-PUT-404 handled
- ID resolution: internalId → externalId via getExternalIds before WC API calls
- No synchronize:true TypeORM patterns (no ORM entities here, but double-check)
- Error handling: duplicate product, product-not-found, variant-not-found
- Unit test coverage: create, update, delete, upsert happy path + error paths

Rate each finding BLOCKING / IMPORTANT / SUGGESTION. List file:line for each.
```

**Agent 876:**
```
Tech-review for PR #960 (branch 876-woocommerce-order-source-port, base 874-woocommerce-product-master-read).

Diff command: git diff origin/874-woocommerce-product-master-read...origin/876-woocommerce-order-source-port -- libs/integrations/woocommerce/

Review criteria:
- OrderSourcePort compliance: listOrderFeed(input) + getOrder({externalOrderId}) — correct signatures?
- Cursor: opaque string (date_upd watermark for WC), null = start from beginning
- Feed items: externalOrderId, eventKey, occurredAt — all present?
- IncomingOrder mapping: all required fields on IncomingOrder (buyer, lineItems, addresses)
- No identifier mapping in adapter — per architecture, that happens in OrderIngestionService
- SSRF guard: connection URL validated at config time (not in each request)
- lazy capability factories: confirmed in refactor commit (97770eaf)
- normGmt utility: moved to infrastructure/utils
- Unit tests: mock HTTP client, cursor pagination test

Rate each finding BLOCKING / IMPORTANT / SUGGESTION. List file:line for each.
```

**Agent 875:**
```
Tech-review for PR #969 (branch 875-woocommerce-inventory-master-port, base 879-woocommerce-product-master-write).

Diff command: git diff origin/879-woocommerce-product-master-write...origin/875-woocommerce-inventory-master-port -- libs/integrations/woocommerce/

Review criteria:
- InventoryMasterPort compliance: getInventory(productId), listInventory(productId) — per-variant stock?
- Variant-keyed stock: adapter should emit one Inventory per WC variation, resolving each variation to its ProductVariant
- Simple product: emits one Inventory keyed to the product's synthetic variant
- variantId on Inventory: must be populated (not null) when variant is known
- SSRF hardening: normaliseToIpv4 added in fce9f492 — verify it handles decimal-integer and octal-octet forms
- DTO spec file: woocommerce-connection-config.dto.spec.ts — 9 test cases including decimal-integer and octal SSRF bypass forms
- Unit tests: inventory adapter mocks, per-variant mapping, simple-product synthetic variant

Rate each finding BLOCKING / IMPORTANT / SUGGESTION. List file:line for each.
```

**Agent 877:**
```
Tech-review for PR #970 (branch 877-woocommerce-order-processor, base 875-woocommerce-inventory-master-port).

Diff command: git diff origin/875-woocommerce-inventory-master-port...origin/877-woocommerce-order-processor -- libs/integrations/woocommerce/

Review criteria:
- OrderProcessorManagerPort compliance: createOrder, updateOrderStatus, cancelOrder, processReturn
- WooCommerceAuthFailureClassifierAdapter: implements AuthFailureClassifierPort correctly?
  - Returns true ONLY for WooCommerceUnauthorizedException and WooCommerceAuthFailureException
  - Returns false for WooCommerceOrderProcessingException (this was Piotr's specific ask)
  - Returns false for WooCommerceResourceNotFoundException
- Auth failure unit test: spec file exists at src/infrastructure/adapters/__tests__/woocommerce-auth-failure-classifier.adapter.spec.ts (added in a3bb2c5c)
- Order fulfillment updater: if present, correct sub-capability pattern
- Error hierarchy: domain exceptions extend Error, have captureStackTrace

Rate each finding BLOCKING / IMPORTANT / SUGGESTION. List file:line for each.
```

### Output format for each agent

```
## Tech-Review: PR #{n} — {branch-name}

### BLOCKING
- [ ] {file}:{line} — {description}

### IMPORTANT  
- [ ] {file}:{line} — {description}

### SUGGESTION
- [ ] {file}:{line} — {description}

### PASS (no issues)
- {area} — looks good
```

---

## 6. Phase 2 — Security-Review Wave (7 parallel agents)

Spawn 7 independent security-focused agents, one per PR. Each agent reviews **only** the security posture of its branch's diff.

### Common security checklist per agent

For each branch, check:
1. **SSRF** — connection URL validated with IsSsrfSafeUrlConstraint + HTTPS enforcement
2. **Credential exposure** — no secret fields returned in API responses; credentials accessed only via credentialsResolver
3. **Input validation** — DTOs have class-validator decorators; no user-controlled strings interpolated into URLs or SQL
4. **HTTP client** — uses WooCommerceHttpClient (Axios-based with auth); never raw string-concatenated URLs
5. **Error messages** — no internal stack traces or credentials leaked in error responses
6. **Secret storage** — credentials in encrypted integration_credentials table; no hardcoding
7. **Auth failure classification** — WooCommerceAuthFailureClassifierAdapter registered so 401/403 triggers connection re-auth

**Agent prompt template:**
```
Security review for PR #{n} (branch {branch-name}, base {base-branch}).

Diff command: git diff origin/{base}...origin/{branch} -- libs/integrations/woocommerce/

Security focus areas:
1. SSRF: Is IsSsrfSafeUrlConstraint applied to siteUrl? Does it block private ranges (RFC-1918, link-local, loopback except localhost)?
2. Credential exposure: Are consumerKey/consumerSecret ever logged or returned in API responses?
3. HTTP requests: Are all outbound WC requests routed through WooCommerceHttpClient (which adds Basic Auth header via credentialsResolver)? No ad-hoc fetch/axios calls with inline creds?
4. Input handling: Is any user-supplied data interpolated into URL paths or query strings without encoding?
5. Error handling: Do catch blocks return sanitised errors? No stack traces or credential values in 4xx/5xx responses?
6. Dependency security: Any new npm dependencies added in package.json? If so, what are they and why?

Rate each finding CRITICAL / HIGH / MEDIUM / LOW. List file:line. Include a recommended fix for CRITICAL/HIGH.
```

---

## 7. Phase 3 — Fix Wave (sequential, dependency order)

After phases 1 and 2 complete, synthesise the findings and fix all **BLOCKING** (from tech) and **CRITICAL/HIGH** (from security) findings.

### Dependency order for fixes

```
Round A (parallel): 873, 874, 878  — these are on main, independent
Round B (parallel): 879, 876       — both on 874 (must wait for 874 fixes)
Round C (serial):   875            — on 879 (must wait for 879 fixes)
Round D (serial):   877            — on 875 (must wait for 875 fixes)
```

### Fix protocol per branch

For each branch needing fixes:

```bash
# Working directory: .claude/worktrees/{wt-dir}/
# 1. Make the fix in the relevant files
# 2. Run the quality gate:
pnpm --filter @openlinker/integrations-woocommerce test --passWithNoTests
# 3. Commit:
git add -A
git commit -s --no-verify -m "fix(woocommerce): {concise description} (#{issue-number})"
```

### Known pre-existing fixes (do NOT re-implement)

- **875** — SSRF normaliseToIpv4 fix + 9 spec cases: `fce9f492` — **already done**
- **877** — auth failure classifier spec: `a3bb2c5c` — **already done**

### Fix scope per branch

**873 fixes** (plugin scaffold):
- Address any BLOCKING/IMPORTANT from tech review
- Common expected issues: missing file headers, credential error aggregation edge cases

**874 fixes** (ProductMaster read):
- Address any BLOCKING/IMPORTANT from tech review
- Common expected issues: identifier mapping connectionId vs platformType mix-up, variant mapping

**878 fixes** (E2E + Docker):
- Address any BLOCKING/IMPORTANT from tech review
- Common expected issues: hardcoded timeouts, port collision in docker-compose, jq vs python3 seed script fragility

**879 fixes** (ProductMaster write):
- Address any BLOCKING/IMPORTANT from tech review
- The upsert `existing.id` fix is already in `e540e158` — do not re-fix

**876 fixes** (OrderSource):
- Address any BLOCKING/IMPORTANT from tech review

**875 fixes** (InventoryMaster):
- Already fully fixed — if new issues found, apply them here

**877 fixes** (OrderProcessor):
- Auth classifier spec already done — apply any remaining BLOCKING/IMPORTANT

---

## 8. Phase 4 — Rebase Wave (sequential, dependency order)

After all fixes are committed, rebase each branch onto its updated parent.

### Rebase strategy

Use `git rebase` in each worktree. Prefer `--onto` when the parent branch has shifted.

**Round A — Rebase 873, 874, 878 onto origin/main** (can be done in parallel):

```bash
# 873
git -C .claude/worktrees/873-woocommerce-plugin-scaffold fetch origin
git -C .claude/worktrees/873-woocommerce-plugin-scaffold rebase origin/main

# 874
git -C .claude/worktrees/874-woocommerce-product-master-read fetch origin
git -C .claude/worktrees/874-woocommerce-product-master-read rebase origin/main

# 878
git -C .claude/worktrees/878-woocommerce-e2e-docker fetch origin
git -C .claude/worktrees/878-woocommerce-e2e-docker rebase origin/main
```

**Round B — Rebase 879 and 876 onto rebased 874** (after Round A completes; can be parallel):

```bash
# First push rebased 874 to origin (needed so 879/876 can fetch it)
# OR: rebase onto the LOCAL HEAD of the 874 worktree

# 879 (base = 874)
git -C .claude/worktrees/879-woocommerce-product-master-write rebase \
  --onto .claude/worktrees/874-woocommerce-product-master-read/HEAD \
  origin/874-woocommerce-product-master-read

# Simpler approach: rebase interactively onto the 874 worktree ref
# Option: push 874 first, then rebase others onto origin/874

# 876 (base = 874)
git -C .claude/worktrees/876-woocommerce-order-source rebase \
  --onto origin/874-woocommerce-product-master-read \
  origin/874-woocommerce-product-master-read  \
  876-woocommerce-order-source-port
```

> **Note on Round B approach**: The cleanest way is to push 874 after Round A rebase, wait for the push to complete, then rebase 879 and 876 onto the updated `origin/874-woocommerce-product-master-read`. This avoids local ref gymnastics.

**Recommended rebase sequence:**

```
Round A:  rebase 873 / 874 / 878 onto origin/main
Round A+: push 874 to origin (so 879/876 can rebase cleanly onto it)
Round B:  rebase 879 and 876 onto origin/874 (updated)
Round B+: push 879 to origin (so 875 can rebase cleanly onto it)
Round C:  rebase 875 onto origin/879 (updated)
Round C+: push 875 to origin (so 877 can rebase cleanly onto it)
Round D:  rebase 877 onto origin/875 (updated)
```

The early push of parent branches is needed so stacked children can fetch and rebase onto the latest parent state. It's a deliberate interleaving — we push partially to enable the next rebase tier.

### Conflict resolution

- Most conflicts will be in `libs/integrations/woocommerce/src/` — file-level additions that don't touch the same lines
- If `libs/integrations/woocommerce/package.json` or `tsconfig.json` conflicts: accept the later branch's version and verify both dependency sets are present
- After every rebase: run `pnpm --filter @openlinker/integrations-woocommerce test --passWithNoTests`

### Rebase conflict abort

```bash
# If rebase goes wrong:
git -C .claude/worktrees/{wt} rebase --abort
```

---

## 9. Phase 5 — Push Wave

### Step 1: Load SSH key

```bash
eval $(ssh-agent -s)
cat > /tmp/askpass.sh << 'EOF'
#!/bin/bash
echo '123123123'
EOF
chmod +x /tmp/askpass.sh
SSH_ASKPASS=/tmp/askpass.sh SSH_ASKPASS_REQUIRE=force ssh-add ~/.ssh/blocky
# Verify:
ssh-add -l
```

### Step 2: Force-push all 7 branches

Push in dependency order to avoid race conditions on stacked PRs:

```bash
# Round A: independent branches (can push in parallel)
git -C .claude/worktrees/873-woocommerce-plugin-scaffold push --force-with-lease origin 873-woocommerce-plugin-scaffold
git -C .claude/worktrees/874-woocommerce-product-master-read push --force-with-lease origin 874-woocommerce-product-master-read
git -C .claude/worktrees/878-woocommerce-e2e-docker push --force-with-lease origin 878-woocommerce-e2e-docker

# Round B: stacked on 874 (push after 874 is pushed)
git -C .claude/worktrees/879-woocommerce-product-master-write push --force-with-lease origin 879-woocommerce-product-master-write
git -C .claude/worktrees/876-woocommerce-order-source push --force-with-lease origin 876-woocommerce-order-source-port

# Round C: stacked on 879 (push after 879 is pushed)
git -C .claude/worktrees/875-woocommerce-inventory-master push --force-with-lease origin 875-woocommerce-inventory-master-port

# Round D: stacked on 875 (push after 875 is pushed)
git -C .claude/worktrees/877-woocommerce-order-processor push --force-with-lease origin 877-woocommerce-order-processor
```

### Step 3: Verify pushes

```bash
git fetch origin
for b in 873-woocommerce-plugin-scaffold \
          874-woocommerce-product-master-read \
          875-woocommerce-inventory-master-port \
          876-woocommerce-order-source-port \
          877-woocommerce-order-processor \
          878-woocommerce-e2e-docker \
          879-woocommerce-product-master-write; do
  LOCAL=$(git -C .claude/worktrees/$(echo $b | sed 's/-port//; s/-source-port$/-source/') rev-parse HEAD 2>/dev/null || echo "?")
  REMOTE=$(git rev-parse origin/$b 2>/dev/null || echo "MISSING")
  echo "$b: local=$LOCAL remote=$REMOTE match=$([ "$LOCAL" = "$REMOTE" ] && echo YES || echo NO)"
done
```

---

## 10. Verification Checklist

After Phase 5:

- [ ] All 7 branches pushed and confirmed on remote
- [ ] Each branch has its latest fix commits ahead of its base
- [ ] `pnpm --filter @openlinker/integrations-woocommerce test --passWithNoTests` passes in each worktree
- [ ] No merge conflicts in any branch (clean rebase)
- [ ] GitHub PRs show no "this branch has conflicts" warning
- [ ] SSRF fix (`fce9f492`) is in 875 ✓
- [ ] Auth classifier spec (`a3bb2c5c`) is in 877 ✓

---

## 11. Risks and Edge Cases

| Risk | Mitigation |
|---|---|
| Rebase conflicts in stacked branches | Work in strict dependency order; resolve at each tier before moving to next |
| SSH agent dies between phases | Keep session alive; reload with askpass script if needed |
| WC package test fails after rebase | Run quality gate after each rebase; fix before moving to next tier |
| `--force-with-lease` rejected (remote has newer commits) | Fetch first, check remote state, then push |
| Phase 3 fix introduces regression | Quality gate catches it; revert the fix commit and try again |
| Branch 878 docker-compose conflicts with existing stack | Port collision check: WC MySQL on 3307 (avoid 3306), WP on 8081 (avoid 80, 5173, 3000) |
| Review agents surface too many SUGGESTION items | Only fix BLOCKING + CRITICAL/HIGH in Phase 3; log SUGGESTION items for follow-up issues |

---

## 12. Scope Decisions

### In Scope
- Full tech + security review of all 7 PRs
- Fix all BLOCKING and CRITICAL/HIGH findings
- Rebase all branches to avoid future conflicts
- Force-push all branches

### Out of Scope
- IMPORTANT and SUGGESTION items — log them but do not fix in this session (create GitHub issues instead)
- Full monorepo lint/type-check (`pnpm lint`, `pnpm type-check`) — not run in this session
- Integration tests (`pnpm test:integration`) — require Docker, not run
- Opening new PRs — existing PRs #947–#972 are updated in-place via force-push
- Merging any PRs — that requires human review approval

---

## 13. Alignment Checklist

- [x] Follows hexagonal architecture — all changes within `libs/integrations/woocommerce/`
- [x] No CORE changes — ports already defined, adapters implement them
- [x] Quality gate scoped to WC package only
- [x] Commits use `-s` (DCO) + `--no-verify`
- [x] Push uses `--force-with-lease` (safe force push)
- [x] SSH key management documented
- [x] Dependency order respected in all phases
- [x] Previously-completed fixes (875 SSRF, 877 spec) preserved — not re-implemented

---

## Related Documentation

- [Architecture Overview — Plugin Manager](../architecture-overview.md#10-plugin-manager--integrations)
- [Engineering Standards — Testing](../engineering-standards.md#testing-standards)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- Previous fix plan: [implementation-plan-woocommerce-piotr-review-final-fixes.md](./implementation-plan-woocommerce-piotr-review-final-fixes.md)
