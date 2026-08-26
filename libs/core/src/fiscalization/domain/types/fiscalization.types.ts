/**
 * Fiscalization Domain Types
 *
 * Neutral vocabulary for registering a completed sale with a provider that
 * performs or brokers a fiscal registration (ADR-042). OpenLinker is never the
 * issuer: it feeds a registering mechanism and records what came back.
 *
 * Country- and vendor-agnostic BY CONTRACT (ADR-042 decision 4) - the litmus is
 * that no regime-specific term appears here as a field name or as a value core
 * branches on. A regime-specific value reaches core only as one of the neutral
 * identity fields or as an opaque {@link FiscalRegistrationRecord.regimeExtras}
 * entry, whose keys core persists verbatim and indexes nowhere.
 *
 * @module libs/core/src/fiscalization/domain/types
 */

/**
 * Lifecycle of one registration attempt against one connection.
 *
 *   - `pending`     - intent persisted, nothing sent yet.
 *   - `registering` - an attempt holds the in-flight CAS lease and may be
 *                     crossing the provider boundary right now.
 *   - `registered`  - the provider reports the sale registered. TERMINAL: a
 *                     completed fiscal registration cannot be un-done, so this
 *                     row is never re-attempted.
 *   - `failed`      - the attempt did not complete; {@link FiscalRegistrationFailureMode}
 *                     says whether re-attempting is safe.
 */
export const FiscalRegistrationStatusValues = [
  'pending',
  'registering',
  'registered',
  'failed',
] as const;
export type FiscalRegistrationStatus = (typeof FiscalRegistrationStatusValues)[number];

/**
 * Fiscalization's OWN failure taxonomy (ADR-042 decision 7). Deliberately
 * mirrors the invoicing shape rather than importing it, so the two taxonomies
 * diverge as their regimes do instead of one silently inheriting the other's
 * extensions.
 *
 *   - `rejected` - TERMINAL. The provider definitely created nothing, so the
 *     same key is safe to re-attempt: re-crossing the boundary cannot produce a
 *     second registration of the sale.
 *   - `in-doubt` - NON-TERMINAL and NEVER auto-retried. The request may have
 *     reached the provider and the sale may already be registered. It is
 *     resolved by locating the registration at the provider
 *     ({@link FiscalLocateCriteria}) or by an operator decision - never by a
 *     blind resend. This is also the FISCAL-SAFE DEFAULT: any failure whose mode
 *     cannot be read structurally off the throwable is treated as `in-doubt`.
 */
export const FiscalRegistrationFailureModeValues = ['rejected', 'in-doubt'] as const;
export type FiscalRegistrationFailureMode =
  (typeof FiscalRegistrationFailureModeValues)[number];

/**
 * The FORM a customer-facing artefact takes, declared by the adapter. Core never
 * branches on it - it is carried so a surface can decide how to render, and so an
 * adapter that produces nothing printable is a first-class case rather than a
 * degraded one (ADR-042 decision 2).
 *
 *   - `document` - a self-contained file; `content` is base64, `contentType` its MIME.
 *   - `markup`   - a device/format-specific markup string a downstream renderer consumes.
 *   - `code`     - a machine-readable code payload (the data, not a rendered image).
 *   - `link`     - a URL the customer follows to retrieve the artefact.
 *   - `text`     - plain human-readable text.
 */
export const FiscalArtefactMediumValues = [
  'document',
  'markup',
  'code',
  'link',
  'text',
] as const;
export type FiscalArtefactMedium = (typeof FiscalArtefactMediumValues)[number];

/**
 * What the adapter SUGGESTS is done with an artefact. A HINT, never an
 * instruction: core neither renders nor delivers, and a caller is free to ignore
 * it (ADR-042 decision 2).
 */
export const FiscalArtefactDispositionValues = ['print', 'display', 'send', 'retain'] as const;
export type FiscalArtefactDisposition = (typeof FiscalArtefactDispositionValues)[number];

/**
 * One customer-facing output of a registration. The delivery channel is a
 * VARIABLE, not a constant: the same neutral operation returns a file in one
 * regime, a code in another, and nothing at all in a pure reporting regime.
 */
