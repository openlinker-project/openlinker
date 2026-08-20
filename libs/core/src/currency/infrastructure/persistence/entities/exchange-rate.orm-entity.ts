/**
 * Exchange Rate ORM Entity
 *
 * TypeORM mapping for the shared, APPEND-ONLY `exchange_rates` registry. Rows
 * are keyed `(source, fromCurrency, toCurrency, rateDate)`, so five hundred
 * EUR orders on one day resolve to one row rather than five hundred.
 *
 * TWO THINGS THE NEXT CONTRIBUTOR WILL WANT TO "FIX" - both deliberate:
 *
 *  1. `rate` is a `string` and must NOT be `Number()`-ed in `toDomain`. Every
 *     other money column in the repo is, which is exactly why this is spelled
 *     out here. The value is an audited 8-decimal figure read back out of a
 *     `numeric(18,8)` column; routing it through a binary float loses the
 *     guarantee that what we stored is what we report. There are zero
 *     `transformer:` usages in any `libs/core` ORM entity, so none is
 *     introduced here either.
 *
 *  2. `rate` means "the number of `toCurrency` units per one `fromCurrency`
 *     unit". A consumer MULTIPLIES, never divides. The registry is
 *     consumer-neutral - it stores published rates, not stamps - so a future
 *     consumer with a different target legitimately stores its own
 *     `(from, to)` rows without weakening the invariant.
 *
 * `fetchedAt` is an explicit `timestamptz` rather than `@CreateDateColumn()`,
 * which emits `timestamp without time zone` on Postgres and would silently
 * diverge from the migration's `timestamptz` (nothing in CI runs a migration
 * against the entity schema, so that divergence would go unnoticed).
 *
 * Column naming is quoted camelCase, matching `order_records`, NOT the
 * snake_case the singleton settings tables use. The two conventions coexist in
 * the repo; each table follows its own.
 *
 * @module libs/core/src/currency/infrastructure/persistence/entities
 */
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { RateDerivation } from '../../../domain/types/exchange-rate.types';

@Entity('exchange_rates')
@Index('UQ_exchange_rates_key', ['source', 'fromCurrency', 'toCurrency', 'rateDate'], {
  unique: true,
})
export class ExchangeRateOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** `'nbp' | 'ecb'` - see the migration's CHECK constraint. */
  @Column({ type: 'varchar', length: 16 })
  source!: string;

  /** ISO-4217, the unit being priced. */
  @Column({ type: 'varchar', length: 3 })
  fromCurrency!: string;

  /** ISO-4217, the unit the price is expressed in. */
  @Column({ type: 'varchar', length: 3 })
  toCurrency!: string;

  /**
   * The day the source published this rate for - what the source ANSWERED
   * with, not what was requested. Held as an ISO `YYYY-MM-DD` string, which is
   * what a Postgres `date` column returns.
   */
  @Column({ type: 'date' })
  rateDate!: string;

  /** `toCurrency` units per one `fromCurrency` unit. String on purpose. */
  @Column({ type: 'decimal', precision: 18, scale: 8 })
  rate!: string;

  /** The source's own document reference, e.g. NBP's `149/A/NBP/2026`. */
  @Column({ type: 'text', nullable: true })
  sourceRef!: string | null;

  /** The base a `pivot` derivation divided through; `NULL` = direct or inverted. */
  @Column({ type: 'varchar', length: 3, nullable: true })
  pivotCurrency!: string | null;

  /**
   * How this rate was obtained, with each leg's document reference. `NOT NULL`:
   * a direct rate records `{"kind":"direct","legs":[{...}]}`, so a consumer
   * never has to guess whether an empty column means "direct" or "unknown".
   */
  @Column({ type: 'jsonb' })
  derivation!: RateDerivation;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  fetchedAt!: Date;
}
