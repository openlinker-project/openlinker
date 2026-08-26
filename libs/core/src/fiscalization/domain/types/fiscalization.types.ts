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
 * What a registration PRODUCED, without what it produced (#2523).
 *
 * A registered receipt may carry artefacts and it may carry none. Until this
 * projection existed a surface could not offer "open the receipt document"
 * without inventing what exists, so the summary carries exactly the three facts
 * an affordance needs - the FORM, the adapter's HINT, and a LABEL - and never
 * the payload.
 *
 * Content is excluded on purpose rather than for economy. An artefact payload
 * is a customer-facing document: it can be large, it can carry buyer-identifying
 * detail, and a per-order projection is read to decide what to OFFER, not to
 * deliver. A caller that genuinely needs the bytes reads the registration record
 * itself; the summary exists so a surface can decide there is something to
 * offer at all.
 *
 * **Nothing here says anything was DELIVERED, and no reading of it can.**
 * `disposition` is what the adapter suggests a caller might do - not what
 * happened, not what will happen, and not a record of an attempt. No shipped
 * adapter reports whether a document reached a buyer, so a surface must never
 * derive "sent to the customer" from a `send` disposition, and this type carries
 * no timestamp, recipient, status or attempt count it could derive one from.
 *
 * An EMPTY list is a SUCCESSFUL registration (ADR-042 decision 2) - a pure
 * reporting regime returns identifiers only - and is distinct from `null`, which
 * means the registration never got far enough to produce anything.
 */
export interface FiscalArtefactSummary {
  medium: FiscalArtefactMedium;
  /** The adapter's suggestion. NEVER evidence that it happened. */
  disposition: FiscalArtefactDisposition;
  /** Short adapter-supplied label a surface can show; `null` when it supplied none. */
  label: string | null;
  /**
   * MIME type when the adapter knows one (typically only for `document`).
   * Carried because an affordance differs by file type - "open the PDF" is a
   * different offer from "download the file" - and it describes the payload
   * without being any of it.
   */
  contentType: string | null;
}

/**
 * Project artefacts onto their summaries, dropping every payload.
 *
 * Pure, and co-located with the type it projects onto (the pure-rule exception
 * in `engineering-standards.md`): a field added to {@link FiscalArtefactSummary}
 * means editing this function in the same commit, which is what keeps a payload
 * from leaking in through a summary assembled by hand somewhere else.
 *
 * `null` in, `null` out - a registration that never produced anything is not the
 * same as one that produced nothing, and collapsing the two would report an
 * unfinished attempt as a completed pure-reporting registration.
 */
export function summarizeFiscalArtefacts(
  artefacts: FiscalArtefact[] | null | undefined,
): FiscalArtefactSummary[] | null {
  if (artefacts === null || artefacts === undefined) {
    return null;
  }
  return artefacts.map((artefact) => ({
    medium: artefact.medium,
    disposition: artefact.disposition,
    label: artefact.label,
    contentType: artefact.contentType,
  }));
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

/**
 * What a {@link FiscalLocateCriteria} lookup answered (ADR-042 amendment #2502,
 * decision 1).
 *
 * THREE outcomes, because two are not enough. Before this union a locator could
 * only say "here is the registration" or "no match", so a provider that had
 * ACCEPTED the sale and not yet registered it had to be reported as an absence -
 * and the operator surface, having nothing else to say, reported it as one
 * during what was in fact normal processing.
 *
 *   - `registered` - the provider confirms a completed registration and hands
 *     back the neutral identity set. The ONLY outcome core may terminalise a
 *     record on.
 *   - `held`       - the provider holds the sale and has not registered it. It
 *     is NOT evidence of absence and NOT a failure. The record stays exactly as
 *     it was, and asking again later is the whole point.
 *   - `not-found`  - the provider holds no registration for these coordinates.
 *     Evidence, never authority to resend (decision 7): a resend of a
 *     registration that already landed is the double registration the contract
 *     exists to prevent.
 */
export const FiscalLocateStatusValues = ['registered', 'held', 'not-found'] as const;
export type FiscalLocateStatus = (typeof FiscalLocateStatusValues)[number];

export type FiscalLocateAnswer =
  | { status: 'registered'; registration: FiscalLocateResult }
  | {
      status: 'held';
      /**
       * Adapter-supplied, PII-free note about WHAT the provider is holding
       * (typically its own non-terminal status string). Carried for the log and
       * for an operator surface; core never branches on it.
       */
      detail?: string | null;
    }
  | { status: 'not-found' };

/**
 * Coerce whatever a locator returned into a {@link FiscalLocateAnswer}.
 *
 * Pure, and deliberately co-located with the union it normalises (the
 * pure-rule exception in `engineering-standards.md`): adding a member to the
 * union means editing this function in the same commit.
 *
 * It exists because a plugin is third-party-shaped. An out-of-tree adapter
 * compiled against a `libs/core` that predates this union still returns the old
 * `FiscalLocateResult | null` shape, and reading `.status` off it would throw on
 * an operator's reconcile click. The mapping is fail-safe in the fiscal
 * direction:
 *
 *   - `null` / `undefined`             -> `not-found` (the legacy "no match").
 *   - a legacy result object           -> `registered` (the legacy non-null
 *     answer meant exactly that, and reading it as anything else would stop
 *     resolving real registrations). Recognised by the identity keys
 *     {@link FiscalLocateResult} declares non-optional, NOT by the mere absence
 *     of a `status`: an untagged object carrying none of them - `{}`, `[]`, a
 *     shape from a defective adapter - is not a locate result, and reading one
 *     as `registered` would terminalise a record on a registration nothing
 *     confirmed.
 *   - anything else, including a
 *     `status` this build does not
 *     recognise                        -> `held`, never `registered`. An answer
 *     core cannot interpret must not terminalise a record on a registration it
 *     cannot confirm.
 *
 * Every `held` answer carries an explicit `detail` so a consumer never has to
 * tell `undefined` from `null`.
 */
export function readFiscalLocateAnswer(raw: unknown): FiscalLocateAnswer {
  if (raw === null || raw === undefined) {
    return { status: 'not-found' };
  }
  if (typeof raw !== 'object') {
    return { status: 'held', detail: null };
  }

  const candidate = raw as { status?: unknown; registration?: unknown; detail?: unknown };
  const status = typeof candidate.status === 'string' ? candidate.status : null;

  if (status === null) {
    return isFiscalLocateResultShape(raw)
      ? { status: 'registered', registration: raw as FiscalLocateResult }
      : { status: 'held', detail: null };
  }
  if (status === 'not-found') {
    return { status: 'not-found' };
  }
  if (status === 'registered') {
    const registration = candidate.registration;
    if (isFiscalLocateResultShape(registration)) {
      return { status: 'registered', registration: registration as FiscalLocateResult };
    }
    // A `registered` answer carrying no identity set is not one core can write.
    return { status: 'held', detail: null };
  }
  return {
    status: 'held',
    detail: typeof candidate.detail === 'string' ? candidate.detail : null,
  };
}

/**
 * Does this value look like a {@link FiscalLocateResult}?
 *
 * Keyed on the four fields the interface declares NON-OPTIONAL, so a real
 * result - legacy or tagged - always passes, while an untagged object that
 * declares none of them fails. Presence is what is tested, never the value: a
 * result reporting `null` for every identity field is a legitimate answer from
 * a regime that assigns few of them (see {@link FiscalLocateResult}), so
 * testing truthiness would reject exactly that case.
 *
 * An array is excluded outright: no locate result is one, and letting one
 * through would put an array where core expects an identity set.
 */
function isFiscalLocateResultShape(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return (
    'providerReference' in value ||
    'documentReference' in value ||
    'signingIdentity' in value ||
    'registeredAt' in value
  );
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
  /**
   * The provider HOLDS the sale but has not registered it yet (ADR-042
   * amendment #2502, decisions 1 and 3). A legitimate answer, not a failure:
   * the record is left exactly where it was and the same check can be repeated
   * later. Distinct from `not-found`, which asserts the provider holds nothing.
   */
  'still-unknown',
] as const;
export type FiscalReconcileOutcome = (typeof FiscalReconcileOutcomeValues)[number];
