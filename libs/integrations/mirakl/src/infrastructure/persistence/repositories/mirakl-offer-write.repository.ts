/**
 * Mirakl Offer Write Repository
 *
 * TypeORM implementation of `MiraklOfferWriteRepositoryPort`. Plain class: the
 * integration module builds it from the TypeORM repository for the entity.
 *
 * @module libs/integrations/mirakl/src/infrastructure/persistence/repositories
 * @implements {MiraklOfferWriteRepositoryPort}
 */
import type { Repository } from 'typeorm';
import { MiraklOfferWrite } from '../../../domain/entities/mirakl-offer-write.entity';
import type { MiraklOfferWriteRepositoryPort } from '../../../domain/ports/mirakl-offer-write-repository.port';
import type {
  MiraklOfferWriteKind,
  MiraklOfferWriteValue,
} from '../../../domain/types/mirakl-offer-write.types';
import { MiraklOfferWriteOrmEntity } from '../entities/mirakl-offer-write.orm-entity';

/** Longest stored reason; Mirakl's are short, a runaway report is cut. */
const MAX_ERROR_LENGTH = 500;

export class MiraklOfferWriteRepository implements MiraklOfferWriteRepositoryPort {
  constructor(private readonly repository: Repository<MiraklOfferWriteOrmEntity>) {}

  async recordPending(
    connectionId: string,
    kind: MiraklOfferWriteKind,
    values: readonly MiraklOfferWriteValue[],
  ): Promise<void> {
    if (values.length === 0) return;
    // Last value wins inside one call too: a batch may name an offer twice.
    const latest = new Map<string, MiraklOfferWriteValue>();
    for (const value of values) latest.set(value.offerSku, value);
    await this.repository
      .createQueryBuilder()
      .insert()
      .into(MiraklOfferWriteOrmEntity)
      .values(
        [...latest.values()].map((value) => ({
          connectionId,
          kind,
          offerSku: value.offerSku,
          value: value.value,
          currency: value.currency ?? null,
          status: 'pending' as const,
        })),
      )
      .onConflict(
        `("connectionId", "kind", "offerSku") WHERE "status" = 'pending' DO UPDATE SET ` +
          `"value" = EXCLUDED."value", "currency" = EXCLUDED."currency", ` +
          `"version" = "mirakl_offer_writes"."version" + 1, "updatedAt" = now()`,
      )
      .execute();
  }

  async recordSubmitted(
    connectionId: string,
    kind: MiraklOfferWriteKind,
    values: readonly MiraklOfferWriteValue[],
    importId: string,
  ): Promise<void> {
    if (values.length === 0) return;
    await this.repository.insert(
      values.map((value) => ({
        connectionId,
        kind,
        offerSku: value.offerSku,
        value: value.value,
        currency: value.currency ?? null,
        status: 'submitted' as const,
        importId,
      })),
    );
  }

  /**
   * Newest row by `createdAt`. Correct only because an offer has at most one
   * `pending` row (`recordPending` upserts into it, keeping its `createdAt`) and
   * a new pending row is created only after the previous one was submitted, so
   * the pending row is always the newest. Changing that index or this ordering
   * would make the stock master read an older target (#4284).
   */
  async findLatest(
    connectionId: string,
    kind: MiraklOfferWriteKind,
    offerSku: string,
  ): Promise<MiraklOfferWrite | null> {
    const row = await this.repository.findOne({
      where: { connectionId, kind, offerSku },
      order: { createdAt: 'DESC' },
    });
    return row ? toDomain(row) : null;
  }

  async findPending(
    connectionId: string,
    kind: MiraklOfferWriteKind,
    limit: number,
  ): Promise<MiraklOfferWrite[]> {
    const rows = await this.repository.find({
      where: { connectionId, kind, status: 'pending' },
      order: { updatedAt: 'ASC' },
      take: limit,
    });
    return rows.map(toDomain);
  }

  async markSubmitted(writes: readonly MiraklOfferWrite[], importId: string): Promise<number> {
    if (writes.length === 0) return 0;
    const result: unknown = await this.repository.query(
      `UPDATE "mirakl_offer_writes" AS w
          SET "status" = 'submitted', "importId" = $1, "updatedAt" = now()
         FROM unnest($2::uuid[], $3::int[]) AS sent(id, version)
        WHERE w."id" = sent.id AND w."version" = sent.version AND w."status" = 'pending'`,
      [importId, writes.map((write) => write.id), writes.map((write) => write.version)],
    );
    return affected(result);
  }

