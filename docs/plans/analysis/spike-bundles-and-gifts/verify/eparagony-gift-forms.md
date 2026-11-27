# eparagony.pl - gift line forms, live sandbox check (round 2)

Date: 2026-11-04. Environment: `sandbox.eparagony.pl` only (API v3, POS `openlinker`).
Probe script and raw outputs (not in the repo):
`/tmp/claude-1000/-home-nor-projekty-blocky-openlinker-pnpm-10--claude-worktrees-zestawy-gratisy-rekonesans-c15354/52953735-93f8-46bc-a17f-aa140611c437/scratchpad/eparagony-gift-probe-2/`
(`probe2.cjs`, `<test>_<rep>.json`, `<test><rep>.receipt.html`).

Every line used a fresh name `GiftV2-<epoch>-<test>-<n>` and one VAT rate per name, so the
Novitus "name killed after rate down-then-up" trap could not fire. Rates: A = 23%, B = 8%.
Amounts below are PLN; the API takes grosze. The body is built by the real receipt mapper
(`eparagony-document.mapper.js`) and then the `lines`, `grossSaleValue` and payment totals are
replaced per test.

## Results

| # | Lines sent (gross) | HTTP | Final | Printer | Printed per-rate (sales / VAT) |
|---|---|---|---|---|---|
| 5 | paid 10.00 A (baseline) | 202 | CONFIRMED | 7783 | A 10.00 / 1.87. Total 10.00 |
| 1 | paid 10.00 A + gift 5.00 B with line rebate -5.00 | 400 | errorCode 41 `Incorrectly calculated value of 'eReceipt.lines[1]'` | none (refused before the printer) | - |
| 2 | paid 10.00 A with line rebate -4.99 + gift 4.99 B | 202 | CONFIRMED | 7833 (stub, see note) | inconclusive |
| 2 (repeat) | same | 202 | CONFIRMED | 7783 | A 5.01 / 0.94, B 4.99 / 0.37. VAT 1.31. Total 10.00 |
| 3 | paid 10.00 A + gift 5.00 B + `REBATE` -5.00 `taxRate: B` | 400 | errorCode 41 `Incorrectly calculated value of 'eReceipt.lines[2]'` | none | - |
| 3b (extra) | paid 10.00 A + gift 5.00 B + `REBATE` -4.99 `taxRate: B` | 202 | CONFIRMED | 7783 | A 10.00 / 1.87, B 0.01 / 0.00. Total 10.01 |
| 4 | paid 10.00 A + paid 6.00 B + `REBATE` -2.00 `taxRate: A` | 202 | CONFIRMED | 7783 | A 8.00 / 1.50, B 6.00 / 0.44. VAT 1.94. Total 14.00 |

Arithmetic check (VAT = gross x r / (1 + r)): 5.01 x 23/123 = 0.937, 4.99 x 8/108 = 0.370,
8.00 x 23/123 = 1.496, 6.00 x 8/108 = 0.444. Every printed figure matches its own base.

Printer 7833 note: test 2 first went to `ZBN1901007833`. Its status carried `endTime`
2022-07-20 and the receipt view showed an unrelated canned receipt ("Usługa Cateringowa
460,00 B"). So 7833 is a sandbox stub that confirms anything; its CONFIRMED proves nothing.
The repeat landed on 7783 and is the result that counts.

## What this adds to round 1

- `REBATE` lines DO accept `taxRate` (spec `LineRebate.taxRate`, A-G). With a rate the rebate
  stays in that rate (test 4, test 3b). Without one it spreads across all rates (round 1).
- The service validates per rate before the printer: a rate whose net value after rebates is
  0.00 (or below) is refused with errorCode 41, whether the zeroing comes from a line
  `rebatesMarkups` (test 1) or a rate-scoped `REBATE` line (test 3). This is the same rule
  round 1 found for a 0.00 gift line alone in its rate.
- A rate left at 0.01 is accepted (test 3b, round 1 b8p), but then the receipt total is 0.01
  more than the order total.

## Conclusion

Accepted and VAT-correct:
- A gift that shares the VAT rate of a paid line, either at 0.00 or with a -100% line rebate
  (round 1). The rate's base stays positive and the VAT is exact.
- A real basket discount as a `REBATE` line WITH the `taxRate` of the line it reduces
  (test 4). Recommended form for any discount on a mixed-rate receipt.

Accepted but not a faithful gift:
- "Move value" (test 2): the receipt totals the order (10.00) and the VAT is arithmetically
  right for the split it prints, but 4.99 of the paid product's value is declared at 8%
  instead of 23% (VAT 1.31 instead of the baseline 1.87). That is OpenLinker inventing a
  price allocation the seller never made and lowering the tax due. Do not use.
- Leaving 0.01 in the gift's rate (test 3b, round 1 b8p): accepted, VAT right, but the
  receipt total is 0.01 above what the buyer paid. Do not use.

Refused by eparagony (errorCode 41, HTTP 400, nothing reaches the printer) - OpenLinker should
refuse these itself before calling, with an operator-facing reason:
- A gift whose VAT rate has no paid value on the same receipt: 0.00 line, -100% line rebate,
  or a rate-scoped `REBATE` that zeroes the rate (tests 1 and 3; round 1 a/b variants).
- Also avoid a rate-less document `REBATE` on a mixed-rate receipt (round 1): accepted but it
  prints wrong VAT, so it must never be sent.

Simplest safe rule for the mapper: omit a zero-value gift line entirely (baseline test 5 is
the correct fiscal result for "paid 10.00 + free gift"), or keep it only when another line
with positive value shares its rate. Express discounts only as `REBATE` with `taxRate`.
