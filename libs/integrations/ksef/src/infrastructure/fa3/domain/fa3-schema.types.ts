/**
 * FA(3) Schema Enumerations
 *
 * FA(3)-specific enumerated wire values: the `P_12` tax-rate vocabulary and the
 * `KodWaluty` currency set. PL/KSeF specifics, package-local per ADR-026. Uses
 * the `as const` + union idiom (engineering-standards: no TS enum) so the values
 * are both a runtime array (validation) and a compile-time union.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/domain
 */

/**
 * FA(3) `P_12` tax-rate codes — the complete set of 9 values.
 *
 * | Value    | Meaning                                             |
 * |----------|-----------------------------------------------------|
 * | `23`     | Standard rate 23%                                   |
 * | `8`      | Reduced rate 8%                                     |
 * | `5`      | Reduced rate 5%                                     |
 * | `0 KR`   | 0% — domestic (krajowa) zero-rate                   |
 * | `0 WDT`  | 0% — intra-EU supply of goods (WDT)                 |
 * | `0 EX`   | 0% — export                                         |
 * | `zw`     | Exempt (zwolnione)                                  |
 * | `oo`     | Reverse charge / outside scope (odwrotne obciążenie)|
 * | `np`     | Not applicable (nie podlega)                        |
 */
export const Fa3P12Values = [
  '23',
  '8',
  '5',
  '0 KR',
  '0 WDT',
  '0 EX',
  'zw',
  'oo',
  'np',
] as const;
export type Fa3P12Value = (typeof Fa3P12Values)[number];

/**
 * FA(3) `KodWaluty` currency codes. Pinned to the common set the builder
 * supports today; the mapper validates ISO-4217 input against this allow-list
 * and throws `UnsupportedCurrencyException` on a miss (skeleton scope — the full
 * ISO-4217 set is a follow-up; PLN is the domestic default).
 */
export const Fa3KodWalutyValues = ['PLN', 'EUR', 'USD', 'GBP', 'CZK'] as const;
export type Fa3KodWaluty = (typeof Fa3KodWalutyValues)[number];
