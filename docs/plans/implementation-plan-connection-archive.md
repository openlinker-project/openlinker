# Implementation Plan - Archive (soft delete) and restore a connection (#3657)

## 1. Task

An operator can disable a connection but never remove it. Add **archive** (soft delete) for a
disabled connection, and **restore** for an archived one.

**Layer**: CORE (status vocabulary, repository default filter, adapter resolution) + Interface
(API routes) + Frontend (`/connections` list, connection detail page).

**Non-goals**
- Hard delete. The seven `ON DELETE CASCADE` tables would lose mappings with no undo.
- Uninstalling webhooks at the remote platform. Ingress already refuses any connection that is
  not `active` (`webhook-auth.service.ts:86`).
- Deduplicating identifier mappings when the same shop is added again as a NEW connection.

## 2. Research

| Fact | Where |
|---|---|
| Status is a closed union, stored as plain `varchar` | `connection.types.ts:32`, `connection.orm-entity.ts:35` |
| Every connection read goes through ONE `list()` | `connection.repository.ts:63` |
| `listCapabilityAdapters` (with or without `includeAllStatuses`) calls that `list()` | `integrations.service.ts:164` |
| Adapter resolution refuses only `disabled` | `integrations.service.ts:66` |
| `PATCH /connections/:id` accepts any `ConnectionStatusValues` member | `update-connection.dto.ts:29` |
| `disable()` evicts the HTTP transport cache | `connection.service.ts:1132` |
| Credential rows: `create` / `delete(ref)` exist on the port | `integration-credential-repository.port.ts:53,65` |
| `updateCredentials` refuses a non-`db:` ref | `connection.service.ts:1108` |
| `credentialsBacked` = `credentialsRef.startsWith('db:')` | `connection-response.dto.ts:113` |
| FE status switches that must gain a case | `connections-list-page.tsx:25`, `connection-detail-page.tsx:29`, `sales-documents-panel.tsx:54` |
| `ConfirmDialog` supports `body` + `confirmDisabled` | `shared/ui/confirm-dialog.tsx` |
| `DataTable` ignores row clicks on interactive children | `data-table.tsx:296` |

No raw SQL or ORM query outside `ConnectionRepository` reads the `connections` table in production
code, so the repository is a real single choke point.

## 3. Design

### 3.1 Vocabulary
`ConnectionStatusValues` gains `'archived'`. No migration: the column is `varchar`.

### 3.2 The one filter
`ConnectionRepository.list(filters)`:
- `filters.status` set -> exact match (as today). `status: 'archived'` is the ONLY way to read
  archived rows through `list()`.
- `filters.status` absent -> `status <> 'archived'`.

That single rule covers `GET /connections`, every `useConnectionsQuery` picker, every
`listCapabilityAdapters` caller (including the five `includeAllStatuses` readers:
analytics-trust, catalog-trust, returns, fulfillment-authority, who-decides), and the scheduler.

`get(id)` stays unfiltered, so history keeps showing the real name.

### 3.3 Adapter resolution
`IntegrationsService.getAdapter` throws `ConnectionDisabledException` for `archived` as well as
`disabled`.

### 3.4 Service + routes (`ConnectionService`, `ConnectionController`)
- `archive(id)`
  - `NotFoundException` when missing.
  - Already `archived` -> return as is (idempotent).
  - Not `disabled` -> `ConflictException` naming the current status.
  - Delete the credential row when `credentialsRef` starts with `db:` (a missing row is
    tolerated: `delete` returns `false`), then write `{ status: 'archived', credentialsRef: '' }`.
    Order: credential first, connection second. A crash in between leaves a `disabled`
    connection pointing at a deleted row, which fails loudly on enable and is fixed by
    archiving again - the reverse order could leave an archived row with a live credential.
  - `httpTransportFactory.evict(id)`.
- `restore(id)`
  - Not `archived` -> `ConflictException`. Otherwise write `{ status: 'disabled' }`.
