# Implementation Plan: Backend Validation for Mailer `fromAddress` (CRLF / Header-Injection Guard)

**Date**: 2026-07-22
**Status**: Draft
**Estimated Effort**: 1-2 hours

---

## 1. Task Summary

**Objective**: Add `class-validator` guards to `UpdateMailerSettingsDto.fromAddress` (`apps/api/src/mailer/http/dto/update-mailer-settings.dto.ts`) that reject control characters (CRLF/bare-LF header-injection shapes) and enforce the same loose `email` / `Display Name <email>` shape the frontend already accepts, so the backend — the real trust boundary — is not left validating nothing on a field that flows unchanged into `SmtpMailerAdapter.sendMail({ from })` → nodemailer.

**Context**: Follow-up from a security finding raised reviewing #1761 (`fix(web/mailer-settings): accept display-name form in From address field`, currently open/unmerged). The frontend's Zod schema was hardened for convenience, but per `docs/frontend-architecture.md` ("FE must not duplicate backend validation ... as a source of truth"), server-side validation is the actual boundary and today's DTO has only `@IsOptional() @IsString()` — a direct `PUT /mailer-settings` call bypassing the FE form can set an arbitrary string, including one carrying an embedded CRLF that smuggles a second mail header (e.g. a stray `Bcc:`).

**Classification**: Interface (DTO validation in `apps/api`) — no CORE, no port, no migration, no FE change.

---

## 2. Scope & Non-Goals

### In Scope
- A new `@Matches`-based (or single custom `@Validate` constraint) guard on `UpdateMailerSettingsDto.fromAddress` in `apps/api/src/mailer/http/dto/update-mailer-settings.dto.ts`.
- Rejects any control character (at minimum `\r` / `\n`, generalized to the full C0 control range so no other header-injection-adjacent byte sneaks through).
- Accepts the same two shapes the FE currently validates: bare `email` and `Display Name <email>`.
- A colocated DTO validation spec (`update-mailer-settings.dto.spec.ts`) exercising both accepted shapes and every rejection case.

### Out of Scope
- Full RFC 5322 address parsing (the issue explicitly scopes this out — "not re-implementing full RFC 5322 parsing server-side either").
- Any change to `apps/web/src/features/mailer-settings/**` — PR #1761 (still open) owns the FE-side hardening; this plan only closes the backend gap and does not depend on #1761 merging first (the DTO change is independent and backward-compatible with whatever the FE currently sends, merged or not).
- Any change to `MailerSettingsService`, `SmtpMailerAdapter`, or the `mailer_settings` ORM entity/table — the field type and flow are unchanged, only its input validation gains a gate.
- A shared/reusable `class-validator` decorator module — this is the second call site for this exact "loose email or display-name" shape (FE has its own, independent, Zod-based implementation) but there is no established shared-validator convention in `apps/api` yet (confirmed by search — no `apps/api/src/**/validators/` or `common/decorators/` folder exists) and introducing one for a single call site would be a premature abstraction per the engineering standards.

### Constraints
- Must not reject any value the current FE schema in PR #1761 accepts (parity), so operators using the hardened FE form never hit a mismatched 400 from the backend.
- Must not break the pre-existing bare-string values that may already be stored (e.g. no backend migration is needed — this only gates the `PUT` write path, not existing rows).
- `IsOptional()` semantics must be preserved: `fromAddress` stays optional/nullable (console transport doesn't require it).

---

## 3. Architecture Mapping

**Target Layer**: Interface (`apps/api/src/mailer/http/dto/`) — no CORE, Infrastructure, or Shared change.

**Capabilities Involved**: None — this is DTO-level input validation, not a capability port change.

**Existing Services Reused**:
- `class-validator`'s `@Matches` / `@Validate` + `ValidatorConstraint` decorators (already the established pattern in this codebase — see `CredentialsXorConstraint` in `apps/api/src/integrations/http/dto/create-connection.dto.ts` and the plain `@Matches` regex guards in `apps/api/src/webhooks/http/dto/webhook-request.dto.ts` and `apps/api/src/shipping/http/dto/generate-label.dto.ts`).
- The DTO's existing `@IsOptional() @IsString()` pair is kept — the new guard layers on top and only runs when a non-empty string is present (class-validator skips subsequent decorators only via `@IsOptional()`, which short-circuits on `undefined`/`null`, not on empty string — the new validator must itself tolerate `''` if that's a value the FE can still send un-required; see Risks §8 for the exact empty-string decision).

