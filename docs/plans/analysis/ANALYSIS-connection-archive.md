# Pre-implement gate - connection archive (#3657)

Plan: `docs/plans/implementation-plan-connection-archive.md`

## Verdict: READY

No Critical finding. Four Warnings, each already handled by the plan or resolvable inside
implementation without changing its design.

The audit was run directly (grep over the live tree) rather than fanned out, because the plan
touches one bounded context (`identifier-mapping` + `integrations`) and one frontend feature.

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `'archived'` status value | NEW (confirmed absent) | No `archived` / `archive` / `restore` / delete path for connections anywhere in `libs/core`, `apps/api`, `apps/web` |
| Default exclusion in `ConnectionPort.list()` | PARTIAL (extend existing) | `connection.repository.ts:63` - one query builder, every read goes through it |
| Credential deletion | EXISTS -> reuse | `IntegrationCredentialRepositoryPort.delete(ref): Promise<boolean>` (`integration-credential-repository.port.ts:65`) |
| Credential minting for an empty ref | EXISTS -> reuse | `ConnectionService.create` already does rewrite -> validate shape -> `credentials.create` -> `db:{ref}` (`connection.service.ts:818-833`) |
| `archive` / `restore` service methods | NEW, following an existing shape | `ConnectionService.disable` (`connection.service.ts:1132`) incl. `httpTransportFactory.evict` |
| Service interface entries | PARTIAL | `apps/api/src/integrations/application/interfaces/connection.service.interface.ts` exists; add both methods there |
| Typed-name confirmation dialog | EXISTS -> reuse | `shared/ui/confirm-dialog.tsx` already takes `body` + `confirmDisabled` |
| Row action inside a linked `DataTable` row | EXISTS -> reuse | `data-table.tsx:296` ignores clicks on interactive children |
| Mutation hook shape | EXISTS -> copy | `use-disable-connection-mutation.ts` |
| Migration | NOT NEEDED (confirmed) | `connections.status` is `varchar` (`connection.orm-entity.ts:35`); no CHECK constraint on it in any migration |

## Backward-compatibility findings

### W1 - `ConnectionStatus` union widens (Warning)
Every exhaustive consumer must gain an arm. Found:
- `apps/web/src/pages/connections/connections-list-page.tsx:25` (`toStatusTone`, exhaustive switch - compile error until handled) and `:19` (`CONNECTION_STATUSES` mirror)
- `apps/web/src/pages/connections/connection-detail-page.tsx:29` (exhaustive switch)
- `apps/web/src/features/sales-documents/components/sales-documents-panel.tsx:54` (switch)
- `apps/web/src/pages/insights/insights-page.tsx:50` - falls through to `neutral`, correct as is
- `apps/web/src/features/connections/api/connections.types.ts:30` (FE mirror)
- `apps/api/src/analytics-trust/dto/analytics-trust-response.dto.ts:34` - typed by the union; archived connections are excluded upstream, so the value is never emitted

No `check:invariants` mirror script covers `ConnectionStatus`, so `pnpm type-check` is the only
guard - it catches the exhaustive switches, not the fall-through ones. Out-of-tree plugins with an
exhaustive switch on `ConnectionStatus` break at compile time; acceptable for a widening.

### W2 - `ConnectionPort.list()` default changes meaning (Warning)
Signature unchanged; behaviour narrows. 16 production callers. Checked the ones that pass no
`status`: `order-ingestion.service.ts:1132` (routing claimants), `price-changes.service.ts:706`,
`bench-executor.resolver.ts:71`, `authority-status.service.ts:219`,
`connection-pricing-sync.service.ts:176,251`, `list-connections.tool.ts:38` (MCP),
`integrations.service.ts:168`. For every one of them excluding an archived connection is the
intended result (an archived connection claims no authority, routes nothing, prices nothing, is
not offered to an agent). The port docblock must state the default.

### W3 - `credentialsBacked` changes value for existing rows (Warning)
The field's own Swagger description already says `true = editable via PUT /credentials`
(`connection-response.dto.ts:46`), so the plan aligns the value with the documented meaning
rather than inventing a new one. Visible effect on existing data: a connection with
`credentialsRef === ''` on an adapter that requires credentials (Subiekt GT without the optional
bridge token) flips from read-only to an editable panel. `credentialsStored` is additive. Update
the Swagger description of both fields.

### W4 - `UpdateConnectionDto.status` now accepts `'archived'` (Warning)
`@IsEnum(ConnectionStatusValues)` (`update-connection.dto.ts:29`) will pass the new value. The
plan's `update` guard (400 for `status: 'archived'`, 409 for any status change on an archived
row) is what closes it; without it a plain `PATCH` would archive without wiping credentials.
Must ship with a test.

### No Critical items
- No barrel export removed or renamed.
- No port method signature changed (`ConnectionUpdate` gains an optional field).
- No Symbol token touched.
- No ORM schema change.
- `check-cross-context-imports`: no new cross-context import planned.
- `check-service-interfaces`: `ConnectionService` lives in `apps/api`, outside that script's scope, but its interface file exists and gets the new methods.

## Open questions

None blocking. Noted for the implementer:
- `assertUniqueConfigKeys` (`connection.service.ts:582`) compares only `active` siblings, so an
  archived connection never blocks re-creating the same shop, and restoring it to `disabled`
  never collides either. Re-enabling a restored connection goes through `update` without a
  `config` patch and therefore skips the check - pre-existing behaviour, not introduced here.
- A restored Allegro connection gets its credentials back through the existing OAuth re-auth
  flow (`oauth-connection.service.ts:286`), which calls `updateCredentials` and then
  `update({status: 'active'})`. Both work once `updateCredentials` handles an empty ref and the
  `update` guard only blocks `archived` rows.
