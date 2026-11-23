/**
 * Mirakl Error Report Parser: unit tests
 *
 * Fixtures are the reports Empik staging returned during SPIKE-4268: an OF03
 * offer report (quoted) and an STO03 stock report (unquoted).
 *
 * @module libs/integrations/mirakl/src/infrastructure/imports
 */
import { parseCsv, parseMiraklErrorReport } from '../mirakl-error-report.parser';

const OF03_REPORT = [
  '"sku";"product-id";"product-id-type";"description";"internal-description";"price";"price-ranges";"price-additional-info";"quantity";"min-quantity-alert";"state";"available-start-date";"available-end-date";"update-delete";"logistic-class";"discount-price";"discount-start-date";"discount-end-date";"discount-ranges";"leadtime-to-ship";"allow-quote-requests";"product-tax-code";"min-order-quantity";"max-order-quantity";"package-quantity";"pricing-unit";"error-line";"error-message"',
  '"OL-TEST-NOCARD";"5901234123457";"EAN";"";"";"10";"";"";"1";"";"11";"";"";"update";"1";"";"";"";"";"2";"false";"";"";"";"";"";"2";"The product does not exist"',
  '',
].join('\n');

const STO03_REPORT = [
  'line-number;errors;offer-sku;quantity',
  "2;No existing offer with SKU 'OL-DOES-NOT-EXIST' found;OL-DOES-NOT-EXIST;3",
  '',
].join('\n');

describe('parseMiraklErrorReport', () => {
  it('should read the reason, line and SKU when the report is an offer report', () => {
    expect(parseMiraklErrorReport(OF03_REPORT)).toEqual([
      { reason: 'The product does not exist', line: 2, sku: 'OL-TEST-NOCARD' },
    ]);
  });

  it('should read the reason, line and SKU when the report is a stock report', () => {
    expect(parseMiraklErrorReport(STO03_REPORT)).toEqual([
      {
        reason: "No existing offer with SKU 'OL-DOES-NOT-EXIST' found",
        line: 2,
        sku: 'OL-DOES-NOT-EXIST',
      },
    ]);
  });

  it('should fall back to the last error column when no known reason column exists', () => {
    expect(parseMiraklErrorReport('offer-sku;price;price-error\nA;1;Too low\n')).toEqual([
      { reason: 'Too low', sku: 'A' },
    ]);
  });

  it('should return no errors when the report has only a header', () => {
    expect(parseMiraklErrorReport('line-number;errors\n')).toEqual([]);
  });

  it('should return no errors when the report is empty', () => {
    expect(parseMiraklErrorReport('')).toEqual([]);
  });

  it('should skip rows whose reason is empty', () => {
    expect(parseMiraklErrorReport('line-number;errors\n2;\n3;Bad\n')).toEqual([
      { reason: 'Bad', line: 3 },
    ]);
  });
});

describe('parseCsv', () => {
  it('should keep delimiters, quotes and line breaks inside quoted cells', () => {
    expect(parseCsv('a;"b;c";"d ""e""\nf"\r\n1;2;3', ';')).toEqual([
      ['a', 'b;c', 'd "e"\nf'],
      ['1', '2', '3'],
    ]);
  });
});