- `update(id, patch)` gains two guards before any other work:
  - `patch.status === 'archived'` -> `BadRequestException` ("use PATCH /connections/:id/archive").
  - `existing.status === 'archived'` and `patch.status` present -> `ConflictException`
    ("use PATCH /connections/:id/restore").
- `updateCredentials` on a connection with `credentialsRef === ''` mints a new credential row
  (same code path as `create()`: rewrite, validate shape, `credentials.create`) and writes the
  new `db:` ref. Merge-onto-existing stays for `db:` refs.
- `updateCredentials` refuses an `archived` row with 409 (restore first).
- `ConnectionUpdate` gains optional `credentialsRef`, applied by `ConnectionRepository.update`.
  Only `ConnectionService` sets it; `UpdateConnectionDto` does NOT expose it.
- Routes: `PATCH :id/archive`, `PATCH :id/restore`, both `@Roles('admin')`, returning
  `ConnectionResponseDto` like `disable`.

### 3.5 Frontend
- `ConnectionStatus` mirror + `CONNECTION_STATUSES` gain `'archived'`; the three status switches
  map it to `neutral`.
- `connections.api.ts`: `archive(id)`, `restore(id)`. Hooks
  `use-archive-connection-mutation.ts`, `use-restore-connection-mutation.ts`, invalidating
  `connectionsQueryKeys.all`.
- `ArchiveConnectionDialog` (`features/connections/components/`): `ConfirmDialog`, `tone="danger"`,
  body lists what happens (hidden everywhere, credentials removed, mappings and history kept,
  restorable) and holds a text input; `confirmDisabled` until the input equals the connection
  name exactly.
- `/connections` list: an `actions` column. `disabled` row -> **Archive** (opens the dialog).
  `archived` row -> **Restore** (no dialog). Gated with `useWriteAccess('connections:write')` +
  `ReadOnlyLock`, like the detail page. Card view gets the same action.
- Connection detail page (`ConnectionActionsPanel`):
  - `disabled`: an **Archive** row below **Enable**.
  - `archived`: an "Archived" row with **Restore** only; Test, Trigger sync, Disable and Enable
    are hidden (none of them can work).
- Re-entering credentials after restore: see § 3.6.
- Export the dialog and hooks from the `features/connections` barrel only if a page needs them
  (pages may deep-import today, so no new barrel entries are required).

### 3.6 Re-entering credentials after restore (option B)

A restored connection has `credentialsRef === ''`. Today every plugin `CredentialsPanel` and the
host fallback gate on `credentialsBacked`, which is `ref.startsWith('db:')`, so they would render
read-only and the operator could not put credentials back.

- **`credentialsBacked` means "editable via `PUT /connections/:id/credentials`"**, which after
  § 3.4 is true for a `db:` ref AND for an empty ref on an adapter that requires credentials:
  `ref.startsWith('db:') || (ref === '' && resolveRequiresCredentials(metadata))`. The controller
  already resolves `metadata` in `toResponse`, so `ConnectionResponseDto.fromDomain` takes the
  flag as a parameter. On a metadata failure the default is `resolveRequiresCredentials(undefined)`
  (`true`).
- **New field `credentialsStored: boolean`** = `ref.startsWith('db:')`: "a credential row exists".
  It separates "editable and set" from "editable and missing".
- `updateCredentials` refuses a credential-less adapter (`requiresCredentials: false`) with 400,
  so no row is minted that nothing reads.
- Frontend:
  - `Connection` type gains `credentialsStored`.
  - Detail page: the credentials summary reads `DB-managed` / `Not set` / `Environment variable`.
  - Detail page, `disabled` and `credentialsBacked && !credentialsStored`: an Alert "This
    connection has no credentials" with the next step - an OAuth platform
    (`requiresExternalAuthRedirect`) links to the setup wizard in re-auth mode
    (`{setupCard.to}?reauth={id}`, the existing `ReauthRequiredBanner` target, whose backend path
    `reauthenticateExistingConnection` calls `updateCredentials`); every other platform links to
    the edit page. **Enable** is hidden in that state: enabling a connection with no credentials
    would only fail on the first job.
  - `EditConnectionForm` host fallback (platforms with no `CredentialsPanel`) shows
    `Not set` for that state instead of `Stored securely`.

