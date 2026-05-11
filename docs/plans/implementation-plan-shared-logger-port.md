# Implementation Plan — Shared Logger Port (#589)

**Issue**: [#589 — [F2] [HIGH] @openlinker/shared Logger is a NestJS Logger subclass — locks plugins to a Nest version](https://github.com/SilkSoftwareHouse/openlinker/issues/589)
**Thread**: Modularity Thread F · Catalog SDK-4
**Layer**: SDK / Shared infrastructure (cross-cutting backend)

---

## 1 · Goal

Decouple `@openlinker/shared/logging` from `@nestjs/common`. Adapters and core services should depend on a neutral `LoggerPort` shipped from `@openlinker/shared/logging`; the NestJS-backed implementation moves to a host-only `@openlinker/shared/logging/nest` subpath. A plugin compiled against `@openlinker/shared` must not transitively pull `@nestjs/common` through the logger.

## 2 · Non-goals

- Migrating the 91 call sites from `new Logger(ClassName.name)` to DI-based logger injection. The current factory-style API is preserved verbatim — this is a backend swap, not a consumer migration.
- Removing `@nestjs/common` from `libs/shared` peerDependencies. Other shared modules (cache, database, errors) still legitimately use Nest. The fix is scoped to `logging`.
- Adding structured-log fields, log levels beyond `log/debug/warn/error`, or transport plug-points beyond a single global backend setter. Anything richer is out of scope and would be a follow-up.

## 3 · Constraints

- **Preserve `new Logger(context)` ergonomics.** 91 import sites use this exact shape; no consumer-side changes.
- **Preserve prod log output.** Apps (API, worker) currently print via NestJS' Logger; output formatting must remain visually unchanged.
- **No new runtime deps in the default path.** A plugin must work with `@openlinker/shared/logging` alone — no requirement to wire anything to get logs.
- **Backend rules**: domain layer stays framework-free; `Logger` is already only used from application/infrastructure layers, so no boundary changes required.

## 4 · Research summary

- **Consumer pattern** (uniform across 91 files): `private readonly logger = new Logger(ClassName.name);` followed by `.log/.error/.warn/.debug` calls. No DI, no extension, no `verbose`.
- **Method-call tally** (libs/core + libs/integrations): debug=358, warn=227, log=148, error=83. Four methods is the right port surface.
- **Signature shape of `.error`**: both `logger.error(msg)` and `logger.error(msg, error)`/`logger.error(msg, error.stack)` patterns are in use. Port must accept an optional second arg.
- **Reference pattern in this codebase**: `libs/shared/src/cache/` already follows port-in-shared-core + adapter-in-subpath, but uses NestJS DI. We adopt the *layering* (port in main path, default impl ships, Nest-specific impl segregated to its own subpath) but keep the **factory-style API** the existing 91 sites depend on.
- **Workspace layout**: `libs/shared/package.json` `exports` field gates Node-runtime resolution; tsconfig path alias `@openlinker/shared/*` already wildcards into `libs/shared/src/*`, so a new `/nest` subpath needs only a `package.json` exports entry.
- **Apps**: `apps/api/src/main.ts` (NestFactory.create) and `apps/worker/src/main.ts` (NestFactory.createApplicationContext) are the only places that need `installNestLogger()`.

## 5 · Design

### Layering

```
libs/shared/src/logging/
├── index.ts                     # Public surface (current path)
├── logger.port.ts               # LoggerPort interface
├── logger.types.ts              # LogLevel + LogLevelValues (as const)
├── logger.ts                    # Logger class (context-bound) + module-level backend registry
├── console-logger.adapter.ts    # ConsoleLoggerAdapter — default, zero deps
├── format-body-for-log.ts       # unchanged
├── format-body-for-log.spec.ts  # unchanged
├── logger.spec.ts               # new — colocated per local convention
└── nest/
    ├── index.ts                 # Public surface for /nest subpath
    ├── nest-logger.adapter.ts   # NestLoggerAdapter (wraps @nestjs/common Logger)
    └── install.ts               # installNestLogger() — one-liner for hosts
```

File split mirrors `libs/shared/src/cache/` precedent (`cache.port.ts` + `cache.types.ts`). Spec is colocated next to `logger.ts` to match the sibling `format-body-for-log.spec.ts` — no `__tests__/` subfolder.

### `LoggerPort` (in `logger.port.ts`)

```ts
export interface LoggerPort {
  log(message: unknown, context?: string): void;
  debug(message: unknown, context?: string): void;
  warn(message: unknown, context?: string): void;
  error(message: unknown, stack?: unknown, context?: string): void;
}
```

Adapters implement `LoggerPort` directly — the project's documented adapter pattern (`{System}{Capability}Adapter`). The earlier draft introduced a separate `LoggerBackend` interface aliased to `LoggerPort`; that was no-op signal noise and has been dropped per tech-review SUGGESTION.

### `LogLevel` (in `logger.types.ts`)

Follows the documented `as const + union` pattern (engineering-standards "Union Types: `as const` Pattern (Default)"):

```ts
export const LogLevelValues = ['log', 'debug', 'warn', 'error'] as const;
export type LogLevel = (typeof LogLevelValues)[number];
```

Runtime array is exported so future validation/filtering code (or a Swagger surface) can enumerate levels without re-declaring them.

### `Logger` class (in `logger.ts`)

- Module-level mutable `activeBackend: LoggerPort` initialised to a `ConsoleLoggerAdapter` instance.
- `setLoggerBackend(backend: LoggerPort): void` — swap (used by host wiring + tests).
- `getLoggerBackend(): LoggerPort` — exported for advanced use / tests.
- `class Logger implements LoggerPort` — constructor stores `context`. Each method delegates: `this.log(m, ctx?) => activeBackend.log(m, ctx ?? this.context)`.

This preserves the existing 91-site call shape exactly.

### `ConsoleLoggerAdapter`

- Pure TypeScript, zero deps.
- Formats as `[OL] <ISO timestamp> <LEVEL> [<context>] <message>`. (Approximates Nest's "Nest" prefix shape but isn't presented as Nest output.)
- `error(message, stack?, context?)`: writes message via `console.error`; if `stack` is provided, writes it on the next line.
- Uses `console.log` / `console.warn` / `console.error` / `console.debug` per level.
- ESLint `no-console` exemption is local to this file via an `eslint-disable` comment with reason — this is the one legitimate place to call `console.*` in the codebase.

### `NestLoggerAdapter` (in `/nest`)

- Wraps `@nestjs/common`'s `Logger`. Maintains a per-context cache of `NestLogger` instances (`Map<string, NestLogger>`) to mirror Nest's per-context formatting.
- `installNestLogger()` is the one-liner: `setLoggerBackend(new NestLoggerAdapter())`.
- This is the only file in `libs/shared/` that imports `@nestjs/common` for logging purposes after the refactor.

### Wiring

- `apps/api/src/main.ts`: `installNestLogger()` is the **first statement** of `bootstrap()`, before any other work.
- `apps/worker/src/main.ts`: same. The worker declares a module-level `const logger = new Logger('WorkerBootstrap')` and its `.catch(logger.error(...))` runs if `bootstrap()` throws — calling `installNestLogger()` as the first line of `bootstrap()` ensures even crash-path errors land in the Nest backend (and pre-init errors are still captured by the console default — visually different but never lost).
- The existing 91 consumer sites continue to work unchanged because the `Logger` class signature is preserved.

### `package.json` exports (`libs/shared/package.json`)

Add:

```json
"./logging/nest": {
  "types": "./dist/logging/nest/index.d.ts",
  "require": "./dist/logging/nest/index.js"
}
```

### Public surface

- `@openlinker/shared/logging` exports: `LoggerPort`, `LogLevel`, `LogLevelValues`, `Logger`, `setLoggerBackend`, `getLoggerBackend`, `ConsoleLoggerAdapter`, plus the existing `formatBodyForLog`.
- `@openlinker/shared/logging/nest` exports: `NestLoggerAdapter`, `installNestLogger`.
- `libs/shared/src/index.ts` already does `export * from './logging'`, so `import { Logger } from '@openlinker/shared'` (used by several call sites today) continues to resolve transparently.

## 6 · Step-by-step plan

Each step lists files touched and acceptance criteria.

### Step 1 — Add port, types, and default adapter

**Files**:
- `libs/shared/src/logging/logger.port.ts` (new) — `LoggerPort`
- `libs/shared/src/logging/logger.types.ts` (new) — `LogLevelValues` + `LogLevel`
- `libs/shared/src/logging/console-logger.adapter.ts` (new) — `ConsoleLoggerAdapter implements LoggerPort`

**Accept**: file headers per engineering-standards; `LoggerPort` lives in `*.port.ts` with the variadic `(message: unknown, ...optionalParams: unknown[]) => void` shape (mirrors Nest's signature so structured-data + error-object 2nd args keep working); `LogLevel` follows the documented `as const + union` pattern in `*.types.ts`; `ConsoleLoggerAdapter` has the four methods and zero framework imports.

### Step 2 — Rewrite `logger.ts` around the port

**Files**:
- `libs/shared/src/logging/logger.ts` (edit — remove `extends NestLogger`; add backend registry; `Logger implements LoggerPort`)

**Accept**:
- `Logger` no longer imports `@nestjs/common`.
- `new Logger(ctx)` returns an object with `log/debug/warn/error` matching today's call shape.
- `setLoggerBackend(b)` swaps the active backend; `getLoggerBackend()` returns it.
- Method delegation passes the instance's bound `context` when the caller didn't override it.

### Step 3 — Update logging barrel + verify root barrel

**Files**:
- `libs/shared/src/logging/index.ts` (edit — re-export the new symbols)

**Accept**:
- Barrel exports `LoggerPort`, `LogLevel`, `LogLevelValues`, `Logger`, `setLoggerBackend`, `getLoggerBackend`, `ConsoleLoggerAdapter` plus existing `formatBodyForLog`.
- Verify `libs/shared/src/index.ts` still does `export * from './logging'` (no edit expected — pre-existing). This is the seam that keeps `import { Logger } from '@openlinker/shared'` working for the small set of call sites that go through the root barrel.

### Step 4 — Add `nest/` subpath

**Files**:
- `libs/shared/src/logging/nest/nest-logger.adapter.ts` (new)
- `libs/shared/src/logging/nest/install.ts` (new)
- `libs/shared/src/logging/nest/index.ts` (new — barrel)

**Accept**:
- `NestLoggerAdapter` is the only place that imports `@nestjs/common` for logging.
- `installNestLogger()` wires it via `setLoggerBackend`.
- Per-context `NestLogger` cache avoids reallocating instances.

### Step 5 — Expose `/nest` subpath in package.json

**Files**:
- `libs/shared/package.json` (edit — add `./logging/nest` exports entry)

**Accept**: `pnpm --filter @openlinker/shared build` emits `dist/logging/nest/index.js` and `dist/logging/nest/index.d.ts`; consumers can `import { installNestLogger } from '@openlinker/shared/logging/nest'`.

### Step 6 — Wire `installNestLogger()` in host apps

**Files**:
- `apps/api/src/main.ts` (edit — call as **first statement** of `bootstrap()`)
- `apps/worker/src/main.ts` (edit — same)

**Accept**: both apps boot and emit logs with the same `[Nest] …` format as today; worker's crash-path `logger.error(...)` in `.catch()` hits the Nest backend because `installNestLogger()` runs synchronously at the top of `bootstrap()` before any failure can occur.

### Step 7 — Tests

**Files**:
- `libs/shared/src/logging/__tests__/logger.spec.ts` (new)

**Cases**:
- `new Logger('Ctx').log('hi')` calls the active backend's `log` with `('hi', 'Ctx')`.
- `setLoggerBackend(fake)` redirects all four methods.
- `Logger.error(msg, stack)` forwards `stack` to backend as the 2nd arg.
- After test: restore default backend in `afterEach` to avoid cross-test pollution.

**Accept**: `pnpm --filter @openlinker/shared test` passes including the new spec.

### Step 8 — Documentation

**Files**:
- `docs/architecture-overview.md` (edit — §11 Logging & Monitoring; §Technology Stack > Logging)
- `docs/engineering-standards.md` (edit — §Logging)

**Updates**:
- Point at `LoggerPort` as the contract; describe `Logger` as the consumer-facing factory.
- Note the default backend (console) and the `/nest` opt-in.
- Code sample uses `import { Logger } from '@openlinker/shared/logging'` (unchanged) — clarify it now resolves through a swappable backend, with `installNestLogger()` called in `apps/*/src/main.ts`.

**Accept**: docs no longer describe `Logger` as a NestJS subclass.

### Step 9 — Quality gate

```bash
pnpm lint
pnpm type-check
pnpm test
```

All zero-error. Spot-check that 91 existing call sites still type-check unmodified.

## 7 · Risk register

| Risk | Mitigation |
|---|---|
| `Logger.error(message, error)` (passing an `Error` object as 2nd arg) renders differently under console backend vs. Nest backend. | Console backend handles both `string` and `unknown` for `stack`; stringifies via `String(stack)` plus best-effort `stack` field extraction. Visually different from Nest in dev, but functionally lossless. Test covers this. |
| Tests that mock `Logger` directly (none found in grep, but possible) break. | Spec file grep before commit; the `Logger` class API is unchanged so anything mocking it via `jest.spyOn(logger, 'log')` continues to work. |
| Subpath export not picked up by `ts-jest` in tests. | Existing `./cache` subpath uses the same exports shape and works; replicating that pattern. Verify by adding the `/nest` test step. |
| Hot reload / dev mode picks up stale `dist/`. | Standard `pnpm install && pnpm build` after the change; tsconfig path alias `@openlinker/shared/*` resolves to `src/*` for dev so dist freshness doesn't matter at type-check time. |
| Test pollution: module-level `activeBackend` is a process-wide singleton; a future spec that calls `setLoggerBackend(...)` without restoring it leaks state into sibling specs in the same Jest worker. | The new `logger.spec.ts` restores the default in `afterEach`. Document the pattern in the spec's header comment so anyone else writing logger-related tests follows it. |

## 8 · Validation checklist

- [ ] `libs/shared/src/logging/logger.ts` contains zero imports of `@nestjs/common`.
- [ ] `grep -r "extends NestLogger" libs/` returns no results.
- [ ] `grep -r "@nestjs/common" libs/shared/src/logging/` matches only files under `libs/shared/src/logging/nest/`.
- [ ] `new Logger('X')` still compiles in all 91 existing import sites without edits.
- [ ] `apps/api` and `apps/worker` `main.ts` call `installNestLogger()` before any log emission.
- [ ] Docs updated (architecture-overview §Logging, engineering-standards §Logging).
- [ ] Quality gate (`lint`, `type-check`, `test`) passes cleanly.
- [ ] New unit spec covers backend swap + context forwarding.

## 9 · Open questions / deferred

- Should `installNestLogger()` also override Nest's own internal logger (the one Nest uses for module-init messages) via `Logger.overrideLogger`? **Decision: no** — the worker already configures Nest's internal levels via `{ logger: [...] }`; mixing concerns is out of scope. Follow-up if needed.
- A future ticket could move per-call structured fields (`logger.log(msg, { reqId, ... })`) into the port. Not in scope for #589.
