/**
 * Invoice Service (ADR-026 "SVC")
 *
 * Core application service that orchestrates fiscal document issuance. A DUMB
 * executor: it owns idempotency, the persist-intent-before-call lifecycle, and
 * per-connection adapter resolution — it does NOT decide whether/which document
 * type to issue (`documentType` is a caller-supplied pass-through; the provider
 * adapter derives it when absent). Depends ONLY on ports
 * (`InvoiceRecordRepositoryPort` + `IIntegrationsService`), never concrete
 * adapters; nothing from `libs/integrations` is imported. No `faktura`/`paragon`/
 * `NIP` vocabulary lives here.
 *
 * The accepted-risk contract (R1/R2/R3) is on {@link IInvoiceService}. On a
 * successful issue the service also snapshots the issued-document content (§7.3):
 * seller from the adapter result, buyer/lines from the command, with per-line and
 * VAT-breakdown money computed here (country-agnostic, neutral tax-rate codes only).
 *
 * @module libs/core/src/invoicing/application/services
 * @implements {IInvoiceService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Logger } from '@openlinker/shared/logging';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import { type SyncLockPort, SYNC_LOCK_TOKEN } from '@openlinker/core/sync';
import type { IFiscalRegistrationService } from '@openlinker/core/fiscalization';
// Type-only NAMED import (never a wildcard — see
// docs/architecture-overview.md#cross-context-dependencies-in-core) of just
// the one token used in the lazy require below. Erases at compile time, never
// emits a runtime require(), so it cannot reintroduce the CommonJS cycle that
// require breaks; used only to type its return value without an inline
// `import()` type (banned by `@typescript-eslint/consistent-type-imports`).
import type { FISCAL_REGISTRATION_SERVICE_TOKEN as FiscalRegistrationServiceTokenType } from '@openlinker/core/fiscalization';

import type { IInvoiceService } from './invoice.service.interface';
import { InvoiceRecordRepositoryPort } from '../../domain/ports/invoice-record-repository.port';
import { InvoiceNumberingSeriesRepositoryPort } from '../../domain/ports/invoice-numbering-series-repository.port';
import {
  CORRECTION_NUMBERING_DOCUMENT_TYPE,
  DEFAULT_NUMBERING_DOCUMENT_TYPE,
} from '../../domain/types/invoice-numbering.types';
import {
  INVOICE_RECORD_REPOSITORY_TOKEN,
  INVOICE_NUMBERING_SERIES_REPOSITORY_TOKEN,
} from '../../invoicing.tokens';
import type { InvoiceRecord } from '../../domain/entities/invoice-record.entity';
import type { InvoicingPort } from '../../domain/ports/invoicing.port';
import { isCorrectionIssuer } from '../../domain/ports/capabilities/correction-issuer.capability';
import { isDocumentNumberConsumer } from '../../domain/ports/capabilities/document-number-consumer.capability';
import { DuplicateInvoiceRecordException } from '../../domain/exceptions/duplicate-invoice-record.exception';
import { InvoiceRecordNotFoundException } from '../../domain/exceptions/invoice-record-not-found.exception';
import { OrderAlreadyInvoicedException } from '../../domain/exceptions/order-already-invoiced.exception';
import { OrderAlreadyHasFiscalReceiptException } from '../../domain/exceptions/order-already-has-fiscal-receipt.exception';
import { InvoiceIssueContendedException } from '../../domain/exceptions/invoice-issue-contended.exception';
import {
  INVOICE_ISSUE_LOCK_TTL_MS,
  invoiceIssueLockKey,
} from './invoice-issue-lock';
import { MissingNumberingSeriesException } from '../../domain/exceptions/missing-numbering-series.exception';
import { taxRatePercentToFraction } from '../../domain/types/tax-rate-notation.types';
import { findMissingTaxRate } from '../../domain/types/order-tax-rate-gate.types';
import { isTaxRateEnforced } from '@openlinker/core/sales-documents';
import { MissingTaxRateException } from '../../domain/exceptions/missing-tax-rate.exception';
import { CapabilityNotSupportedException } from '@openlinker/core/integrations';
// Published so an adapter spec can pin its own pre-call refusal message against
// the very markers this service matches on (#2103 review) — see the constant's doc.
import { CURRENCY_REJECTION_MARKERS } from '../../domain/types/invoicing.types';
import type {
  CorrectionLine,
  GetInvoiceByOrderQuery,
  InvoiceFailureCode,
  InvoiceFailureMode,
  InvoiceOutcomePatch,
  InvoiceRecordFilters,
  InvoiceRecordPagination,
  InvoiceLine,
  IssueCorrectionCommand,
  IssuedDocumentContent,
  IssuedDocumentLine,
  IssuedDocumentLineAmounts,
  IssuedDocumentSeller,
  IssuedLineSnapshot,
  IssueInvoiceCommand,
  IssueInvoiceResult,
  PaginatedInvoiceRecords,
  RegulatoryClearanceResult,
  TaxBreakdownEntry,
} from '../../domain/types/invoicing.types';

/**
 * Capability key the connection must declare to issue a document. Open-world
 * string, registered in `integrations/domain/types/adapter.types.ts`.
 */
const INVOICING_CAPABILITY = 'Invoicing';

/**
 * Max persisted length of a sanitized `errorMessage`. The adapter is
 * third-party-shaped and may echo buyer-supplied data in a rejection message;
 * bound it before storing so `invoice_records.errorMessage` stays a small,
 * operator-facing diagnostic rather than an unbounded PII sink.
 */
const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * Max persisted length of the PII-free `failureReason` (W1). Far shorter than
 * `errorMessage` because it is a sanitized, operator-facing one-liner that is
 * SAFE to expose on the response DTO — it must never become a PII sink.
 */
const MAX_FAILURE_REASON_LENGTH = 200;

/**
 * Substrings (case-insensitive) that mark a `rejected` failure as a buyer
 * tax-identifier problem, so the FE can prompt the operator to fix the buyer
 * data. Neutral vocabulary only (no country tax-system names per ADR-026):
 * matches the generic "tax id" the adapter surfaces in its rejection reason.
 */
const TAX_ID_REJECTION_MARKERS = ['tax id', 'tax-id', 'taxid', 'tax identifier'] as const;

/**
 * Lifetime of an `issuing` CAS lease (#1200). Bounds how long a crashed
 * mid-call attempt can block same-key retries before the slot becomes
 * re-claimable.
 *
 * FISCAL SAFETY — this MUST stay strictly greater than the longest possible
 * single provider round-trip, or an expired lease could be re-claimed while the
 * original call is still in flight → a SECOND provider call → a double-issued
 * fiscal document. Today the Subiekt adapter caps its per-request `timeoutMs` at
 * 120 s at config validation (subiekt-adapter.factory.ts), so 5 min leaves a
 * comfortable 2.5× margin. The margin is now enforced BY CONSTRUCTION rather than
 * by comment: `MAX_SUPPORTED_PROVIDER_TIMEOUT_MS` records the ceiling every
 * provider adapter must keep its round-trip under, and the module-load assertion
 * below fails fast if the lease is ever lowered to (or below) that ceiling.
 *
 * @internal Exported only so the invariant is unit-testable; NOT on the
 * invoicing barrel (the barrel re-exports `InvoiceService` by name).
 */
export const ISSUING_LEASE_MS = 5 * 60 * 1000;

/**
 * Hard ceiling, in milliseconds, on any single provider round-trip the system
 * supports (incl. transport retries) — the Subiekt config validation enforces
 * its 120 s `timeoutMs` cap to honour this. The CAS lease (`ISSUING_LEASE_MS`)
 * MUST strictly exceed this so an expired lease can never be re-claimed while an
 * original provider call is still in flight (the fiscal double-issue guard).
 *
 * @internal Exported only for the unit test that pins the invariant.
 */
