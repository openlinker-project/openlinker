/**
 * Price Change Episode (#3142, ADR-072)
 *
 * One EPISODE of "the master price for this variant changed, and this
 * destination/source pair hasn't decided what to do about it yet" — opened
 * once, updated in place by re-detection, closed by an explicit resolution.
 * Mirrors `ReservationShortfallEpisode` (`libs/core/src/inventory`): a partial
 * unique index over `(productVariantId, destinationConnectionId,
 * sourceConnectionId) WHERE resolvedAt IS NULL` means at most one OPEN episode
 * per key exists at a time, and its `id` is stable for the life of the
 * condition (a re-detection refreshes the row in place rather than minting a
 * new one).
 *
 * `refreshedAt` is the staleness marker (ADR-072 / #3143): when a re-detection
 * lands on an ALREADY-open episode whose `sourceNewAmount` differs from what
 * is already stored, `refreshedAt` is stamped so the review queue can render
 * the "this changed again while you were deciding" state (mockup's
 * `row-needs-refresh`) and the accept endpoint can refuse a stale accept.
 *
 * Anemic and readonly per ADR-011 — every method here is a pure derivation
 * over the entity's own already-loaded fields.
 *
 * @module libs/core/src/listings/domain/entities
 */
import type {
  PriceChangeBlockReason,
  PriceChangeResolution,
} from '../types/price-change-episode.types';

export class PriceChangeEpisode {
  constructor(
    public readonly id: string,
    public readonly productVariantId: string,
    public readonly destinationConnectionId: string,
    public readonly sourceConnectionId: string,
    public readonly sourceCurrency: string,
    /** `null` = no prior source price was ever recorded (#3159 review). See `computedOldAmount`/`deltaPct`. */
    public readonly sourceOldAmount: number | null,
    public readonly sourceNewAmount: number,
    /** `null` = no baseline was ever recorded (a brand-new mapping's first detection). See `deltaPct`. */
    public readonly computedOldAmount: number | null,
    public readonly computedNewAmount: number,
    public readonly manualPriceOverride: number | null,
    public readonly manualPriceOverrideSetAt: Date | null,
    public readonly blockReason: PriceChangeBlockReason | null,
    public readonly detectedAt: Date,
    /** Stamped on a re-detection that lands on an already-open row (#3143). */
    public readonly refreshedAt: Date | null,
    public readonly resolvedAt: Date | null,
    public readonly resolution: PriceChangeResolution | null,
    public readonly resolvedByUserId: string | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date
  ) {}

  isOpen(): boolean {
    return this.resolvedAt === null;
  }

  isBlocked(): boolean {
    return this.blockReason !== null;
  }

  /**
   * The publishable amount for this episode: the operator's pinned price when
   * one was set (ADR-072 decision 5 — never the destination-reported `frozen`
   * field), otherwise the rule-computed amount.
   */
  effectiveAmount(): number {
    return this.manualPriceOverride ?? this.computedNewAmount;
  }

  /**
   * `deltaPct` between the computed old and new amount, matching the
   * mockup's `buildItem`.
   *
   * `null` means the DIRECTION is unknown, never "down" (#3159 review): a
   * brand-new mapping's first detection carries `computedOldAmount: null` —
   * there is no prior value to diff against, so no direction can be derived.
   * A real recorded baseline of `0` (e.g. a previously-free product now
   * carrying a price) is a different case — division by zero, not an
   * unknown baseline — and is guarded separately, returning `0` rather than
   * `null` or `Infinity`.
   */
  deltaPct(): number | null {
    if (this.computedOldAmount === null) {
      return null;
    }
    if (this.computedOldAmount === 0) {
      return 0;
    }
    return (
      Math.round(
        ((this.computedNewAmount - this.computedOldAmount) / this.computedOldAmount) * 1000
      ) / 10
    );
  }

  /**
   * `|deltaPct| >= 10` — the mockup's "steep" delta-chip / "Big changes"
   * magnitude threshold. An unknown `deltaPct` (no baseline) is never steep.
   */
  isSteep(): boolean {
    const delta = this.deltaPct();
    return delta !== null && Math.abs(delta) >= 10;
  }

  /**
   * The episode's direction — `'unknown'` when there's no baseline to
   * compare against (`computedOldAmount === null`, matching `deltaPct`'s own
   * `null`), otherwise `'up'` or `'down'`.
   *
   * Deliberately NOT derived from `deltaPct() > 0` (#3159 review): `deltaPct`
   * returns `0` for a real zero baseline specifically to avoid a `NaN`/
   * `Infinity` percentage, and `0 > 0` is false — which silently misclassified
   * a genuine `0 -> 100` increase (a price appearing where there was none) as
   * `'down'`. This compares the raw amounts instead, so a zero baseline with
   * ANY positive new amount is unambiguously `'up'`.
   */
  direction(): 'up' | 'down' | 'unknown' {
    if (this.computedOldAmount === null) {
      return 'unknown';
    }
    return this.computedNewAmount >= this.computedOldAmount ? 'up' : 'down';
  }
}
