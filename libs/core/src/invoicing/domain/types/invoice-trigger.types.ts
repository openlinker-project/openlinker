/**
 * Invoice Trigger Model Types
 *
 * Per-connection trigger model that decides WHEN an order transition turns into
 * an issuance call (OL #1120). Country/regulatory-agnostic (ADR-026) — names a
 * lifecycle policy, not a tax concept, and despite the type's name it applies
 * to every sales-document kind. Persisted on `Connection.config` (no migration
 * — `ConnectionConfig` is jsonb), per document kind since #3582:
 * `config.salesDocument.triggerModels[kind]`, falling back to the legacy
 * kind-agnostic `config.invoicing.triggerModel`. `resolveTriggerModelForKind`
 * is the only reader of that precedence.
 *
 * - `manual`         — never auto-issues; issuance is operator/API-driven.
 * - `auto-on-paid`   — enqueue issuance when the order is paid.
 * - `auto-on-shipped`— enqueue issuance when the order is shipped (honored only
 *   where the source adapter emits `'shipped'` inbound — see D6).
 * - `batched`        — (#3583) qualifies when paid, like `auto-on-paid`, but
 *   waits in its connection's batch queue and is issued by a scheduled or
 *   operator-started batch run.
 *
 * @module libs/core/src/invoicing/domain/types
 */
import type {
  SalesDocumentGateBlockReason,
  SalesDocumentKind,
} from '@openlinker/core/sales-documents';

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
 * The batch run a gate evaluation belongs to (#3583): the connection running
 * and the kinds it issues. Only a `batched` order routed to THIS connection and
 * one of THESE kinds proceeds; every other order is evaluated as usual.
 */
export interface AutoIssueBatchRunScope {
  connectionId: string;
  documentKinds: readonly SalesDocumentKind[];
}

export interface AutoIssueOptions {
  batchRun?: AutoIssueBatchRunScope;
}

export function isInBatchRun(
  batchRun: AutoIssueBatchRunScope | undefined,
  connectionId: string,
  documentKind: SalesDocumentKind,
): boolean {
  return (
    batchRun !== undefined &&
    batchRun.connectionId === connectionId &&
    batchRun.documentKinds.includes(documentKind)
  );
}

/** Which rung of the precedence produced a resolved trigger model (#3582). */
export const TriggerModelSourceValues = ['kind', 'legacy', 'default'] as const;
export type TriggerModelSource = (typeof TriggerModelSourceValues)[number];

export interface ResolvedTriggerModel {
  model: InvoiceTriggerModel;
  source: TriggerModelSource;
}

function isInvoiceTriggerModel(value: unknown): value is InvoiceTriggerModel {
  return (
    typeof value === 'string' && (InvoiceTriggerModelValues as readonly string[]).includes(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The trigger model that applies to ONE document kind on a connection (#3582).
 *
 * Precedence: `config.salesDocument.triggerModels[kind]` → the legacy
 * kind-agnostic `config.invoicing.triggerModel` → `manual`. Each rung counts
 * only when it holds a recognised model, so an unrecognised kind-scoped value
 * falls through to the legacy one rather than straight to `manual`: a typo in
 * the new key must not switch off issuing the legacy key still enables.
 *
 * The legacy rung is what keeps the split backward compatible: a connection
 * that never set a kind-scoped value resolves the same model for every kind,
 * exactly as before #3582. This is deliberately not `parseTriggerModel`, which
 * collapses "unrecognised" into `manual` and would hide the fallback.
 *
 * The browser keeps a mirror of this rule
 * (`apps/web/src/features/connections/lib/resolve-trigger-model-for-kind.ts`,
 * the web bundle cannot import core, #591); both specs share one case table.
 */
export function resolveTriggerModelForKind(
  config: unknown,
  kind: SalesDocumentKind,
): ResolvedTriggerModel {
  const record = isRecord(config) ? config : {};
  const salesDocument = isRecord(record.salesDocument) ? record.salesDocument : {};
  const byKind = isRecord(salesDocument.triggerModels) ? salesDocument.triggerModels : {};

  const scoped = byKind[kind];
  if (isInvoiceTriggerModel(scoped)) {
    return { model: scoped, source: 'kind' };
  }

  const invoicing = isRecord(record.invoicing) ? record.invoicing : {};
  if (isInvoiceTriggerModel(invoicing.triggerModel)) {
    return { model: invoicing.triggerModel, source: 'legacy' };
  }

  return { model: 'manual', source: 'default' };
}

/**
 * Why `config.salesDocument.triggerModels` cannot be stored, or `null` when it
 * can. The write-side twin of `resolveTriggerModelForKind`: the reader falls
 * through an unrecognised value to the legacy key, so a typo would silently
 * leave a kind on a model the operator did not choose. The connection form
 * refuses it, but the raw config editor, curl and MCP do not go through the
 * form (#2610), so the server refuses it too. An absent or `null` key is fine.
 */
export function describeInvalidTriggerModels(config: unknown): string | null {
  const record = isRecord(config) ? config : {};
  const salesDocument = record.salesDocument;
  if (salesDocument === undefined || salesDocument === null) return null;
  if (!isRecord(salesDocument)) return 'config.salesDocument must be an object';
  const byKind = salesDocument.triggerModels;
  if (byKind === undefined || byKind === null) return null;
  if (!isRecord(byKind)) return 'config.salesDocument.triggerModels must be an object';
  for (const [kind, value] of Object.entries(byKind)) {
    if (value === null) continue;
    if (!isInvoiceTriggerModel(value)) {
      return (
        `config.salesDocument.triggerModels.${kind} must be one of: ` +
        InvoiceTriggerModelValues.join(', ')
      );
    }
  }
  return null;
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
