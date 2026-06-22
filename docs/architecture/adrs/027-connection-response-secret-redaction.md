# ADR-027: Connection response secret redaction — role-aware DTO factory

**Status:** Proposed
**Issue:** #1124
**Date:** 2026-06-22
**Author:** implementation plan for #1124

---

## Context

The `viewer` role must be safe for untrusted demo users. A key requirement from the spec (`docs/specs/product-spec-1123-rbac-depth.md` §5, R1) is that every raw config value is **absent or masked** in non-admin API responses — and that this is **deny-by-default** (non-admins receive an allow-listed projection, not a full record with sensitive fields blanked late).

The concrete sensitive field is `ConnectionResponseDto.config`, a JSONB blob that may contain shop URLs, OAuth client IDs, and other platform-specific configuration. Currently `GET /connections` and `GET /connections/:id` return the full `config` to all authenticated users.

Three enforcement points were considered:

### Option A — Class-serializer groups (`@SerializeGroups` / `@Expose`, `@Exclude`)

NestJS's `ClassSerializerInterceptor` can suppress fields via `@Expose({ groups: ['admin'] })`. The interceptor strips fields at serialization time.

**Rejected.** This is late-blanking: the full `Connection.config` object is assembled, passed to the DTO constructor, and only stripped at the HTTP response boundary by an interceptor. The strip can be bypassed if:
- A new endpoint returns `connection.config` directly (no DTO).
- An interceptor is not registered on a controller.
- A serialization opt-in annotation is forgotten on a new field.
The guarantor is a decorating convention, not the data-flow itself.

### Option B — Guard

A `SecretRedactionGuard` could inspect the response object and blank sensitive fields before they reach the serializer.

**Rejected.** Guards in NestJS run *before* the handler and cannot intercept or modify return values. This would require a custom interceptor, not a guard — and an interceptor still suffers the same late-blanking problem as Option A.

### Option C — Role-aware static factory on the DTO (chosen)

```typescript
static fromDomain(
  connection: Connection,
  supportedCapabilities: string[],
  role?: UserRole
): ConnectionResponseDto {
  dto.config = role === 'admin' ? connection.config : {};
  // ...
}
```

The DTO is built at the controller layer. The `config` field is never populated for non-admin callers — it is never in the object. There is no data to strip. The allow-list (what gets into the DTO) is explicit and colocated with the DTO definition.

## Decision

**Option C — role-aware static factory.**

The controller passes the `AuthenticatedUser.role` to `ConnectionResponseDto.fromDomain()`. When `role !== 'admin'` (or `role` is undefined), `config` is set to `{}` (an empty `Record<string, unknown>` — never `null`, to preserve the FE contract).

```typescript
// connection.controller.ts
@Get()
async list(
  @Query() filtersDto: ConnectionFiltersDto,
  @CurrentUser() user: AuthenticatedUser
): Promise<ConnectionResponseDto[]> {
  const connections = await this.connectionService.list(filters);
  return Promise.all(connections.map((c) => this.toResponse(c, user)));
}

private async toResponse(
  connection: Connection,
  user?: AuthenticatedUser
): Promise<ConnectionResponseDto> {
  const supported = /* ... */;
  return ConnectionResponseDto.fromDomain(connection, supported, user?.role);
}
```

## Consequences

**Positive:**
- Deny-by-default: the sensitive value is never constructed in the response object for non-admins. No interceptor, no decorator, no convention to forget.
- Auditable in one place: `ConnectionResponseDto.fromDomain` is the single file to audit for what non-admins receive. Adding a new sensitive field requires an explicit `role === 'admin'` guard in the same factory.
- Type-safe: the `role?: UserRole` parameter is typed; passing the wrong string is a compile error.

**Neutral:**
- The controller's `list()` and `get()` methods now require `@CurrentUser()`. This is a minor addition already present on other endpoints in the same controller.
- `config: {}` is always present in the response (not absent), so existing FE code that reads `config.someKey` gracefully gets `undefined` rather than crashing.

**Negative / trade-offs:**
- The factory must be updated if new sensitive fields are added to `Connection` in the future. Mitigation: the pattern is explicit and localized — a code review of `ConnectionResponseDto` is sufficient to audit all projected fields.
- Does not apply automatically to related DTOs (`ConnectionDiagnosticsResponseDto`). Mitigation: `GET /connections/:id/diagnostics` is gated to `@Roles('admin')` in the same PR (#1124) — the entire endpoint is admin-only rather than relying on field-level projection.

## Scope

This ADR applies only to `ConnectionResponseDto`. Other DTOs that might expose sensitive data (e.g., `AiProviderSettingsResponseDto`) are already gated at the endpoint level (`@Roles('admin')`) and do not need field-level projection.

Future connection-related DTOs (if a `ConnectionSummaryDto` is introduced for the operator role in #1126) should follow the same factory pattern.