**New Components Required**:
- One new `ValidatorConstraint` class (`FromAddressShapeConstraint`), colocated in `update-mailer-settings.dto.ts` — mirrors the `CredentialsXorConstraint` placement precedent (small, single-DTO-local constraint lives beside the DTO it validates, not in a shared file).
- One new spec file: `apps/api/src/mailer/http/dto/update-mailer-settings.dto.spec.ts`.

**Core vs Integration Justification**: This is pure Interface-layer input validation — it belongs in the DTO, not CORE, because `libs/core` domain layer must stay framework-independent (no `class-validator` decorators are permitted in `libs/core/src/mailer/domain/**`, and the transport-format concern is specific to the HTTP boundary, not a domain invariant `MailerSettingsService` needs to enforce for any other caller of the port). This matches how the existing `paidDate` calendar-shape guard lives in `mark-invoice-paid-request.dto.ts`, not in `libs/core/src/invoicing`.

---

## 4. External / Domain Research

### Internal Patterns

**Reference implementation (FE, PR #1761 — not yet merged, treated as the shape to mirror, not a dependency)**:
```typescript
// apps/web/src/features/mailer-settings/components/mailer-settings-form.schema.ts (from PR #1761 diff)
const EMAIL_PATTERN = /^(?!.*\.\.)[^\s@<>.][^\s@<>]*@[^\s@<>.][^\s@<>]*\.[^\s@<>]+$/;
const NAME_AND_EMAIL_PATTERN = /^[^<>\r\n]+\s<([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)>$/;

function isValidFromAddress(value: string): boolean {
  if (EMAIL_PATTERN.test(value)) return true;
  const match = NAME_AND_EMAIL_PATTERN.exec(value);
  return match !== null && EMAIL_PATTERN.test(match[1]);
}
```
This plan reimplements the same two-pattern-plus-helper shape server-side (not imported — `apps/web` and `apps/api` do not share a validation module, and Zod vs class-validator are different runtimes). Keeping the literal regexes textually identical (modulo syntax adaptation) is the intentional parity mechanism; a shared-package extraction is explicitly out of scope (§2).

**Existing custom single-field `class-validator` constraint precedent**:
```typescript
// apps/api/src/integrations/http/dto/create-connection.dto.ts
@ValidatorConstraint({ name: 'CredentialsXor', async: false })
class CredentialsXorConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean { /* ... */ }
  defaultMessage(): string { /* ... */ }
}
```
Note this example is cross-field (reads other properties via `args.object`); the new `FromAddressShapeConstraint` is simpler — single-value, no cross-field read needed — but the class shape (colocated `@ValidatorConstraint` + `implements ValidatorConstraintInterface`) is the established convention to follow.

**Existing plain single-purpose `@Matches` precedent** (simpler alternative considered — see §7 Alternatives):
```typescript
// apps/api/src/invoicing/http/dto/mark-invoice-paid-request.dto.ts
@Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'paidDate must be a calendar date (YYYY-MM-DD)' })
```

**DTO validation spec precedent** (`plainToInstance` + `validate` from `class-validator`, asserting on `errors[0].constraints`):
```typescript
// apps/api/src/invoicing/http/dto/mark-invoice-paid-request.dto.spec.ts
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

function buildDto(payload: Record<string, unknown>): MarkInvoicePaidRequestDto {
  return plainToInstance(MarkInvoicePaidRequestDto, payload);
}

it('should reject a full ISO datetime (calendar-date-only field)', async () => {
  const errors = await validate(buildDto({ paidDate: '2026-07-08T23:30:00+02:00' }));
  expect(errors).toHaveLength(1);
  expect(errors[0].constraints).toHaveProperty('matches');
});
```
The new `update-mailer-settings.dto.spec.ts` follows this exact structure, but must additionally populate the DTO's other `!`-required fields (`transport`, `smtpSecure`) since `UpdateMailerSettingsDto` has no independent optional-only surface the way `MarkInvoicePaidRequestDto` does — see Phase 1 Step 2 below for the exact fixture shape.

### Data Flow (unchanged, confirmed during research)

`PUT /mailer-settings` → `MailerSettingsController.update` → `MailerSettingsService.updateSettings` (`libs/core/src/mailer/application/services/mailer-settings.service.ts`) persists `fromAddress` unchanged via `MailerSettingsRepositoryPort` → later read by `SmtpMailerAdapter.sendMail({ from: settings.fromAddress })` → nodemailer. Confirmed the core service does not itself parse or validate the string (`fromAddress: null` is the only other place the string literal appears, as the default). No core-side change needed — the DTO gate is sufficient because it's the only write path for this field (`MailerSettingsController.update` is the single mutator; there is no second endpoint that sets `fromAddress`).

---

## 5. Questions & Assumptions

### Open Questions
None — the issue explicitly scopes the fix ("Scope this narrowly") and both accepted shapes are already precedented by the FE implementation in PR #1761.

### Assumptions
1. **Empty string handling**: the current DTO validates `fromAddress` with `@IsOptional() @IsString()` only — `class-validator`'s `@IsOptional()` skips remaining validators only for `undefined`/`null`, not for `''`. Today an empty string passes (since `@IsString()` accepts `''`). The FE schema treats empty-string `fromAddress` as valid for non-SMTP transport and invalid (custom "required" message) for SMTP transport — a form-level cross-field rule, not a shape rule. Assumption: the backend DTO should **also accept `''`** as a pass-through value (matching today's behavior and avoiding a new cross-field SMTP-conditional requirement that doesn't exist elsewhere in this DTO — the file header already documents "the controller does not cross-validate this... trusting the admin form"). The new constraint therefore short-circuits to valid on `''`, only applying the email/display-name shape check to non-empty strings. This is a safe default: an empty `from` is not a header-injection vector, and adding a new SMTP-conditional requirement server-side would be a scope increase beyond "closing the actual trust-boundary gap."
2. **Regex parity, not shared code**: assume duplicating the two regex literals (FE Zod, BE class-validator) is acceptable and the right call per the existing codebase norm of hand-written per-boundary validation (documented in `docs/frontend-architecture.md`: "start with hand-written feature contracts... do not mix generated and hand-written types"). No safer default exists here since sharing would require a new cross-app validation package.
3. **Control-character scope**: the issue asks for "at minimum `\r`/`\n`". Assumption: use `[^\s@<>.]`/`[^\s@<>]` character classes (already excluding all whitespace, which includes `\r`/`\n`/tab/etc. in the bare-email branch) plus an explicit `[^<>\r\n]` exclusion in the display-name branch (mirroring the FE's own commented rationale: "unlike the bare-email path (where `\s` already blocks them), `[^<>]` alone would let a CRLF-carrying name through"). This transitively rejects every C0 control character in the bare-email path via `\s`-exclusion, and specifically `\r`/`\n` in the display-name path — matching the FE's own stated scope exactly, so there's no broader control-character allowlist/denylist question to resolve.

### Documentation Gaps
None identified — `docs/engineering-standards.md § Error Handling` and the `CredentialsXorConstraint` precedent fully cover the pattern to follow.

---

## 6. Proposed Implementation Plan

### Phase 1: Backend DTO Validation

**Goal**: `UpdateMailerSettingsDto.fromAddress` rejects CRLF-carrying and shape-malformed input while accepting everything the FE's PR #1761 schema accepts.

**Steps**:

1. **Add the `FromAddressShapeConstraint` + apply it to `fromAddress`**
   - **File**: `apps/api/src/mailer/http/dto/update-mailer-settings.dto.ts`
   - **Action**:
     - Import `Validate`, `ValidatorConstraint`, and the `ValidatorConstraintInterface` type from `class-validator` (alongside the existing imports).
     - Define two module-level regex constants mirroring the FE's PR #1761 patterns exactly (see §4):
       ```typescript
       const EMAIL_PATTERN = /^(?!.*\.\.)[^\s@<>.][^\s@<>]*@[^\s@<>.][^\s@<>]*\.[^\s@<>]+$/;
       const NAME_AND_EMAIL_PATTERN = /^[^<>\r\n]+\s<([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)>$/;
       ```
     - Define `FromAddressShapeConstraint`:
       ```typescript
       @ValidatorConstraint({ name: 'FromAddressShape', async: false })
       class FromAddressShapeConstraint implements ValidatorConstraintInterface {
         validate(value: unknown): boolean {
           if (typeof value !== 'string' || value.length === 0) {
             return true; // empty/absent handled by @IsOptional(); not a header-injection vector
           }
           if (EMAIL_PATTERN.test(value)) {
             return true;
           }
           const match = NAME_AND_EMAIL_PATTERN.exec(value);
           return match !== null && EMAIL_PATTERN.test(match[1]);
         }
         defaultMessage(): string {
           return 'fromAddress must be a valid email address, optionally with a display name (e.g. "OpenLinker <noreply@example.com>")';
         }
       }
       ```
     - Apply `@Validate(FromAddressShapeConstraint)` on the `fromAddress` property, after the existing `@IsOptional() @IsString()` pair.
   - **Acceptance**: `noreply@openlinker.io` and `OpenLinker <noreply@openlinker.io>` validate cleanly; `''` and `undefined` validate cleanly; a value containing `\r` or `\n` anywhere fails; `A <b@example.com> <d@example.com>` fails; `test..test@test.pl` fails.
   - **Dependencies**: None — self-contained file edit.

2. **Add the DTO validation spec**
   - **File**: `apps/api/src/mailer/http/dto/update-mailer-settings.dto.spec.ts` (new)
   - **Action**: Follow the `mark-invoice-paid-request.dto.spec.ts` structure — a `buildDto(overrides)` helper that supplies the DTO's required fields (`transport: 'smtp'`, `smtpSecure: true`) plus `fromAddress` from the test case, then asserts via `validate()` + `plainToInstance()`. Cover:
     - accepts a bare email (`noreply@openlinker.io`)
     - accepts `Display Name <email>` (`OpenLinker <noreply@openlinker.io>`)
     - accepts omitted `fromAddress` (`undefined`)
     - accepts empty string `fromAddress: ''`
     - rejects a value with an embedded CRLF in a display name (`'Foo\r\nBcc: attacker@evil.com <a@b.com>'`) — the concrete header-injection reproduction from the issue
     - rejects a value with an embedded bare LF (`'Foo\nBcc: x@evil.com <a@b.com>'`)
     - rejects a malformed bare address (`'not-an-email'`)
     - rejects a display-name address with a malformed inner email (`'Name <not-an-email>'`)
     - rejects a double-bracketed address (`'A <b@example.com> <d@example.com>'`)
     - rejects consecutive dots in the local-part (`'test..test@test.pl'`)
     - rejects a stray angle bracket swallowed into the local-part (`'Test <,<test@test.test>'`)
     - asserts `errors[0].constraints` has the `FromAddressShape` key (`fromAddressShape`, the camelCased constraint name class-validator derives) on every rejection case
   - **Acceptance**: `pnpm --filter @openlinker/api test update-mailer-settings.dto.spec.ts` passes with all cases green.
   - **Dependencies**: Step 1.

3. **Run the quality gate**
   - **Action**: `pnpm lint && pnpm type-check && pnpm --filter @openlinker/api test`
   - **Acceptance**: Zero lint errors, zero type errors, full mailer test suite green (including the pre-existing `mailer-settings.controller.spec.ts`, which is unaffected — it mocks the service layer above the DTO and never exercises `class-validator`).
   - **Dependencies**: Steps 1-2.

### Implementation Details

**New Components**:
- **Interface**: `FromAddressShapeConstraint` (colocated `ValidatorConstraint` class in `update-mailer-settings.dto.ts`), plus the new `@Validate(FromAddressShapeConstraint)` decorator on `fromAddress`.

**Configuration Changes**: None.

**Database Migrations**: None — no schema/entity change; `mailer_settings.from_address` column and its runtime type are untouched.

**Events**: None emitted or consumed — this is synchronous request-body validation inside the existing `PUT /mailer-settings` handler; no new event flow.

**Error Handling**: NestJS's global `ValidationPipe` (already active for all controllers per `docs/engineering-standards.md § Validation`) converts a failed `FromAddressShapeConstraint` into the framework's standard `400 Bad Request` with the constraint's `defaultMessage()` in the response body — no custom exception class needed, matching how every other `@Matches`/`@Validate` DTO guard in this codebase already behaves (`create-connection.dto.ts`, `mark-invoice-paid-request.dto.ts`).

---

## 7. Alternatives Considered

### Alternative 1: Two separate `@Matches` regexes combined via `@ValidateIf` branches
- **Description**: Instead of one custom `ValidatorConstraint`, use two mutually-exclusive `@Matches` decorators gated by `@ValidateIf` predicates that each test one of the two shapes.
- **Why Rejected**: `class-validator` decorators are ANDed by default; expressing "either shape A or shape B" cleanly needs either a custom constraint (chosen) or `@ValidateIf` acrobatics that would still require inspecting the value inside the predicate to decide which `@Matches` branch applies — no cleaner than a single custom constraint, and less discoverable (`defaultMessage()` on one function beats two decorators whose combined semantics aren't obvious from the class body alone).
- **Trade-offs**: The custom-constraint approach is a few more lines (a class + interface import) but keeps validation logic and its message in one reviewable place, matching the `CredentialsXorConstraint` precedent already in this codebase.

### Alternative 2: A single mega-regex with alternation (no helper function, no `ValidatorConstraint` class)
- **Description**: Express both shapes as one `@Matches(/^(bare-email-alt)|(name-and-email-alt)$/)` regex, avoiding the extra class.
- **Why Rejected**: The display-name branch needs its *captured* inner email re-validated against the exact same bare-email pattern (dot-collision rules, etc.) — expressing that as pure alternation without back-reference support in JS regex would require either duplicating the full bare-email pattern inline inside the alternation (fragile — two copies to keep in sync inside one regex literal) or accepting a looser display-name check that doesn't fully match the FE's guarantees. The two-pattern-plus-helper-function shape (already proven in the FE implementation) is clearer and directly portable.
- **Trade-offs**: One extra class vs. one denser, harder-to-read/audit regex literal for a security-sensitive check — readability and auditability win here.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Validation lives entirely in the Interface layer (`apps/api/src/mailer/http/dto/`); `libs/core/src/mailer/**` is untouched, preserving domain-layer framework independence (`docs/architecture-overview.md § Hexagonal Architecture Structure`).

### Naming Conventions
- ✅ `FromAddressShapeConstraint` follows the existing `{Purpose}Constraint` shape used by `CredentialsXorConstraint`; the spec file follows `*.dto.spec.ts`.

### Existing Patterns
- ✅ Reuses the exact `@Validate(...)` + colocated `ValidatorConstraint` pattern already in `create-connection.dto.ts`, and the exact DTO-spec structure already in `mark-invoice-paid-request.dto.spec.ts` — no new abstraction introduced.

### Risks
- **Regex drift between FE and BE**: since the two patterns are hand-duplicated (not shared), a future FE-side loosening (e.g. supporting quoted display names with embedded commas) could silently diverge from the backend gate, causing the FE to accept a value the backend then 400s. **Mitigation**: the DTO's `FromAddressShapeConstraint` block carries a code comment cross-referencing the FE schema file path, so a future editor of either side is pointed at the other; this is an acceptable ongoing-maintenance cost given the explicit decision (§2) not to extract a shared package for a two-call-site concern.
- **Existing stored values that predate this gate**: any already-persisted `fromAddress` string that would now fail the new constraint is not affected on read — the constraint only runs on the `PUT /mailer-settings` write path, so an existing malformed row (if any) keeps working for outbound mail until an operator next edits and re-saves settings, at which point they'd need to fix the value. This is correct given the "closing the trust-boundary gap for future writes" scope — no migration/backfill is warranted for a validation-only change.

### Edge Cases
- **Whitespace-only display name** (e.g. `'   <a@b.com>'`): the FE's own documented risk note (from PR #1761's implementation plan) says this is an accepted edge case given "structural shape only" validation scope. The `NAME_AND_EMAIL_PATTERN`'s `[^<>\r\n]+\s<...>` requires at least one non-bracket, non-CRLF character before the trailing space+bracket, so a pure-whitespace "name" of length ≥ 1 does technically match (whitespace satisfies `[^<>\r\n]`). This plan inherits the same acceptance the FE plan already made — no additional tightening, since it doesn't affect header-injection safety (no control character crosses the boundary either way).
- **`@Validate` triggering on `null`**: `class-validator`'s `@IsOptional()` treats `null` the same as `undefined` (skips remaining validators), so `fromAddress: null` never reaches `FromAddressShapeConstraint.validate()` at all — consistent with the DTO's existing `string | null` type and the "nullable" Swagger annotation.

### Backward Compatibility
- ✅ No breaking change to the DTO shape (`fromAddress?: string | null` unchanged) — only new validation on write. Any client (FE, direct API caller) sending a well-formed bare email or already-valid `Name <email>` continues to work unchanged. A client currently sending a CRLF-carrying string (the vulnerability itself) starts getting a `400` — this is the intended fix, not a compatibility regression.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- New: `apps/api/src/mailer/http/dto/update-mailer-settings.dto.spec.ts` — full case list in Phase 1 Step 2.
- Existing: `apps/api/src/mailer/http/mailer-settings.controller.spec.ts` stays green unmodified (it mocks `IMailerSettingsService` above the DTO layer; NestJS's `ValidationPipe` is not exercised by a controller unit test that constructs the controller directly, so no controller-spec change is needed for this fix — only the DTO-level spec exercises `class-validator` directly, matching the `mark-invoice-paid-request.dto.spec.ts` precedent for the same kind of DTO-only guard).

### Integration Tests
- None required — this is a pure input-validation change with no cross-component orchestration, database, or adapter behavior involved. The existing mailer integration coverage (if any) is unaffected since it operates above the validated boundary. (No `*.int-spec.ts` currently exists for mailer settings per the `find` above; not introducing one is consistent with the "targeted vertical slices" scope in `docs/testing-guide.md`.)

### Mocking Strategy
- N/A — DTO validation tests instantiate the real DTO class via `plainToInstance` and run real `class-validator` `validate()`, no mocking needed (matches the `mark-invoice-paid-request.dto.spec.ts` precedent exactly).

### Acceptance Criteria
- [ ] `UpdateMailerSettingsDto.fromAddress` rejects any string containing `\r` or `\n`.
- [ ] `UpdateMailerSettingsDto.fromAddress` accepts a bare email and a `Display Name <email>` form, matching the FE's PR #1761 accepted shapes exactly.
- [ ] `UpdateMailerSettingsDto.fromAddress` continues to accept `undefined`, `null`, and `''`.
- [ ] New spec file covers all cases in Phase 1 Step 2 and passes.
- [ ] `pnpm lint`, `pnpm type-check`, and `pnpm --filter @openlinker/api test` all pass with zero errors.
- [ ] No change to `libs/core/src/mailer/**`, no migration generated (confirmed via `pnpm --filter @openlinker/api migration:show` showing no pending migrations after the change).

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — Interface-layer-only change.
- [x] Respects CORE vs Integration boundaries — no CORE touched.
- [x] Uses existing patterns (no unnecessary abstractions) — reuses `ValidatorConstraint` precedent; explicitly rejected extracting a shared validator package (§2, §7).
- [x] Idempotency considered — N/A (synchronous validation, no side effects, no retries).
- [x] Event-driven patterns used where applicable — N/A, no events involved.
- [x] Rate limits & retries addressed — N/A, not an external-system call.
- [x] Error handling comprehensive — relies on the existing global `ValidationPipe` → `400` conversion, consistent with every other DTO in this codebase.
- [x] Testing strategy complete — unit spec covers every accept/reject case named in the issue.
- [x] Naming conventions followed — `FromAddressShapeConstraint`, `*.dto.spec.ts`.
- [x] File structure matches standards — new spec colocated with the DTO it tests, per `docs/engineering-standards.md § Files and Folders`.
- [x] Plan is execution-ready.
- [x] Plan is saved as markdown file.

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- Issue: [#1765](https://github.com/openlinker-project/openlinker/issues/1765)
- Related PR (frontend, open/unmerged): [#1761](https://github.com/openlinker-project/openlinker/pull/1761)
- Related issue (frontend hardening, this plan's counterpart): [#1749](https://github.com/openlinker-project/openlinker/issues/1749)