export const MAX_SUPPORTED_PROVIDER_TIMEOUT_MS = 120 * 1000;

// Enforce the fiscal-safety margin BY CONSTRUCTION (not by comment): fail loud at
// module load if anyone lowers the lease below the supported provider-timeout
// ceiling, which would reopen the double-issue race the lease exists to close.
if (ISSUING_LEASE_MS <= MAX_SUPPORTED_PROVIDER_TIMEOUT_MS) {
  throw new Error(
    `Fiscal-safety invariant violated: ISSUING_LEASE_MS (${ISSUING_LEASE_MS}ms) must strictly exceed ` +
      `MAX_SUPPORTED_PROVIDER_TIMEOUT_MS (${MAX_SUPPORTED_PROVIDER_TIMEOUT_MS}ms) so an expired CAS lease ` +
      `can never be re-claimed mid-flight and double-issue a fiscal document.`,
  );
}

/**
 * Neutral shape the SVC reads STRUCTURALLY off a caught adapter throwable to
 * classify the failure mode (#1200) — it is NOT an adapter error subclass and is
 * NOT value-imported. Adapters expose a neutral `failureMode` on their thrown
 * errors; the SVC reads it duck-typed. Anything it cannot read as the terminal
 * `'rejected'` is treated as the fiscal-safe `'in-doubt'`.
 */
interface NeutralFailureCarrier {
  failureMode?: unknown;
  /**
   * Operator-readable rejection reason some adapters stamp on a TERMINAL
   * `rejected` throwable (e.g. Subiekt's `SubiektInvoiceRejectedError.reason`).
   * Read STRUCTURALLY (duck-typed) — core never value-imports the adapter class.
   */
  reason?: unknown;
}

