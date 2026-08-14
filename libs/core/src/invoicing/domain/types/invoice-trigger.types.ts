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
import type { SalesDocumentGateBlockReason } from '@openlinker/core/sales-documents';

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

/**
 * Outcome of evaluating a trigger model against ONE order transition (#2100).
 *
 * The three arms exist because "did not enqueue" is not one state, and #2100's
 * whole point is that the operator can tell them apart:
 *
 * - `proceed` — the transition qualifies; compose and enqueue.
 * - `waiting` — an `auto-on-*` model whose condition is not met YET. Level-
 *   evaluated (D3): an unpaid order is not blocked, it is waiting, and the next
 *   transition re-evaluates it. Persisting a reason here would put a permanent
 *   badge on every order that is merely early in its lifecycle.
 * - `blocked` — issuance will not happen on this connection until an operator (or
 *   a future OL release, for `batched`) changes something. Carries the neutral
 *   `SalesDocumentGateBlockReason` that gets persisted and rendered.
 */
export type TriggerGateOutcome =
  | { kind: 'proceed' }
  | { kind: 'waiting' }
  | { kind: 'blocked'; reason: SalesDocumentGateBlockReason };