export interface FiscalArtefact {
  medium: FiscalArtefactMedium;
  /** Adapter's suggestion, not an instruction. */
  disposition: FiscalArtefactDisposition;
  /** Opaque payload; base64 when `medium === 'document'`, otherwise plain text. */
  content: string;
  /** MIME type when the adapter knows one (typically only for `document`). */
  contentType: string | null;
  /** Short adapter-supplied label a surface can show next to the artefact. */
  label: string | null;
}

/**
 * One line of the sale being registered. Amounts are the buyer-paid GROSS
 * figures the source reported; a fiscal registration transmits amounts it must
 * not recompute.
 */
export interface FiscalTransactionLine {
  name: string;
  quantity: number;
  /** Buyer-paid gross price of ONE unit. */
  unitPriceGross: number;
  /**
   * Neutral tax-rate code, passed through verbatim to the adapter.
   *
   * OpenLinker NEVER computes, infers or defaults a rate (ADR-042 decision 8,
   * negative half - settled and unconditional). An empty string means OL
   * resolved none and the adapter's own regime mapping applies; it is not a
   * claim that the rate is zero. The positive half of decision 8 - the rate
   * arriving from the product master, and a missing rate BLOCKING registration -
   * depends on contract work outside this context (#2054) and is not expressed
   * here yet.
   */
  taxRate: string;
  /** Source-side article reference when the order carried one. */
  sku: string | null;
}

/**
 * Where a customer-facing artefact could be delivered, when the caller knows.
 * Optional and purely informational to core: an adapter whose provider
 * distributes the artefact itself needs a target, one that returns the artefact
 * inline does not.
 */
export interface FiscalRecipient {
  email: string | null;
  phone: string | null;
}

/**
 * Register one completed sale (ADR-042 decision 2 - the single base-port
 * operation).
 *
 * `idempotencyKey` is MANDATORY and never null (decision 6): a double
 * registration is a legal event for the seller, not a data-quality issue, so
 * core refuses to run an un-keyed registration at all. It is the caller's
 * choice of key - the HTTP surface defaults it deterministically per
 * (connection, order) so a double click cannot produce a second registration.
 */
export interface RegisterTransactionCommand {
  connectionId: string;
  orderId: string;
  idempotencyKey: string;
  /** ISO-4217 code of every amount on the command. */
  currency: string;
  lines: FiscalTransactionLine[];
  /** Buyer-paid gross total of the sale. */
  totalGross: number;
  /** When the sale completed at the source; absent when the source did not report it. */
  occurredAt?: Date;
  recipient?: FiscalRecipient | null;
  /**
   * The order's tax-rate era (#2260 review) - `'pre-rollout'` for an order that
   * arrived before per-line rates existed, absent/`null` for everything after.
   *
   * Read ONLY by the write-path tax-rate guard, which exempts a pre-rollout
   * order so it registers exactly as it did before the epic (ADR-063
   * § Consequences). It is never sent to a provider and never reaches a
   * receipt.
   *
   * It exists for the same reason `IssueInvoiceCommand.taxRateEra` does, and
   * the two must agree: `AutoIssueTriggerService` is era-aware, so without the
   * marker on this command the gate passed a pre-rollout order, reported `none`
   * (clearing any persisted reason) and the era-blind write gate then refused
   * the job - a silent decline along the era axis.
   */
  taxRateEra?: string | null;
}

/**
 * What the provider reports back. Every identity field is independently
 * nullable: a regime that assigns only some of them is normal, not degraded.
 *
 * `artefacts` is POSSIBLY EMPTY, and an empty list is a SUCCESSFUL registration
 * (ADR-042 decision 2) - a pure reporting regime returns identifiers only.
 */
