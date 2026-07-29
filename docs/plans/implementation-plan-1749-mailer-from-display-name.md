# Implementation Plan: Mailer From-Address Field Accepts Display-Name Format

**Date**: 2026-07-22
**Status**: Draft
**Estimated Effort**: 1-2 hours

---

## 1. Task Summary

**Objective**: Loosen the client-side Zod validation on the mailer settings "From address" field so it accepts both a bare email (`noreply@openlinker.io`) and the RFC-5322-style `Display Name <email>` form (`OpenLinker <noreply@openlinker.io>`).

**Context**: The "Edit mailer settings" dialog currently rejects any From address containing a display name, showing "Enter a valid email address". This blocks admins from setting a friendly sender name — recipients see the bare address in their inbox instead of e.g. "OpenLinker". The backend already accepts and correctly handles the `Display Name <email>` form end-to-end (DTO has no `@IsEmail()`, core service passes the string through unchanged, and nodemailer natively parses this format into the `From:` header). The only rejecting validator is the frontend Zod regex.

**Classification**: Frontend (Interface layer — form validation, React Hook Form + Zod)

---

## 2. Scope & Non-Goals

### In Scope
- `apps/web/src/features/mailer-settings/components/mailer-settings-form.schema.ts` — extend the `fromAddress` validation in `superRefine` to accept both forms.
- Update the error message to reflect both accepted forms.
- Add a new colocated unit test file for the schema (none exists yet) covering both valid forms and the invalid/empty cases.
- Manual smoke check that saving a display-name From address round-trips correctly (dialog → API → outbound header), per the issue's acceptance criteria — verified by reading the already-unchanged backend/adapter code, not by re-testing the backend (out of scope, see below).

### Out of Scope
- Any backend, DTO, or core (`libs/core/src/mailer/**`) change — the issue confirms these already accept and pass through the `Display Name <email>` form unchanged. No re-verification of `smtp-mailer.adapter.ts` / nodemailer behavior is needed; it's cited in the issue as already correct.
- Broader mailer-settings UI/UX changes (help text, placeholder examples) beyond the error message wording.
- Internationalizing the new error message string — the FE i18n seam is explicitly no-op for existing/new inline strings per `docs/frontend-architecture.md § Internationalization`; this string stays an inline literal like its neighbors.
- Adding a live preview of the parsed display name in the dialog — not requested, no acceptance criterion covers it.

### Constraints
- Zero backend/DTO/migration changes (confirmed no schema/entity touch → no migration workflow needed).
- Preserve `MAX_FROM_ADDRESS_LENGTH` (320) and the "required for SMTP transport" empty-check exactly as-is — only the format check inside the non-empty branch changes.
- Console transport (`transport !== 'smtp'`) must remain entirely unaffected — the whole `fromAddress` check lives inside the `if (values.transport !== 'smtp') return;`-gated branch already.

---

## 3. Architecture Mapping

**Target Layer**: Frontend / Interface (form-state validation) — per `docs/frontend-architecture.md § Form State`, form validation lives in the feature's Zod schema; server-side validation remains the source of truth (already permissive here).

**Capabilities Involved**: None (no ports/adapters touched — pure client-side regex/validation logic).

**Existing Services Reused**: None needed. This is a self-contained schema-file edit; no new hooks, components, or API surface.

**New Components Required**: None. One new test file (`mailer-settings-form.schema.test.ts`) colocated with the schema, following the existing `*.test.ts(x)` convention already used by `mailer-settings-dialog.test.tsx` / `mailer-settings-tile.test.tsx` in the same folder.

