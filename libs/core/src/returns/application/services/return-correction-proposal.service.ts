/**
 * Return Correction Proposal Service (#2374, `W2-38`, ADR-060 / ADR-044)
 *
 * **A proposal, never an issuance.** This service reads, classifies and records.
 * It calls no adapter, crosses no provider boundary, and references neither
 * `CorrectionIssuer` nor `IInvoiceService.issueCorrection` — asserted by
 * `__tests__/proposal-never-issues.spec.ts`, because a correction transmitted to
 * a tax authority cannot be withdrawn and the safest place to keep that property
 * is a test rather than a promise.
 *
 * ## The cycle
 *
 * 1. Refuse an ORPHAN through the ONE seam (`assertAttributedForTrigger`, #2332).
 * 2. Take the disposed lines — `quantityRestocked + quantityScrapped`, the
 *    CHECK-guarded counters, never a sum over the act ledger (#2370: the ledger
 *    is history beside the invariant, never instead of it).
 * 3. Read the latest ISSUED invoice and its #1297 line snapshot; refuse rather
 *    than diff against the order's current state if the document predates it.
 * 4. Classify, purely (`classifyReturnCorrectionLines`).
 * 5. Record — or deliberately do not.
 *
 * ## Why a blocked restock excludes its line
 *
 * #2370 rule 1: a blocked restock does not increment `quantityRestocked`, because
 * the counter records BOOK-CONFIRMED restock and a refused book write confirmed
 * nothing. Those units are therefore invisible to step 2 — and crediting a buyer
 * for units whose disposition OL could not confirm would be exactly the guess
 * this programme refuses. So the line is excluded, but **loudly**: the act ledger
 * is read once per build (`findOutstandingRestockEventsForReturn`) and the line
 * is reported `no-match` / `disposition-not-confirmed`, which tells the operator
 * to attest and re-open rather than leaving the line to vanish silently.
 *
 * ## Recording: the row always matches the answer
 *
 * `openOrReuse` has no update path and the return keeps accumulating disposals,
 * so a persisted payload goes stale. An open row whose payload is identical is
 * reused; one that has diverged is `abandon`ed and replaced. `abandon` is the
 * right terminal here and not a workaround — its own contract covers a proposal
 * "that was NEVER PUT to the authority", and this one crosses no boundary at all,
 * so releasing the slot costs nothing. Consequently the row carries **no operator
 * picks**: a pick belongs to the confirm request (#2376), or the next build
 * destroys it.
 *
 * `nothing-correctable` opens NO row. A slot must not be held for a proposal
 * that has nothing to confirm — but the proposal body is still returned in full,
 * so the operator reads why each line was excluded.
 *
 * @module libs/core/src/returns/application/services
 * @implements {IReturnCorrectionProposalService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { INVOICE_SERVICE_TOKEN, type IInvoiceService } from '@openlinker/core/invoicing';
import { ORDER_CHANGE_SERVICE_TOKEN, type IOrderChangeService } from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

import { classifyReturnCorrectionLines } from '../../domain/domain-services/return-correction-matching.domain-service';
import type { CorrectionReturnLineInput } from '../../domain/domain-services/return-correction-matching.domain-service';
import { ReturnNotAttributedError } from '../../domain/exceptions/return-not-attributed.error';
import type { ReturnLine } from '../../domain/entities/return-line.entity';
import { ReturnRepositoryPort } from '../../domain/ports/return-repository.port';
import type {
  ReturnCorrectionProposal,
  ReturnCorrectionProposalLine,
  ReturnCorrectionProposalResult,
} from '../../domain/types/return-correction-proposal.types';
import type { ReturnDownstreamTrigger } from '../../domain/types/return-trigger.types';
import { RETURN_REPOSITORY_TOKEN, RETURNS_SERVICE_TOKEN } from '../../returns.tokens';
import { IReturnsService } from './returns.service.interface';
import type {
  BuildReturnCorrectionProposalInput,
  IReturnCorrectionProposalService,
} from './return-correction-proposal.service.interface';

/** The ADR-044 kind this service proposes. */
const RETURN_INVOICE_CORRECTION_KIND = 'return.invoice_correction';

/** The attribution-guard vocabulary this build is refused by (#2332). */
const RETURN_INVOICE_CORRECTION_TRIGGER: ReturnDownstreamTrigger = 'invoice_correction';

/**
 * The `targetRef` namespace. See `OrderChangeKindValues`' docblock: the shared
 * partial unique index carries no `kind`, so the key must be unique per
 * (return, document) AND must not intrude on the bare-`returnId` namespace the
 * decline/authorize kinds own.
 */
