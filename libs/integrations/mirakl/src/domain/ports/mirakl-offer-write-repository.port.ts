/**
 * Mirakl Offer Write Repository Port
 *
 * Persistence for recorded stock and price changes (`mirakl_offer_writes`).
 * Every transition is a conditional update, so two workers flushing or
 * settling the same connection never both win.
 *
 * @module libs/integrations/mirakl/src/domain/ports
 */
import type { MiraklOfferWrite } from '../entities/mirakl-offer-write.entity';
import type {
  MiraklOfferWriteKind,
  MiraklOfferWriteValue,
} from '../types/mirakl-offer-write.types';

export interface MiraklOfferWriteRepositoryPort {
  /** Record values to send. A pending value for the same offer is replaced. */
  recordPending(
    connectionId: string,
    kind: MiraklOfferWriteKind,
    values: readonly MiraklOfferWriteValue[]
  ): Promise<void>;

  /** Record writes already sent in `importId` (an OF24 create). */
  recordSubmitted(
    connectionId: string,
    kind: MiraklOfferWriteKind,
    values: readonly MiraklOfferWriteValue[],
    importId: string
  ): Promise<void>;

  /** The newest write of one kind for one offer, whatever its status. */
  findLatest(
    connectionId: string,
    kind: MiraklOfferWriteKind,
    offerSku: string
  ): Promise<MiraklOfferWrite | null>;

  /** Pending writes of one kind, oldest first. */
  findPending(
    connectionId: string,
    kind: MiraklOfferWriteKind,
    limit: number
  ): Promise<MiraklOfferWrite[]>;

  /**
   * Mark writes as sent in `importId`, each only at the version that was read.
   * A write replaced in between stays pending and is sent next time.
   */
  markSubmitted(writes: readonly MiraklOfferWrite[], importId: string): Promise<number>;

  /** Fail writes the operator refused to import at all, each at the version read. */
  failPending(writes: readonly MiraklOfferWrite[], reason: string): Promise<number>;

  /** Submitted writes of one kind, oldest first (the card pass, #4278). */
  findSubmitted(
    connectionId: string,
    kind: MiraklOfferWriteKind,
    limit: number
  ): Promise<MiraklOfferWrite[]>;

  /**
   * Settle submitted writes one by one (a card the operator accepted or
   * refused). Each row only while still submitted; returns the rows settled.
   */
  settleWrites(
    writes: readonly MiraklOfferWrite[],
    status: 'applied' | 'failed',
    reason?: string
  ): Promise<number>;

  /** When a file of this kind was last sent for the connection, or null. */
  latestImportAt(connectionId: string, kind: MiraklOfferWriteKind): Promise<Date | null>;

  /**
   * Ids of this connection's imports still waiting for an outcome, oldest
   * first. Card imports are left out: the card pass follows them itself,
   * because a finished card import is not yet a card in the catalogue.
   */
  findSubmittedImports(
    connectionId: string,
    limit: number
  ): Promise<Array<{ importId: string; kind: MiraklOfferWriteKind }>>;

  /**
   * Settle one import: lines named in `failures` fail with their reason, every
   * other line of the import is applied. Returns the number of rows settled.
   */
  settleImport(
    connectionId: string,
    importId: string,
    failures: ReadonlyMap<string, string>
  ): Promise<number>;

  /** Fail every line of one import with the same reason. */
  failImport(connectionId: string, importId: string, reason: string): Promise<number>;

  /** Delete settled rows older than `before`. */
  deleteSettledBefore(connectionId: string, before: Date): Promise<number>;
}