  async failPending(writes: readonly MiraklOfferWrite[], reason: string): Promise<number> {
    if (writes.length === 0) return 0;
    const result: unknown = await this.repository.query(
      `UPDATE "mirakl_offer_writes" AS w
          SET "status" = 'failed', "error" = $1, "updatedAt" = now()
         FROM unnest($2::uuid[], $3::int[]) AS sent(id, version)
        WHERE w."id" = sent.id AND w."version" = sent.version AND w."status" = 'pending'`,
      [truncate(reason), writes.map((write) => write.id), writes.map((write) => write.version)],
    );
    return affected(result);
  }

  async findSubmittedImports(
    connectionId: string,
    limit: number,
  ): Promise<Array<{ importId: string; kind: MiraklOfferWriteKind }>> {
    const rows = (await this.repository.query(
      `SELECT "importId", "kind"
         FROM "mirakl_offer_writes"
        WHERE "connectionId" = $1 AND "status" = 'submitted' AND "importId" IS NOT NULL
        GROUP BY "importId", "kind"
        ORDER BY MIN("updatedAt") ASC
        LIMIT $2`,
      [connectionId, limit],
    )) as Array<{ importId: string; kind: MiraklOfferWriteKind }>;
    return rows;
  }

  async settleImport(
    connectionId: string,
    importId: string,
    failures: ReadonlyMap<string, string>,
  ): Promise<number> {
    const skus = [...failures.keys()];
    const reasons = skus.map((sku) => truncate(failures.get(sku) ?? ''));
    let settled = 0;
    if (skus.length > 0) {
      settled += affected(
        await this.repository.query(
          `UPDATE "mirakl_offer_writes" AS w
              SET "status" = 'failed', "error" = f.reason, "updatedAt" = now()
             FROM unnest($3::text[], $4::text[]) AS f(sku, reason)
            WHERE w."connectionId" = $1 AND w."importId" = $2
              AND w."status" = 'submitted' AND w."offerSku" = f.sku`,
          [connectionId, importId, skus, reasons],
        ),
      );
    }
    settled += affected(
      await this.repository.query(
        `UPDATE "mirakl_offer_writes"
            SET "status" = 'applied', "updatedAt" = now()
          WHERE "connectionId" = $1 AND "importId" = $2 AND "status" = 'submitted'`,
        [connectionId, importId],
      ),
    );
    return settled;
  }

  async failImport(connectionId: string, importId: string, reason: string): Promise<number> {
    return affected(
      await this.repository.query(
        `UPDATE "mirakl_offer_writes"
            SET "status" = 'failed', "error" = $3, "updatedAt" = now()
          WHERE "connectionId" = $1 AND "importId" = $2 AND "status" = 'submitted'`,
        [connectionId, importId, truncate(reason)],
      ),
    );
  }

  async deleteSettledBefore(connectionId: string, before: Date): Promise<number> {
    return affected(
      await this.repository.query(
        `DELETE FROM "mirakl_offer_writes"
          WHERE "connectionId" = $1 AND "status" IN ('applied', 'failed') AND "updatedAt" < $2`,
        [connectionId, before],
      ),
    );
  }
}

function toDomain(row: MiraklOfferWriteOrmEntity): MiraklOfferWrite {
  return new MiraklOfferWrite(
    row.id,
    row.connectionId,
    row.kind,
    row.offerSku,
    row.value,
    row.currency,
    row.status,
    row.importId,
    row.version,
    row.error,
    row.createdAt,
    row.updatedAt,
  );
}

/** Rows touched by a raw UPDATE or DELETE; the pg driver answers `[rows, count]`. */
function affected(result: unknown): number {
  if (Array.isArray(result) && typeof result[1] === 'number') {
    return result[1];
  }
  return 0;
}

function truncate(reason: string): string {
  return reason.length > MAX_ERROR_LENGTH ? `${reason.slice(0, MAX_ERROR_LENGTH - 1)}…` : reason;
}