function correctionTargetRef(returnId: string, invoiceRecordId: string): string {
  return `correction:${returnId}:${invoiceRecordId}`;
}

@Injectable()
export class ReturnCorrectionProposalService implements IReturnCorrectionProposalService {
  private readonly logger = new Logger(ReturnCorrectionProposalService.name);

  constructor(
    @Inject(RETURN_REPOSITORY_TOKEN)
    private readonly repository: ReturnRepositoryPort,
    @Inject(RETURNS_SERVICE_TOKEN)
    private readonly returns: IReturnsService,
    @Inject(INVOICE_SERVICE_TOKEN)
    private readonly invoices: IInvoiceService,
    @Inject(ORDER_CHANGE_SERVICE_TOKEN)
    private readonly orderChanges: IOrderChangeService
  ) {}

  async buildProposal(
    input: BuildReturnCorrectionProposalInput
  ): Promise<ReturnCorrectionProposalResult> {
    const record = await this.returns.assertAttributedForTrigger(
      input.returnId,
      RETURN_INVOICE_CORRECTION_TRIGGER
    );

    // The guard is what makes this non-null. Re-asserted rather than `!`-ed: if a
    // future change let an orphan through, this raises the same refusal instead
    // of proposing a correction against a phantom order.
    const internalOrderId = record.internalOrderId;
    if (internalOrderId === null) {
      throw new ReturnNotAttributedError(record.id, RETURN_INVOICE_CORRECTION_TRIGGER);
    }

    const outstanding = await this.repository.findOutstandingRestockEventsForReturn(record.id);
    const linesWithUnconfirmedDisposition = new Set(
      outstanding.map((event) => event.returnLineId)
    );

    // A line whose ONLY disposition is unconfirmed contributes no counter units,
    // so it is absent from `disposedLines` — yet it is exactly the line an
    // operator must be told about. Union the two sets so it is classified and
    // excluded with a reason rather than never appearing.
    const candidateLines = record.lines.filter(
      (line) => disposedQuantityOf(line) > 0 || linesWithUnconfirmedDisposition.has(line.id)
    );

    if (candidateLines.length === 0) {
      this.logger.debug(`Return ${record.id} has no disposed lines to correct`);
      return { outcome: 'no-disposed-lines', proposal: null, changeId: null, opened: false };
    }

    const invoice = await this.invoices.getLatestIssuedInvoiceForOrder(internalOrderId);
    if (invoice === null) {
      this.logger.debug(
        `Order ${internalOrderId} holds no issued invoice; nothing for return ${record.id} to correct`
      );
      return { outcome: 'no-invoice', proposal: null, changeId: null, opened: false };
    }

    const snapshot = invoice.issuedLineSnapshot;
    if (snapshot === null) {
      // #1297's whole reason for existing: diffing against the order's CURRENT
      // state was wrong, and a pre-snapshot document gives no other basis. Refuse
      // rather than reconstruct — a reconstruction is what #1297 replaced.
      this.logger.warn(
        `Invoice ${invoice.id} predates the issued-line snapshot; refusing to propose a ` +
          `correction for return ${record.id} rather than diff against the order's current state`
      );
      return { outcome: 'no-line-snapshot', proposal: null, changeId: null, opened: false };
    }

    const lines = classifyReturnCorrectionLines(
      candidateLines.map((line) =>
        toMatcherInput(line, linesWithUnconfirmedDisposition.has(line.id))
      ),
      snapshot.lines
    );

    const proposal: ReturnCorrectionProposal = {
      returnId: record.id,
      internalOrderId,
      invoiceRecordId: invoice.id,
      invoiceConnectionId: invoice.connectionId,
      invoiceDocumentNumber: invoice.documentNumber,
      currency: snapshot.currency,
      lines,
    };

    if (!lines.some(isCorrectable)) {
      // Returned in full — the operator needs every exclusion reason — but no
      // ADR-044 slot is held for a proposal with nothing to confirm.
      this.logger.log(
        `Return ${record.id} has ${lines.length} disposed line(s), none correctable against ` +
          `invoice ${invoice.id}`
      );
      return { outcome: 'nothing-correctable', proposal, changeId: null, opened: false };
    }

    const { changeId, opened } = await this.recordProposal(
      internalOrderId,
      record.id,
      invoice.id,
      proposal,
      input.actorUserId
    );

    this.logger.log(
      `Proposed a correction of invoice ${invoice.id} for return ${record.id}: ` +
        `${lines.filter((line) => line.status === 'matched').length} matched, ` +
        `${lines.filter((line) => line.status === 'ambiguous').length} ambiguous, ` +
        `${lines.filter((line) => line.status === 'no-match').length} excluded ` +
        `(change ${changeId}). Nothing has been issued.`
    );

    return { outcome: 'proposed', proposal, changeId, opened };
  }