export interface RegisterTransactionResult {
  /** Provider identity the adapter owns (e.g. its registered platform key). */
  providerType: string;
  /** Provider-assigned locator key - what a later lookup is keyed on. */
  providerReference: string | null;
  /** The reference borne by the registered document itself. */
  documentReference: string | null;
  /**
   * Flat identifier of whatever performed or signed the registration. FLAT BY
   * DESIGN (ADR-042 decision 3): an anchor-class union is exactly what the ADR
   * rejects, because the class is not stable even within one country.
   */
  signingIdentity: string | null;
  /**
   * `null` when the provider's response carried no timestamp for this
   * registration - an adapter must NEVER fabricate one (e.g. by falling back
   * to its own clock) on a field that is part of the persisted identity set.
   * Mirrors {@link FiscalLocateResult.registeredAt}'s nullability exactly, for
   * the same reason.
   */
  registeredAt: Date | null;
  /**
   * Adapter-owned bag of flat string key/values with no cross-regime
   * counterpart. Core persists it verbatim and indexes NO key inside it. A key
   * that shows up in a second adapter gets promoted to a neutral field.
   */
  regimeExtras?: Record<string, string>;
  artefacts: FiscalArtefact[];
}

/**
 * Business coordinates a {@link FiscalRegistrationLocator} looks a registration
 * up by. Needed because after an indeterminate call OL holds no provider
 * reference at all (ADR-042 decision 7). Every field is optional; an adapter
 * uses whichever its provider can query on.
 */
export interface FiscalLocateCriteria {
  /** OL's own key, for a provider that echoes it back. */
  idempotencyKey?: string;
  /** OL's internal order id, for a provider that carries a caller reference. */
  orderId?: string;
  documentReference?: string;
  occurredFrom?: Date;
  occurredTo?: Date;
}

/**
 * A registration the provider confirms it holds. Mirrors the persisted identity
 * set so reconciliation writes it with no translation. `null` from the locator
 * means the provider holds NO match.
 */
export interface FiscalLocateResult {
  /**
   * Provider identity the adapter owns, mirroring
   * {@link RegisterTransactionResult.providerType}. OPTIONAL because a locator
   * answers about a document, not about itself: an adapter that omits it leaves
   * the record's existing value alone, since core will not invent a provider
   * identity for a row it never registered through. Supplying it is what lets a
   * record that reaches `registered` by RECONCILIATION carry the same identity a
   * directly-registered one does, instead of the `''` placeholder its pending row
   * was created with.
   */
  providerType?: string;
  providerReference: string | null;
  documentReference: string | null;
  signingIdentity: string | null;
  registeredAt: Date | null;
  regimeExtras?: Record<string, string>;
  artefacts?: FiscalArtefact[];
}

/** Insert shape for a new registration record. */
export interface CreateFiscalRegistrationRecordInput {
  connectionId: string;
  orderId: string;
  /** `''` until the adapter result backfills the authoritative value. */
  providerType: string;
  /** Never null - the exactly-once guarantee has no keyless mode. */
  idempotencyKey: string;
  status: FiscalRegistrationStatus;
}

/** Partial update applied to a record once an attempt terminates. */
export interface FiscalRegistrationOutcomePatch {
  status?: FiscalRegistrationStatus;
  providerType?: string;
  providerReference?: string | null;
  documentReference?: string | null;
  signingIdentity?: string | null;
  registeredAt?: Date | null;
  regimeExtras?: Record<string, string> | null;
  artefacts?: FiscalArtefact[] | null;
  failureMode?: FiscalRegistrationFailureMode | null;
  /** Short, PII-free, operator-facing summary. Safe to expose on a response. */
  failureReason?: string | null;
  /** INTERNAL-ONLY bounded diagnostic. Never exposed to API callers. */
  errorMessage?: string | null;
  leaseExpiresAt?: Date | null;
}

/** Outcome of one {@link FiscalLocateCriteria}-driven reconciliation attempt. */
export const FiscalReconcileOutcomeValues = [
  /** The provider confirmed a registration; the record advanced to `registered`. */
  'resolved',
  /** The provider holds no match; the record stays `in-doubt` for an operator. */
  'not-found',
  /** The adapter cannot be queried by business coordinates; operator handling only. */
  'unsupported',
] as const;
export type FiscalReconcileOutcome = (typeof FiscalReconcileOutcomeValues)[number];
