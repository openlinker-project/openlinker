# Implementation Plan: Fix Onboarding Documentation Gaps (#1092)

**Date**: 2026-06-17
**Status**: Ready for Review
**Estimated Effort**: ~1 hour
**Issue**: [#1092](https://github.com/openlinker-project/openlinker/issues/1092)

---

## 1. Task Summary

**Objective**: Fix six confirmed documentation gaps (N3, N4, N5, N6, N7, N9) that cause contributors
to hit broken setups on a fresh checkout, partially closing the #856 onboarding audit.

**Context**: All six gaps were verified against the live codebase. They break the quickstart path
in a way that produces either a silent failure (missing tables, wrong port) or confusing state
(stale env vars that no longer exist in `.env.example`). All fixes are doc-only — no code, schema,
or ports are touched.

**Classification**: Documentation / DX

---

## 2. Scope & Non-Goals

### In Scope

- `README.md` — Quickstart block (lines 221–231)
- `CONTRIBUTING.md` — Setup Checklist (line 14) and Development Setup section (lines 49, 72)
- `docs/dev-environment.md` — lines 373–383 (stale PrestaShop env vars)
- `apps/worker/.env.example` — append `OL_CUSTOMER_IDENTITY_MODE` commented entry at end of file

### Out of Scope

- N1, N2, N8 (separate issues from the #856 audit — not part of this PR)
- Any code changes, schema migrations, or port modifications
- `docs/getting-started.md` (already correct; not modified here)
- `apps/api/.env.example` (already correct; not modified here)
- `apps/web/.env.example` (already correct, ships safe defaults; only referenced, not modified)

### Constraints

- No code changes — doc/example files only
- Must match current codebase reality: `apps/web/vite.config.ts:7` sets `port: 4173`; NestJS
  ConfigModule convention is `.env.local`; PrestaShop credentials live in the DB via Connections UI

---

## 3. Architecture Mapping

**Target Layer**: DX / Documentation (no code layers touched)

**Capabilities Involved**: N/A

**Existing Services Reused**: N/A

**New Components Required**: None

**Core vs Integration Justification**: Not applicable — doc-only changes.

**Reference**: Gaps were verified against
[`apps/web/vite.config.ts:7`](../apps/web/vite.config.ts),
[`apps/api/.env.example:124`](../apps/api/.env.example),
[`docs/migrations.md`](./migrations.md), and
[`docs/architecture-overview.md § Customers`](./architecture-overview.md#5-customers).

---

## 4. External / Domain Research

### Internal Patterns

- `apps/worker/.env.example:1-7` already documents the `.env.local` copy convention in its own
  header comment (`cp apps/worker/.env.example apps/worker/.env.local`) — the fix aligns
  README.md/CONTRIBUTING.md with that convention.
- `docs/getting-started.md` already uses `.env.local` as the copy target for the API; the CONTRIBUTING.md fix closes the inconsistency.
- `apps/api/.env.example:124` documents `OL_CUSTOMER_IDENTITY_MODE=email_fallback` with a comment
  explaining modes. The worker entry should mirror the same comment style.
- CONTRIBUTING.md lines 16 and 62 already include `pnpm --filter @openlinker/api migration:run`;
  only README.md is missing it (N4 fix scope is README.md only).

---

## 5. Questions & Assumptions

### Open Questions

- None. All six gaps were confirmed against the live codebase before this plan was written.

### Assumptions

1. The `apps/web/.env.example` note in README.md should be a code comment (`#`) rather than a
   prose line, to stay visually consistent with the bash block.
2. The comment style for `OL_CUSTOMER_IDENTITY_MODE` in `apps/worker/.env.example` should match
   existing commented-out vars in the file (prefixed with `# `, value shown as default with a
   `# OL_..=` pattern, comment block above).
3. `docs/dev-environment.md:373` — the full paragraph from "Update `apps/api/.env` with
   PrestaShop settings:" through the closing `> **Note**: These settings are placeholders…` note is
   replaced. The H3 section header ("### API Configuration", line 371) and the text on line 373 are
   both part of the stale block and are replaced together.
4. CONTRIBUTING.md line 72 (`pnpm start:dev:web      # React frontend on :5173`) is also fixed to
   `:4173` (same N3 gap, second occurrence in that file).

### Documentation Gaps

- None that affect this PR. `docs/getting-started.md` already reflects the current reality and is
  not touched here.

---

## 6. Proposed Implementation Plan

### Phase 1: README.md — Quickstart block

**Goal**: Fix N3 (wrong port), N4 (missing migration step), N5 (worker + web .env.example absent).

**Steps**:

1. **Fix env copy commands (N5 + N6-adjacent)**
   - **File**: `README.md`
   - **Lines**: 225
   - **Action**: Replace `cp apps/api/.env.example apps/api/.env` with two lines:
     ```bash
     cp apps/api/.env.example apps/api/.env.local
     cp apps/worker/.env.example apps/worker/.env.local
     # apps/web/.env.example ships safe defaults; copy only if you need to override VITE_API_BASE_URL
     ```
   - **Acceptance**: Both copy commands present; `.env.local` target; web note present.

2. **Add migration step (N4)**
   - **File**: `README.md`
   - **Lines**: after `pnpm dev:stack:up` line (~227)
   - **Action**: Insert `pnpm --filter @openlinker/api migration:run          # Create database tables`
     between `pnpm dev:stack:up` and `pnpm start:dev:api`.
   - **Acceptance**: Migration command present in Quickstart, positioned between stack-up and API start.

3. **Fix web port comment (N3)**
   - **File**: `README.md`
   - **Lines**: 230
   - **Action**: Change `# React admin UI on :5173` → `# React admin UI on :4173`
   - **Acceptance**: Port comment reads `:4173`.

**Resulting Quickstart block**:
```bash
git clone https://github.com/openlinker-project/openlinker.git
cd openlinker
pnpm install
cp apps/api/.env.example apps/api/.env.local
cp apps/worker/.env.example apps/worker/.env.local
# apps/web/.env.example ships safe defaults; copy only if you need to override VITE_API_BASE_URL

pnpm dev:stack:up                                    # PostgreSQL · Redis · MySQL · PrestaShop · WooCommerce in Docker
pnpm --filter @openlinker/api migration:run          # Create database tables
pnpm start:dev:api                                   # NestJS API on :3000
pnpm start:dev:worker                                # Background job worker
pnpm start:dev:web                                   # React admin UI on :4173
```

---

### Phase 2: CONTRIBUTING.md — Setup Checklist and Development Setup

**Goal**: Fix N5 (worker .env.example absent), N6 (`.env` → `.env.local`), N3 (second port occurrence).

**Steps**:

1. **Fix Setup Checklist copy target (N6 + N5)**
   - **File**: `CONTRIBUTING.md`
   - **Lines**: 14
   - **Action**: Replace `cp apps/api/.env.example apps/api/.env` with:
     ```bash
     cp apps/api/.env.example apps/api/.env.local
     cp apps/worker/.env.example apps/worker/.env.local
     ```
   - **Acceptance**: Both copy commands present in the fast-path checklist.

2. **Fix Development Setup copy target (N6 + N5)**
   - **File**: `CONTRIBUTING.md`
   - **Lines**: 49
   - **Action**: Replace `cp apps/api/.env.example apps/api/.env` (and surrounding comment) with:
     ```bash
     cp apps/api/.env.example apps/api/.env.local
     cp apps/worker/.env.example apps/worker/.env.local
     # Edit .env.local files with your configuration
     ```
   - **Acceptance**: `.env.local` target in numbered setup step; worker copy present.

3. **Fix web port in Development Setup start commands (N3)**
   - **File**: `CONTRIBUTING.md`
   - **Lines**: 72
   - **Action**: Change `pnpm start:dev:web      # React frontend on :5173` →
     `pnpm start:dev:web      # React frontend on :4173`
   - **Acceptance**: Port comment reads `:4173`.

---

### Phase 3: docs/dev-environment.md — Remove stale PrestaShop env vars

**Goal**: Fix N7 (stale PRESTASHOP_* vars confuse contributors).

**Steps**:

1. **Replace stale PrestaShop env block**
   - **File**: `docs/dev-environment.md`
   - **Lines**: 371–382 (from `### API Configuration` heading through closing `> **Note**:` line)
   - **Action**: Replace the entire block:
     ```
     ### API Configuration

     Update `apps/api/.env` with PrestaShop settings:

     ```env
     # PrestaShop Configuration
     PRESTASHOP_BASE_URL=http://localhost:8080
     PRESTASHOP_API_KEY=your-prestashop-webservice-api-key
     PRESTASHOP_WEBHOOK_SECRET=your-webhook-secret-optional
     ```

     > **Note**: These settings are placeholders for development. Future adapters will use the `Connection` entity to store connection-specific configuration.
     ```
     with:
     ```
     > **Note**: PrestaShop credentials (shop URL, webservice API key, webhook secret) are
     > configured through the Connections UI, not environment variables.
     > See [Getting Started](./getting-started.md) for the full setup walkthrough.
     ```
   - **Acceptance**: No `PRESTASHOP_BASE_URL`, `PRESTASHOP_API_KEY`, or `PRESTASHOP_WEBHOOK_SECRET`
     references remain in this file. The replacement note uses present tense ("are configured")
     and points to getting-started.md.

---

### Phase 4: apps/worker/.env.example — Add OL_CUSTOMER_IDENTITY_MODE

**Goal**: Fix N9 (missing env var causes silent customer-identity divergence between API and worker).

**Steps**:

1. **Append OL_CUSTOMER_IDENTITY_MODE commented entry**
   - **File**: `apps/worker/.env.example`
   - **Lines**: end of file (after line 84)
   - **Action**: Append the following block:
     ```
     # ─────────────────────────────────────────────────────────────────────────────
     # Customer identity
     # ─────────────────────────────────────────────────────────────────────────────

     # Customer identity mode — must match apps/api/.env.local value (default: email_fallback).
     # Running a different mode than the API causes silent customer-identity divergence.
     # Modes: email_fallback | external_only  (see docs/architecture-overview.md § Customers)
     # OL_CUSTOMER_IDENTITY_MODE=email_fallback
     ```
   - **Acceptance**: `OL_CUSTOMER_IDENTITY_MODE` is present in `apps/worker/.env.example` as a
     commented-out entry with a note about matching the API value.

---

## 7. Alternatives Considered

### Alternative 1: Combine all env changes into a single note at the top of each section

- **Description**: Add a single prose callout "copy both `.env.example` files" rather than
  showing explicit `cp` commands.
- **Why Rejected**: Contributors copy-paste commands from quickstart blocks. Prose callouts get
  skipped. The existing pattern in CONTRIBUTING.md and the worker `.env.example` header already
  uses explicit `cp` lines — follow that pattern.

### Alternative 2: Remove the entire `## Environment Variables` subsection from dev-environment.md

- **Description**: Since PrestaShop credentials are now UI-configured, remove the entire section.
- **Why Rejected**: Other env vars in the file (Docker Compose vars, Redis config) are still
  valid. Only the PrestaShop-specific block is stale. Targeted replacement is safer and leaves
  valid content intact.

### Alternative 3: Document OL_CUSTOMER_IDENTITY_MODE as an uncommented active line in worker .env.example

- **Description**: Add `OL_CUSTOMER_IDENTITY_MODE=email_fallback` as an active (non-commented) line.
- **Why Rejected**: Consistent with the pattern for optional tuning vars in this file (e.g.,
  `OL_ALLEGRO_OFFER_POLL_*`, `OL_LOG_BODY_MAX_BYTES`): defaults that match the built-in default
  are shown commented-out so contributors know the option exists without forcing a value that may
  diverge if the default changes.

---

## 8. Validation & Risks

### Architecture Compliance

- ✅ No code layer touched; hexagonal boundaries unaffected.

### Naming Conventions

- ✅ N/A (doc + example files only).

### Existing Patterns

- ✅ `.env.local` convention matches `docs/getting-started.md` and `apps/worker/.env.example:3`
  header comment.
- ✅ Commented-out optional var style matches existing vars in `apps/worker/.env.example`.
- ✅ Migration step matches `CONTRIBUTING.md:16,62` pattern.
- ✅ Port `:4173` matches `apps/web/vite.config.ts:7`.

### Risks

- **Low — README.md Quickstart verbosity**: The Quickstart grows by 3 lines (two `cp` + one
  migration). Acceptable: all three lines are materially required for a working setup.
- **Low — dev-environment.md context loss**: Removing the stale block shrinks the section. The
  replacement note links to `getting-started.md`, which covers the full Connections UI flow.
  No context is silently dropped.

### Edge Cases

- **web .env.example note placement**: The note is placed as a bash comment `#` inside the code
  block — consistent with the inline comments already present on `pnpm dev:stack:up`. It must
  be placed *before* the blank line separator (not after `cp` commands for a different app) to
  group with the env-copy commands visually.

### Backward Compatibility

- ✅ Pure documentation — no API, schema, or code changes. Zero backward-compatibility risk.

---

## 9. Testing Strategy & Acceptance Criteria

### Testing

This is a documentation-only change; no automated tests apply. Verification is manual:

1. Follow the updated README.md Quickstart verbatim on a clean clone — confirm no setup failures.
2. Review each changed file against the acceptance criteria below.

### Acceptance Criteria

- [ ] `README.md` Quickstart port comment reads `:4173`
- [ ] `README.md` Quickstart includes `pnpm --filter @openlinker/api migration:run` between
  `pnpm dev:stack:up` and `pnpm start:dev:api`
- [ ] `README.md` Quickstart env copy targets `apps/api/.env.local` and `apps/worker/.env.local`
- [ ] `README.md` Quickstart includes a comment noting `apps/web/.env.example` ships safe defaults
- [ ] `CONTRIBUTING.md` Setup Checklist uses `apps/api/.env.local` as copy target (not `.env`)
- [ ] `CONTRIBUTING.md` Setup Checklist includes `apps/worker/.env.example` copy step
- [ ] `CONTRIBUTING.md` Development Setup uses `apps/api/.env.local` as copy target
- [ ] `CONTRIBUTING.md` Development Setup includes `apps/worker/.env.example` copy step
- [ ] `CONTRIBUTING.md` Development Setup port comment reads `:4173`
- [ ] `docs/dev-environment.md` contains no `PRESTASHOP_BASE_URL`, `PRESTASHOP_API_KEY`, or
  `PRESTASHOP_WEBHOOK_SECRET` entries
- [ ] `docs/dev-environment.md` replacement note uses present tense and links to `getting-started.md`
- [ ] `apps/worker/.env.example` documents `OL_CUSTOMER_IDENTITY_MODE` as a commented reference
  with a note about matching the API value

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (N/A — doc-only)
- [x] Respects CORE vs Integration boundaries (N/A — doc-only)
- [x] Uses existing patterns (follows `.env.local` convention already established in worker header + getting-started.md)
- [x] Idempotency considered (N/A — doc-only)
- [x] Event-driven patterns used where applicable (N/A — doc-only)
- [x] Rate limits & retries addressed (N/A — doc-only)
- [x] Error handling comprehensive (N/A — doc-only)
- [x] Testing strategy complete (manual verification defined)
- [x] Naming conventions followed (N/A — doc-only)
- [x] File structure matches standards (N/A — doc-only)
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview — § Customers](./architecture-overview.md#5-customers) — `OL_CUSTOMER_IDENTITY_MODE` modes
- [Engineering Standards](./engineering-standards.md)
- [Getting Started](./getting-started.md) — Connections UI walkthrough (referenced from dev-environment.md fix)
- [Migrations Guide](./migrations.md) — `pnpm --filter @openlinker/api migration:run` docs