/** Money is kept to 2 decimal places (the minor-unit precision of ISO-4217 currencies used here). */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Resolve a neutral `taxRate` string code to a fractional rate. Numeric codes
 * (`'23'`, `'8'`, `'0'`) are read as a percentage; non-numeric exemption codes
 * (`zw`/`np`/…) carry no tax (0). The adapter owns the authoritative regime
 * mapping; this is only for the non-authoritative content projection.
 *
 * Notation is settled once, in `taxRatePercentToFraction` (#2247) - fractional
 * input throws there rather than being read as a hundredth of itself here.
 */
function rateFraction(taxRate: string): number {
  return taxRatePercentToFraction(taxRate) ?? 0;
}

/**
 * Apply correction deltas to the original ("before") lines, producing the
 * post-correction ("after") line set (#1297). Deltas are keyed by 1-based
 * `originalLineNumber`; each present delta overrides `quantity`/`unitPriceGross`
 * on the matching line. Lines with no matching delta pass through unchanged; a
 * delta whose `originalLineNumber` is out of range is ignored, and duplicate
 * deltas for the same line last-write-win via the `Map` (the adapter and the
 * shape validators own delta validation — the HTTP boundary rejects duplicate
 * `originalLineNumber`s outright, so neither case reaches here from the API;
 * this snapshot builder never throws). Pure: no I/O, no mutation of the inputs.
 */
function applyCorrectionDeltas(
  originalLines: readonly InvoiceLine[],
  deltas: readonly CorrectionLine[],
): InvoiceLine[] {
  const byLineNumber = new Map<number, CorrectionLine>();
  for (const delta of deltas) {
    byLineNumber.set(delta.originalLineNumber, delta);
  }
  return originalLines.map((line, index) => {
    const delta = byLineNumber.get(index + 1);
    if (!delta) {
      return line;
    }
    return {
      ...line,
      quantity: delta.newQuantity ?? line.quantity,
      unitPriceGross: delta.newUnitPriceGross ?? line.unitPriceGross,
    };
  });
}

@Injectable()
export class InvoiceService implements IInvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    @Inject(INVOICE_RECORD_REPOSITORY_TOKEN)
    private readonly repo: InvoiceRecordRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(INVOICE_NUMBERING_SERIES_REPOSITORY_TOKEN)
    private readonly numberingRepo: InvoiceNumberingSeriesRepositoryPort,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly issueLock: SyncLockPort,
    // Resolved LAZILY via ModuleRef, never via a static `InvoicingModule.imports`
    // edge to `FiscalizationModule` — see `resolveFiscalRegistrationService`.
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Issue one originating document for an order, serialized per ORDER (#2047).
   *
   * The one-invoice-per-order guard is a read (`findAllByOrderId` -> `find`), so
   * on its own it is read-then-act: two attempts on DIFFERENT connections for a
   * not-yet-invoiced order both read `[]`, both pass, and — because the
   * `(connectionId, idempotencyKey)` unique index cannot collide across
   * connections — both create a row and cross the provider boundary. The lock
   * closes that window; see {@link invoiceIssueLockKey} for why the key is per
   * order rather than per (order, connection), and for why lock-TTL expiry is not
   * a correctness cliff.
   *
   * Contended behaviour mirrors `ShipmentDispatchService.dispatch`, minus
   * anything that could re-cross the provider boundary while a peer holds the
   * lock:
   * - **Lock held by a peer:** answer from persisted state only
   *   ({@link issueContended}) — a truthful already-invoiced refusal, an
   *   idempotent replay of an already-`issued` same-key row, else the retryable
   *   {@link InvoiceIssueContendedException}.
   * - **Lock acquired:** run the real issuance; release in `finally`.
   *
   * `issueCorrection` is deliberately NOT locked: a correction is a linked
   * follow-up of an `issued` original, explicitly outside the at-most-one
   * invariant (ADR-041 §3b), so it has no cross-connection exclusivity to
   * enforce.
   */
  async issueInvoice(cmd: IssueInvoiceCommand): Promise<InvoiceRecord> {
    // #2248 (ADR-063 § 6): refuse before the lock and before any persisted
    // state is touched. This is the write-path half of the gate, and it is what
    // closes the MANUAL routes - `POST /invoices`, the panel button, bulk issue
    // - which every other block reason deliberately leaves open. A command
    // whose lines carry no rate can only be issued by a provider guessing one
    // onto a real fiscal document.
    //
    // Checked on the COMMAND rather than on the order, so no caller can bypass
    // it by composing lines itself, and so the correction path (which composes
    // its own lines from an already-issued document) is unaffected.
    //
    // Off unless the deployment opted in, and never applied to a pre-rollout
    // order - see the method's own docblock for why both gates are there.
    this.assertEveryLineHasATaxRate(cmd);

    const lockKey = invoiceIssueLockKey(cmd.orderId);
    const token = await this.issueLock.acquire(lockKey, INVOICE_ISSUE_LOCK_TTL_MS);

    if (!token) {
      return this.issueContended(cmd);
    }

    try {
      return await this.issueLocked(cmd);
    } finally {
      // Best-effort release — never let a release failure mask the issuance
      // result (a real fiscal document may already exist at this point).
      try {
        await this.issueLock.release(lockKey, token);
      } catch (releaseError) {
        this.logger.warn(
          `Failed to release invoice-issue lock ${lockKey}: ` +
            `${releaseError instanceof Error ? releaseError.message : String(releaseError)}`,
        );
      }
    }
  }

  /**
   * Refuse an issuance whose lines do not all name a tax rate (#2248).
   *
   * `'0'` passes: a zero rate is an answer, not a gap. A blank one does not -
   * that is what the mapper emits when nothing established the rate, and the
   * three shipped providers each substitute a different default for it.
   *
   * Gated twice (#2245 review). The refusal applies only when the deployment
   * has switched strict enforcement on - catalogue coverage is zero on deploy,
   * so an ungated guard refuses 100% of issuance on day one - and never to a
   * pre-rollout order, whose lines carry no rate because none was ever
   * collected and which ADR-063 § Consequences says must issue as it always
   * did. `isTaxRateEnforced` answers both at once so this site cannot check one
   * half and forget the other.
   */
  private assertEveryLineHasATaxRate(cmd: IssueInvoiceCommand): void {
    if (!isTaxRateEnforced(cmd.taxRateEra)) {
      return;
    }
    const finding = findMissingTaxRate(
      cmd.lines.map((line) => ({ productId: line.name, taxRate: line.taxRate })),
    );
    if (finding) {
      throw new MissingTaxRateException(cmd.orderId, finding);
    }
  }

  /**
   * Answer an issuance request whose per-order lock is held by a peer, using
   * PERSISTED STATE ONLY — this path never reaches the `Invoicing` adapter, so it
   * cannot be the second document.
   *
   * The checks run in the same order the locked path would, so a contended
   * caller and an uncontended one cannot disagree about the same state:
   *
   *   1. the cross-connection guard (identical to step 0 below) — if the peer
   *      already persisted its row, the honest answer is "already invoiced
   *      there", not "contended";
   *   2. an already-`issued` same-key row on the REQUESTED connection — returned
   *      verbatim, preserving idempotent replay (a pure read; deliberately NOT
   *      `resumeExisting`, which may re-cross the provider boundary);
   *   3. otherwise the peer is mid-flight with nothing persisted yet, so raise
   *      the retryable contended exception rather than proceed into the race.
   */
  private async issueContended(cmd: IssueInvoiceCommand): Promise<InvoiceRecord> {
    await this.assertNotInvoicedElsewhere(cmd.orderId, cmd.connectionId);

    const key = cmd.idempotencyKey;
    if (key !== undefined) {
      const existing = await this.repo.findByIdempotencyKey(cmd.connectionId, key);
      if (existing?.status === 'issued') {
        return existing;
      }
    }

    this.logger.warn(
      `Issuance for order ${cmd.orderId} is contended and no blocking record is persisted ` +
        `yet; refusing to race a concurrent issuance on connection ${cmd.connectionId}`,
    );
    throw new InvoiceIssueContendedException(cmd.orderId);
  }

  private async issueLocked(cmd: IssueInvoiceCommand): Promise<InvoiceRecord> {
    // (0) One-invoice-per-order guard (#2047). Runs BEFORE the idempotency gate
    // and before any row is created, so a cross-connection second issuance
    // creates nothing at all. It is the backstop that survives a mis-set primary,
    // two tabs racing, or a hand-rolled API call — the auto-issue trigger's
    // single-connection selection is the first line, not the only one. The "two
    // tabs" case holds only BECAUSE the per-order lock above serializes the
    // guard with the create that follows it.
    await this.assertNotInvoicedElsewhere(cmd.orderId, cmd.connectionId);

    // (1) Idempotency read-gate. Only when a key is supplied (R1: keyless calls
    // are never deduplicated). An already-`issued` hit is returned verbatim — no
    // second provider document. A non-`issued` hit is resumed under the
    // fiscal-safety invariant (see resumeExisting): R2/R3 closure (#1200).
    const key = cmd.idempotencyKey;
    if (key !== undefined) {
      const existing = await this.repo.findByIdempotencyKey(cmd.connectionId, key);
      if (existing) {
        return this.resumeExisting(cmd, existing);
      }
    }

    // (2) Persist intent: a `pending` row BEFORE any external call, so an
    // in-doubt crash leaves a durable trace to reconcile against.
    let pending: InvoiceRecord;
    try {
      pending = await this.repo.create({
        connectionId: cmd.connectionId,
        orderId: cmd.orderId,
        // providerType is unknown to the SVC up front; the adapter owns the
        // authoritative value and the success patch backfills it (see
        // issueWithAdapter). The pending row records '' until then.
        providerType: '',
        // documentType is a caller PASS-THROUGH; "" means "let the adapter
        // derive it". No derivation here.
        documentType: cmd.documentType ?? '',
        status: 'pending',
        idempotencyKey: key ?? null,
        // Neutral denormalized presence flag (#1202): captured at create time
        // from the command's buyer so the taxId list filter needs no Order join.
        // Non-null but empty-string values are treated as absent (no tax id).
        hasBuyerTaxId: cmd.buyer.taxId !== null && cmd.buyer.taxId.value.length > 0,
      });
    } catch (error) {
      // (5) Create-race: a concurrent same-key call won the dedup guard between
      // our read-gate and create. Re-read by key and resume the winner under the
      // SAME fiscal-safety gate. Guarded by `key !== undefined` — the guard
      // cannot fire keyless.
      if (key !== undefined && error instanceof DuplicateInvoiceRecordException) {
        const winner = await this.repo.findByIdempotencyKey(cmd.connectionId, key);
        if (winner) {
          return this.resumeExisting(cmd, winner);
        }
      }
      throw error;
    }

    return this.issueWithAdapter(cmd, pending.id);
  }

  /**
   * One-invoice-per-order guard (#2047), extended cross-KIND (#2157,
   * ADR-041 §3a/3b). Throws {@link OrderAlreadyInvoicedException} when ANY
   * record on a DIFFERENT invoicing connection blocks issuance
   * (`InvoiceRecord.blocksIssuanceElsewhere`: `pending` / `issuing` / `issued`,
   * or `failed` with a `failureMode` other than `rejected`), and throws
   * {@link OrderAlreadyHasFiscalReceiptException} when the order already
   * carries a blocking `FiscalRegistrationRecord` on ANY fiscalization
   * connection — ADR-041 decision 3a is exclusive across document KINDS, not
   * just within one: invoice or fiscal receipt, never both.
   *
   * Records on the REQUESTED connection are deliberately ignored for the
   * SAME-kind check — the per-connection lifecycle (idempotency read-gate +
   * `resumeExisting` + the CAS claim) already owns retry/replay semantics
   * there, and re-checking them here would break the idempotent replay of an
   * already-`issued` row. The CROSS-kind check has no such exemption: an
   * invoicing connection id can never collide with a fiscalization connection
   * id's own retry/replay state, so every blocking fiscal-receipt record
   * refuses regardless of which connection is asking.
   *
   * A `failed` + `rejected` record elsewhere is NOT blocking: the provider
   * refused the document and created nothing, so moving the order to another
   * provider is fiscally safe (it does change the numbering series, which the
   * operator confirms in the UI).
   *
   * **This check is a read, and is authoritative only under the per-order lock**
   * that `issueInvoice` holds around it (see {@link invoiceIssueLockKey}). Called
   * unlocked it would be read-then-act: two concurrent attempts on different
   * connections would both observe no blocking record and both proceed. Every
   * caller must therefore either hold the lock or, like {@link issueContended},
   * be unable to reach the provider at all. `FiscalRegistrationService.register`
   * (#2157) acquires the SAME lock key before registering, so a concurrent
   * cross-kind attempt is serialized the same way a same-kind one is.
   *
   * Logged at `warn`, not `error`, deliberately: a refusal here is the guard
   * WORKING — the expected outcome whenever an operator (or a stale tab) aims a
   * second connection at an invoiced order. The signal is not left to the log
   * either way: it is raised as {@link OrderAlreadyInvoicedException} /
   * {@link OrderAlreadyHasFiscalReceiptException}, mapped to a 409 the FE
   * renders against the real document. That is the opposite case to the
   * auto-issue ambiguity, which logs at `error` because nothing is raised to a
   * caller there — the install silently stops issuing.
   */
  private async assertNotInvoicedElsewhere(
    orderId: string,
    requestedConnectionId: string,
  ): Promise<void> {
    const records = await this.repo.findAllByOrderId(orderId);
    const blocking = records.find(
      (record) =>
        record.connectionId !== requestedConnectionId && record.blocksIssuanceElsewhere,
    );
    if (blocking) {
      this.logger.warn(
        `Refusing to issue a second document for order ${orderId} on connection ` +
          `${requestedConnectionId}: invoice ${blocking.id} on connection ` +
          `${blocking.connectionId} is ${blocking.status}` +
          `${blocking.status === 'failed' ? ` (failureMode=${blocking.failureMode ?? 'unknown'})` : ''}`,
      );
      throw new OrderAlreadyInvoicedException(
        orderId,
        blocking.connectionId,
        requestedConnectionId,
        blocking.status,
        blocking.id,
      );
    }

    await this.assertNoBlockingFiscalReceipt(orderId, requestedConnectionId);
  }

  /**
   * Cross-KIND half of the one-document-per-order guard (#2157, ADR-041 §3a/3b).
   * Refuses to issue an invoice when the order already carries a BLOCKING
   * `FiscalRegistrationRecord` on ANY fiscalization connection.
   *
   * Resolved via `ModuleRef.get(FISCAL_REGISTRATION_SERVICE_TOKEN, { strict:
   * false })` rather than a normal `@Inject` constructor dependency, and
   * deliberately NOT via a static `InvoicingModule.imports` edge to
   * `FiscalizationModule`: this repo's own ADR-041 decision 2 states "there is
   * no `forwardRef` anywhere in `libs/core`, `apps/api` or `apps/worker`", and a
   * normal two-way constructor dependency here (`FiscalRegistrationService`
   * already injects `IInvoiceService` the other direction, see
   * `assertNotAlreadyRegistered`) would require exactly that. `ModuleRef`'s
   * lazy, whole-container lookup breaks the cycle without it: NEITHER core
   * module's `imports` array references the other.
   *
   * A `NestJS` "provider not found" throw (fiscalization not wired into THIS
   * process) is read as "nothing can have been registered here either", which
   * is accurate: the SAME missing wiring that would hide the fiscalization
   * read also means `FiscalRegistrationService.register` cannot run in that
   * process. This is not a silent safety gap — it degrades exactly where the
   * write path it would guard against is itself unreachable. Both
   * `apps/api` and `apps/worker` import `FiscalizationModule` today (the
   * latter since #2156, for the `fiscalization.register` handler), so this
   * fallback is defensive rather than a live gap in either host process.
   *
   * CommonJS-CYCLE NOTE (found live during epic #2154 Phase 4 e2e — the
   * `ModuleRef` lookup above breaks the NestJS DI-graph cycle, but a plain
   * top-level `import { FISCAL_REGISTRATION_SERVICE_TOKEN } from
   * '@openlinker/core/fiscalization'` in THIS file still closes a REQUIRE
   * cycle one layer down: `app.module.ts` requires `@openlinker/core/invoicing`
   * first, which (via this file) requires `@openlinker/core/fiscalization`
   * mid-load, whose `fiscalization.module.ts` requires
   * `@openlinker/core/invoicing` back — landing on invoicing's own
   * still-partially-populated `module.exports`, where `InvoicingModule` (the
   * barrel's LAST export) is not yet assigned. Node hands back `undefined`,
   * and NestJS's `@Module({ imports: [...] })` decorator captures that
   * `undefined` PERMANENTLY (decorator arguments evaluate once, synchronously,
   * at class-definition time — they are not live bindings), crashing
   * `apps/api` / `apps/worker` boot with "the module at index [n] of the
   * FiscalizationModule imports array is undefined". {@link
   * resolveFiscalRegistrationService} therefore requires the token LAZILY,
   * deferred past application boot to first actual call — by then both
   * barrels have fully finished loading via `app.module.ts`'s own top-level
   * imports, so the cycle never closes mid-load. A dynamic `require()`, not
   * `import()`, because `ModuleRef.get` needs the token SYNCHRONOUSLY and by
   * exact Symbol identity — a second `Symbol('...')` with the same
   * description would not `===` the one `FiscalRegistrationService` registers
   * against.
   */
  private async assertNoBlockingFiscalReceipt(
    orderId: string,
    requestedConnectionId: string,
  ): Promise<void> {
    const fiscalRegistrationService = this.resolveFiscalRegistrationService();
    if (!fiscalRegistrationService) {
      return;
    }

    const records = await fiscalRegistrationService.getByOrderId(orderId);
    const blocking = records.find((record) => record.blocksFurtherRegistration);
    if (!blocking) {
      return;
    }

    this.logger.warn(
      `Refusing to issue a document for order ${orderId} on connection ` +
        `${requestedConnectionId}: fiscal registration ${blocking.id} on connection ` +
        `${blocking.connectionId} is ${blocking.status}` +
        `${blocking.status === 'failed' ? ` (failureMode=${blocking.failureMode ?? 'unknown'})` : ''}`,
    );
    throw new OrderAlreadyHasFiscalReceiptException(
      orderId,
      blocking.connectionId,
      requestedConnectionId,
      blocking.status,
      blocking.id,
    );
  }

  /**
   * Lazily resolve `IFiscalRegistrationService` from anywhere in the running
   * application's DI container. Returns `null` (never throws) when
   * fiscalization is not wired into this process — see
   * {@link assertNoBlockingFiscalReceipt}.
   */
  private resolveFiscalRegistrationService(): IFiscalRegistrationService | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- lazy require needed to break a CommonJS barrel-load cycle with `@openlinker/core/fiscalization` (see the doc comment above)
      const fiscalization = require('@openlinker/core/fiscalization') as {
        FISCAL_REGISTRATION_SERVICE_TOKEN: typeof FiscalRegistrationServiceTokenType;
      };
      return this.moduleRef.get<IFiscalRegistrationService>(
        fiscalization.FISCAL_REGISTRATION_SERVICE_TOKEN,
        { strict: false },
      );
    } catch (error) {
      // Expected on every process that never imports `FiscalizationModule`
      // (e.g. a deployment that only ever uses Invoicing) — `ModuleRef.get`
      // throws when the token was never bound. That case is a normal,
      // silent no-op. Anything else caught here (a malformed require, a
      // provider that threw during lazy instantiation, …) is NOT expected
      // and must not vanish without a trace: this guard is the one thing
      // standing between a fiscal receipt and a second, duplicate invoice
      // for the same order (#2157), so a swallowed unexpected error here
      // would silently disable that protection. Logged, not thrown — this
      // resolver still can't distinguish "not wired" from "broken" by type,
      // and failing closed would also break the fully-expected not-wired case.
      this.logger.warn(
        `Could not resolve IFiscalRegistrationService (treating fiscalization as not wired ` +
          `into this process): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Decide how to resume an EXISTING same-key record, enforcing the fiscal-safety
   * invariant before any retry re-crosses the provider boundary (#1200). Shared
   * by the read-gate and the create-race re-read so both honour the same rules:
   *
   *   - `issued`           -> return verbatim (idempotent replay).
   *   - live `issuing`     -> return as-is; another attempt holds the slot. NO
   *                           provider call (closes R2 + the `pending` half of R3).
   *   - in-doubt `failed`  -> return as-is for manual reconciliation. NO provider
   *                           call (a document may already exist — closes R3's
   *                           `failed` half).
   *   - re-attemptable     -> `pending`, expired `issuing`, or a terminal
   *                           `rejected` `failed`: claim the slot atomically and,
   *                           only on a WIN, re-cross the boundary. A lost claim
   *                           returns the contended row WITHOUT a provider call.
   */
  private async resumeExisting(
    cmd: IssueInvoiceCommand,
    existing: InvoiceRecord,
  ): Promise<InvoiceRecord> {
    if (existing.status === 'issued') {
      return existing;
    }

    const now = new Date();
    if (existing.isLeaseLive(now)) {
      // R2/R3: an original attempt is still in flight under a live lease. Surface
      // the in-flight row; NEVER race a second provider call alongside it.
      this.logger.warn(
        `Invoice record ${existing.id} is claimed by a live in-flight attempt; not re-attempting`,
      );
      return existing;
    }

    if (existing.status === 'failed' && !existing.isReattemptableFailure) {
      // R3: an in-doubt failure — the provider MAY have issued a document. Block
      // the auto-re-attempt and surface for manual reconciliation.
      this.logger.warn(
        `Invoice record ${existing.id} failed in-doubt (failureMode=${existing.failureMode ?? 'unknown'}); ` +
          `not auto-re-attempting — surfaced for manual reconciliation`,
      );
      return existing;
    }

    // Re-attemptable: `pending`, an expired `issuing` lease, or a terminal
    // `rejected` `failed`. issueWithAdapter claims the slot atomically first so
    // exactly one concurrent same-key retry crosses the boundary (R2).
    return this.issueWithAdapter(cmd, existing.id);
  }

  /**
   * Steps (3)+(4): atomically CLAIM the in-flight slot, resolve the per-connection
   * `'Invoicing'` adapter, cross the CORE<->Integration boundary, and patch the
   * `recordId` row with the outcome. On success -> `issued` + the six provider
   * fields (lease cleared). On a throw -> `failed` + a sanitized errorMessage + a
   * neutral `failureMode` read STRUCTURALLY off the throwable (lease cleared),
   * then rethrow (per-design propagation).
   *
   * The CAS claim (claimForIssue) is the R2 single-flight guard: a concurrent
   * same-key retry that fails to claim backs off WITHOUT calling the provider.
   */
  private async issueWithAdapter(
    cmd: IssueInvoiceCommand,
    recordId: string,
  ): Promise<InvoiceRecord> {
    // (3a) Atomic claim. A null return means a live attempt already holds the
    // slot (or the row went terminal): back off WITHOUT crossing the boundary.
    const leaseExpiresAt = new Date(Date.now() + ISSUING_LEASE_MS);
    const claimed = await this.repo.claimForIssue(recordId, leaseExpiresAt);
    if (claimed === null) {
      this.logger.warn(
        `Could not claim invoice record ${recordId} for issuance ` +
          `(held by a live attempt or already terminal); not re-attempting`,
      );
      const current = await this.repo.findById(recordId);
      if (current) {
        return current;
      }
      // Vanished between claim and re-read — surface as not-found per contract.
      throw new InvoiceRecordNotFoundException(recordId);
    }

    const adapter = await this.integrations.getCapabilityAdapter<InvoicingPort>(
      cmd.connectionId,
      INVOICING_CAPABILITY,
    );

    // (3a′) Single issuance instant (#1692). Compute ONE `issuedAt` here and
    // thread it into BOTH the numbering allocation (its date variables + period
    // key) AND the command handed to the adapter (a `DocumentNumberConsumer`
    // stamps its legal issue date from it) — so the allocated number and the
    // provider's issue date can never straddle a day/period boundary.
    const issuedAt = new Date();
    cmd = { ...cmd, issuedAt };

    // (3b) Numbering allocation (#1575). ONLY when the adapter passes
    // `isDocumentNumberConsumer` (KSeF today): allocate + persist the rendered
    // number onto this record in ONE transaction BEFORE crossing the provider
    // boundary; a retry of an already-numbered record reuses its persisted
    // number. Happens after the CAS claim so exactly one attempt allocates.
    // Non-consumer adapters (inFakt/Subiekt) get NO allocation and keep their
    // provider-assigned number. Any numbering failure is a terminal
    // (re-attemptable) `rejected` — the provider is never contacted.
    try {
      const documentNumber = await this.allocateDocumentNumber(adapter, claimed, cmd, {
        correction: cmd.correction !== undefined,
        issueDate: issuedAt,
        // #1694: the document's currency + order-origin feed numbering routing.
        currency: cmd.currency,
        source: cmd.source ?? null,
      });
      if (documentNumber !== undefined) {
        cmd = { ...cmd, documentNumber };
      }
    } catch (error) {
      await this.failRecordBeforeProvider(recordId, error);
      throw error;
    }

    let issueResult: Awaited<ReturnType<InvoicingPort['issueInvoice']>>;
    try {
      issueResult = await adapter.issueInvoice(cmd);
    } catch (error) {
      const sanitized = this.sanitizeError(error);
      const failureMode = this.classifyFailure(error);
      const failureCode = this.classifyFailureCode(error, failureMode);
      const failureReason = this.deriveFailureReason(failureCode);
      // Log the BOUNDED diagnostic + record id only — never the raw (unbounded,
      // possibly buyer-echoing) provider message to an external sink.
      this.logger.warn(
        `Invoice issuance failed for record ${recordId} (failureMode=${failureMode}, failureCode=${failureCode}): ${sanitized}`,
      );
      const patch: InvoiceOutcomePatch = {
        status: 'failed',
        errorMessage: sanitized,
        failureMode,
        // W1: machine-readable code + PII-free reason for the response DTO.
        failureCode,
        failureReason,
        // Release the lease: the attempt is over (terminal rejection or in-doubt).
        leaseExpiresAt: null,
      };
      await this.repo.updateOutcome(recordId, patch);
      throw error;
    }

    const { record: issued, seller, sourceDocument, documentLines } = issueResult;
    // #2251: prefer the document's OWN per-line amounts over core's
    // recomputation, so the stored figure matches the paper to the grosz.
    const documentContent = this.buildContent(cmd, issued, seller ?? null, documentLines);
    // #1297: snapshot the exact issue-command inputs (buyer/currency/lines) so a
    // later correction diffs against the lines AS ISSUED, not the order's current
    // state. Verbatim from the command — no recomputation.
    const issuedLineSnapshot: IssuedLineSnapshot = {
      buyer: cmd.buyer,
      currency: cmd.currency,
      lines: cmd.lines,
    };

    const patch: InvoiceOutcomePatch = {
      status: 'issued',
      // Backfill the authoritative provider identity + document type from the
      // adapter result. The pending row was created with providerType '' (the
      // SVC does not know the connection's provider up front) and documentType
      // = the caller pass-through (possibly ''); the adapter owns both, so the
      // projection would otherwise misreport them for every issued record.
      providerType: issued.providerType,
      documentType: issued.documentType,
      providerInvoiceId: issued.providerInvoiceId,
      providerInvoiceNumber: issued.providerInvoiceNumber,
      regulatoryStatus: issued.regulatoryStatus,
      clearanceReference: issued.clearanceReference,
      pdfUrl: issued.pdfUrl,
      issuedAt: issued.issuedAt,
      // Clear any stale message + failure mode/code/reason from a prior failed
      // attempt, and release the `issuing` lease — the record is now `issued`.
      errorMessage: null,
      failureMode: null,
      failureCode: null,
      failureReason: null,
      leaseExpiresAt: null,
      // W2: snapshot the issued-document content at issue time.
      documentContent,
      // W3: persist the raw source document (e.g. FA(3) XML) returned by the
      // adapter so `GET /invoices/:id/document?kind=source` can re-serve it
      // from the record snapshot without a provider round-trip (#1224).
      // `undefined` when the adapter does not surface one — leaves the column
      // null and the endpoint 409s gracefully.
      sourceDocument: sourceDocument ?? null,
      // #1297: persist the issuance-time line snapshot on the same issued patch.
      issuedLineSnapshot,
    };
    return this.repo.updateOutcome(recordId, patch);
  }

  /**
   * Allocate an OpenLinker document number for a record when the resolved adapter
   * is a `DocumentNumberConsumer` (#1575). Returns the number to stamp on the
   * command, or `undefined` when the adapter numbers documents itself (no
   * allocation — it keeps its provider-assigned number).
   *
   * Idempotent per record: a record that already carries a `documentNumber` (a
   * retry of a previously-numbered attempt) reuses it — no new sequence is burned.
   * Otherwise it resolves the connection's series by document-type routing (#9):
   * the document's neutral type (`invoice` by default, `corrected` for a
   * correction) plus the command's optional `register` (#10), falling back to the
   * register-less default route for that type and — for a correction with no
   * dedicated correction route — to the base (`invoice`) route, preserving the
   * pre-#9 "correction falls back to the main series" behaviour. Throws
   * {@link MissingNumberingSeriesException} when no route resolves, and delegates
   * to the repository's atomic allocate+persist. The issue date is the single
   * issuance instant threaded by the caller (#1692), resolved in the
   * adapter-supplied seller timezone (#7); the rendered number is length-checked
   * against the adapter's declared limit (#11).
   */
  private async allocateDocumentNumber(
    adapter: InvoicingPort,
    record: InvoiceRecord,
    cmd: { connectionId: string; documentType?: string; register?: string },
    opts: {
      correction: boolean;
      issueDate: Date;
      /** ISO-4217 currency axis for numbering routing (#1694); `null` = wildcard. */
      currency?: string | null;
      /** Neutral order-origin axis for numbering routing (#1694); `null` = wildcard. */
      source?: string | null;
    },
  ): Promise<string | undefined> {
    if (!isDocumentNumberConsumer(adapter)) {
      return undefined;
    }
    if (record.documentNumber !== null) {
      // Retry of an already-numbered record — reuse the persisted number.
      return record.documentNumber;
    }

    // #1694: the full routing axes carried into most-specific-match-wins
    // resolution (register + currency + source). currency/source are wildcards
    // when absent; the repository drops source -> currency -> register in turn.
    const axes = {
      register: cmd.register ?? null,
      currency: opts.currency ?? null,
      source: opts.source ?? null,
    };
    const routingType =
      cmd.documentType ??
      (opts.correction ? CORRECTION_NUMBERING_DOCUMENT_TYPE : DEFAULT_NUMBERING_DOCUMENT_TYPE);

    let seriesId = await this.numberingRepo.findSeriesIdForDocument(
      cmd.connectionId,
      routingType,
      axes,
    );
    if (seriesId === null && opts.correction) {
      // A correction with no dedicated correction route falls back to the base
      // (main-equivalent) series — the pre-#9 default behaviour.
      seriesId = await this.numberingRepo.findSeriesIdForDocument(
        cmd.connectionId,
        DEFAULT_NUMBERING_DOCUMENT_TYPE,
        axes,
      );
    }
    if (seriesId === null) {
      throw new MissingNumberingSeriesException(cmd.connectionId);
    }

    const allocation = await this.numberingRepo.allocateNumber({
      seriesId,
      recordId: record.id,
      connectionId: cmd.connectionId,
      // The single issuance instant (#1692) — the SAME `Date` the adapter stamps
      // its legal issue date from; date variables + period reset resolve from it
      // in the seller timezone the adapter supplies.
      issueDate: opts.issueDate,
      timeZone: adapter.numberingTimeZone,
      maxDocumentNumberLength: adapter.maxDocumentNumberLength,
    });
    return allocation.documentNumber;
  }

  /**
   * Mark a record `failed` for a numbering/config error caught BEFORE the
   * provider boundary (#1575). Terminal `rejected` — the provider was never
   * contacted, so it is safe to re-attempt once the operator fixes the series.
   * The lease is released; the original domain error is rethrown by the caller.
   */
  private async failRecordBeforeProvider(recordId: string, error: unknown): Promise<void> {
    const sanitized = this.sanitizeError(error);
    const failureReason =
      sanitized.length <= MAX_FAILURE_REASON_LENGTH
        ? sanitized
        : sanitized.slice(0, MAX_FAILURE_REASON_LENGTH);
    this.logger.warn(`Numbering allocation failed for record ${recordId}: ${sanitized}`);
    await this.repo.updateOutcome(recordId, {
      status: 'failed',
      errorMessage: sanitized,
      failureMode: 'rejected',
      failureCode: 'provider-rejected',
      failureReason,
      leaseExpiresAt: null,
    });
  }

  /**
   * Classify a caught adapter throwable into the neutral {@link InvoiceFailureMode}
   * (#1200) WITHOUT value-importing any adapter error subclass. The adapter stamps
   * a neutral `failureMode` on the errors it throws; the SVC reads it STRUCTURALLY
   * (duck-typed) here.
   *
   * Fiscal-safe default: ONLY an explicit, recognised `'rejected'` is treated as a
   * terminal no-document failure (safe to re-attempt). EVERYTHING else — an
   * absent/unknown/`'in-doubt'` marker, a plain `Error`, a non-error throwable —
   * collapses to `'in-doubt'`, which the read-gate will NOT auto-re-attempt. An
   * unclassifiable failure must never be assumed safe to re-issue.
   */
  private classifyFailure(error: unknown): InvoiceFailureMode {
    const mode = (error as NeutralFailureCarrier | null)?.failureMode;
    return mode === 'rejected' ? 'rejected' : 'in-doubt';
  }

  /**
   * Derive the neutral, closed {@link InvoiceFailureCode} (W1) from the already-
   * classified {@link InvoiceFailureMode} plus a STRUCTURAL read of the adapter
   * throwable's `reason`/message — never value-importing an adapter error class.
   *
   *   - `rejected` (TERMINAL): a tax-identifier rejection → `buyer-tax-id-invalid`;
   *     a settlement-currency rejection → `invalid-currency` (both operator-
   *     fixable on the source order); anything else → `provider-rejected`.
   *   - `in-doubt` (transient/indeterminate transport): `transport-timeout`.
   *
   * Tax id is checked first purely for determinism — a message naming both is
   * routed to the buyer-data fix, which is the more specific remedy.
   *
   * The mode is the source of truth for re-attemptability; the code is the FE-
   * facing cause refinement. An unrecognised mode can never reach here (the only
   * two values are exhaustively handled), so there is no need for a separate
   * `provider-error` branch on the mode — it is the fiscal-safe code reserved for
   * a future widening of the mode set.
   */
  private classifyFailureCode(
    error: unknown,
    failureMode: InvoiceFailureMode,
  ): InvoiceFailureCode {
    if (failureMode === 'in-doubt') {
      return 'transport-timeout';
    }
    // failureMode === 'rejected': refine off the provider's neutral reason text.
    const carrier = error as NeutralFailureCarrier | null;
    const reasonText =
      typeof carrier?.reason === 'string'
        ? carrier.reason
        : error instanceof Error
          ? error.message
          : '';
    const haystack = reasonText.toLowerCase();
    if (TAX_ID_REJECTION_MARKERS.some((marker) => haystack.includes(marker))) {
      return 'buyer-tax-id-invalid';
    }
    if (CURRENCY_REJECTION_MARKERS.some((marker) => haystack.includes(marker))) {
      return 'invalid-currency';
    }
    return 'provider-rejected';
  }

  /**
   * Map the neutral {@link InvoiceFailureCode} to a fixed, PII-free, operator-
   * facing one-liner safe to expose on the response DTO. Deliberately NOT derived
   * from the (possibly buyer-echoing) provider message — a constant per code — so
   * `failureReason` can never leak PII. Bounded for defence in depth.
   */
  private deriveFailureReason(failureCode: InvoiceFailureCode): string {
    const reasons: Record<InvoiceFailureCode, string> = {
      'buyer-tax-id-invalid': 'The buyer tax identifier was rejected as invalid.',
      // Worded to fit an adapter PRE-CALL refusal, which is the only origin
      // that actually reaches this code today (see InvoiceFailureCode's doc):
      // it never claims the provider saw a request it did not. It stays
      // accurate for a provider-side currency rejection too, should one ever
      // route here, which is why it names the condition rather than the actor.
      'invalid-currency':
        'The settlement currency is missing, malformed, or not accepted for this document. Fix the currency on the order and re-issue.',
      'provider-rejected': 'The invoicing provider rejected the request.',
      'transport-timeout':
        'The invoicing request timed out; the document may or may not have been created.',
      'provider-error': 'The invoicing provider returned an unexpected error.',
    };
    const reason = reasons[failureCode];
    return reason.length <= MAX_FAILURE_REASON_LENGTH
      ? reason
      : reason.slice(0, MAX_FAILURE_REASON_LENGTH);
  }

  async issueCorrection(cmd: IssueCorrectionCommand): Promise<InvoiceRecord> {
    // Persist intent before the provider call: `pending` row so a crash leaves
    // a durable trace. Corrections do not share the idempotency-gate / CAS-lease
    // of issueInvoice — each correction is a distinct new fiscal document with
    // its own record; the caller supplies an idempotencyKey for dedup if needed.
    const pending = await this.repo.create({
      connectionId: cmd.connectionId,
      orderId: cmd.orderId,
      providerType: '',
      documentType: cmd.documentType ?? 'corrected',
      status: 'pending',
      idempotencyKey: cmd.idempotencyKey ?? null,
    });

    const adapter = await this.integrations.getCapabilityAdapter<InvoicingPort>(
      cmd.connectionId,
      INVOICING_CAPABILITY,
    );

    if (!isCorrectionIssuer(adapter)) {
      // Adapter resolved but doesn't implement CorrectionIssuer: update the row
      // to failed (in-doubt) and throw so the caller can surface the 422.
      await this.repo.updateOutcome(pending.id, {
        status: 'failed',
        errorMessage: 'Provider does not support correction issuance.',
        failureMode: 'rejected',
        failureCode: 'provider-rejected',
        failureReason: 'The invoicing provider does not support corrections.',
        leaseExpiresAt: null,
      });
      throw new CapabilityNotSupportedException(cmd.connectionId, 'CorrectionIssuer');
    }

    // Single issuance instant for the correction (#1692): threaded into BOTH the
    // correction-number allocation and the command the adapter stamps its legal
    // issue date from, so the two can never straddle a day/period boundary.
    const issuedAt = new Date();
    cmd = { ...cmd, issuedAt };

    // Numbering allocation for the CORRECTION document (#1575) — a correction
    // draws a FRESH number from the connection's correction series (never reuses
    // the original's). Only for `DocumentNumberConsumer` adapters; a self-
    // numbering provider keeps its own number.
    try {
      const documentNumber = await this.allocateDocumentNumber(adapter, pending, cmd, {
        correction: true,
        issueDate: issuedAt,
        // #1694: a correction's currency axis is the original document's currency;
        // its source axis is the caller-supplied order origin.
        currency: cmd.originalDocument?.currency ?? null,
        source: cmd.source ?? null,
      });
      if (documentNumber !== undefined) {
        cmd = { ...cmd, documentNumber };
      }
    } catch (error) {
      await this.failRecordBeforeProvider(pending.id, error);
      throw error;
    }

    let issueResult: IssueInvoiceResult;
    try {
      issueResult = await adapter.issueCorrection(cmd);
    } catch (error) {
      const sanitized = this.sanitizeError(error);
      const failureMode = this.classifyFailure(error);
      const failureCode = this.classifyFailureCode(error, failureMode);
      const failureReason = this.deriveFailureReason(failureCode);
      this.logger.warn(
        `Correction issuance failed for record ${pending.id} (failureMode=${failureMode}, failureCode=${failureCode}): ${sanitized}`,
      );
      await this.repo.updateOutcome(pending.id, {
        status: 'failed',
        errorMessage: sanitized,
        failureMode,
        failureCode,
        failureReason,
        leaseExpiresAt: null,
      });
      throw error;
    }

    const { record: issued, seller, sourceDocument, documentLines } = issueResult;

    // #1297: snapshot the correction's OWN post-correction ("after") lines so a
    // correction-of-correction diffs against them, not the live order. Derived
    // from the caller-assembled original snapshot (`cmd.originalDocument.lines`,
    // the "before" state) with the per-line deltas applied. Only when the caller
    // supplied `originalDocument` (order still resolvable); absent → persist null
    // and the next correction falls back to order-derived reconstruction.
    const correctedLines = cmd.originalDocument
      ? applyCorrectionDeltas(cmd.originalDocument.lines, cmd.lines)
      : null;
    const issuedLineSnapshot: IssuedLineSnapshot | null =
      cmd.originalDocument && correctedLines
        ? {
            buyer: cmd.originalDocument.buyer,
            currency: cmd.originalDocument.currency,
            lines: correctedLines,
          }
        : null;
    // W2/W3 (#1229 follow-up): a correction's displayed content and source
    // document were previously never persisted at all — every corrected
    // invoice's "View"/"Preview" 409'd with "no source document available"
    // even when the adapter (KSeF) had built and submitted a real FA(3) XML.
    // Mirrors `issueInvoice`'s persistence exactly, built from the corrected
    // ("after") lines rather than the original ones.
    const documentContent =
      correctedLines && cmd.originalDocument
        ? this.buildContent(
            {
              lines: correctedLines,
              buyer: cmd.originalDocument.buyer,
              currency: cmd.originalDocument.currency,
            },
            issued,
            seller ?? null,
            // #2251: a correction is the LATEST EFFECTIVE document, so its own
            // amounts overwrite the stored ones. Without this the record would
            // keep the pre-correction figures while the paper says otherwise.
            documentLines,
          )
        : null;

    return this.repo.updateOutcome(pending.id, {
      status: 'issued',
      providerType: issued.providerType,
      documentType: issued.documentType,
      providerInvoiceId: issued.providerInvoiceId,
      providerInvoiceNumber: issued.providerInvoiceNumber,
      regulatoryStatus: issued.regulatoryStatus,
      clearanceReference: issued.clearanceReference,
      pdfUrl: issued.pdfUrl,
      issuedAt: issued.issuedAt,
      errorMessage: null,
      failureMode: null,
      failureCode: null,
      failureReason: null,
      leaseExpiresAt: null,
      issuedLineSnapshot,
      documentContent,
      sourceDocument: sourceDocument ?? null,
    });
  }

  async getInvoice(query: GetInvoiceByOrderQuery): Promise<InvoiceRecord | null> {
    // Projection read of OL's OWN store — NEVER the provider/adapter.
    return this.repo.findByOrderId(query.orderId, query.connectionId);
  }

  async getInvoiceById(invoiceId: string): Promise<InvoiceRecord | null> {
    // Projection read of OL's OWN store by primary id — NEVER the provider/adapter.
    return this.repo.findById(invoiceId);
  }

  async getLatestInvoiceForOrder(orderId: string): Promise<InvoiceRecord | null> {
    return this.repo.findLatestByOrderId(orderId);
  }

  async getLatestIssuedInvoiceForOrder(orderId: string): Promise<InvoiceRecord | null> {
    // `findAllByOrderId` is already `createdAt DESC, id DESC`, so the first
    // `issued` row IS the newest issued document — and because a successful
    // correction is itself an `InvoiceRecord`, that is automatically the prior
    // correction's own snapshot rather than the original's (#1297's
    // correction-of-a-correction rule, satisfied by construction).
    //
    // Deliberately NOT `findLatestByOrderId`: a newer `failed` or `pending` row
    // would mask the document that actually exists, and a correction proposed
    // against a row the provider never issued corrects nothing.
    const records = await this.repo.findAllByOrderId(orderId);
    return records.find((record) => record.status === 'issued') ?? null;
  }

  async findBlockingInvoiceForOrder(orderId: string): Promise<InvoiceRecord | null> {
    // Same predicate `assertNotInvoicedElsewhere` uses, exposed as a projection
    // read for cross-context consumption (#2157) — `FiscalRegistrationService`
    // calls this via `IInvoiceService` to enforce ADR-041's cross-kind
    // exclusivity. No connection exemption here: unlike the same-context guard,
    // a caller from OUTSIDE invoicing has no "requested connection" of its own
    // to exclude.
    const records = await this.repo.findAllByOrderId(orderId);
    return records.find((record) => record.blocksIssuanceElsewhere) ?? null;
  }

  async listInvoiceConnectionIdsForOrder(orderId: string): Promise<string[]> {
    // Same newest-first read the #2047 guard uses, projected to distinct
    // connections. An order holds a handful of rows at most, so de-duplicating
    // in memory beats a second, DISTINCT-shaped repository method.
    const records = await this.repo.findAllByOrderId(orderId);
    return [...new Set(records.map((record) => record.connectionId))];
  }

  async getLatestInvoicesForOrders(orderIds: string[]): Promise<InvoiceRecord[]> {
    return this.repo.findLatestByOrderIds(orderIds);
  }

  async listInvoices(
    filter: InvoiceRecordFilters,
    pagination: InvoiceRecordPagination,
  ): Promise<PaginatedInvoiceRecords> {
    // Cross-context list seam (#1119): the HTTP layer reaches the invoice
    // projection through here, never the repository port. Pure projection read.
    return this.repo.findMany(filter, pagination);
  }

  async applyRegulatoryClearance(
    invoiceId: string,
    result: RegulatoryClearanceResult,
  ): Promise<InvoiceRecord> {
    // Write-back of a refreshed clearance outcome (#1356). ONLY the two
    // regulatory fields are patched — the issuance lifecycle (status, provider
    // ids, line snapshot, failure fields) is deliberately left untouched, so a
    // resend never mutates the issued document's own record beyond its clearance
    // state. `updateOutcome` throws `InvoiceRecordNotFoundException` on an
    // unknown id.
    return this.repo.updateOutcome(invoiceId, {
      regulatoryStatus: result.regulatoryStatus,
      clearanceReference: result.clearanceReference ?? null,
    });
  }

  /**
   * Derive a length-bounded, operator-facing diagnostic from a thrown error.
   *
   * The returned text is INTERNAL-ONLY: it is persisted to
   * `invoice_records.errorMessage` and surfaced via `getInvoice` to operators,
   * is NOT returned to untrusted external callers, and MAY contain provider-echoed
   * buyer data — hence the length bound. Do NOT log the raw (unbounded) provider
   * message at any level that ships to an external log sink; log the bounded value
   * and/or only `error.name` / the record id.
   */
  private sanitizeError(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    if (raw.length <= MAX_ERROR_MESSAGE_LENGTH) {
      return raw;
    }
    const marker = '…[truncated]';
    return raw.slice(0, MAX_ERROR_MESSAGE_LENGTH - marker.length) + marker;
  }

  /**
   * Snapshot the issued-document content (§7.3) from the command + the adapter's
   * neutral result. Per-line `net`/`tax`/`gross` are derived from the command's
   * gross unit price + neutral tax-rate code; the tax breakdown buckets lines by
   * rate and the totals sum across lines. `seller` is `null` when the adapter did
   * not surface one (graceful degradation — see {@link IssuedDocumentContent}).
   *
   * AUTHORITATIVE WHERE THE ADAPTER REPORTS IT (#2251). `documentLines` carries
   * the amounts the issued document actually states, matched by 1-based line
   * number, and those win. Core computes no net and rounds nothing, so a copy
   * is the only way a stored figure can agree with the paper to the grosz.
   *
   * A line with no reported amounts falls back to the pre-#2251 recomputation
   * from the neutral `taxRate` code, which is a display projection and can
   * diverge under rounding or regime-specific rules. The fallback is per LINE
   * rather than per document, so a provider that reports some lines and not
   * others still contributes what it has.
   */
  private buildContent(
    cmd: Pick<IssueInvoiceCommand, 'lines' | 'buyer' | 'currency'>,
    record: InvoiceRecord,
    seller: IssuedDocumentSeller | null,
    documentLines?: IssuedDocumentLineAmounts[],
  ): IssuedDocumentContent {
    const reported = new Map<number, IssuedDocumentLineAmounts>(
      (documentLines ?? []).map((entry) => [entry.lineNumber, entry]),
    );

    const lines = cmd.lines.map((line, index): IssuedDocumentLine => {
      // 1-based, matching the document's own numbering. Shipping lines are part
      // of it - they are real document lines - so they never shift the mapping.
      const stated = reported.get(index + 1);
      if (stated) {
        return {
          name: line.name,
          quantity: line.quantity,
          unitNet: stated.unitNet,
          taxRate: line.taxRate,
          net: stated.net,
          tax: stated.tax,
          gross: stated.gross,
        };
      }
      const fraction = rateFraction(line.taxRate);
      const gross = round2(line.quantity * line.unitPriceGross);
      const net = round2(gross / (1 + fraction));
      const tax = round2(gross - net);
      const unitNet = round2(line.unitPriceGross / (1 + fraction));
      return {
        name: line.name,
        quantity: line.quantity,
        unitNet,
        taxRate: line.taxRate,
        net,
        tax,
        gross,
      };
    });

    const taxBreakdown = this.buildTaxBreakdown(lines);
    const totals = {
      net: round2(lines.reduce((sum, l) => sum + l.net, 0)),
      tax: round2(lines.reduce((sum, l) => sum + l.tax, 0)),
      gross: round2(lines.reduce((sum, l) => sum + l.gross, 0)),
    };

    return {
      seller,
      buyer: {
        name: cmd.buyer.name,
        taxId: cmd.buyer.taxId,
        address: cmd.buyer.address,
      },
      lines,
      taxBreakdown,
      totals,
      currency: cmd.currency,
      issueDate: record.issuedAt ? record.issuedAt.toISOString() : null,
      saleDate: null,
      payment: null,
    };
  }

  /** Group lines by their neutral `taxRate` code, summing net/tax/gross per bucket. */
  private buildTaxBreakdown(lines: IssuedDocumentLine[]): TaxBreakdownEntry[] {
    const byRate = new Map<string, TaxBreakdownEntry>();
    for (const line of lines) {
      const bucket = byRate.get(line.taxRate) ?? {
        rate: line.taxRate,
        net: 0,
        tax: 0,
        gross: 0,
      };
      bucket.net = round2(bucket.net + line.net);
      bucket.tax = round2(bucket.tax + line.tax);
      bucket.gross = round2(bucket.gross + line.gross);
      byRate.set(line.taxRate, bucket);
    }
    return [...byRate.values()];
  }
}
