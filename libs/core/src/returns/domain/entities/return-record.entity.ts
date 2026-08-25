/**
 * Return Record Domain Entity
 *
 * The OL-owned return aggregate root (#2327, ADR-060) — the header above the
 * source observation, carrying its lines.
 *
 * **`internalOrderId` is nullable BY DESIGN, and this is the whole point of the
 * field.** A return arrives from a source that names an order OL may not have
 * ingested, may have ingested under a different connection, or may never
 * ingest at all; a parcel is nonetheless on its way to the operator's building.
 * Refusing to persist such a return would delete the only record that it
 * exists. So an ORPHAN return persists, surfaces in an operator bucket
 * (`ReturnRepositoryPort.listOrphans`, read API #2334), and **blocks every
 * downstream trigger** — nothing may be restocked, refunded or corrected
 * against an order OL cannot name. Nullability is what makes "unattributed" a
 * representable, visible state instead of an insert that fails silently in a
 * job log.
 *
 * There is deliberately no FK to `order_records` either: the value is verified
 * at the application layer, matching the `refund_records` / `invoice_records`
 * precedent of an indexed `text` reference with no cross-table lock coupling.
 *
 * Anemic and fully `readonly` per ADR-011. The four timestamps are independent
 * facts, not a status ladder — see `return.types.ts`.
 *
 * The id is `ol_return_*`, minted with `formatInternalId('Return')`.
 *
 * @module domain/entities
 */
import type { ReturnOrigin } from '../types/return.types';
import type { ReturnLine } from './return-line.entity';

export class ReturnRecord {
  constructor(
    /** `ol_return_*` — see `ReturnRepository.create`. */
    public readonly id: string,
    public readonly sourceConnectionId: string,
    public readonly externalReturnId: string | null,
    /** Nullable by design — orphan returns persist and block downstream triggers. */
    public readonly internalOrderId: string | null,
    /**
     * The SOURCE's own order reference, verbatim (#2332) — the re-attribution key.
     *
     * Deliberately adjacent to `internalOrderId`: the two are the same fact seen from
     * either side of the mapping, and reading them together is what makes an orphan row
     * legible. Note the consequence for constructors — three adjacent `string | null`
     * parameters means a mis-ordered call type-checks, so the repository round-trip is
     * specced with three DISTINCT values.
     */
    public readonly externalOrderId: string | null,
    public readonly origin: ReturnOrigin,
    /** The source's own status word, verbatim — never interpreted. */
    public readonly rawStatus: string | null,
    public readonly rawPayload: Record<string, unknown> | null,
    public readonly openedAt: Date | null,
    public readonly authorizedAt: Date | null,
    public readonly declinedAt: Date | null,
    public readonly closedAt: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly lines: readonly ReturnLine[]
  ) {}

  /**
   * Is this return unattributed — i.e. does OL not know which order it belongs to?
   *
   * **This is THE definition of orphan, and there must not be a second one.** Every
   * consumer derives from `internalOrderId IS NULL`: the downstream-trigger guard
   * (`IReturnsService.assertAttributedForTrigger`), the orphan-bucket count and list
   * (`IDX_returns_orphans`' predicate), the re-attribution candidate query, and #2334's
   * read DTO. A second rule spelled anywhere else is how the bucket and the block start
   * disagreeing about the same row.
   *
   * Pure and synchronous — a function of one already-loaded field, per ADR-011's bounded
   * allowance for read-only derivations on an otherwise anemic entity.
   */
  isOrphan(): boolean {
    return this.internalOrderId === null;
  }
}
