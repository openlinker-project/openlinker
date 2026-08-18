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

/**
 * The gate block reason each non-auto trigger model maps to (#2100 review).
 *
 * Two of ADR-041's gate reasons are named after values of THIS enum
 * (`'trigger-model-manual'` / `'trigger-model-batched'`), and nothing else linked
 * the two vocabularies: renaming a trigger model would have left the persisted
 * reason string silently stale. This map is that link — it is keyed by the trigger
 * models that block, so renaming one is a compile error here, and the reason
 * literals are checked against ADR-041's union by the value type.
 *
 * `auto-on-paid` / `auto-on-shipped` are deliberately absent: they never block,
 * they only wait for their condition (see `TriggerGateOutcome`).
 */
export const BLOCK_REASON_BY_TRIGGER_MODEL = {
  manual: 'trigger-model-manual',
  batched: 'trigger-model-batched',
} as const satisfies Record<
  Extract<InvoiceTriggerModel, 'manual' | 'batched'>,
  SalesDocumentGateBlockReason
>;
