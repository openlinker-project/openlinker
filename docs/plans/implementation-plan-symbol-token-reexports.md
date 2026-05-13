# Implementation Plan — Standardise Symbol DI token re-exports

**Issue:** #595 — [F8] [MEDIUM] Symbol DI tokens inconsistently re-exported from sub-barrels
**Branch:** `595-symbol-token-reexports`
**Layer:** CORE (`libs/core/src/<ctx>/`) + cross-package consumers
**Owner:** Piotr Swierzy

---

## 1. Goal

Make every context sub-barrel re-export its Symbol DI tokens via `export * from './<ctx>.tokens'`, so external consumers (in-tree plugins, host apps, and future OSS plugins) have exactly one canonical import path per token: `@openlinker/core/<ctx>`. Aligns with the Modularity-Thread-F SDK boundary work (parent #552) and the engineering-standards.md § _Repository Ports Pattern_ Symbol-token-naming convention. Closes the open question an OSS plugin author would hit when binding to a token — "do I import from `@openlinker/core/inventory` or `@openlinker/core/inventory/inventory.tokens`?" — with one answer.

### Non-goals

- Not introducing or renaming any Symbol tokens. Existing token identifiers stay.
- Not changing same-context relative imports inside `libs/core/src/<ctx>/**`. Engineering-standards.md § _Import Aliases_ rule 1 explicitly allows relative imports up to `../..` for same-context cross-layer files; the existing in-package `../../customers.tokens` / `../../listings.tokens` etc. imports stay.
- Not touching `webhooks` — its single Symbol token lives in a port file (`webhook-delivery-repository.port.ts:47`), not a `*.tokens.ts`. That's a different shape (port-co-located token) and out of scope for the `*.tokens.ts` re-export convention this issue is about. If `webhooks` ever grows a second token, the canonical move is to extract to `webhooks/webhooks.tokens.ts` and apply the same `export *` rule from this PR — but today's single-token-in-port-file shape is acceptable because the port + token form a tight unit.
- Not touching plugin-package tokens (`libs/integrations/ai/src/ai-integration.tokens.ts`, `libs/integrations/allegro/src/allegro.tokens.ts`) — those are plugin-private surfaces and not consumed via the `@openlinker/core/*` barrels.

---

## 2. Current-state audit

### 2.1 `*.tokens.ts` files (12)

`ai`, `content`, `customers`, `events`, `identifier-mapping`, `integrations`, `inventory`, `listings`, `mappings`, `orders`, `products`, `sync`.

### 2.2 Sub-barrel conformance

| Context | Pattern in `<ctx>/index.ts` | Conformant? |
|---|---|---|
| `ai` | `export * from './ai.tokens'` | ✅ |
| `content` | `export * from './content.tokens'` | ✅ |
| `customers` | `export * from './customers.tokens'` | ✅ |
| `identifier-mapping` | `export * from './identifier-mapping.tokens'` | ✅ |
| `events` | cherry-picks 1 token | ❌ |
| `integrations` | cherry-picks ~9 tokens | ❌ |
| `inventory` | cherry-picks 5 tokens | ❌ |
| `listings` | cherry-picks 9+ tokens | ❌ |
| `mappings` | cherry-picks 5 tokens | ❌ |
| `orders` | cherry-picks 5 tokens | ❌ |
| `products` | cherry-picks 5 tokens | ❌ |
| `sync` | cherry-picks 8+ tokens | ❌ |
| `users` | cherry-picks 3 tokens declared **inline in `users.module.ts:17-19`** — no `users.tokens.ts` file | ❌ + missing file |

### 2.3 Cross-context deep `*.tokens` imports (12 files)

12 files reach into a sibling context's deep `*.tokens.ts` instead of going through the top-level barrel. Two clusters:

- **Inside `libs/core/`** (4 sites): `libs/core/src/content/application/services/{content-state-reader,integrations-content-publisher,content-suggestion}.service.ts`, `libs/core/src/orders/application/services/order-sync.service.ts`, `libs/core/src/integrations/application/services/integrations.service.spec.ts`.
- **Outside `libs/core/`** (8 sites): `apps/api/src/webhooks/application/services/webhook-auth.service.ts`, and seven `apps/worker/test/integration/*.int-spec.ts` files.

All match the shape `from '@openlinker/core/<ctx>/<ctx>.tokens'`. The fix: drop the `/<ctx>.tokens` suffix — `@openlinker/core/<ctx>` will resolve once the sub-barrel re-exports all tokens.

### 2.4 Same-context `../../<ctx>.tokens` imports

~15 sites use relative `../../customers.tokens`, `../../products.tokens`, `../../listings.tokens`, etc. from inside the same context. Engineering-standards.md § _Import Aliases_ rule 1 permits these (depth ≤ `../..`). **Out of scope.**

---

## 3. Design

Single canonical pattern after this PR:

```ts
// libs/core/src/<ctx>/<ctx>.tokens.ts       ← all Symbol tokens for the context
export const <CTX>_<INTERFACE>_TOKEN = Symbol('<InterfacePort>');

// libs/core/src/<ctx>/index.ts              ← sub-barrel re-exports them
export * from './<ctx>.tokens';

// libs/core/src/<ctx>/<ctx>.module.ts       ← module imports them (no longer declares them)
import { <CTX>_<INTERFACE>_TOKEN } from './<ctx>.tokens';

// External consumer (sibling context, host app, plugin)
import { <CTX>_<INTERFACE>_TOKEN } from '@openlinker/core/<ctx>';
```

ESLint guards the convention by banning deep `@openlinker/core/*/*.tokens` imports in `libs/**` and `apps/**` (`no-restricted-imports`), matching the existing guards for ORM sub-barrel deep paths.

---

## 4. Step-by-step

### Step 4.1 — Create `libs/core/src/users/users.tokens.ts`

Extract the three Symbol tokens currently declared inline in `users.module.ts:17-19`.

```ts
/**
 * Users DI Tokens
 *
 * Symbol tokens for dependency injection in the users bounded context.
 *
 * @module libs/core/src/users
 */

export const USER_REPOSITORY_TOKEN = Symbol('UserRepositoryPort');
export const PASSWORD_RESET_TOKEN_REPOSITORY_TOKEN = Symbol('PasswordResetTokenRepositoryPort');
export const PASSWORD_RESET_NOTIFIER_TOKEN = Symbol('PasswordResetNotifierPort');
```

### Step 4.2 — Update `users.module.ts`

Replace the three inline `export const` declarations at lines 17-19 with a plain `import` from the new file (no re-export). Grep confirmed zero call sites reach for these tokens via `users.module.ts`, so the safety-net re-export adds confusion (two canonical import paths for the same Symbol — exactly the inconsistency this PR is eliminating) without protecting any caller.

```ts
import {
  USER_REPOSITORY_TOKEN,
  PASSWORD_RESET_TOKEN_REPOSITORY_TOKEN,
  PASSWORD_RESET_NOTIFIER_TOKEN,
} from './users.tokens';
```

Tokens are referenced inside `users.module.ts` for the `provide:` provider definitions; the import keeps them in scope. Any future caller that needs a token reaches for it via `@openlinker/core/users` (post-sub-barrel-update) or `./users.tokens` (relative, same-context).

### Step 4.3 — Normalize each cherry-picking sub-barrel

For each of the 9 cherry-picking contexts (`events`, `integrations`, `inventory`, `listings`, `mappings`, `orders`, `products`, `sync`, `users`), replace the explicit token list with `export * from './<ctx>.tokens'`:

```ts
// Before
export {
  INVENTORY_REPOSITORY_TOKEN,
  INVENTORY_SERVICE_TOKEN,
  // ...
} from './inventory.tokens';

// After
export * from './inventory.tokens';
```

For each: any token added later to `<ctx>.tokens.ts` becomes automatically available on the sub-barrel — no second edit needed. This is the whole point of the convention.

### Step 4.4 — Reroute 12 cross-context deep imports

For each file in § 2.3, drop the `/<ctx>.tokens` suffix:

```diff
-import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations/integrations.tokens';
+import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
```

The two same-context examples in `libs/core/src/integrations/application/services/integrations.service.spec.ts:16-17` are also cross-context deep imports (importing from `identifier-mapping/identifier-mapping.tokens`) — same swap.

### Step 4.5 — Add ESLint guard

Extend the existing `no-restricted-imports` overrides in `.eslintrc.js` to ban `@openlinker/core/*/*.tokens` patterns in `libs/**` and `apps/**`. Mirrors the existing guards for ORM-entities deep paths.

Pattern shape (matching how the existing ORM-entity guard is written):

```js
'no-restricted-imports': [
  'error',
  {
    patterns: [
      // ... existing patterns
      {
        group: ['@openlinker/core/*/*.tokens', '@openlinker/core/*/*.tokens.*'],
        message:
          'Import Symbol tokens through the top-level context barrel (@openlinker/core/<ctx>), not the deep <ctx>.tokens path.',
      },
    ],
  },
],
```

**Scope note**: this rule matches against the import-source *string*. The same-context relative imports inside `libs/core/src/<ctx>/**` (e.g., `from '../../customers.tokens'`) carry no `@openlinker/core/` prefix in the source string, so they don't trigger the pattern by construction. Engineering-standards.md § _Import Aliases_ rule 1 explicitly permits those up to `../..`, and this rule preserves that permission without an extra carve-out. Exact placement and override-scoping matches the precedent established by #591/#594 for the ORM sub-barrel guards.

### Step 4.6 — Document the convention in `engineering-standards.md`

Add a standalone § _Symbol DI Token Re-export Convention_ section (at the same nesting level as § _Repository Ports Pattern_) so the rule is discoverable beyond just the repository-port use case — Symbol tokens are also used for application service interfaces, port interfaces, and message-bus producers. Cross-link from the existing § _Repository Ports Pattern_ § _Why Symbol tokens?_ block.

The new section captures:

1. Every context owns a `<ctx>/<ctx>.tokens.ts` file. All Symbol tokens for the context live there.
2. The context sub-barrel does `export * from './<ctx>.tokens';` — no cherry-picking.
3. External consumers import tokens only from the top-level barrel `@openlinker/core/<ctx>`. Deep `@openlinker/core/<ctx>/<ctx>.tokens` paths are forbidden (ESLint-guarded).
4. Token-naming convention: `{CONTEXT}_{INTERFACE}_TOKEN`, e.g. `INVENTORY_REPOSITORY_TOKEN`, `OFFER_LINKING_SERVICE_TOKEN` (already followed across the tree).
5. `<ctx>.tokens.ts` files must contain **only** `export const <NAME>_TOKEN = Symbol(...);` declarations. Non-Symbol exports (types, helpers, constants) belong in `<ctx>.types.ts` or another dedicated file — `export *` from the tokens file in the sub-barrel would otherwise widen the public surface unintentionally.

### Step 4.7 — Quality gate

```bash
pnpm lint
pnpm type-check
pnpm test
```

Plus the new ESLint guard should fire on any deep `*.tokens` import that slipped through. Manual grep as belt-and-braces:

```bash
grep -rn "from ['\"]@openlinker/.*\\.tokens['\"]" apps libs --include="*.ts" \
  | grep -v "node_modules\\|dist"   # must return empty
```

---

## 5. Validation

### 5.1 Architecture

- ✅ No layer crossings introduced. Tokens stay in `<ctx>/`.
- ✅ Sub-barrel surface gains additional exports (zero removals); main barrel re-exports unchanged.
- ✅ `users` gains a `users.tokens.ts` file, matching the 12-other-context shape — explicit fix for the "13th context is the odd one out" observation in the issue body.

### 5.2 Public-API impact

- **Additive only on the sub-barrel surface**: every token previously cherry-picked stays accessible. Tokens that *were already accessible* via the deep `*.tokens` path are now *also* accessible via the top-level barrel.
- **The deep path keeps working at TS compile time** (via `tsconfig.base.json` paths mapping) — but the ESLint guard rejects new uses, and the existing 12 sites are migrated. No runtime change today; the eventual goal (covered separately under #591) is to drop deep paths entirely from `package.json` `exports`.

### 5.3 Testing

- No new tests needed. The refactor is a pure import-path rewrite + sub-barrel widening.
- All existing unit + integration tests must continue to pass unchanged.

### 5.4 Risk

- **TS dev-time path resolution** picks `libs/core/src/<ctx>/index.ts` for `@openlinker/core/<ctx>` via the workspace alias; the `export *` widens what's exposed but cannot break existing imports.
- **Star re-export semantic conflict**: `export * from './<ctx>.tokens'` would conflict if `<ctx>.tokens.ts` re-declared a name that's also exported by another file the sub-barrel pulls from. Verified by audit: no name collision exists today (token names are uniquely suffixed `_TOKEN`).
- **Star re-export over-exposure**: `export *` widens the sub-barrel to every export in `<ctx>.tokens.ts`, not just `_TOKEN` symbols. Verified by grep across all 12 token files (`grep -E "^export" <ctx>.tokens.ts | grep -v "Symbol("`): zero non-Symbol exports exist. The `<ctx>.tokens.ts` files are uniformly token-only. The new engineering-standards.md rule § 5 codifies this invariant going forward.

---

## 6. Acceptance checklist (from issue #595)

- [ ] Every sub-barrel does `export * from './<ctx>.tokens';` (12 in `libs/core/`).
- [ ] `users` has a `users.tokens.ts` file; tokens are no longer declared inline in `users.module.ts`.
- [ ] No file outside `libs/core/src/<ctx>/**` imports `@openlinker/core/<ctx>/<ctx>.tokens` — all 12 sites rerouted to `@openlinker/core/<ctx>`.
- [ ] ESLint `no-restricted-imports` rule guards against new deep `*.tokens` imports in `libs/**` and `apps/**`.
- [ ] `engineering-standards.md` § _Repository Ports Pattern_ documents the token-file convention.
- [ ] `pnpm lint && pnpm type-check && pnpm test` pass.
