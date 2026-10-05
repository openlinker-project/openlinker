/**
 * Correction Fallback Idempotency Key
 *
 * `IssueCorrectionCommand.idempotencyKey` is OPTIONAL, and until now a keyless
 * `issueCorrection` call skipped the whole idempotency gate (R1, "keyless is
 * never deduplicated" — the same accepted-risk contract `issueInvoice` states
 * on {@link IInvoiceService}). For `issueCorrection` that was never a merely
 * theoretical risk: the only shipped caller of the capability — the operator
 * "Issue correction" button (`apps/api/src/invoicing/http/invoicing.controller.ts`
 * → `apps/web/src/features/invoicing/hooks/use-issue-correction-mutation.ts`) —
 * never threads an `idempotencyKey` through at all, so every FE-originated
 * correction request was, and without this, would remain, completely
 * undeduplicated: a double-click or a network retry could create two real
 * correction documents at the provider and two `InvoiceRecord` rows in core.
 *
 * #3365 review, IMPORTANT finding: a shipped adapter MAY also derive its own
 * fallback dedup token when no key is supplied (eparagony's
 * `resolveRegistrationKey`, `document-token.policy.ts`'s precedent this file
 * mirrors) — for `issueCorrection` specifically, no shipped `CorrectionIssuer`
 * (KSeF / inFakt / Subiekt) does this today, but a self-deriving adapter would
 * disagree with a core that promises no dedup at all: two keyless calls could
 * create two `InvoiceRecord` rows here while the provider holds only one
 * document.
 *
 * This function closes BOTH gaps at once, by making core supply a REAL key
 * whenever the caller omits one, before the read-gate runs and before the
 * command reaches the adapter (`InvoiceService.issueCorrection` builds an
 * "effective" command with this key set and threads it through
 * `resumeExistingCorrection` / `issueCorrectionWithAdapter` /
 * `adapter.issueCorrection`). Two consequences follow structurally, not by
 * adapter-specific convention: (1) core's own `(connectionId,
 * idempotencyKey)` read-gate and unique-index guard now apply to every
 * keyless call, closing the FE gap; (2) an adapter that would otherwise
 * derive its own fallback token instead receives a real, non-empty
 * `cmd.idempotencyKey` and — per every shipped adapter's own `idempotencyKey
 * ?? fallback` shape — uses the SUPPLIED value rather than deriving one, so
 * core and the adapter can no longer disagree about how many corrections
 * exist for one request.
 *
 * The derivation deliberately does NOT collapse to `(connectionId, orderId)`
 * alone. `IssueCorrectionCommand`'s own docblock (`InvoiceService.
 * issueCorrection`) states that two DIFFERENT idempotency keys correcting the
 * same original document are a legitimate multi-correction sequence, not a
 * race to exclude — an order can legitimately be corrected more than once
 * (e.g. a quantity fix followed weeks later by an unrelated price fix). A key
 * derived from `(connectionId, orderId)` alone would silently collapse every
 * SUBSEQUENT keyless correction of one order into the FIRST one ever issued
 * (`resumeExistingCorrection` returns an `issued` hit verbatim), making a
 * second correction permanently unreachable from the FE. The key is instead
 * derived from every field that describes WHAT is being corrected — the
 * original document reference plus the correction's own content (lines,
 * reason, requested document type) — so a genuine retry (byte-identical
 * content, e.g. a double-click) hashes to the same key and dedupes, while a
 * materially different correction (different lines/reason) hashes to a
 * different key and proceeds as its own document.
 *
 * Derivation is a namespaced SHA-256 hex digest over NUL-byte-separated
 * fields, the `document-token.policy.ts` precedent (no secret, only needs to
 * be deterministic and collision-resistant). Pure — no I/O beyond
 * `node:crypto`'s synchronous hash.
 *
 * @module libs/core/src/invoicing/domain/idempotency
 */
import { createHash } from 'node:crypto';
import type { CorrectionLine, IssueCorrectionCommand } from '../types/invoicing.types';

const FALLBACK_KEY_NAMESPACE = 'openlinker:invoicing:correction-fallback:v1';

/**
 * Deterministic fallback `idempotencyKey` for a keyless
 * {@link IssueCorrectionCommand}. Only the fields that describe the
 * CORRECTION's content participate — `issuedAt` and `documentNumber` (stamped
 * by the service itself, after this function runs) and the full
 * `originalDocument` snapshot (already identified by
 * `originalProviderInvoiceId`) are deliberately excluded, or every retry of
 * the identical logical correction would mint a fresh key on every call.
 */
export function deriveCorrectionFallbackKey(
  cmd: Pick<
    IssueCorrectionCommand,
    'connectionId' | 'orderId' | 'originalProviderInvoiceId' | 'documentType' | 'reason' | 'lines'
  >,
): string {
  const digest = createHash('sha256')
    .update(
      [
        FALLBACK_KEY_NAMESPACE,
        cmd.connectionId,
        cmd.orderId,
        cmd.originalProviderInvoiceId,
        cmd.documentType ?? '',
        cmd.reason ?? '',
        canonicalizeLines(cmd.lines),
      ].join('\0'),
    )
    .digest('hex');
  return `correction-fallback:${digest}`;
}

/**
 * Stable, order-independent serialization of the correction's line deltas.
 * Sorted by `originalLineNumber` so the caller's array order (which carries
 * no semantic meaning) can never change the derived key.
 */
function canonicalizeLines(lines: CorrectionLine[]): string {
  return [...lines]
    .sort((a, b) => a.originalLineNumber - b.originalLineNumber)
    .map(
      (line) =>
        `${line.originalLineNumber}:${line.newQuantity ?? ''}:${line.newUnitPriceGross ?? ''}`,
    )
    .join('|');
}
