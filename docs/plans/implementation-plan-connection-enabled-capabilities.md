# Connection `enabledCapabilities` (#166)

## Goal

Let users select which capabilities a connection should fulfil. Defaults to the adapter's full supported set; capability-based resolution filters by this field.

## Decisions

- **Source of truth**: `Connection.enabledCapabilities: Capability[]` persisted on the row.
- **Default on create**: if the client omits the field, `ConnectionService.create` sets it to the adapter's `supportedCapabilities`.
- **Validation**: on create + update, every value must be in `adapter.supportedCapabilities`.
- **`adapterKey` immutable post-create**: update endpoint rejects any change to `adapterKey` (avoids "validate against which adapter" ambiguity).
- **Backfill**: one-shot migration hardcodes the two known adapter mappings; unknown rows get `[]` with a `RAISE NOTICE`. Behavior-preserving: today every row implicitly has all caps.
- **Runtime gate**: `IntegrationsService.getCapabilityAdapter` and `listCapabilityAdapters` additionally require `connection.enabledCapabilities.includes(capability)`.
- **Exception**: `CapabilityNotEnabledException extends CapabilityNotSupportedException` — existing `instanceof` callers keep working; new callers can distinguish "enable it" vs "switch connection".
- **Response DTO**: carries persisted `enabledCapabilities` + derived `supportedCapabilities` (resolved from registry at read time) so the detail page can render both checked and unchecked supported capabilities without a second request.

## Follow-ups (explicitly deferred)

- **Allegro wizard capability UI**: Allegro's only capability is `Marketplace`, and the wizard starts an OAuth redirect rather than a direct create, so the picker adds no user-visible value today. If additional Allegro capabilities appear, revisit.
- **Object-param Connection constructor**: the positional 10-arg constructor is getting noisy; a follow-up PR should refactor to `new Connection({ ... })`.
- **Cross-context coupling** (`Capability` in `integrations`, consumed by `Connection` entity in `identifier-mapping`): type-only import today, no runtime cycle. If another bounded context needs `Capability`, consider promoting it to a shared domain types module.

## Non-goals
- Per-org "default destination for capability X" pointer (deferred, see #166 open questions).
- Bulk PATCH / capability toggling across multiple connections.
- Boot-time backfill service.
- Credentials store rework (#165).

## Steps

1. **Types**: add `enabledCapabilities: Capability[]` to `ConnectionCreate` / `ConnectionUpdate`.
2. **Domain**: add field to `Connection` entity.
3. **ORM**: add `enabledCapabilities` jsonb column to `ConnectionOrmEntity`.
4. **Migration** `1780000000000-add-enabled-capabilities-to-connections.ts`: add column with `DEFAULT '[]'`, backfill by adapterKey (hardcoded mapping), log unknowns.
5. **Repository**: map field in `toDomain` / `toOrm`; apply in `update`.
6. **Exception**: new `CapabilityNotEnabledException`.
7. **ConnectionService.create**: default `enabledCapabilities` from registry when omitted; validate subset.
8. **ConnectionService.update**: reject `adapterKey` changes; validate subset for `enabledCapabilities`.
9. **IntegrationsService**: add `enabledCapabilities` gate in both `getCapabilityAdapter` + `listCapabilityAdapters`.
10. **DTOs**: input `enabledCapabilities?: Capability[]`; response includes persisted + derived supported set.
11. **Backend tests**: update existing specs; add cases for disabled capability, adapterKey-immutable, invalid capability on create.
12. **Frontend**: `Connection` type gains `enabledCapabilities` + `supportedCapabilities`; wizard shows capability checkboxes (pre-checked to supported); detail page renders `ConnectionCapabilitiesPanel` with toggle calling the existing update mutation.
13. **Quality gate**: lint, type-check, unit tests.
