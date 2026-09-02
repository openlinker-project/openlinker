/**
 * Display Currency Conversion Service Interface
 *
 * The read-only, request-scoped display-currency transform behind the
 * `/analytics` display-currency picker (#2458, ADR-064, pending in PR #2485). See the interface
 * methods' own doc comments for the two conversion modes.
 *
 * @module libs/core/src/orders/application/interfaces
 */
import type {
  CurrentRateConversionInput,
  CurrentRateConversionResult,
  OrderDateConversionInput,
  OrderDateConversionResult,
} from '../../domain/types/display-currency.types';

export interface IDisplayCurrencyConversionService {
  /**
   * Group `input.amounts` by distinct native currency and convert each group
   * to `input.displayCurrency` at today's rate. A currency with no resolvable
   * rate is reported in the result's `unresolvedNativeCurrencies` — never
   * thrown — and excluded from `convertedTotal`.
   */
  convertAtCurrentRate(input: CurrentRateConversionInput): Promise<CurrentRateConversionResult>;

  /**
   * Convert an already-computed reporting-currency total to
   * `input.displayCurrency`. Zero I/O when the two currencies already match;
   * otherwise resolves exactly one current rate and multiplies the whole
   * total once — never once per order.
   */
  convertAtOrderDate(input: OrderDateConversionInput): Promise<OrderDateConversionResult>;
}
