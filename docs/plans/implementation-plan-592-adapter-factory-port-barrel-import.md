# Implementation plan — #592 Barrel-only imports in CORE domain ports

## 1. Understand

**Goal**: Replace deep cross-context imports in CORE port files with the top-level barrel (`@openlinker/core/<context>`), and prevent regressions with an ESLint guard scoped to `libs/core/src/**/domain/ports/*.port.ts`.

**Layer**: CORE domain ports + DX (lint config). No FE, no migration, no port-contract change.

**Non-goals**:
- **No** changes to `connection.entity.ts`. The issue text references a `Capability` deep import there ("connection.entity.ts:19"), but #576/#577 already widened `enabledCapabilities` to `string[]` and dropped the `Capability` import — the file now imports only from a local relative `./types/connection.types`. Verified via grep.
- **No** widening of the lint rule beyond ports. Ports are the surface plugin authors implement; the rest of CORE can be tightened in a future thread-F pass.
- **No** behavioural change in `AdapterFactoryPort` or `ConnectionTesterPort` themselves. Imports only.

## 2. Research

Grep across `libs/core/src/**/*.{port,capability}.ts` for `@openlinker/core/*/{domain,application,infrastructure}/` imports:

```bash
grep -rn "from '@openlinker/core/[^']*/domain/" libs/core/src \
  --include='*.port.ts' --include='*.capability.ts'
```

Result — exactly two hits, no false negatives elsewhere:

| File | Line | Current |
|---|---|---|
| `libs/core/src/integrations/domain/ports/adapter-factory.port.ts` | 9 | `import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';` |
| `libs/core/src/integrations/domain/ports/connection-tester.port.ts` | 14 | `import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';` |

The 12 sub-capability files in `libs/core/src/listings/domain/ports/capabilities/` all import via relative paths or the top-level barrel — already compliant. Folding them into the lint glob below is a guard for future regressions, not a fix.

The issue cites only the first; the second has the identical shape and same root cause (a port file teaching the deep-path pattern). In scope by the issue's own framing ("the port file's *own* import shape teaches plugin authors that deep paths are acceptable").

Barrel sanity check (`libs/core/src/identifier-mapping/index.ts`): `export * from './domain/entities/connection.entity';` — confirmed `Connection` is exported from the top-level barrel.

ESLint config inventory (`.eslintrc.js`):
- Base `no-restricted-imports` is `'warn'`, targeting deep relative paths (`../../domain/*` etc.).
- Existing override at lines 191-202 turns the rule **off** for `**/infrastructure/**`, `**/persistence/**`, and `**/application/**` files (intentional, documented). That override does **not** match port files (they live in `domain/ports/`).
- No existing override targets `**/domain/ports/**`. The new override is placed **last** in `overrides[]` so its more-specific glob is applied after the infrastructure-disable override — avoids future surprises if globs are broadened.

## 3. Design

### Import fixes

```diff
- import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';
+ import { Connection } from '@openlinker/core/identifier-mapping';
```

Applied to both port files. Pure import-path change; types resolve identically through the barrel.

### Lint guard

Add a new ESLint override (placed **last** in `overrides[]`) targeting both port files and sub-capability files in CORE — these together form the public contract surface plugin adapters implement (per `architecture-overview.md` § OfferManagerPort, the sub-capability split #337/#359):

```js
{
  // Port and capability files form the public contract surface plugin
  // adapters implement. They must import cross-context types via the
  // top-level package barrel — never deep sub-paths — so plugin authors
  // can model their imports on the contract without copying brittle
  // internal paths (#592).
  files: ['libs/core/src/**/domain/ports/**/*.{port,capability}.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [
              '@openlinker/core/*/domain/**',
              '@openlinker/core/*/application/**',
              '@openlinker/core/*/infrastructure/**',
            ],
            message:
              "Port and capability files must import cross-context types via the top-level package barrel — e.g. `import { Connection } from '@openlinker/core/identifier-mapping'` — never via deep sub-paths. Ports are the contract surface plugin authors implement; the deep-path pattern leaks unstable internals.",
          },
        ],
      },
    ],
  },
},
```

Severity `'error'`: this is a structural contract on the public-surface files, not a stylistic warning, and the codebase pattern for documented dependency rules is `'error'` (see the FE `shared/` override at lines 65-77).

The pattern allows:
- `@openlinker/core/<context>` (top-level barrel) — the desired path.
- `@openlinker/core/<context>/services` (e.g. the `listings/services` documented sub-barrel) — only restricted sub-paths are `/domain/`, `/application/`, `/infrastructure/`.
- Relative imports to sibling files (e.g. `./credentials-resolver.port`).
- External packages (`@nestjs/common` etc.).

## 4. Steps

| # | File | Change | AC |
|---|---|---|---|
| 1 | `libs/core/src/integrations/domain/ports/adapter-factory.port.ts` | Swap line 9 deep import to barrel. | Import resolves; `pnpm type-check` clean. |
| 2 | `libs/core/src/integrations/domain/ports/connection-tester.port.ts` | Swap line 14 deep import to barrel. | Same as step 1. |
| 3 | `.eslintrc.js` | Append the port/capability-files override described above (last entry in `overrides[]`). | `pnpm lint` clean on current tree. |
| 4 | Smoke-test the lint rule | Temporarily restore the deep import in `adapter-factory.port.ts`, run `pnpm lint`, confirm a `no-restricted-imports` error fires at that line, then revert. | Rule fires on bad input; passes on good input. |
| 5 | Quality gate | `pnpm lint && pnpm type-check && pnpm test`. | Zero errors / failures. |
| 6 | Commit + PR | Conventional `refactor(core)`. `Closes #592` in body. Note stale `Capability` reference in issue body. | PR opened against `main`. |

## 5. Validate

- ✅ Hexagonal: change is fully in `libs/core/src/integrations/domain/ports/` + DX config. No infrastructure touched.
- ✅ Naming: no new files. No rename. The port classes' names unchanged.
- ✅ Type safety: re-routing through the barrel preserves the exact `Connection` type — same symbol re-exported.
- ✅ No runtime impact: TypeScript imports erased at compile time; the emitted `require()` shifts from `@openlinker/core/identifier-mapping/domain/entities/connection.entity` to `@openlinker/core/identifier-mapping`, both of which the `@openlinker/core` package's `exports` field already serves.
- ✅ Backwards compat: any external consumer importing `Connection` via the deep path continues to work — the deep path remains exported. We only change the *port file's own* import; we don't remove the deep export.
- ✅ Test changes: none required. The fix is pure code-path-equivalent, and lint is enforced by the quality gate.

## 6. AC mapping (issue #592)

| Issue AC | Met by |
|---|---|
| Replace line 9 in `adapter-factory.port.ts` with the barrel import | Step 1 |
| Apply the same fix to `connection.entity.ts:19` (Capability deep import) | **Already resolved** by #576/#577 — verified in research. Will note in PR body. |
| Add a barrel-only import lint rule for `libs/core/src/**/domain/ports/*.port.ts` | Step 3 |

Bonus finding: `connection-tester.port.ts:14` has the same deep-import problem the issue describes for the factory port. Fixed in the same PR (step 2) — same root cause, same fix.