**Side effect, intended**: an existing connection that already carries `''` on an adapter that
requires credentials (a Subiekt GT connection without the optional bridge token) now shows an
editable credentials panel instead of "Environment variable". Its panel can now store the optional
token. Nothing about its runtime behaviour changes until an operator does so.

## 4. Steps

1. `libs/core/src/identifier-mapping/domain/types/connection.types.ts` - add `'archived'`;
   add `credentialsRef?: string` to `ConnectionUpdate`.
2. `libs/core/src/identifier-mapping/infrastructure/persistence/repositories/connection.repository.ts`
   - default exclusion in `list()`; apply `credentialsRef` in `update()`; fix the `toDomain`
   status cast to `ConnectionStatus`.
3. `libs/core/src/identifier-mapping/domain/ports/connection.port.ts` - document the `list()`
   default in the docblock.
4. `libs/core/src/integrations/application/services/integrations.service.ts` - refuse `archived`
   in `getAdapter`.
5. `apps/api/src/integrations/application/services/connection.service.ts` (+ its interface) -
   `archive`, `restore`, `update` guards, `updateCredentials` empty-ref branch.
6. `apps/api/src/integrations/http/connection.controller.ts` - two routes.
7. `apps/api/src/integrations/http/dto/connection-response.dto.ts` + `toResponse` -
   `credentialsBacked` rule and `credentialsStored` (§ 3.6).
8. FE types, api, hooks, `ArchiveConnectionDialog`, list page column, `ConnectionActionsPanel`,
   the two other status switches, the § 3.6 credentials alert and labels.
9. Tests (§ 5).

## 5. Tests

- `connection.repository` int-spec (real Postgres): default `list()` hides archived;
  `status: 'archived'` returns only archived; `get()` still returns it.
- `connection.service.spec.ts`: archive happy path (credential deleted, ref cleared, transport
  evicted), 409 per non-disabled status, idempotent re-archive, non-`db:` ref skips the delete;
  restore happy path + 409; update guards (both); updateCredentials empty-ref mints a row.
- `connection-response.dto` spec: `credentialsBacked` / `credentialsStored` for `db:`, `''` with
  and without `requiresCredentials`, and a legacy non-`db:` ref.
- `integrations.service.spec.ts`: `getAdapter` refuses `archived`.
- `connection.controller.spec.ts`: routes delegate.
- `route-authorization-coverage.spec.ts`: passes unchanged (both routes decorated).
- FE: `ArchiveConnectionDialog` (confirm disabled until exact name, calls mutation);
  `connections-list-page.test.tsx` (Archive only on disabled rows, Restore on archived rows,
  `Archived` filter option); `ConnectionActionsPanel` archived branch; detail page
  missing-credentials alert (OAuth link vs edit link, Enable hidden).

## 6. Risks and limitations

1. **Partial credential panels.** A plugin panel that sends only the changed fields (rotation
   shape) mints a row from a partial blob on a restored connection; the adapter's credentials
   shape validator refuses it with a 400 the panel already renders. Platforms with no
   `CredentialsPanel` and no OAuth wizard (eparagony) still cannot re-enter credentials in the UI;
   the API path works.
2. **Authority claims on an archived connection stop counting** (they leave every candidate set
   through § 3.2). A who-decides row made `ambiguous` by it resolves; a sales-document routing
   that relied on it resolves `unresolved` and reports through the existing #2100 reason. This is
   the intended effect and nothing rewrites the archived row's `config`.
3. **Anything reading `connections` without the port** would still see archived rows. None
   exists in production code today (§ 2); new code must go through `ConnectionPort`.
