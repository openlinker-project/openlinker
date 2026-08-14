/**
 * Fiscal Registration Record - Domain Entity
 *
 * OL's neutral projection of one attempt to register a completed sale with a
 * provider on a fiscalization connection (ADR-042). Non-authoritative: the
 * registering mechanism owns the act, this row records that OL asked and what
 * came back - including, crucially, the case where OL does NOT know whether the
 * sale landed.
 *
 * Anemic by default (ADR-011): readonly fields plus pure, side-effect-free
 * derivations over its own already-loaded state.
 *
 * @module libs/core/src/fiscalization/domain/entities
 */
import type {
  FiscalArtefact,
  FiscalRegistrationFailureMode,
  FiscalRegistrationStatus,
} from '../types/fiscalization.types';

export class FiscalRegistrationRecord {
  constructor(
    public readonly id: string,
    public readonly connectionId: string,
    public readonly orderId: string,
    /** Provider identity, backfilled from the adapter result; `''` until then. */
    public readonly providerType: string,
    /**
     * Caller-supplied exactly-once key. NEVER null (ADR-042 decision 6) - it
     * backs a PLAIN unique index on `(connectionId, idempotencyKey)`, unlike
     * invoicing's optional-key partial index.
     */
    public readonly idempotencyKey: string,
    public readonly status: FiscalRegistrationStatus,
    /** Provider-assigned locator key; `null` until the provider assigns one. */
    public readonly providerReference: string | null,
    /** Reference borne by the registered document; `null` until assigned. */
    public readonly documentReference: string | null,
    /** Flat id of whatever performed or signed the registration; `null` until known. */
    public readonly signingIdentity: string | null,
    /** When the registration happened at the provider; `null` until registered. */
    public readonly registeredAt: Date | null,
    /**
     * Adapter-owned flat string key/values with no cross-regime counterpart.
     * Persisted verbatim; NO key inside is indexed or read by core.
     */
    public readonly regimeExtras: Record<string, string> | null,
    /**
     * Customer-facing outputs the registration produced. An EMPTY list on a
     * `registered` row is a success, not a failure.
     */
    public readonly artefacts: FiscalArtefact[] | null,
    /** `null` unless `status === 'failed'`. */
    public readonly failureMode: FiscalRegistrationFailureMode | null,
    /** Short PII-free operator-facing summary; `null` unless `status === 'failed'`. */
    public readonly failureReason: string | null,
    /** INTERNAL-ONLY bounded diagnostic; never exposed to API callers. */
    public readonly errorMessage: string | null,
    /** Expiry of the in-flight CAS claim; `null` unless this row holds the slot. */
    public readonly leaseExpiresAt: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  /** Pure derivation: the provider reports the sale registered. */
  get isRegistered(): boolean {
    return this.status === 'registered';
  }

  /**
   * Pure derivation: is this row's in-flight claim still live at `now`? A live
   * claim means another attempt may be crossing the provider boundary right now
   * and a concurrent retry must NOT cross it as well.
   */
  isLeaseLive(now: Date): boolean {
    return (
      this.status === 'registering' &&
      this.leaseExpiresAt !== null &&
      this.leaseExpiresAt.getTime() > now.getTime()
    );
  }

  /**
   * Pure derivation: a `failed` row is safe to re-attempt ONLY when the provider
   * DEFINITELY created nothing - a terminal `rejected` failure. An `in-doubt`
   * failure (or an absent mode) is never re-attemptable: the sale may already be
   * registered, so it is surfaced for reconciliation instead.
   */
  get isReattemptableFailure(): boolean {
    return this.status === 'failed' && this.failureMode === 'rejected';
  }

  /**
   * Pure derivation: is this row awaiting a reconciliation that only a provider
   * lookup or an operator decision can settle? The one state OL can neither
   * advance nor abandon on its own.
   */
  get isInDoubt(): boolean {
    return this.status === 'failed' && this.failureMode === 'in-doubt';
  }

  /**
   * Pure derivation: does this record forbid starting a SECOND originating
   * registration of the same sale - under a different key, or on a different
   * connection?
   *
   * The predicate deliberately matches ADR-041 §3b's originating-document rule
   * (and invoicing's `InvoiceRecord.blocksIssuanceElsewhere`, #2047) with the
   * fiscal statuses substituted: the only record that leaves the sale free to be
   * registered again is one where the provider DEFINITELY created nothing - a
   * terminal `rejected` failure. `pending` / `registering` / `registered` block,
   * and so does a `failed` row with any other mode, absent or unknown included:
   * an `in-doubt` failure means OL does not know whether the sale is registered,
   * and registering again is exactly how one sale ends up with two receipts.
   *
   * The `registering` arm is lease-INDEPENDENT on purpose. An expired lease means
   * the prior attempt crashed mid-flight, not that it created nothing - re-claiming
   * it under the SAME key is fiscally safe (`claimForRegistration` allows exactly
   * that), while starting a NEW registration is not.
   *
   * Unlike invoicing's sibling this is NOT scoped to "elsewhere": a second key on
   * the SAME connection is the very interleaving that defeats the exactly-once
   * guarantee, because the unique index is on `(connectionId, idempotencyKey)` and
   * cannot see the order at all.
   */
  get blocksFurtherRegistration(): boolean {
    if (this.status === 'failed') {
      return this.failureMode !== 'rejected';
    }
    return true;
  }
}
