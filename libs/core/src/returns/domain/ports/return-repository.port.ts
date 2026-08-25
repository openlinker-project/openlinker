/**
 * Return Repository Port
 *
 * Persistence contract for the return aggregate (#2327, ADR-060).
 *
 * Deliberately THIN. This slice ships the model and its schema, not the
 * lifecycle: there is no update, no transition, no counter write and no
 * restock. Ingestion's idempotent update-or-create keyed
 * `(sourceConnectionId, externalReturnId)` — the reason `findByExternalId`
 * exists here at all, and the reason the partial unique index ships now —
 * belongs to #2328; the return feed to #2329; decline to #2333; the read API to
 * #2334. Each of those widens this port rather than inventing a second one.
 *
 * **A note for #2333 and everything after it: `orders` must never import
 * `returns` back.** The edge runs one way — `returns -> orders`, and today only
 * for `RefundReason` off the `@openlinker/core/orders/types` cycle-breaker
 * sub-barrel. A return-shaped read added to an orders service would close a CJS
 * module-load cycle; it belongs on this context's own service (#2328) instead.
 *
 * @module domain/ports
 */
import type { ReturnRecord } from '../entities/return-record.entity';
import type { CreateReturnRecordInput } from '../types/return.types';

export interface ReturnRepositoryPort {
  /**
   * Persist one return header and its lines in a single transaction — a header
   * without its lines is not a return, so a partial write must not be
   * observable.
   */
  create(input: CreateReturnRecordInput): Promise<ReturnRecord>;

  /** Hydrates the aggregate with its lines, ordered by `lineIndex`. */
  findById(id: string): Promise<ReturnRecord | null>;

  /**
   * The source-keyed lookup #2328's update-or-create needs.
   *
   * `externalReturnId` is non-nullable HERE even though the column is nullable:
   * a NULL external id identifies nothing, so "find the return with no external
   * id on this connection" would match an arbitrary member of a set. Whether an
   * id-less source (Erli) should be given a SYNTHETIC key instead is #2328's
   * gate decision — this signature is neutral about it either way.
   */
  findByExternalId(
    sourceConnectionId: string,
    externalReturnId: string
  ): Promise<ReturnRecord | null>;

  /**
   * The operator's orphan bucket: returns OL could not attribute to an order,
   * newest first. Backed by the partial index
   * `IDX_returns_orphans (createdAt DESC) WHERE "internalOrderId" IS NULL`,
   * which is this exact query. Headers only — the bucket is a triage list, and
   * hydrating every line for it would be N+1 for data the list does not render.
   */
  listOrphans(limit: number, offset: number): Promise<ReturnRecord[]>;
}