**Core vs Integration Justification**: N/A — no CORE or Integration code is touched. The fix is entirely within `apps/web`, which per `docs/architecture-overview.md` / `docs/frontend-architecture.md` owns its own form-validation logic and must not duplicate backend validation as a source of truth (it isn't becoming a new source of truth here — it's relaxing an over-strict client check to match the backend's existing permissiveness).

---

## 4. External / Domain Research

### External System
N/A — no external API interaction. Nodemailer's `From:` header parsing (`"Display Name <email>"`) is standard RFC 5322 `mailbox` syntax and is already relied upon by the unchanged `smtp-mailer.adapter.ts`.

### Internal Patterns
- **Existing pattern reference**: `apps/web/src/features/mailer-settings/components/mailer-settings-form.schema.ts` itself is the sole file to change — it already uses the `superRefine`-gated-by-transport pattern documented in its own header comment.
- **Test pattern**: Sibling files `mailer-settings-dialog.test.tsx` and `mailer-settings-tile.test.tsx` in the same folder show the project's Vitest + Testing Library conventions for this feature; the new schema test is plain Vitest (no rendering needed) since it tests a pure Zod schema.
- No other feature in the codebase currently validates a "display name + email" combined field, so there's no existing regex to copy — a small dedicated pattern is added.

---

## 5. Questions & Assumptions

### Open Questions
- None — the issue is fully specified (proposed solution, acceptance criteria, and exact file/line references are all given and verified against the current file).

### Assumptions
- Display-name form is required only for SMTP transport, matching the existing `superRefine` gate (confirmed: the entire `fromAddress` check sits inside the `transport !== 'smtp'` early-return).
- The display-name prefix must be **non-empty** (i.e. bare `<email@domain.com>` with an empty name before the bracket is not a form we need to special-case as valid/invalid distinctly — see design below) — matches the issue's phrasing ("allow a non-empty display-name prefix").
- Only client-side **structural shape** is validated; no attempt to fully validate RFC 5322 quoted-string/comment edge cases in the display name — matches the issue's explicit assumption.

### Documentation Gaps
- None found relevant to this change.

---

## 6. Proposed Implementation Plan

### Phase 1: Schema change

**Goal**: Accept both bare-email and `Name <email>` forms in `fromAddress` validation.

**Steps**:

1. **Add a second pattern for the angle-bracket form**
   - **File**: `apps/web/src/features/mailer-settings/components/mailer-settings-form.schema.ts`
   - **Action**: Alongside the existing `EMAIL_PATTERN`, add a constant that matches `Name <email>`, reusing the same email-body pattern inside the brackets:
     ```ts
     const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
     const NAME_AND_EMAIL_PATTERN = /^.+\s<([^\s@]+@[^\s@]+\.[^\s@]+)>$/;
     ```
     Rationale for capturing the inner address: allows a single `isValidFromAddress()` helper to extract-and-reuse `EMAIL_PATTERN.test(...)` on the captured group instead of duplicating the email regex body — keeps one definition of "what a valid email looks like" (DRY, avoids the two patterns drifting apart if the email regex is ever tightened).
   - **Acceptance**: Both `noreply@openlinker.io` and `OpenLinker <noreply@openlinker.io>` are recognized as syntactically matching; `not-an-email` and `Name <not-an-email>` are not.

2. **Extract a small pure helper function**
   - **File**: same file
   - **Action**: Add a private (non-exported) helper near the patterns:
     ```ts
     function isValidFromAddress(value: string): boolean {
       if (EMAIL_PATTERN.test(value)) {
         return true;
       }
       const match = NAME_AND_EMAIL_PATTERN.exec(value);
       return match !== null && EMAIL_PATTERN.test(match[1]);
     }
     ```
   - **Acceptance**: Function returns `true` for both accepted forms and `false` for malformed input, verified by the new unit tests in Phase 2.
   - **Dependencies**: Step 1.

3. **Wire the helper into `superRefine` and update the message**
   - **File**: same file
   - **Action**: Replace the existing check:
     ```ts
     } else if (!EMAIL_PATTERN.test(values.fromAddress)) {
       ctx.addIssue({
         code: z.ZodIssueCode.custom,
         path: ['fromAddress'],
         message: 'Enter a valid email address',
       });
     }
     ```
     with:
     ```ts
     } else if (!isValidFromAddress(values.fromAddress)) {
       ctx.addIssue({
         code: z.ZodIssueCode.custom,
         path: ['fromAddress'],
         message: 'Enter a valid email address, optionally with a display name (e.g. "OpenLinker <noreply@example.com>")',
       });
     }
     ```
   - **Acceptance**: The empty-string branch (`values.fromAddress.length === 0`) is untouched — only the `else if` condition and message change.
   - **Dependencies**: Step 2.

### Phase 2: Tests

**Goal**: Cover both accepted forms and the rejection/empty cases per the issue's acceptance criteria.

**Steps**:

1. **Create the schema test file**
   - **File**: `apps/web/src/features/mailer-settings/components/mailer-settings-form.schema.test.ts` (new)
   - **Action**: Test `mailerSettingsFormSchema.safeParse(...)` directly (no rendering needed — pure Zod schema, Vitest only) with a base valid SMTP payload (host/port/etc. all valid) and vary only `fromAddress`:
     - `fromAddress: 'noreply@openlinker.io'` → `success: true`.
     - `fromAddress: 'OpenLinker <noreply@openlinker.io>'` → `success: true`.
     - `fromAddress: 'not-an-email'` → `success: false`, issue path `['fromAddress']`.
     - `fromAddress: 'Name <not-an-email>'` → `success: false`, issue path `['fromAddress']`.
     - `fromAddress: ''` with `transport: 'smtp'` → `success: false`, message `'From address is required for SMTP transport'`.
     - `fromAddress: ''` with `transport: 'console'` (or whatever the non-SMTP value in `MailerTransportValues` is) → `success: true` (unaffected — confirms the gate still works).
     - A 321-character `fromAddress` (bare or display-name form) → `success: false` on the max-length check (regression guard — confirms Phase 1 didn't disturb the existing length rule since it runs before `superRefine`).
   - **Acceptance**: All cases above pass; test file follows the naming/colocation convention already used by `mailer-settings-dialog.test.tsx` in the same directory.
   - **Dependencies**: Phase 1 complete.

### Implementation Details

**New Components**: None (no entities/ports/adapters/services/controllers). One new test file only.

**Configuration Changes**: None.

**Database Migrations**: None — confirmed no ORM entity change; `pnpm --filter @openlinker/api migration:show` is not applicable to this PR.

**Events**: None emitted or consumed.

**Error Handling**: Purely client-side Zod issue messages — no new exception types needed (matches existing pattern in the same file).

**Reference**: `docs/frontend-architecture.md § Form State`, `§ Async UX Conventions`.

---

## 7. Alternatives Considered

### Alternative 1: Single combined regex (no helper function)
- **Description**: Write one big regex alternation, e.g. `/^([^\s@]+@[^\s@]+\.[^\s@]+|.+\s<[^\s@]+@[^\s@]+\.[^\s@]+>)$/`, and drop the helper function.
- **Why Rejected**: Duplicates the email-body pattern twice inline, making future changes to "what counts as a valid email" (e.g. tightening the regex) require editing two places within one already-hard-to-read regex. The two-pattern + tiny-helper approach keeps a single source of truth for the email body pattern and is far more readable/testable in isolation.
- **Trade-offs**: The alternative is marginally more compact (one fewer function) but strictly worse for maintainability; rejected.

### Alternative 2: Use a battle-tested email-address-parsing library (e.g. `email-addresses` npm package)
- **Description**: Depend on a library that fully parses RFC 5322 mailbox syntax (quoted strings, comments, multiple addresses, etc.) instead of a regex.
- **Why Rejected**: The issue explicitly scopes this to "validate only structural shape client-side; the backend remains the source of truth" — pulling in a new dependency for a purely cosmetic client-side format gate is disproportionate to the problem, and no other form in the codebase uses an email-parsing library (regex-based `EMAIL_PATTERN` is the established convention in this exact file). Also out of step with `docs/frontend-architecture.md`'s bias toward minimal, hand-written contracts for early slices.
- **Trade-offs**: A library would handle more edge cases (quoted display names with special characters, comments) correctly, but that robustness isn't needed here and adds a new dependency + bundle weight for a single field.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No CORE/Integration/Infrastructure boundary touched — pure frontend form-schema edit.
- ✅ No new global store, no raw `fetch()`, no deep cross-feature import — change is fully internal to one file within `features/mailer-settings/components/`.

### Naming Conventions
- ✅ New test file `mailer-settings-form.schema.test.ts` matches the `*.test.ts` convention (`docs/frontend-architecture.md § Components And Pages`).
- ✅ New constant `NAME_AND_EMAIL_PATTERN` and helper `isValidFromAddress` follow existing `camelCase`/`UPPER_SNAKE_CASE` conventions already used in the file (`EMAIL_PATTERN`, `MAX_FROM_ADDRESS_LENGTH`).

### Existing Patterns
- ✅ Reuses the existing `superRefine`-gated-by-transport pattern already documented in the file's own header comment — no new validation mechanism introduced.

### Risks
- **Regex false-positives/negatives for edge-case display names**: e.g. a name containing `<` or `>` characters, or multiple angle-bracket pairs, could confuse the naive `NAME_AND_EMAIL_PATTERN`. Mitigation: scope is explicitly "structural shape only" per the issue; the greedy `.+\s<...>$` combined with anchored start/end means a malformed multi-bracket string like `A <b> <c@d.com>` will still match the *last* `<...>` pair correctly (regex is anchored at the end `>$`), which is acceptable — real admin input for a "friendly sender name" is not expected to contain angle brackets.
- **Empty display-name edge case**: `<noreply@openlinker.io>` (empty name, no space before `<`) will fail `NAME_AND_EMAIL_PATTERN` (requires `.+\s` before the bracket) and also fail bare `EMAIL_PATTERN` (has literal `<`/`>` chars) — so it's rejected. This is intentional per the assumption "allow a non-empty display-name prefix"; add an explicit test case if we want this locked in as expected-invalid behavior (recommend adding it to Phase 2's test list as a documented edge case, not a blocking gap).

### Edge Cases
- Whitespace-only display name before `<...>` (e.g. `"   <a@b.com>"`) — `.+\s<...>` requires at least one non-whitespace-preceding-a-space char, so `"   "` alone (all spaces) technically matches `.+\s` greedily consuming spaces... this is a low-stakes cosmetic validator; not worth over-engineering. Covered implicitly by "structural shape only" scoping — no test required beyond the ones listed in Phase 2.
- Leading/trailing whitespace on the whole field — already `.trim()`'d by the Zod string schema before `superRefine` runs (existing behavior, unchanged).

### Backward Compatibility
- ✅ Fully backward compatible — every previously-valid bare email address continues to validate identically (the `EMAIL_PATTERN.test(value)` branch is checked first and unchanged). No stored data or API contract changes.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- New file: `apps/web/src/features/mailer-settings/components/mailer-settings-form.schema.test.ts`
- Tests the schema directly via `safeParse`, no component rendering required (Vitest only, matches `docs/frontend-architecture.md § Testing Baseline`).

### Integration Tests
- Not required — this is a pure client-side validation change with no HTTP/API/database interaction. The existing `mailer-settings-dialog.test.tsx` (component-level) is not touched but should still pass unmodified; run it as a regression check since it exercises the same schema via the dialog.

### Mocking Strategy
- None needed — no external dependencies to mock; the schema is tested as a pure function of its input.

### Acceptance Criteria
(mirrors the issue's own acceptance criteria)
- [ ] `OpenLinker <noreply@openlinker.io>` passes validation.
- [ ] Bare `noreply@openlinker.io` still passes validation.
- [ ] `not-an-email`, `Name <not-an-email>`, and empty-for-SMTP all still fail with a clear message.
- [ ] 320-char max-length cap and "required for SMTP transport" behavior preserved (regression-tested).
- [ ] `pnpm --filter @openlinker/web test` passes, including the new schema test file.
- [ ] `pnpm lint` and `pnpm type-check` pass with zero errors.
- [ ] No architecture boundary violations (confirmed: frontend-only change, no CORE/Integration/DB touch).

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (N/A — pure FE form validation, no backend/CORE touch)
- [x] Respects CORE vs Integration boundaries (nothing touched)
- [x] Uses existing patterns (no unnecessary abstractions) — reuses the file's existing `superRefine`-gated pattern; adds one small pure helper, no new library
- [x] Idempotency considered (N/A — client-side sync validation, no side effects)
- [x] Event-driven patterns used where applicable (N/A)
- [x] Rate limits & retries addressed (N/A)
- [x] Error handling comprehensive (Zod issue messages cover all branches: empty/invalid/too-long)
- [x] Testing strategy complete (new schema unit tests + existing dialog test as regression check)
- [x] Naming conventions followed
- [x] File structure matches standards (colocated test file, same folder as schema)
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Frontend Architecture](../frontend-architecture.md)
- [Testing Guide](../testing-guide.md)
- Issue: [#1749](https://github.com/openlinker-project/openlinker/issues/1749)
