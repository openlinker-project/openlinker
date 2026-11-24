/**
 * Postgres access through `docker exec ... psql` (#3591)
 *
 * The G11 decisions allow SQL for exactly two things: reading back what the
 * stack wrote (snapshot columns, CHECK constraints) and the two seeds no flow
 * can produce - an old order imported after a cost exists (G11-G) and a wide
 * range for the CSV streaming check (CSV-7) - plus one `exchange_rates` row.
 * The container name comes from the setup file so no connection string is
 * needed from the host.
 *
 * @module support/g11
 */
import { spawnSync } from 'node:child_process';
import type { G11Setup } from './setup';

export function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface SqlResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export class G11Db {
  constructor(
    private readonly container: string,
    private readonly user: string,
    private readonly database: string,
  ) {}

  static from(setup: G11Setup): G11Db {
    return new G11Db(setup.postgresContainer, setup.db?.user ?? 'postgres', setup.db?.name ?? 'openlinker');
  }

  /** Run one statement; never throws, so a test can assert on a rejected one. */
  try(sql: string): SqlResult {
    const result = spawnSync(
      'docker',
      ['exec', '-i', this.container, 'psql', '-U', this.user, '-d', this.database, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    );
    return {
      ok: result.status === 0,
      stdout: result.stdout ?? '',
      stderr: (result.stderr ?? '') + (result.error ? String(result.error) : ''),
    };
  }

  exec(sql: string): void {
    const result = this.try(sql);
    if (!result.ok) {
      throw new Error(`psql failed: ${result.stderr.trim()}\nSQL: ${sql.slice(0, 400)}`);
    }
  }

  /** Rows of a SELECT as objects. Numeric columns arrive as numbers or strings per Postgres' JSON rules. */
  rows<T extends object>(select: string): T[] {
    const result = this.try(`SELECT coalesce(json_agg(t), '[]'::json) FROM (${select}) t`);
    if (!result.ok) {
      throw new Error(`psql failed: ${result.stderr.trim()}\nSQL: ${select.slice(0, 400)}`);
    }
    return JSON.parse(result.stdout.trim()) as T[];
  }

  scalar(select: string): string | null {
    const result = this.try(select);
    if (!result.ok) throw new Error(`psql failed: ${result.stderr.trim()}\nSQL: ${select.slice(0, 400)}`);
    const line = result.stdout.trim().split('\n')[0] ?? '';
    return line.length > 0 ? line : null;
  }
}

export interface LineSnapshotRow {
  lineNumber: number;
  variantId: string | null;
  quantity: number;
  unitCostNet: string | null;
  unitCostCurrency: string | null;
  costState: 'recorded' | 'not-recorded';
}

export function lineSnapshots(db: G11Db, internalOrderId: string): LineSnapshotRow[] {
  return db.rows<LineSnapshotRow>(
    `SELECT "lineNumber", "variantId", quantity, "unitCostNet"::text AS "unitCostNet",
            "unitCostCurrency", "costState"
       FROM order_line_items WHERE "orderRecordId" = ${lit(internalOrderId)} ORDER BY "lineNumber"`,
  );
}

export interface VariantCostRow {
  netUnitCost: string | null;
  costCurrency: string | null;
  costUpdatedAt: string | null;
  costUpdatedByUserId: string | null;
}

export function variantCostRow(db: G11Db, variantId: string): VariantCostRow | undefined {
  return db.rows<VariantCostRow>(
    `SELECT "netUnitCost"::text AS "netUnitCost", "costCurrency", "costUpdatedAt"::text AS "costUpdatedAt",
            "costUpdatedByUserId" FROM product_variants WHERE id = ${lit(variantId)}`,
  )[0];
}
