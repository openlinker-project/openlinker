# Implementation Plan — Migrate `AllegroEnvironment` enum to `as const` + union

**Issue:** #666 — [TECH-DEBT] Migrate `AllegroEnvironment` enum to `as const` + union type
**Branch:** `666-allegro-env-as-const`
**Layer:** Integration (`libs/integrations/allegro/`)
**Owner:** Piotr Swierzy

---

## 1. Goal

Remove the last remaining TypeScript `enum` in the codebase (`libs/integrations/allegro/src/application/dto/allegro-connection-config.dto.ts:48`) and route the DTO through the canonical `as const` + union type already declared at `libs/integrations/allegro/src/domain/types/allegro-config.types.ts:16-21`. Aligns with `docs/engineering-standards.md` § _Union Types: `as const` Pattern (Default)_ and unblocks the optional ESLint enforcement of the no-enum rule.

### Non-goals

- No public-API contract change (the union has the same accept set: `'sandbox' | 'production'`).
- No schema or migration changes (DTO is `Connection.configJson` shape-only; no DB column).
- No Swagger surface change (the DTO is plugin-private — `@ApiProperty` was stripped post-#587 per the file header; the future `GET /connections/config-schema/:adapterKey` endpoint is unaffected).
- No FE schema change (`apps/web/.../edit-connection.schema.ts` doesn't import `AllegroEnvironment` — it uses its own Zod schema).

---

## 2. Where the work is

The migration is **already half done**:

- ✅ `domain/types/allegro-config.types.ts` ships `AllegroEnvironmentValues` (runtime array) + `AllegroEnvironment` (derived union).
- ✅ `libs/integrations/allegro/src/index.ts:27` exports both names from the package barrel.
- ✅ `application/allegro-adapter.factory.ts:215-217` already validates via `AllegroEnvironmentValues.includes(...)`.
- ❌ `application/dto/allegro-connection-config.dto.ts:48-51` still declares a legacy `enum AllegroEnvironment` that **shadows the union of the same name** within this file's scope.
- ❌ Same DTO uses `@IsEnum(AllegroEnvironment)` on line 149.

Zero value-style accesses (`AllegroEnvironment.SANDBOX` / `.PRODUCTION`) exist anywhere in `libs/` or `apps/` (verified by grep). The enum is purely a type carrier inside this one DTO.

---

## 3. Design

Drop the local enum, import the canonical union + runtime-array from the same package's domain-types module, and swap `@IsEnum` → `@IsIn` — the same `class-validator` pattern already used by neighbouring DTO classes in this same file for `PolishVoivodeshipValues` (line 61) and `AllegroSafetyInformationTypeValues` (line 99). Pattern is established here; no new convention.

`@IsEnum(enum)` and `@IsIn(array)` produce identical accept/reject semantics for string-valued enums — the spec at `infrastructure/adapters/__tests__/allegro-connection-config-shape-validator.adapter.spec.ts` already exercises this DTO with literal strings only (`'sandbox'`, `'production'`, `'staging'`), so no test rewrite is needed.

---

## 4. Step-by-step

### Step 4.1 — Replace the enum declaration with an import

**File:** `libs/integrations/allegro/src/application/dto/allegro-connection-config.dto.ts`

Add `AllegroEnvironment` + `AllegroEnvironmentValues` to the existing import block from `../../domain/types/allegro-config.types`. Delete the `export enum AllegroEnvironment { ... }` declaration block (lines 45-51 including the JSDoc).

### Step 4.2 — Swap `@IsEnum` → `@IsIn` in the property decorator

Same file. Line 149 becomes:

```ts
@IsIn(AllegroEnvironmentValues as readonly string[])
environment!: AllegroEnvironment;
```

Cast to `readonly string[]` mirrors the existing usage at line 61 (`PolishVoivodeshipValues`) and line 99 (`AllegroSafetyInformationTypeValues`) — `class-validator` types its array parameter as `unknown[]` and the cast keeps TypeScript happy.

### Step 4.3 — Drop the now-unused `IsEnum` import

Same file. Remove `IsEnum,` from the `import { ... } from 'class-validator';` block at line 23 (no other usage in this file).

### Step 4.4 — Quality gate

```bash
pnpm lint
pnpm type-check
pnpm test
```

Plus the issue's specific check, widened to cover `const enum` too (engineering-standards.md § _Union Types_ also bans `const enum`):

```bash
grep -rn '^export enum\|^enum ' apps libs    # must return nothing
grep -rn 'const enum' apps libs               # must return nothing — belt-and-braces
```

---

## 5. Validation

### 5.1 Architecture

- ✅ No domain-layer changes (the union has always lived in `domain/types/`).
- ✅ Application layer (DTO) now consumes the domain type instead of declaring its own — strictly an improvement in layer hygiene.
- ✅ No new files, no port/adapter changes, no DI wiring touched.

### 5.2 Naming / conventions

- ✅ Matches engineering-standards.md § _Union Types: `as const` Pattern_ verbatim.
- ✅ Mirrors the in-file precedent (`PolishVoivodeshipValues`, `AllegroSafetyInformationTypeValues`).

### 5.3 Testing

- Existing spec at `infrastructure/adapters/__tests__/allegro-connection-config-shape-validator.adapter.spec.ts` covers accept (`'sandbox'`, `'production'`) and reject (`'staging'`) cases and does not depend on enum class-API. No test change needed.
- PR description should call this out explicitly: _"Validation behaviour confirmed unchanged by the existing accept/reject coverage — `@IsIn(array)` and `@IsEnum(stringEnum)` produce identical accept-sets for string-valued enums."_

### 5.4 Open questions

None. The change is local to one DTO file and has no behaviour drift.

---

## 6. Acceptance checklist (from issue #666)

- [ ] No `enum` keyword remains in `apps/` or `libs/` (verified via grep).
- [ ] Swagger output unchanged — **N/A** for this DTO (plugin-private, `@ApiProperty` already absent per file header).
- [ ] Validation behaviour unchanged — verified by existing shape-validator spec passing without modification.
- [ ] `pnpm lint && pnpm type-check && pnpm test` pass.
