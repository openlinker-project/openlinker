# Implementation Plan: #264 — Remove legacy string-token DI fallbacks

## 1. Task Understanding

**Goal**: Delete the `{ provide: 'StringTokenName', useExisting: SYMBOL_TOKEN }` fallback providers (and matching `exports` entries) from the 7 listed core modules, so Symbol tokens become the only supported DI binding — as engineering-standards "Repository Ports Pattern" requires.

**Layer**: CORE — module metadata only. No domain/application/infrastructure logic changes.

**Non-goals**:
- Test `TestingModule` bindings (out of scope per issue).
- `'REDIS_CLIENT'` and similar external-provider bindings — not port fallbacks.
- Symbol-token naming migrations or other renames.

## 2. Research findings

Three greps establish zero consumers:

| Query | Purpose | Hits (in scope) |
|---|---|---|
| `@Inject\('[A-Z]` | decorator-style injection | 0 (only `'REDIS_CLIENT'`) |
| `inject: \[.*'[A-Z]` | factory-style `useFactory` injection | 0 (only `'REDIS_CLIENT'`) |
| `provide: '[A-Z][A-Za-z]+(Port\|Service)'` | test mocks of the same tokens | 0 |

- **30 string-token providers** in 7 core `*.module.ts` files.
- **Zero in-repo call sites** consume any of them.
- **No `*.spec.ts` mocks** reference these string tokens.
- Conclusion: the fallbacks are pure dead code with zero consumers. Delete freely.

## 3. Solution

Per module: remove the `{ provide: 'X', useExisting: X_TOKEN }` provider entry *and* the `'X'` entry in that module's `exports` array. Leave the Symbol provider + export intact.

No production code or tests need updating.

## 4. Step-by-step

One commit per module would be overkill for a delete-only change. Do all 7 in one pass, with the quality gate as the single verification step.

| # | File | Providers to remove | Exports to remove |
|---|---|---|---|
| 1 | `libs/core/src/identifier-mapping/identifier-mapping.module.ts` | `'ConnectionPort'`, `'IIdentifierMappingService'`, `'IdentifierMappingPort'`, `'IdentifierMappingRepositoryPort'` | same 4 |
| 2 | `libs/core/src/sync/sync.module.ts` | `'JobEnqueuePort'`, `'SyncJobRepositoryPort'`, `'ConnectionCursorRepositoryPort'`, `'SyncJobQueuePort'`, `'SyncLockPort'` | same 5 |
| 3 | `libs/core/src/listings/listings.module.ts` | `'OfferLinkingService'`, `'IOfferMappingSyncService'`, `'ICategoryResolutionService'`, `'OfferMappingRepositoryPort'` | same 4 |
| 4 | `libs/core/src/products/products.module.ts` | `'ProductRepositoryPort'`, `'ProductVariantRepositoryPort'`, `'IProductsService'`, `'IMasterProductSyncService'`, `'IAutoMatchVariantOffersService'` | same 5 |
| 5 | `libs/core/src/customers/customers.module.ts` | `'CustomerProjectionRepositoryPort'`, `'ICustomerProjectionService'`, `'ICustomerIdentityResolverService'`, `'CustomerIdentityResolverPort'` | same 4 |
| 6 | `libs/core/src/inventory/inventory.module.ts` | `'InventoryRepositoryPort'`, `'IInventoryService'`, `'IInventorySyncService'`, `'IMasterInventorySyncService'` | same 4 |
| 7 | `libs/core/src/orders/orders.module.ts` | `'IOrderSyncService'`, `'IOrderIngestionService'`, `'OrderRecordRepositoryPort'`, `'IOrderRecordService'` | same 4 |

**Step 8 — Unit quality gate**:
```
pnpm lint && pnpm type-check && pnpm test
```

**Step 9 — Integration tests**:
```
pnpm test:integration
```

Both must pass with zero errors. If anything fails, there's a hidden string-token consumer the grep missed — track it down and migrate to Symbol.

**Step 10 — Commit body** should record the three grep queries + their results so a future archaeologist can reconstruct the safety reasoning without re-running the analysis.

## 5. Validation

- **Architecture**: Module metadata only; no layer boundaries touched.
- **Grep coverage**: Three greps establish zero consumers (`@Inject\\('[A-Z]`, `inject: \\[.*'[A-Z]`, `provide: '[A-Z]...(Port|Service)'`) — see §2 for details. If the quality gate passes, no consumer exists.
- **Risk**: Very low. Delete-only diff on module files.
- **Integration tests**: Issue acceptance requires `pnpm test:integration` to pass. Docker is up in this session — run locally as part of the quality gate (Step 9).

## 6. Open questions resolved

| Question | Decision |
|---|---|
| Per-module commits or one commit? | One commit — delete-only, same mechanical change, easier to revert atomically if needed. |
| Keep the Symbol provider? | Yes — that's the supported pattern. Only the string fallback goes. |
| Rename any Symbols? | No — out of scope. |
