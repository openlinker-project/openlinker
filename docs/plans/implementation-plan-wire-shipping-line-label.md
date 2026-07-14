# Implementation Plan: Wire a localized shipping-line label (#1562)

Follow-up to #1517 / PR #1546. PR #1546 added an optional `shippingLineName` to
`OrderToIssueInvoiceCommandInput` (neutral default `SHIPPING_LINE_NAME = "Shipping"`).
This issue wires that seam from a source at both issuance entry points.

## Layer
Interface (API controller) + CORE application (auto-issue trigger) + a one-line CORE type
extension. No new port, no migration.

## Decision: neutral per-connection `config.invoicing.shippingLineName` (Approach B)

Investigated both directions from the issue:

- **Approach A (provider/adapter-owned label via a new `Invoicing` sub-capability)** is
  structurally blocked at the auto-issue entry point. `AutoIssueTriggerService` has a
  deliberate one-way edge (F3): it depends only on `ConnectionPort` + `SyncJobsService` and
  injects no `IntegrationsService`. It bakes `command.lines` into the `invoicing.issue` job
  payload, and the worker (`InvoicingIssueHandler`) replays `payload.lines` verbatim (it never
  re-runs the mapper). Reaching a resolved adapter there would require either breaking F3
  (adapter resolution in the order-ingestion hot path) or fragile relabel-by-name in the
  worker. Also, no provider adapter implements such a capability today, so A would be a no-op
  label everywhere until each adapter adds national wording.

- **Approach B (chosen)** stores an opaque, operator-supplied label on the connection config.
  Both entry points already hold the `Connection` (auto-issue already reads
  `config.invoicing.triggerModel`; the controller can `ConnectionPort.get`). The value threads
  straight into the one mapper both sites use - exactly the wiring point the issue names.

**ADR-026 compliance:** core stores an opaque string; no language is hardcoded in core and no
`platformType` switch is introduced. The neutral default and the mapper contract are unchanged
(the mapper still defaults blank/absent to `"Shipping"`).

## Steps

1. **CORE type** - add `shippingLineName?: string` to `ConnectionConfig.invoicing`
   (`libs/core/src/identifier-mapping/domain/types/connection.types.ts`). Additive JSONB field,
   round-tripped verbatim by `ConnectionRepository`. **No migration** (matches `triggerModel`).

2. **Auto-issue** (`auto-issue-trigger.service.ts`) - in `onOrderTransition`, read the
   narrowed `connection.config.invoicing?.shippingLineName` and thread it through
   `composePayload` into `toIssueInvoiceCommand({ ..., shippingLineName })`.

3. **Controller** (`apps/api/src/invoicing/http/invoicing.controller.ts`) - inject
   `CONNECTION_PORT_TOKEN`; add a resilient private `resolveShippingLineName(connectionId)`
   helper (returns `undefined` on any lookup failure so issuance never breaks); pass the value
   into all four `toIssueInvoiceCommand` calls: `issueInvoice`, `retryOne`, `issueOneForOrder`,
   and the correction fallback `buildOriginalDocumentSnapshot`.

4. **Tests** - auto-issue spec: label threaded into payload shipping line when configured;
   neutral default when absent. Controller spec: label threaded into the issued command; default
   when absent.

## Out of scope / honest boundary

- **No backend DTO validation** - `config.invoicing` is a passthrough JSONB shape with no strict
  DTO today (`triggerModel` is coerced leniently at read time, not DTO-validated). Adding a
  strict validator would be new surface unrelated to the wiring; the label is an optional
  operator string the mapper already trims/defaults.
- **Dedicated FE field deferred** - the current invoicing-config FE is Subiekt-plugin-coupled
  (`subiektTriggerModel` in the Subiekt structured section), while `shippingLineName` is
  provider-generic across all invoicing providers. A clean generic FE input is a larger,
  separate change. The field is settable today via the connection create/update API (JSONB
  passthrough), so the backend wiring is fully functional standalone.
