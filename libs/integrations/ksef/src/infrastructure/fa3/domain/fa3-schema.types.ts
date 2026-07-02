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
 * FA(3) `P_12` tax-rate codes — the complete set of 10 `TStawkaPodatku` tokens
 * the builder supports today. These are the exact enumeration values from the
 * vendored FA(3) v1-0E XSD `TStawkaPodatku` restriction — there is NO bare `np`
 * token; KSeF splits "not applicable / outside scope" into two distinct tokens
 * (`np I` and `np II`) that map to two distinct net-base elements (P_13_8 vs
 * P_13_9). Emitting a bare `np` is rejected by the schema.
 *
 * | Value    | Meaning                                                   |
 * |----------|-----------------------------------------------------------|
 * | `23`     | Standard rate 23%                                         |
 * | `8`      | Reduced rate 8%                                           |
 * | `5`      | Reduced rate 5%                                           |
 * | `0 KR`   | 0% — domestic (krajowa) zero-rate                         |
 * | `0 WDT`  | 0% — intra-EU supply of goods (WDT)                       |
 * | `0 EX`   | 0% — export                                               |
 * | `zw`     | Exempt (zwolnione)                                        |
 * | `oo`     | Reverse charge (odwrotne obciążenie)                     |
 * | `np I`   | Outside PL territory, general (XSD P_13_8)                |
 * | `np II`  | Services under art. 100(1)(4) — taxed in buyer's EU state (XSD P_13_9) |
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
  'np I',
  'np II',
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

/**
 * FA(3) `TFormaPlatnosci` payment-form codes (XSD line 1324, `xsd:integer`
 * restriction — the wire value is a numeric-string literal, not a label):
 *
 * | Value | Meaning |
 * |---|---|
 * | `1` | Gotówka (cash) |
 * | `2` | Karta (card) |
 * | `3` | Bon (voucher) |
 * | `4` | Czek (cheque) |
 * | `5` | Kredyt (credit) |
 * | `6` | Przelew (bank transfer) |
 * | `7` | Mobilna (mobile payment) |
 *
 * Declared three times by design (FA3 schema layer here, connection-config
 * layer `KsefFormaPlatnosciValues` in `ksef-connection.types.ts`, FE
 * `KSEF_FORMA_PLATNOSCI_VALUES` in `ksef-setup.schema.ts`) — a future 8th
 * code must be added in all three places.
 */
export const Fa3FormaPlatnosciValues = ['1', '2', '3', '4', '5', '6', '7'] as const;
export type Fa3FormaPlatnosci = (typeof Fa3FormaPlatnosciValues)[number];
