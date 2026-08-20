/**
 * Exchange Rate Repository Port
 *
 * APPEND-ONLY BY CONSTRUCTION. The port declares exactly two operations and
 * neither of them mutates: there is no `update`, no `upsert`, no `delete`, and
 * no `save` that carries an id. That is the guard - a stamped order points at a
 * registry row as evidence, so a rate that could be edited after the fact would
 * make every figure derived from it unverifiable.
 *
 * Adding a mutating method here is not a refactor; it changes what a stamp
 * means. A spec pins the absence, and an integration test pins that a second
 * get-or-create leaves an existing row byte-identical.
 *
 * @module libs/core/src/currency/domain/ports
 */
import type {
  ExchangeRate,
  ExchangeRateKey,
  StoredExchangeRate,
} from '../types/exchange-rate.types';

export interface ExchangeRateRepositoryPort {
  findByKey(key: ExchangeRateKey): Promise<StoredExchangeRate | null>;

  /**
   * Insert a newly fetched rate.
   *
   * Insert-then-recover, not `ON CONFLICT DO NOTHING`: on a unique violation
   * it raises the domain `DuplicateExchangeRateError` and the caller re-selects
   * the winner. That keeps the infrastructure-error to domain-error conversion
   * the engineering standards require of a repository, and it matches
   * `IdentifierMappingRepository.insertMapping`.
   *
   * @throws DuplicateExchangeRateError when the key is already registered
   */
  insertIfAbsent(rate: ExchangeRate): Promise<StoredExchangeRate>;
}