  /**
   * Open the ADR-044 row, or reuse the open one when it still says the same
   * thing. See the class docblock for why divergence abandons rather than
   * updates.
   */
  private async recordProposal(
    internalOrderId: string,
    returnId: string,
    invoiceRecordId: string,
    proposal: ReturnCorrectionProposal,
    actorUserId: string | null
  ): Promise<{ changeId: string; opened: boolean }> {
    const targetRef = correctionTargetRef(returnId, invoiceRecordId);
    const payload = toPayload(proposal);
    const requestedAt = new Date();

    const first = await this.orderChanges.openOrReuse({
      internalOrderId,
      kind: RETURN_INVOICE_CORRECTION_KIND,
      targetRef,
      payload,
      requestedBy: actorUserId,
      requestedAt,
    });

    if (first.opened || isSamePayload(first.change.payload, payload)) {
      return { changeId: first.change.id, opened: first.opened };
    }

    // The open row describes a proposal the operator would no longer be shown.
    // Nothing was ever put to an authority, so terminalising it is free — and
    // leaving it would mean the recorded row and the rendered proposal disagree.
    this.logger.debug(
      `Replacing stale correction proposal ${first.change.id} for return ${returnId}: ` +
        `the return's disposed lines have moved since it was opened`
    );
    await this.orderChanges.abandon(first.change.id);

    const replacement = await this.orderChanges.openOrReuse({
      internalOrderId,
      kind: RETURN_INVOICE_CORRECTION_KIND,
      targetRef,
      payload,
      requestedBy: actorUserId,
      requestedAt,
    });

    return { changeId: replacement.change.id, opened: replacement.opened };
  }
}

/**
 * Book-confirmed disposal only. NOT a sum over the act ledger: #2370 keeps the
 * counters the `CHK_return_lines_quantity_ordering`-guarded invariant, and a
 * blocked restock deliberately does not increment `quantityRestocked`.
 */
function disposedQuantityOf(line: ReturnLine): number {
  return line.quantityRestocked + line.quantityScrapped;
}

function toMatcherInput(line: ReturnLine, hasUnconfirmedDisposition: boolean): CorrectionReturnLineInput {
  return {
    returnLineId: line.id,
    lineIndex: line.lineIndex,
    name: line.name,
    sku: line.sku,
    quantityDisposed: disposedQuantityOf(line),
    hasUnconfirmedDisposition,
  };
}

function isCorrectable(line: ReturnCorrectionProposalLine): boolean {
  return line.status === 'matched' || line.status === 'ambiguous';
}

/**
 * The proposal as the jsonb payload stores it. Carries no buyer data — the same
 * rule `CreateOrderChangeInput.payload` states for `return.decline`; the snapshot's
 * buyer block is deliberately not copied here, since the proposal is about lines.
 *
 * The double cast is forced rather than careless: an `interface` gains no implicit
 * index signature, so it is not assignable to `Record<string, unknown>` however
 * plainly JSON-shaped it is. The spread is a real object of JSON-safe values.
 */
function toPayload(proposal: ReturnCorrectionProposal): Record<string, unknown> {
  return { ...proposal } as unknown as Record<string, unknown>;
}

/**
 * Recursively key-sorted JSON.
 *
 * **`JSON.stringify` alone is wrong here, and silently so.** The stored payload
 * comes back from a **jsonb** column, and Postgres normalises jsonb key order
 * (sorted by key length, then bytewise) rather than preserving insertion order —
 * so a plain stringify of the stored value never equals a stringify of the
 * freshly-built one, the reuse branch below becomes unreachable, and every build
 * abandons and re-opens a row that says exactly what the old one said. Sorting
 * both sides is what makes the comparison about CONTENT rather than about which
 * side of the database round trip the value came from.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Content equality across the jsonb round trip. See {@link canonicalJson}. */
function isSamePayload(
  stored: Record<string, unknown> | null,
  next: Record<string, unknown>
): boolean {
  if (stored === null) {
    return false;
  }
  return canonicalJson(stored) === canonicalJson(next);
}

/**
 * Exported for the spec ONLY, so the jsonb key-order property can be asserted
 * directly rather than inferred from a mock that echoes an object reference back
 * — which is precisely how the defect this function fixes stayed invisible.
 */
export const __canonicalJsonForTests = canonicalJson;
