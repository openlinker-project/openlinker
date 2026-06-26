/**
 * Invoice Trigger Model Types
 *
 * Per-connection trigger model that decides WHEN an order transition turns into
 * an issuance call (OL #1120). Country/regulatory-agnostic (ADR-026) — names a
 * lifecycle policy, not a tax concept. Persisted on `Connection.config` under
 * `config.invoicing.triggerModel` (no migration — `ConnectionConfig` is jsonb).
 *
 * - `manual`         — never auto-issues; issuance is operator/API-driven.
 * - `auto-on-paid`   — enqueue issuance when the order is paid.
 * - `auto-on-shipped`— enqueue issuance when the order is shipped (honored only
 *   where the source adapter emits `'shipped'` inbound — see D6).
 * - `batched`        — DEFERRED to a future issue; rejected cleanly (never
 *   silently ignored) by the trigger service.
 *
 * @module libs/core/src/invoicing/domain/types
 */
export const InvoiceTriggerModelValues = [
  'manual',
  'auto-on-paid',
  'auto-on-shipped',
  'batched',
] as const;

export type InvoiceTriggerModel = (typeof InvoiceTriggerModelValues)[number];

/**
 * Parse an untrusted `config.invoicing.triggerModel` value into the enum.
 * Unset / missing / unrecognized maps to the safe default `manual` — the single
 * source of truth for trigger-model coercion.
 */
export function parseTriggerModel(value: unknown): InvoiceTriggerModel {
  return (InvoiceTriggerModelValues as readonly string[]).includes(
    value as string,
  )
    ? (value as InvoiceTriggerModel)
    : 'manual';
}
